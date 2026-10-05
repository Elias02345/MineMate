import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  symlink,
  readFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, type MineMateApp } from "../apps/api/src/app.ts";
import { loadConfig } from "../apps/api/src/config.ts";
import { safePath } from "../packages/backup/src/paths.ts";
import {
  createArchive,
  extractArchive,
  hashFile,
} from "../packages/backup/src/archive.ts";
describe("persistent application and authentication", () => {
  let root: string, instance: MineMateApp, cookie: string, csrf: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "minemate-api-"));
    instance = await createApp({
      config: loadConfig({
        MINEMATE_DATA_PATH: root,
        MINEMATE_HOST_DATA_PATH: root,
      }),
      logger: false,
      monitor: false,
      static: false,
    });
  });
  afterEach(async () => {
    await instance.app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function owner() {
    const result = await instance.app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      headers: { origin: "http://localhost" },
      payload: { username: "Owner", password: "long-enough-password" },
    });
    expect(result.statusCode).toBe(200);
    cookie = result.headers["set-cookie"]!.toString().split(";")[0]!;
    csrf = (result.json() as { csrf: string }).csrf;
  }
  it("migrates once and persists the owner across reopen", async () => {
    await owner();
    expect(instance.store.all("SELECT * FROM migrations")).toHaveLength(1);
    await instance.app.close();
    instance = await createApp({
      config: loadConfig({
        MINEMATE_DATA_PATH: root,
        MINEMATE_HOST_DATA_PATH: root,
      }),
      logger: false,
      monitor: false,
      static: false,
    });
    expect(instance.store.users()).toHaveLength(1);
    expect(instance.store.all("SELECT * FROM migrations")).toHaveLength(1);
  });
  it("atomically closes first registration under racing attempts", async () => {
    const results = await Promise.all(
      ["Alex", "Steve"].map((username) =>
        instance.app.inject({
          method: "POST",
          url: "/api/v1/auth/bootstrap",
          headers: { origin: "http://localhost" },
          payload: { username, password: "long-enough-password" },
        }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(instance.store.users()).toHaveLength(1);
  });
  it("requires login and CSRF on mutations", async () => {
    expect((await instance.app.inject("/api/v1/servers")).statusCode).toBe(401);
    await owner();
    expect(
      (
        await instance.app.inject({
          method: "POST",
          url: "/api/v1/users",
          headers: {
            cookie,
            origin: "https://evil.invalid",
            "x-csrf-token": csrf,
          },
          payload: { username: "Guest", password: "long-enough-password" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await instance.app.inject({
          method: "POST",
          url: "/api/v1/users",
          headers: { cookie, origin: "http://localhost" },
          payload: { username: "Guest", password: "long-enough-password" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await instance.app.inject({
          method: "POST",
          url: "/api/v1/users",
          headers: { cookie, origin: "http://localhost", "x-csrf-token": csrf },
          payload: { username: "Guest", password: "long-enough-password" },
        })
      ).statusCode,
    ).toBe(200);
  });
  it("protects the owner and revokes disabled member sessions", async () => {
    await owner();
    const ownerId = instance.store.users()[0]!.id;
    expect(
      (
        await instance.app.inject({
          method: "PATCH",
          url: "/api/v1/users/" + ownerId,
          headers: { cookie, origin: "http://localhost", "x-csrf-token": csrf },
          payload: { enabled: false },
        })
      ).statusCode,
    ).toBe(400);
    await instance.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { cookie, origin: "http://localhost", "x-csrf-token": csrf },
      payload: { username: "Guest", password: "long-enough-password" },
    });
    const login = await instance.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: "http://localhost" },
        payload: { username: "Guest", password: "long-enough-password" },
      }),
      memberCookie = login.headers["set-cookie"]!.toString().split(";")[0]!;
    expect(
      (
        await instance.app.inject({
          url: "/api/v1/users",
          headers: { cookie: memberCookie },
        })
      ).statusCode,
    ).toBe(403);
    const member = instance.store.users().find((u) => u.role === "member")!;
    await instance.app.inject({
      method: "PATCH",
      url: "/api/v1/users/" + member.id,
      headers: { cookie, origin: "http://localhost", "x-csrf-token": csrf },
      payload: { enabled: false },
    });
    expect(
      (
        await instance.app.inject({
          url: "/api/v1/servers",
          headers: { cookie: memberCookie },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("keeps session tokens and integration credentials out of the database", async () => {
    await owner();
    const token = cookie.split("=")[1]!,
      rows = JSON.stringify(instance.store.all("SELECT * FROM sessions"));
    expect(rows).not.toContain(token);
    await instance.app.inject({
      method: "POST",
      url: "/api/v1/system/curseforge",
      headers: { cookie, origin: "http://localhost", "x-csrf-token": csrf },
      payload: { key: "test-secret-value" },
    });
    expect(
      JSON.stringify(instance.store.all("SELECT * FROM settings")),
    ).not.toContain("test-secret-value");
  });
  it("rejects symlink traversal and round-trips a verified archive", async () => {
    const input = path.join(root, "input"),
      output = path.join(root, "restored");
    await mkdir(input);
    await writeFile(path.join(input, "level.dat"), "world bytes");
    const archive = path.join(root, "backup.zip"),
      packed = await createArchive(input, archive);
    expect(await hashFile(archive)).toBe(packed.hash);
    await extractArchive(archive, output);
    expect(await readFile(path.join(output, "level.dat"), "utf8")).toBe(
      "world bytes",
    );
    await symlink("/etc", path.join(input, "escape"));
    await expect(safePath(input, "escape/passwd")).rejects.toThrow();
    await expect(
      createArchive(input, path.join(root, "unsafe.zip")),
    ).rejects.toThrow();
  });
});
