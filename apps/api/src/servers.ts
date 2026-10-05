import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Store } from "../../../packages/database/src/index.ts";
import {
  AppError,
  serverConfigSchema,
  usesUploadedServerJar,
  serverJarFilename,
  now,
  can,
  permissions,
  type Permission,
  type User,
  type Server,
  type ServerConfig,
} from "../../../packages/shared/src/index.ts";
import { Runtime } from "../../../packages/minecraft/src/index.ts";
import {
  assertOwned,
  labels,
  type DockerProvider,
} from "../../../packages/docker/src/index.ts";
import {
  DataPaths,
  atomicWrite,
  safePath,
} from "../../../packages/backup/src/paths.ts";
import {
  javaStatus,
  bedrockStatus,
} from "../../../packages/gateway-protocol/src/index.ts";
import type { Config } from "./config.ts";
import { Host, allocatePort } from "./host.ts";
import type { SecretStore } from "./secrets.ts";
import type { Jobs } from "./jobs.ts";
import type { Events } from "./events.ts";

export class Servers {
  readonly runtime: Runtime;
  readonly host: Host;
  readonly installation: string;
  private creating = false;
  constructor(
    readonly store: Store,
    readonly docker: DockerProvider,
    readonly paths: DataPaths,
    readonly config: Config,
    readonly secrets: SecretStore,
    readonly jobs: Jobs,
    readonly events: Events,
  ) {
    this.installation = store.setting("installationId", randomUUID());
    store.setSetting("installationId", this.installation);
    this.runtime = new Runtime(docker, this.installation);
    this.host = new Host(docker, paths, config, this.installation);
    jobs.register("create", async (op, phase) => {
      const s = this.get(op.serverId!);
      try {
        phase("Preparing persistent world storage");
        if (!usesUploadedServerJar(s.config))
          await this.ensureContainer(s, phase);
        await this.ensureGateway(s, phase);
        this.state(s, "STOPPED");
        return { serverId: s.id };
      } catch (e) {
        this.fail(s, e);
        throw e;
      }
    });
    for (const action of ["start", "stop", "restart", "sleep"] as const)
      jobs.register(action, async (op, phase) => {
        const s = this.get(op.serverId!);
        try {
          if (action === "stop" || action === "sleep") {
            phase("Saving the world and stopping");
            await this.stop(s);
            s.desired = action === "sleep" ? "SLEEPING" : "STOPPED";
            this.state(s, action === "sleep" ? "SLEEPING" : "STOPPED");
          } else {
            if (action === "restart") {
              phase("Saving the world before restarting");
              await this.stop(s);
            }
            phase("Starting Minecraft");
            await this.start(s, phase);
            phase("Waiting for Minecraft readiness");
            await this.waitReady(s);
            phase("World is online");
          }
          this.store.audit(this.actor(op.id), s.id, "server." + action);
          return { serverId: s.id };
        } catch (e) {
          this.fail(s, e);
          throw e;
        }
      });
    jobs.register("delete", async (op, phase) => {
      const s = this.get(op.serverId!),
        mode = String(op.payload.mode);
      phase("Stopping the world");
      await this.stop(s);
      await this.removeGateway(s.id);
      if (s.containerId) {
        await this.runtime.remove(s.containerId, s.id);
        s.containerId = null;
      }
      if (mode === "data") {
        phase("Removing confirmed world data");
        await safePath(this.paths.root, `servers/${s.id}`);
        await rm(path.join(this.paths.root, "servers", s.id), {
          recursive: true,
        });
        this.store.audit(this.actor(op.id), s.id, "server.deleted", { mode });
        this.store.run("DELETE FROM servers WHERE id=?", s.id);
      } else {
        s.archived = mode === "archive";
        s.desired = "STOPPED";
        this.state(s, "STOPPED");
        this.store.audit(this.actor(op.id), s.id, "server.archived", { mode });
      }
      return { mode };
    });
  }
  get(id: string) {
    const s = this.store.findServer(id, this.config.lanIp);
    if (!s)
      throw new AppError("NOT_FOUND", "This world could not be found.", 404);
    return s;
  }
  authorized(user: User, id: string, permission: Permission) {
    const s = this.get(id),
      grants = this.store.grants(id, user.id);
    if (!can(user, grants, permission))
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission for this world action.",
        403,
      );
    s.permissions = user.role === "member" ? grants : [...permissions];
    return s;
  }
  list(user: User) {
    return this.store.servers(this.config.lanIp).flatMap((s) => {
      const grants = this.store.grants(s.id, user.id);
      if (!can(user, grants, "view")) return [];
      s.permissions = user.role === "member" ? grants : [...permissions];
      return [s];
    });
  }
  actor(operationId: string) {
    return String(
      this.store.get("SELECT actor FROM operations WHERE id=?", operationId)
        ?.actor ?? "system",
    );
  }
  state(s: Server, state: Server["state"]) {
    s.state = state;
    s.updatedAt = now();
    this.store.saveServer(s);
    this.events.send("server.status.changed", s, s.id);
    void this.writeRoute(s).catch((e) =>
      this.events.send("gateway.error", { message: String(e) }, s.id),
    );
  }
  fail(s: Server, e: unknown) {
    s.error = e instanceof Error ? e.message : String(e);
    this.state(s, "ERROR");
  }
  async create(user: User, input: unknown) {
    if (user.role === "member")
      throw new AppError("FORBIDDEN", "An administrator creates worlds.", 403);
    if (this.creating)
      throw new AppError(
        "BUSY",
        "Another world is reserving its port. Try again.",
        409,
      );
    this.creating = true;
    try {
      const c = serverConfigSchema.parse(input);
      if (c.edition === "BEDROCK" && c.version.toUpperCase() === "LATEST")
        c.version = await resolveBedrockVersion();
      await this.host.prove();
      const info = await this.docker.ping();
      if (
        c.edition === "BEDROCK" &&
        info.Arch !== "x86_64" &&
        info.Arch !== "amd64"
      )
        throw new AppError(
          "BEDROCK_ARCH",
          "Bedrock Dedicated Server needs an amd64 Docker host.",
        );
      if (c.memoryMb > info.MemTotal / 1024 ** 2)
        throw new AppError(
          "MEMORY",
          "This world requests more memory than the host has.",
        );
      const protocol = c.edition === "JAVA" ? "TCP" : "UDP",
        taken = new Set(
          this.store
            .servers(this.config.lanIp)
            .filter((s) => s.endpoint.protocol === protocol)
            .map((s) => s.port),
        );
      for (const container of await this.docker.list())
        for (const p of container.Ports)
          if (p.PublicPort && p.Type === protocol.toLowerCase())
            taken.add(p.PublicPort);
      const port = await allocatePort(
          c.edition === "JAVA"
            ? this.config.javaStart
            : this.config.bedrockStart,
          c.edition === "JAVA" ? this.config.javaEnd : this.config.bedrockEnd,
          protocol,
          taken,
          c.port,
        ),
        id = randomUUID(),
        at = now();
      await this.paths.createServer(id);
      this.store.transaction(() => {
        this.store.run(
          "INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          id,
          c.name,
          JSON.stringify(c),
          port,
          protocol,
          "CREATING",
          "STOPPED",
          null,
          null,
          null,
          0,
          at,
          at,
        );
        this.store.run(
          "INSERT INTO eula_acceptances VALUES(?,?,?,?,?)",
          randomUUID(),
          id,
          user.id,
          at,
          "https://www.minecraft.net/eula",
        );
        this.store.run(
          "INSERT INTO server_runtimes VALUES(?,?,0,?,?)",
          id,
          "missing",
          "[]",
          at,
        );
        this.store.audit(user.id, id, "server.created", {
          edition: c.edition,
          version: c.version,
        });
        this.store.audit(user.id, id, "eula.accepted");
      });
      await atomicWrite(
        this.paths.server(id, "metadata") + "/rcon.secret",
        this.secrets.seal(randomBytes(32).toString("base64url")),
      );
      await atomicWrite(this.paths.server(id) + "/eula.txt", "eula=true\n");
      return {
        server: this.get(id),
        operation: this.jobs.enqueue(id, user.id, "create"),
      };
    } finally {
      this.creating = false;
    }
  }
  async ensureContainer(s: Server, phase: (text: string) => void = () => {}) {
    if (s.containerId) {
      try {
        await this.runtime.owned(s.containerId, s.id);
        return;
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 404) throw e;
        s.containerId = null;
      }
    }
    if (
      !this.store.get("SELECT id FROM eula_acceptances WHERE server_id=?", s.id)
    )
      throw new AppError(
        "EULA",
        "Accept the Minecraft agreement before starting.",
      );
    await this.host.prove();
    await this.docker.ensureNetwork(this.config.network);
    if (usesUploadedServerJar(s.config)) {
      try {
        await stat(
          await safePath(this.paths.server(s.id), serverJarFilename(s.config)),
        );
      } catch {
        throw new AppError(
          "CUSTOM_JAR",
          "Upload your confirmed custom server JAR before starting.",
        );
      }
    }
    if (s.config.edition === "BEDROCK") {
      const properties = path.join(
        this.paths.server(s.id),
        "server.properties",
      );
      try {
        await stat(properties);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        await atomicWrite(
          properties,
          `server-name=${s.name.replace(/[\r\n]/g, " ")}\nmax-players=${s.config.maxPlayers}\nserver-port=19132\nserver-portv6=19133\nlevel-name=world\nonline-mode=true\nallow-list=false\n`,
        );
      }
    }
    const secret = this.secrets.unseal(
        await readFile(
          this.paths.server(s.id, "metadata") + "/rcon.secret",
          "utf8",
        ),
      ),
      provider = this.runtime.provider(s.config),
      spec = provider.spec(s.id, s.config, {
        installation: this.installation,
        network: this.config.network,
        hostDirectory: await this.paths.hostServer(s.id),
        rconPassword: secret,
      });
    phase("Downloading the selected Minecraft runtime");
    await this.docker.pull(spec.Image);
    phase("Creating the isolated Minecraft container");
    s.containerId = await this.docker.create("minemate-world-" + s.id, spec);
    this.store.saveServer(s);
  }
  async writeRoute(s: Server) {
    const directory = path.join(this.paths.root, "gateway", s.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await atomicWrite(
      path.join(directory, "route.json"),
      JSON.stringify({
        edition: s.config.edition,
        state: s.state,
        host: "world-" + s.id,
        port: this.runtime.provider(s.config).port,
        name: s.name,
        version: s.config.version,
        maxPlayers: s.config.maxPlayers,
      }),
    );
  }
  async ensureGateway(s: Server, phase: (text: string) => void = () => {}) {
    if (this.config.disableGateway) return;
    await this.writeRoute(s);
    const saved = this.store.setting<string | null>("gateway:" + s.id, null);
    if (saved) {
      try {
        const info = await this.docker.inspect(saved);
        assertOwned(info, this.installation, s.id, "gateway");
        if (!info.State.Running) await this.docker.start(saved);
        return;
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 404) throw e;
      }
    }
    const image =
      process.env.MINEMATE_RUNTIME_IMAGE ?? "ghcr.io/elias02345/minemate:0.3.0";
    if (!/^[a-zA-Z0-9./_-]+:[a-zA-Z0-9._-]+$/.test(image))
      throw new AppError(
        "GATEWAY_IMAGE",
        "Configure an explicit MineMate runtime image tag.",
      );
    phase("Preparing the sleep and wake gateway");
    const protocol = s.endpoint.protocol.toLowerCase(),
      port = this.runtime.provider(s.config).port;
    const id = await this.docker.create("minemate-gateway-" + s.id, {
      Image: image,
      Healthcheck: { Test: ["NONE"] },
      Cmd: ["node", "dist/gateway/main.js"],
      User: "1000:1000",
      Env: ["MINEMATE_ROUTE_PATH=/route"],
      Labels: labels(this.installation, s.id, "gateway"),
      ExposedPorts: { [`${port}/${protocol}`]: {} },
      HostConfig: {
        Binds: [path.join(this.paths.hostRoot, "gateway", s.id) + ":/route"],
        NetworkMode: this.config.network,
        PortBindings: {
          [`${port}/${protocol}`]: [
            { HostIp: this.config.gatewayBind, HostPort: String(s.port) },
          ],
        },
        Memory: 128 * 1024 ** 2,
        NanoCpus: 500000000,
        RestartPolicy: { Name: "unless-stopped" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        ReadonlyRootfs: true,
      },
    });
    this.store.setSetting("gateway:" + s.id, id);
    await this.docker.start(id);
  }
  async removeGateway(id: string) {
    const container = this.store.setting<string | null>("gateway:" + id, null);
    if (container) {
      try {
        const info = await this.docker.inspect(container);
        assertOwned(info, this.installation, id, "gateway");
        if (info.State.Running) await this.docker.stop(container, 5);
        await this.docker.remove(container);
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 404) throw e;
      }
      this.store.setSetting("gateway:" + id, null);
    }
  }
  async stop(s: Server) {
    s.desired = "STOPPED";
    this.state(s, "STOPPING");
    if (s.containerId) {
      try {
        await this.runtime.stop(s.containerId, s.id);
      } catch (e) {
        if (!(e instanceof AppError) || e.status !== 404) throw e;
      }
    }
    this.state(s, "STOPPED");
  }
  async start(s: Server, phase: (text: string) => void = () => {}) {
    if (s.archived)
      throw new AppError("ARCHIVED", "Unarchive this world before starting.");
    let accepted = false;
    try {
      accepted = /^eula=true\s*$/m.test(
        await readFile(
          await safePath(this.paths.server(s.id), "eula.txt"),
          "utf8",
        ),
      );
    } catch {
      /* explicit EULA repair is required */
    }
    if (!accepted)
      throw new AppError(
        "EULA",
        "The Minecraft agreement is missing or unaccepted. Open the graphical EULA repair flow.",
      );
    await this.ensureContainer(s, phase);
    await this.ensureGateway(s, phase);
    s.desired = "RUNNING";
    s.error = null;
    this.state(s, "STARTING");
    await this.runtime.start(s.containerId!, s.id);
  }
  async probe(s: Server) {
    if (!s.containerId) return null;
    const info = await this.runtime.owned(s.containerId, s.id);
    if (!info.State.Running) return null;
    const host = info.NetworkSettings.Networks[this.config.network]?.IPAddress;
    if (!host) return null;
    return s.config.edition === "JAVA" ? javaStatus(host) : bedrockStatus(host);
  }
  async waitReady(s: Server, timeout = 240000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const info = await this.runtime.owned(s.containerId!, s.id);
      if (!info.State.Running) {
        const log = (await this.docker.logs(s.containerId!)).replace(
          /(rcon\.password\s*[=:]\s*)\S+/gi,
          "$1[redacted]",
        );
        await atomicWrite(
          this.paths.server(s.id, "metadata") + "/failure.log",
          log.slice(-32000),
        );
        throw new AppError(
          "MINECRAFT_CRASH",
          "Minecraft stopped before becoming ready. Open Repair for the preserved startup diagnosis.",
          409,
          log.slice(-4000),
        );
      }
      try {
        const status = await this.probe(s);
        if (status) {
          s.metrics = {
            cpuPercent: null,
            memoryBytes: null,
            memoryLimit: null,
            diskBytes: null,
            uptimeSeconds: null,
            players: status.players,
            playerNames: status.names,
            at: now(),
          };
          this.state(s, "RUNNING");
          return;
        }
      } catch {
        /* downloading or starting; keep waiting */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new AppError(
      "READINESS_TIMEOUT",
      "Minecraft has not become ready yet. Open the console to inspect the download or startup.",
      409,
    );
  }
  async replaceContainer(s: Server, c: ServerConfig) {
    await this.stop(s);
    if (s.containerId) {
      await this.runtime.remove(s.containerId, s.id);
      s.containerId = null;
    }
    s.config = c;
    s.name = c.name;
    this.store.saveServer(s);
    await this.ensureContainer(s);
  }
}

async function resolveBedrockVersion() {
  const response = await fetch(
    "https://net.web.minecraft-services.net/api/v1.0/download/links",
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new AppError(
      "BEDROCK_VERSION",
      "The official Bedrock version service could not be reached. Enter a specific version.",
    );
  const body = (await response.json()) as {
    result?: { links?: { downloadType: string; downloadUrl: string }[] };
  };
  const link = body.result?.links?.find(
    (l) => l.downloadType === "serverBedrockLinux",
  )?.downloadUrl;
  const version = link?.match(/bedrock-server-([0-9.]+)\.zip/)?.[1];
  if (!version)
    throw new AppError(
      "BEDROCK_VERSION",
      "The official Bedrock version could not be determined. Enter a specific version.",
    );
  return version;
}
