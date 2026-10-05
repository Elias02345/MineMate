import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp, type MineMateApp } from "../apps/api/src/app.ts";
import { loadConfig } from "../apps/api/src/config.ts";
import { FixtureDocker } from "./fixtures/docker.ts";
import { fixtureProtocol } from "./fixtures/protocol.ts";
import { revision } from "../apps/api/src/files.ts";
import type { Server } from "../packages/shared/src/index.ts";
import type net from "node:net";

describe("world operations with a controlled Docker fixture", () => {
  let root: string,
    instance: MineMateApp,
    server: Server,
    headers: Record<string, string>,
    protocol: net.Server;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "minemate-operations-"));
    protocol = await fixtureProtocol();
    instance = await createApp({
      config: loadConfig({
        MINEMATE_DATA_PATH: root,
        MINEMATE_HOST_DATA_PATH: root,
        MINEMATE_DISABLE_GATEWAY: "true",
        MINEMATE_JAVA_PORT_START: "57000",
      }),
      docker: new FixtureDocker(),
      logger: false,
      monitor: false,
      static: false,
    });
    const owner = await instance.app.inject({
      method: "POST",
      url: "/api/v1/auth/bootstrap",
      headers: { origin: "http://localhost" },
      payload: { username: "Owner", password: "long-enough-password" },
    });
    headers = {
      origin: "http://localhost",
      cookie: owner.headers["set-cookie"]!.toString().split(";")[0]!,
      "x-csrf-token": owner.json().csrf,
    };
    const created = await instance.app.inject({
      method: "POST",
      url: "/api/v1/servers",
      headers,
      payload: {
        name: "Recovery world",
        edition: "JAVA",
        software: "FABRIC",
        version: "1.21.1",
        memoryMb: 1024,
        cpu: 1,
        maxPlayers: 10,
        eula: true,
      },
    });
    expect(created.statusCode).toBe(202);
    server = created.json().server;
    await finish(created.json().operation.id);
    server = instance.servers.get(server.id);
    await instance.servers.start(server);
    await instance.servers.waitReady(server);
  });
  afterEach(async () => {
    await instance.app.close();
    await new Promise<void>((resolve) => protocol.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  async function finish(id: string) {
    for (let i = 0; i < 300; i++) {
      const row = instance.store.get(
        "SELECT * FROM operations WHERE id=?",
        id,
      )!;
      const op = instance.store.operation(row);
      if (!["QUEUED", "RUNNING"].includes(op.status)) return op;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("Fixture job did not finish");
  }
  async function action(kind: string, payload: Record<string, unknown> = {}) {
    const op = instance.jobs.enqueue(
      server.id,
      instance.store.users()[0]!.id,
      kind,
      payload,
    );
    return finish(op.id);
  }
  it("restores bytes, inventory, resource settings and the original LAN port together", async () => {
    const directory = instance.servers.paths.server(server.id);
    await mkdir(path.join(directory, "mods"));
    await writeFile(
      path.join(directory, "mods/manual.jar"),
      "trusted fixture bytes",
    );
    await instance.content.inventory(server);
    const inventoryHash = instance.store.content(server.id)[0]!.hash;
    await action("backup");
    const backup = instance.store.backups(server.id)[0]!;
    const originalPort = server.port;
    await instance.servers.stop(server);
    server.port = 57001;
    instance.store.run(
      "UPDATE servers SET port=? WHERE id=?",
      server.port,
      server.id,
    );
    server.config.memoryMb = 2048;
    instance.store.saveServer(server);
    await writeFile(path.join(directory, "world/level.dat"), "changed world");
    await writeFile(path.join(directory, "mods/manual.jar"), "changed archive");
    await instance.content.inventory(server);
    await instance.backups.restore(server, backup.id);
    expect(server.port).toBe(originalPort);
    expect(server.config.memoryMb).toBe(1024);
    expect(
      await readFile(path.join(directory, "world/level.dat"), "utf8"),
    ).toBe("controlled test world");
    expect(instance.store.content(server.id)[0]!.hash).toBe(inventoryHash);
    expect(instance.store.content(server.id)[0]!.managed).toBe(false);
    expect(
      await readFile(path.join(directory, "mods/manual.jar"), "utf8"),
    ).toBe("trusted fixture bytes");
    expect(instance.servers.get(server.id).port).toBe(originalPort);
  });
  it("blocks an update when imported content cannot be verified for the target", async () => {
    await mkdir(instance.servers.paths.server(server.id) + "/mods");
    await writeFile(
      instance.servers.paths.server(server.id) + "/mods/unidentified.jar",
      "fixture archive",
    );
    const check = await instance.updates.check(server, "1.21.2");
    expect(check.compatible).toBe(false);
    expect(check.blocked).toContain("mods/unidentified.jar");
    expect(check.items[0]!.state).toBe("UNCERTAIN");
  });
  it("rejects stale edits without overwriting newer configuration and supports archive creation", async () => {
    const filename = instance.servers.paths.server(server.id) + "/config.json";
    await writeFile(filename, '{"value":1}');
    const original = revision('{"value":1}');
    await writeFile(filename, '{"value":2}');
    expect(
      (
        await action("file", {
          action: "write",
          path: "config.json",
          text: '{"value":3}',
          revision: original,
        })
      ).status,
    ).toBe("FAILED");
    expect(await readFile(filename, "utf8")).toBe('{"value":2}');
    expect(
      (
        await action("file", {
          action: "write",
          path: "config.json",
          text: "invalid json",
          revision: revision('{"value":2}'),
        })
      ).status,
    ).toBe("FAILED");
    expect(await readFile(filename, "utf8")).toBe('{"value":2}');
    expect(
      (
        await action("file", {
          action: "archive",
          path: "world",
          destination: "world-export.zip",
        })
      ).status,
    ).toBe("SUCCEEDED");
    expect(
      (await readdir(instance.servers.paths.server(server.id))).includes(
        "world-export.zip",
      ),
    ).toBe(true);
  });
  it("rejects invalid archives at the HTTP boundary and cleans their staging files", async () => {
    const boundary = "minemate-test-boundary",
      payload = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="first.jar"\r\nContent-Type: application/java-archive\r\n\r\nnot a jar\r\n--${boundary}--\r\n`,
      );
    const result = await instance.app.inject({
      method: "POST",
      url: `/api/v1/servers/${server.id}/uploads?kind=jar&confirm=true`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(result.statusCode).toBe(400);
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
  });
  it("completes a staged configuration upload and cleans its moved source", async () => {
    const boundary = "minemate-file-boundary",
      content = '{"setting":true}',
      payload = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="uploaded.json"\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--\r\n`,
      );
    const response = await instance.app.inject({
      method: "POST",
      url: `/api/v1/servers/${server.id}/uploads?kind=file&confirm=true`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(response.statusCode).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    expect(
      await readFile(
        instance.servers.paths.server(server.id) + "/uploaded.json",
        "utf8",
      ),
    ).toBe(content);
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
    expect(
      instance.store
        .backups(server.id)
        .some((b) => b.reason === "before file upload"),
    ).toBe(true);
  });
  it("limits a view-only member to the explicitly shared world", async () => {
    await instance.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers,
      payload: { username: "Guest", password: "long-enough-password" },
    });
    const guest = instance.store.users().find((u) => u.role === "member")!;
    await instance.app.inject({
      method: "PUT",
      url: `/api/v1/servers/${server.id}/permissions`,
      headers,
      payload: { userId: guest.id, permissions: ["view"] },
    });
    const login = await instance.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: "http://localhost" },
        payload: { username: "Guest", password: "long-enough-password" },
      }),
      member = {
        origin: "http://localhost",
        cookie: login.headers["set-cookie"]!.toString().split(";")[0]!,
        "x-csrf-token": login.json().csrf,
      };
    expect(
      (
        await instance.app.inject({ url: "/api/v1/servers", headers: member })
      ).json(),
    ).toHaveLength(1);
    for (const route of ["files", "console", "permissions"])
      expect(
        (
          await instance.app.inject({
            url: `/api/v1/servers/${server.id}/${route}`,
            headers: member,
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await instance.app.inject({
          method: "POST",
          url: `/api/v1/servers/${server.id}/lifecycle`,
          headers: member,
          payload: { action: "stop" },
        })
      ).statusCode,
    ).toBe(403);
  });
});
