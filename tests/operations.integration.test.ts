import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import yazl from "yazl";
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
import { createHash } from "node:crypto";
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
    for (let i = 0; i < 1500; i++) {
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
  async function archive(
    entries: Record<string, string | Buffer> | [string, string | Buffer][],
  ) {
    const zip = new yazl.ZipFile(),
      chunks: Buffer[] = [];
    for (const [name, text] of Array.isArray(entries)
      ? entries
      : Object.entries(entries))
      zip.addBuffer(Buffer.from(text), name);
    const done = new Promise<Buffer>((resolve, reject) => {
      zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      zip.outputStream.on("error", reject);
      zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    });
    zip.end();
    return done;
  }
  async function upload(
    kind: string,
    files: { name: string; data: Buffer }[],
    relativePaths?: string[],
    query = "",
  ) {
    const boundary = "minemate-upload-boundary",
      chunks: Buffer[] = [];
    if (relativePaths)
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="relativePaths"\r\n\r\n${JSON.stringify(relativePaths)}\r\n`,
        ),
      );
    for (const file of files)
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        file.data,
        Buffer.from("\r\n"),
      );
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return instance.app.inject({
      method: "POST",
      url: `/api/v1/servers/${server.id}/uploads?kind=${kind}&confirm=true${query}`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat(chunks),
    });
  }
  it("installs multiple mod JARs without optional manifests in one recovery-protected batch", async () => {
    await instance.servers.stop(server);
    const jar = await archive({
      "fabric.mod.json": '{"id":"fixture","version":"1"}',
      "example/Mod.class": "controlled fixture",
    });
    const response = await upload("jar", [
      { name: "mod-one.jar", data: jar },
      { name: "mod-two [server].jar", data: jar },
    ]);
    expect(response.statusCode, response.body).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    expect(
      instance.store
        .content(server.id)
        .map((i) => i.filename)
        .sort(),
    ).toEqual(["mods/mod-one.jar", "mods/mod-two [server].jar"]);
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "mods/mod-one.jar"),
      ),
    ).toEqual(jar);
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
    expect(instance.store.backups(server.id)).toHaveLength(1);
  });
  it("resumes checked chunks and installs a validated mod batch exactly once", async () => {
    const jar = await archive({
      "fabric.mod.json": '{"id":"fixture"}',
      "example/Mod.class": "fixture",
    });
    const base = `/api/v1/servers/${server.id}/upload-sessions`;
    const created = await instance.app.inject({
      method: "POST",
      url: base,
      headers,
      payload: {
        kind: "jar",
        confirm: true,
        files: ["one.jar", "two.jar"].map((name) => ({
          name,
          size: jar.length,
        })),
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const part = jar.subarray(0, Math.floor(jar.length / 2));
    const send = (
      index: number,
      offset: number,
      bytes: Buffer,
      hash = createHash("sha256").update(bytes).digest("hex"),
    ) =>
      instance.app.inject({
        method: "PUT",
        url: `${base}/${id}/files/${index}`,
        headers: {
          ...headers,
          "content-type": "application/octet-stream",
          "x-upload-offset": String(offset),
          "x-upload-sha256": hash,
        },
        payload: bytes,
      });
    const bad = await send(0, 0, part, "0".repeat(64));
    expect(bad.statusCode).toBe(422);
    expect(
      (
        await instance.app.inject({
          method: "GET",
          url: `${base}/${id}`,
          headers,
        })
      ).json().files[0].offset,
    ).toBe(0);
    expect((await send(0, 0, part)).statusCode).toBe(200);
    expect((await send(0, 0, part)).statusCode).toBe(409);
    expect(
      (
        await instance.app.inject({
          method: "GET",
          url: `${base}/${id}`,
          headers,
        })
      ).json().files[0].offset,
    ).toBe(part.length);
    expect(
      (await send(0, part.length, jar.subarray(part.length))).statusCode,
    ).toBe(200);
    expect((await send(1, 0, jar)).statusCode).toBe(200);
    const mismatched = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/files/0/validate`,
      headers,
      payload: { sha256: "0".repeat(64) },
    });
    expect(mismatched.statusCode).toBe(422);
    expect(
      (
        await instance.app.inject({
          method: "POST",
          url: `${base}/${id}/files/0/reset`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect((await send(0, 0, jar)).statusCode).toBe(200);
    for (const index of [0, 1]) {
      const validated = await instance.app.inject({
        method: "POST",
        url: `${base}/${id}/files/${index}/validate`,
        headers,
        payload: { sha256: createHash("sha256").update(jar).digest("hex") },
      });
      expect(validated.statusCode, validated.body).toBe(200);
    }
    const completed = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/finish`,
      headers,
      payload: {},
    });
    expect(completed.statusCode, completed.body).toBe(202);
    expect((await finish(completed.json().operation.id)).status).toBe(
      "SUCCEEDED",
    );
    const repeated = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/finish`,
      headers,
      payload: {},
    });
    expect(repeated.json().operation.id).toBe(completed.json().operation.id);
    expect(instance.store.backups(server.id)).toHaveLength(1);
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "mods/one.jar"),
      ),
    ).toEqual(jar);
  });
  it("reuses uploaded mods when a rejected JAR is removed from a wizard batch", async () => {
    const base = `/api/v1/servers/${server.id}/upload-sessions`;
    const good = await archive({ "fabric.mod.json": '{"id":"fixture"}' });
    const bad = await archive({ "README.txt": "not a mod" });
    const selected = [
      { name: "one.jar", size: good.length, lastModified: 123 },
      { name: "bad.jar", size: bad.length, lastModified: 123 },
      { name: "two.jar", size: good.length, lastModified: 123 },
    ];
    const create = (files: typeof selected, resumeFrom?: string) =>
      instance.app.inject({
        method: "POST",
        url: base,
        headers,
        payload: { kind: "jar", confirm: true, files, resumeFrom },
      });
    const first = await create(selected);
    expect(first.statusCode, first.body).toBe(201);
    const firstId = first.json().id as string;
    for (const [index, bytes] of [good, bad, good].entries()) {
      const part = await instance.app.inject({
        method: "PUT",
        url: `${base}/${firstId}/files/${index}`,
        headers: {
          ...headers,
          "content-type": "application/octet-stream",
          "x-upload-offset": "0",
          "x-upload-sha256": createHash("sha256").update(bytes).digest("hex"),
        },
        payload: bytes,
      });
      expect(part.statusCode, part.body).toBe(200);
    }
    const rejected = await instance.app.inject({
      method: "POST",
      url: `${base}/${firstId}/files/1/validate`,
      headers,
      payload: { sha256: createHash("sha256").update(bad).digest("hex") },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().message).toContain(
      "bad.jar: This JAR has no Java classes or recognized mod/plugin metadata.",
    );
    const retry = await create([selected[0]!, selected[2]!], firstId);
    expect(retry.statusCode, retry.body).toBe(201);
    expect(
      retry.json().files.map((file: { offset: number }) => file.offset),
    ).toEqual([good.length, good.length]);
    const retryId = retry.json().id as string;
    for (const index of [0, 1]) {
      const checked = await instance.app.inject({
        method: "POST",
        url: `${base}/${retryId}/files/${index}/validate`,
        headers,
        payload: { sha256: createHash("sha256").update(good).digest("hex") },
      });
      expect(checked.statusCode, checked.body).toBe(200);
    }
    const finished = await instance.app.inject({
      method: "POST",
      url: `${base}/${retryId}/finish`,
      headers,
      payload: {},
    });
    expect(finished.statusCode, finished.body).toBe(202);
    expect((await finish(finished.json().operation.id)).status).toBe(
      "SUCCEEDED",
    );
    expect(
      instance.store
        .content(server.id)
        .map((item) => item.filename)
        .sort(),
    ).toEqual(["mods/one.jar", "mods/two.jar"]);
    expect(instance.store.backups(server.id)).toHaveLength(1);
  });
  it("accepts 464 separately acknowledged files without a per-minute request cap", async () => {
    const base = `/api/v1/servers/${server.id}/upload-sessions`;
    const files = Array.from({ length: 464 }, (_, i) => ({
      name: `batch-${i}.txt`,
      size: 1,
    }));
    const created = await instance.app.inject({
      method: "POST",
      url: base,
      headers,
      payload: { kind: "file", confirm: true, files },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const bytes = Buffer.from("x");
    const hash = createHash("sha256").update(bytes).digest("hex");
    for (let i = 0; i < files.length; i++) {
      const part = await instance.app.inject({
        method: "PUT",
        url: `${base}/${id}/files/${i}`,
        headers: {
          ...headers,
          "content-type": "application/octet-stream",
          "x-upload-offset": "0",
          "x-upload-sha256": hash,
        },
        payload: bytes,
      });
      expect(part.statusCode, `chunk ${i}: ${part.body}`).toBe(200);
      const validated = await instance.app.inject({
        method: "POST",
        url: `${base}/${id}/files/${i}/validate`,
        headers,
        payload: { sha256: hash },
      });
      expect(validated.statusCode, `file ${i}: ${validated.body}`).toBe(200);
    }
    const completed = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/finish`,
      headers,
      payload: {},
    });
    expect(completed.statusCode, completed.body).toBe(202);
    expect((await finish(completed.json().operation.id)).status).toBe(
      "SUCCEEDED",
    );
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "batch-463.txt"),
        "utf8",
      ),
    ).toBe("x");
    expect(instance.store.backups(server.id)).toHaveLength(1);
  });
  it.skipIf(!process.env.RUN_LARGE_UPLOAD_TEST)(
    "streams and verifies a file larger than the old 512 MiB limit",
    async () => {
      const base = `/api/v1/servers/${server.id}/upload-sessions`;
      const chunk = Buffer.alloc(1024 * 1024, 0x5a);
      const chunkHash = createHash("sha256").update(chunk).digest("hex");
      const full = createHash("sha256");
      const count = 513;
      const created = await instance.app.inject({
        method: "POST",
        url: base,
        headers,
        payload: {
          kind: "file",
          confirm: true,
          files: [{ name: "large.dat", size: count * chunk.length }],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json().id as string;
      for (let i = 0; i < count; i++) {
        const part = await instance.app.inject({
          method: "PUT",
          url: `${base}/${id}/files/0`,
          headers: {
            ...headers,
            "content-type": "application/octet-stream",
            "x-upload-offset": String(i * chunk.length),
            "x-upload-sha256": chunkHash,
          },
          payload: chunk,
        });
        expect(part.statusCode, `part ${i}: ${part.body}`).toBe(200);
        full.update(chunk);
      }
      const resumed = await instance.app.inject({
        method: "GET",
        url: `${base}/${id}`,
        headers,
      });
      expect(resumed.json().files[0].offset).toBe(count * chunk.length);
      const checked = await instance.app.inject({
        method: "POST",
        url: `${base}/${id}/files/0/validate`,
        headers,
        payload: { sha256: full.digest("hex") },
      });
      expect(checked.statusCode, checked.body).toBe(200);
      expect(
        (
          await instance.app.inject({
            method: "DELETE",
            url: `${base}/${id}`,
            headers,
          })
        ).statusCode,
      ).toBe(200);
    },
  );
  it("imports a Modrinth server pack through the resumable archive path", async () => {
    const pack = await archive({
      "modrinth.index.json": JSON.stringify({
        formatVersion: 1,
        game: "minecraft",
        dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.0" },
        files: [],
      }),
      "server-overrides/config/pack.toml": "enabled = true\n",
      "client-overrides/config/client.toml": "client only\n",
    });
    const base = `/api/v1/servers/${server.id}/upload-sessions`;
    const created = await instance.app.inject({
      method: "POST",
      url: base,
      headers,
      payload: {
        kind: "modpack",
        confirm: true,
        files: [{ name: "server.mrpack", size: pack.length }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const hash = createHash("sha256").update(pack).digest("hex");
    const part = await instance.app.inject({
      method: "PUT",
      url: `${base}/${id}/files/0`,
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "x-upload-offset": "0",
        "x-upload-sha256": hash,
      },
      payload: pack,
    });
    expect(part.statusCode, part.body).toBe(200);
    const validated = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/files/0/validate`,
      headers,
      payload: { sha256: hash },
    });
    expect(validated.statusCode, validated.body).toBe(200);
    const completed = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/finish`,
      headers,
      payload: {},
    });
    expect(completed.statusCode, completed.body).toBe(202);
    const op = await finish(completed.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "config/pack.toml"),
        "utf8",
      ),
    ).toBe("enabled = true\n");
    expect(
      await readdir(
        path.join(instance.servers.paths.server(server.id), "config"),
      ),
    ).not.toContain("client.toml");
  });
  it("imports an ATM-style NeoForge server ZIP without running its host scripts", async () => {
    const installer = await archive({
      "install_profile.json": JSON.stringify({
        minecraft: "26.1.2",
        version: "neoforge-26.1.2.109",
      }),
    });
    const mod = await archive([
      ["META-INF/neoforge.mods.toml", "[[mods]]"],
      ["example/Mod.class", "fixture"],
      ["META-INF/LICENSE.txt", "shared license"],
      ["META-INF/LICENSE.txt", "shared license"],
    ]);
    const nested = "META-INF/jarjar/mezz_config.jar";
    const jarJar = await archive({
      "META-INF/jarjar/metadata.json": JSON.stringify({
        jars: [{ path: nested }],
      }),
      [nested]: mod,
    });
    const pack = await archive({
      "neoforge-26.1.2.109-installer.jar": installer,
      "mods/ars_nouveau-1.21.1-5.13.1.jar": mod,
      "mods/mezz_config-standalone.jar": jarJar,
      "config/atm.toml": "enable = true\n",
      "kubejs/server_scripts/atm.js": "// game content\n",
      "server-icon.png": "image fixture",
      "startserver.sh": "exit 99\n",
      "user_jvm_args.txt": "-Xmx100G\n",
      "eula.txt": "eula=false\n",
      "server.properties": "server-port=1\n",
    });
    const base = `/api/v1/servers/${server.id}/upload-sessions`;
    const wrongType = await instance.app.inject({
      method: "POST",
      url: base,
      headers,
      payload: {
        kind: "atm",
        confirm: true,
        files: [{ name: "client.mrpack", size: pack.length }],
      },
    });
    expect(wrongType.statusCode).toBe(400);
    const created = await instance.app.inject({
      method: "POST",
      url: base,
      headers,
      payload: {
        kind: "atm",
        confirm: true,
        files: [{ name: "ServerFiles-0.10.0-beta.zip", size: pack.length }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const hash = createHash("sha256").update(pack).digest("hex");
    const part = await instance.app.inject({
      method: "PUT",
      url: `${base}/${id}/files/0`,
      headers: {
        ...headers,
        "content-type": "application/octet-stream",
        "x-upload-offset": "0",
        "x-upload-sha256": hash,
      },
      payload: pack,
    });
    expect(part.statusCode, part.body).toBe(200);
    const checked = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/files/0/validate`,
      headers,
      payload: { sha256: hash },
    });
    expect(checked.statusCode, checked.body).toBe(200);
    const finished = await instance.app.inject({
      method: "POST",
      url: `${base}/${id}/finish`,
      headers,
      payload: {},
    });
    expect(finished.statusCode, finished.body).toBe(202);
    const operation = await finish(finished.json().operation.id);
    expect(operation.status, operation.error ?? undefined).toBe("SUCCEEDED");
    const config = instance.servers.get(server.id).config;
    expect(config).toMatchObject({
      software: "NEOFORGE",
      version: "26.1.2",
      loaderVersion: "26.1.2.109",
      serverSource: "upload",
      java: "auto",
    });
    const root = instance.servers.paths.server(server.id);
    expect(await readFile(path.join(root, "server-installer.jar"))).toEqual(
      installer,
    );
    expect(await readFile(path.join(root, "config/atm.toml"), "utf8")).toBe(
      "enable = true\n",
    );
    expect(
      await readFile(path.join(root, "kubejs/server_scripts/atm.js"), "utf8"),
    ).toBe("// game content\n");
    expect(
      instance.store
        .content(server.id)
        .map((item) => item.filename)
        .sort(),
    ).toEqual([
      "mods/ars_nouveau-1.21.1-5.13.1.jar",
      "mods/mezz_config-standalone.jar",
    ]);
    for (const name of ["startserver.sh", "user_jvm_args.txt"])
      await expect(readFile(path.join(root, name))).rejects.toMatchObject({
        code: "ENOENT",
      });
    expect(await readFile(path.join(root, "eula.txt"), "utf8")).toBe(
      "eula=true\n",
    );
    expect(instance.store.backups(server.id)).toHaveLength(1);
  });
  it("rejects a whole invalid or duplicate JAR batch before stopping the server", async () => {
    const jar = await archive({ "example/Mod.class": "fixture" });
    for (const files of [
      [
        { name: "good.jar", data: jar },
        { name: "bad.jar", data: Buffer.from("invalid") },
      ],
      [
        { name: "same.jar", data: jar },
        { name: "same.jar", data: jar },
      ],
    ]) {
      const response = await upload("jar", files);
      expect(response.statusCode).toBe(400);
      expect(instance.servers.get(server.id).state).toBe("RUNNING");
      expect(
        await readdir(instance.servers.paths.server(server.id, "uploads")),
      ).toEqual([]);
      expect(instance.store.content(server.id)).toHaveLength(0);
    }
  });
  it.each(["FABRIC", "PAPER"] as const)(
    "installs 1,001 %s JARs in one batch with one recovery point",
    async (software) => {
      if (software !== server.config.software) {
        await instance.servers.stop(server);
        await instance.servers.replaceContainer(server, {
          ...server.config,
          software,
        });
        server = instance.servers.get(server.id);
        await instance.servers.start(server);
        await instance.servers.waitReady(server);
      }
      const jar = await archive(
        software === "PAPER"
          ? { "plugin.yml": "name: Fixture\nmain: example.Plugin\n" }
          : { "fabric.mod.json": '{"id":"fixture","version":"1"}' },
      );
      const files = Array.from({ length: 1001 }, (_, i) => ({
        name: `content-${i}.jar`,
        data: jar,
      }));
      const response = await upload("jar", files);
      expect(response.statusCode, response.body).toBe(202);
      const op = await finish(response.json().operation.id);
      expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
      const directory = software === "PAPER" ? "plugins" : "mods";
      expect(instance.store.content(server.id)).toHaveLength(files.length);
      expect(
        await readdir(
          path.join(instance.servers.paths.server(server.id), directory),
        ),
      ).toHaveLength(files.length);
      expect(
        await readFile(
          path.join(
            instance.servers.paths.server(server.id),
            directory,
            files.at(-1)!.name,
          ),
        ),
      ).toEqual(jar);
      expect(instance.store.backups(server.id)).toHaveLength(1);
      expect(instance.servers.get(server.id).state).toBe("RUNNING");
      expect(
        await readdir(instance.servers.paths.server(server.id, "uploads")),
      ).toEqual([]);
    },
  );
  it("cleans a large invalid batch and accepts the corrected retry atomically", async () => {
    const jar = await archive({ "fabric.mod.json": '{"id":"fixture"}' });
    const files = Array.from({ length: 150 }, (_, i) => ({
      name: `retry-${i}.jar`,
      data: jar,
    }));
    const rejected = await upload("jar", [
      ...files,
      { name: "invalid.jar", data: Buffer.from("invalid") },
    ]);
    expect(rejected.statusCode).toBe(400);
    expect(instance.servers.get(server.id).state).toBe("RUNNING");
    expect(instance.store.content(server.id)).toHaveLength(0);
    expect(instance.store.backups(server.id)).toHaveLength(0);
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
    const retried = await upload("jar", files);
    expect(retried.statusCode, retried.body).toBe(202);
    expect((await finish(retried.json().operation.id)).status).toBe(
      "SUCCEEDED",
    );
    expect(instance.store.content(server.id)).toHaveLength(files.length);
    expect(instance.store.backups(server.id)).toHaveLength(1);
    expect(instance.servers.get(server.id).state).toBe("RUNNING");
  });
  it("uploads 1,001 ordinary files without a multipart part-count ceiling", async () => {
    const files = Array.from({ length: 1001 }, (_, i) => ({
      name: `file-${i}.txt`,
      data: Buffer.from(`content ${i}`),
    }));
    const response = await upload(
      "file",
      files,
      undefined,
      "&directory=extras",
    );
    expect(response.statusCode, response.body).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    const directory = path.join(
      instance.servers.paths.server(server.id),
      "extras",
    );
    expect(await readdir(directory)).toHaveLength(files.length);
    expect(await readFile(path.join(directory, files.at(-1)!.name))).toEqual(
      files.at(-1)!.data,
    );
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
  });
  it("uses an uploaded NeoForge installer as server software and keeps mods separate", async () => {
    await instance.servers.stop(server);
    const create = vi.spyOn(instance.servers.docker, "create");
    const installer = await archive({
      "META-INF/MANIFEST.MF":
        "Manifest-Version: 1.0\nMain-Class: net.neoforged.installer.Main\n",
      "install_profile.json": JSON.stringify({
        minecraft: "1.21.1",
        path: "net.neoforged:neoforge:21.1.200",
      }),
    });
    const response = await upload(
      "custom",
      [{ name: "neoforge.jar", data: installer }],
      undefined,
      "&software=NEOFORGE",
    );
    expect(response.statusCode, response.body).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    server = instance.servers.get(server.id);
    expect(server.config.software).toBe("NEOFORGE");
    expect(server.config.serverSource).toBe("upload");
    expect(create.mock.calls.at(-1)![1].Env).toContain(
      "NEOFORGE_INSTALLER=/data/server-installer.jar",
    );
    expect(create.mock.calls.at(-1)![1].Env).toContain("TYPE=NEOFORGE");
    expect(
      await readFile(
        path.join(
          instance.servers.paths.server(server.id),
          "server-installer.jar",
        ),
      ),
    ).toEqual(installer);
    expect(instance.store.content(server.id)).toHaveLength(0);
    const mod = await archive({
      "META-INF/neoforge.mods.toml": "modLoader=javafml",
      "example/Mod.class": "fixture",
    });
    const mods = await upload("jar", [{ name: "neo-mod.jar", data: mod }]);
    expect((await finish(mods.json().operation.id)).status).toBe("SUCCEEDED");
    expect(instance.store.content(server.id)[0]!.filename).toBe(
      "mods/neo-mod.jar",
    );
    create.mockRestore();
  });
  it("rejects the wrong installer version and non-executable server JARs", async () => {
    const installer = await archive({
      "install_profile.json": JSON.stringify({
        minecraft: "1.20.1",
        path: "net.neoforged:neoforge:20.1",
      }),
    });
    expect(
      (
        await upload(
          "custom",
          [{ name: "neo.jar", data: installer }],
          undefined,
          "&software=NEOFORGE",
        )
      ).json().code,
    ).toBe("INSTALLER_VERSION");
    const neo = await archive({
      "install_profile.json": JSON.stringify({
        minecraft: "1.21.1",
        version: "neoforge-21.1.255",
      }),
    });
    expect(
      (
        await upload(
          "custom",
          [{ name: "neoforge.jar", data: neo }],
          undefined,
          "&software=FORGE",
        )
      ).json().code,
    ).toBe("INSTALLER_LOADER");
    const mod = await archive({
      "fabric.mod.json": "{}",
      "example/Mod.class": "fixture",
    });
    expect(
      (
        await upload(
          "custom",
          [{ name: "mod.jar", data: mod }],
          undefined,
          "&software=CUSTOM",
        )
      ).json().code,
    ).toBe("SERVER_JAR");
    expect(instance.servers.get(server.id).state).toBe("RUNNING");
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
  });
  it("uploads a directly executable Custom server and then accepts a separate mod batch", async () => {
    await instance.servers.stop(server);
    const jar = await archive({
      "META-INF/MANIFEST.MF":
        "Manifest-Version: 1.0\nMain-Class: example.Server\n",
      "example/Server.class": "fixture",
    });
    const response = await upload(
      "custom",
      [{ name: "my-server.jar", data: jar }],
      undefined,
      "&software=CUSTOM",
    );
    expect((await finish(response.json().operation.id)).status).toBe(
      "SUCCEEDED",
    );
    const mods = await upload("jar", [{ name: "custom-mod.jar", data: jar }]);
    expect((await finish(mods.json().operation.id)).status).toBe("SUCCEEDED");
    expect(instance.store.content(server.id)[0]!.filename).toBe(
      "mods/custom-mod.jar",
    );
  });
  it("imports a wrapped world ZIP and preserves its dimensions and region files", async () => {
    await instance.servers.stop(server);
    const zip = await archive({
      "export/My world/level.dat": "uploaded world",
      "export/My world/region/r.0.0.mca": "region",
      "export/My world/DIM-1/region/r.0.0.mca": "nether",
      "README.txt": "wrapper metadata",
    });
    const response = await upload("world", [{ name: "world.zip", data: zip }]);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "world/level.dat"),
        "utf8",
      ),
    ).toBe("uploaded world");
    expect(
      await readFile(
        path.join(
          instance.servers.paths.server(server.id),
          "world/DIM-1/region/r.0.0.mca",
        ),
        "utf8",
      ),
    ).toBe("nether");
    expect(
      await readdir(instance.servers.paths.server(server.id, "imports")),
    ).toEqual([]);
  });
  it("streams world folders with 10,001 files while preserving relative paths", async () => {
    await instance.servers.stop(server);
    const names = [
      "My world/level.dat",
      ...Array.from(
        { length: 10000 },
        (_, i) => `My world/region/r.${i}.0.mca`,
      ),
    ];
    const response = await upload(
      "world-folder",
      names.map((name) => ({
        name: path.basename(name),
        data: Buffer.from(name),
      })),
      names,
    );
    expect(response.statusCode, response.body).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    expect(
      await readFile(
        path.join(
          instance.servers.paths.server(server.id),
          "world/region/r.9999.0.mca",
        ),
        "utf8",
      ),
    ).toBe(names.at(-1));
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
  });
  it("rejects wrong-edition worlds before touching the running world", async () => {
    const zip = await archive({
      "World/level.dat": "Bedrock",
      "World/db/CURRENT": "leveldb",
    });
    const response = await upload("world", [
      { name: "bedrock.zip", data: zip },
    ]);
    const op = await finish(response.json().operation.id);
    expect(op.status).toBe("FAILED");
    expect(op.error).toContain("Bedrock");
    expect(instance.servers.get(server.id).state).toBe("RUNNING");
    expect(instance.store.backups(server.id)).toHaveLength(0);
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "world/level.dat"),
        "utf8",
      ),
    ).toBe("controlled test world");
    expect(
      await readdir(instance.servers.paths.server(server.id, "uploads")),
    ).toEqual([]);
    expect(
      await readdir(instance.servers.paths.server(server.id, "imports")),
    ).toEqual([]);
  });
  it("imports a Bedrock folder into the configured native world directory", async () => {
    const created = await instance.app.inject({
      method: "POST",
      url: "/api/v1/servers",
      headers,
      payload: {
        name: "Bedrock folder import",
        edition: "BEDROCK",
        software: "BEDROCK",
        version: "1.21.1.03",
        memoryMb: 1024,
        cpu: 1,
        eula: true,
      },
    });
    expect(created.statusCode).toBe(202);
    await finish(created.json().operation.id);
    server = instance.servers.get(created.json().server.id);
    const response = await upload(
      "world-folder",
      [
        { name: "level.dat", data: Buffer.from("native world fixture") },
        { name: "CURRENT", data: Buffer.from("LevelDB fixture") },
      ],
      ["Saved world/level.dat", "Saved world/db/CURRENT"],
    );
    expect(response.statusCode, response.body).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status, op.error ?? undefined).toBe("SUCCEEDED");
    expect(
      await readFile(
        path.join(
          instance.servers.paths.server(server.id),
          "worlds/world/db/CURRENT",
        ),
        "utf8",
      ),
    ).toBe("LevelDB fixture");
    expect(instance.servers.get(server.id).state).toBe("STOPPED");
  });
  it("rejects incomplete and unsafe world folder uploads and removes staging", async () => {
    for (const names of [
      ["World/level.dat", "World/region/r.0.0.mca"],
      ["../outside/level.dat"],
    ]) {
      const response = await upload(
        "world-folder",
        [{ name: "level.dat", data: Buffer.from("world") }],
        names,
      );
      expect(response.statusCode).toBe(400);
      expect(
        await readdir(instance.servers.paths.server(server.id, "uploads")),
      ).toEqual([]);
      expect(instance.servers.get(server.id).state).toBe("RUNNING");
    }
  });
  it("restores the previous world if the imported world fails readiness", async () => {
    const ready = vi
      .spyOn(instance.servers, "waitReady")
      .mockRejectedValueOnce(new Error("fixture startup failure"));
    const zip = await archive({
      "level.dat": "uploaded world",
      "region/r.0.0.mca": "region",
    });
    const response = await upload("world", [{ name: "world.zip", data: zip }]);
    const op = await finish(response.json().operation.id);
    expect(op.status).toBe("FAILED");
    expect(op.error).toContain("fixture startup failure");
    expect(instance.servers.get(server.id).state).toBe("RUNNING");
    expect(
      await readFile(
        path.join(instance.servers.paths.server(server.id), "world/level.dat"),
        "utf8",
      ),
    ).toBe("controlled test world");
    expect(
      await readdir(instance.servers.paths.server(server.id, "imports")),
    ).toEqual([]);
    ready.mockRestore();
  });
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
  it("protects the server installer from general file uploads without stopping Minecraft", async () => {
    const installer =
        instance.servers.paths.server(server.id) + "/server-installer.jar",
      boundary = "minemate-protected-installer-boundary";
    await writeFile(installer, "existing installer");
    const response = await instance.app.inject({
      method: "POST",
      url: `/api/v1/servers/${server.id}/uploads?kind=file&confirm=true`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="server-installer.jar"\r\nContent-Type: application/java-archive\r\n\r\nreplacement bytes\r\n--${boundary}--\r\n`,
      ),
    });
    expect(response.statusCode).toBe(202);
    const op = await finish(response.json().operation.id);
    expect(op.status).toBe("FAILED");
    expect(op.error).toContain("dedicated");
    expect(await readFile(installer, "utf8")).toBe("existing installer");
    expect(instance.servers.get(server.id).state).toBe("RUNNING");
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
  it("routes Java whitelist actions, validates names and refuses Bedrock-only actions", async () => {
    const command = vi
      .spyOn(instance.servers.runtime, "command")
      .mockResolvedValue("done");
    const url = `/api/v1/servers/${server.id}/players`;
    const added = await instance.app.inject({
      method: "POST",
      url,
      headers,
      payload: { action: "whitelist", name: "Friend_123", confirm: true },
    });
    expect(added.statusCode).toBe(200);
    expect(command).toHaveBeenLastCalledWith(
      server.containerId,
      server.id,
      server.config,
      "whitelist add Friend_123",
    );
    const removed = await instance.app.inject({
      method: "POST",
      url,
      headers,
      payload: { action: "unwhitelist", name: "Friend_123", confirm: true },
    });
    expect(removed.statusCode).toBe(200);
    expect(command).toHaveBeenLastCalledWith(
      server.containerId,
      server.id,
      server.config,
      "whitelist remove Friend_123",
    );
    for (const payload of [
      { action: "whitelist", name: "Two Names", confirm: true },
      { action: "allowlist", name: "Friend", confirm: true },
      { action: "whitelist", name: "Friend", confirm: false },
    ]) {
      expect(
        (await instance.app.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(400);
    }
    expect(command).toHaveBeenCalledTimes(2);
  });
  it("quotes Bedrock gamertags for allowlist commands and refuses Java-only actions", async () => {
    // This route-level fixture verifies edition-specific command construction,
    // independently of an actual Bedrock runtime.
    server.config = {
      ...server.config,
      edition: "BEDROCK",
      software: "BEDROCK",
    };
    instance.store.saveServer(server);
    const command = vi
      .spyOn(instance.servers.runtime, "command")
      .mockResolvedValue("queued");
    const url = `/api/v1/servers/${server.id}/players`;
    for (const name of ["Friend Name", "名前 #123"]) {
      for (const [action, verb] of [
        ["allowlist", "add"],
        ["unallowlist", "remove"],
      ]) {
        expect(
          (
            await instance.app.inject({
              method: "POST",
              url,
              headers,
              payload: { action, name, confirm: true },
            })
          ).statusCode,
        ).toBe(200);
        expect(command).toHaveBeenLastCalledWith(
          server.containerId,
          server.id,
          server.config,
          `allowlist ${verb} ${JSON.stringify(name)}`,
        );
      }
    }
    for (const action of ["whitelist", "unwhitelist", "ban", "pardon"]) {
      expect(
        (
          await instance.app.inject({
            method: "POST",
            url,
            headers,
            payload: { action, name: "Friend Name", confirm: true },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(command).toHaveBeenCalledTimes(4);
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
    for (const route of ["files", "console", "players", "permissions"])
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
