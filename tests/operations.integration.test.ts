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
  async function archive(entries: Record<string, string>) {
    const zip = new yazl.ZipFile(),
      chunks: Buffer[] = [];
    for (const [name, text] of Object.entries(entries))
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
  it("streams world folders with more than 100 files while preserving relative paths", async () => {
    await instance.servers.stop(server);
    const names = [
      "My world/level.dat",
      ...Array.from({ length: 105 }, (_, i) => `My world/region/r.${i}.0.mca`),
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
          "world/region/r.104.0.mca",
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
