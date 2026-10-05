import type { ServerConfig } from "../../shared/src/index.ts";
import { javaRuntime, AppError } from "../../shared/src/index.ts";
import {
  labels,
  assertOwned,
  type DockerProvider,
  type CreateContainer,
  type ContainerInfo,
} from "../../docker/src/index.ts";
export const JAVA_IMAGE_VERSION = "2026.9.2";
export const BEDROCK_IMAGE = "itzg/minecraft-bedrock-server:2026.9.2";
export interface RuntimeContext {
  installation: string;
  network: string;
  hostDirectory: string;
  rconPassword: string;
}
export interface MinecraftRuntimeProvider {
  spec(
    id: string,
    config: ServerConfig,
    context: RuntimeContext,
  ): CreateContainer;
  command(
    docker: DockerProvider,
    containerId: string,
    command: string,
  ): Promise<string>;
  port: number;
}
export class JavaMinecraftProvider implements MinecraftRuntimeProvider {
  port = 25565;
  spec(id: string, c: ServerConfig, ctx: RuntimeContext): CreateContainer {
    const env: Record<string, string> = {
      EULA: "TRUE",
      TYPE: c.software,
      VERSION: c.version,
      MEMORY: `${c.memoryMb}M`,
      MAX_PLAYERS: String(c.maxPlayers),
      ENABLE_RCON: "true",
      RCON_PASSWORD: ctx.rconPassword,
      RCON_PORT: "25575",
      SERVER_PORT: "25565",
      UID: "1000",
      GID: "1000",
      OVERRIDE_SERVER_PROPERTIES: "false",
      LEVEL: c.software === "CUSTOM" ? "world" : "world",
      USE_AIKAR_FLAGS: "false",
    };
    if (c.seed) env.SEED = c.seed;
    if (c.jvmFlags) env.JVM_OPTS = c.jvmFlags;
    if (c.loaderVersion) {
      const keys: Record<string, string> = {
        FABRIC: "FABRIC_LOADER_VERSION",
        FORGE: "FORGE_VERSION",
        NEOFORGE: "NEOFORGE_VERSION",
        PAPER: "PAPER_BUILD",
        PURPUR: "PURPUR_BUILD",
      };
      const key = keys[c.software];
      if (key) env[key] = c.loaderVersion;
    }
    if (c.software === "CUSTOM") env.CUSTOM_SERVER = "/data/custom-server.jar";
    return {
      User: "1000:1000",
      Image: `itzg/minecraft-server:${JAVA_IMAGE_VERSION}-java${javaRuntime(c.version, c.java)}`,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      Labels: labels(ctx.installation, id),
      HostConfig: {
        Binds: [`${ctx.hostDirectory}:/data`],
        Memory: (c.memoryMb + 512) * 1024 * 1024,
        NanoCpus: Math.round(c.cpu * 1e9),
        NetworkMode: ctx.network,
        RestartPolicy: { Name: "no" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
      },
      NetworkingConfig: {
        EndpointsConfig: { [ctx.network]: { Aliases: [`world-${id}`] } },
      },
    };
  }
  async command(docker: DockerProvider, id: string, cmd: string) {
    return docker.exec(id, ["rcon-cli", cmd]);
  }
}
export class BedrockMinecraftProvider implements MinecraftRuntimeProvider {
  port = 19132;
  spec(id: string, c: ServerConfig, ctx: RuntimeContext): CreateContainer {
    if (process.arch !== "x64")
      throw new AppError(
        "BEDROCK_ARCH",
        "The official Bedrock Dedicated Server requires an amd64 host.",
      );
    return {
      User: "1000:1000",
      Image: BEDROCK_IMAGE,
      Env: [
        `EULA=TRUE`,
        `VERSION=${c.version}`,
        "SERVER_PORT=19132",
        "SERVER_PORT_V6=19133",
        "UID=1000",
        "GID=1000",
        ...(c.seed ? [`LEVEL_SEED=${c.seed}`] : []),
      ],
      Labels: labels(ctx.installation, id),
      OpenStdin: true,
      Tty: true,
      HostConfig: {
        Binds: [`${ctx.hostDirectory}:/data`],
        Memory: c.memoryMb * 1024 * 1024,
        NanoCpus: Math.round(c.cpu * 1e9),
        NetworkMode: ctx.network,
        RestartPolicy: { Name: "no" },
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
      },
      NetworkingConfig: {
        EndpointsConfig: { [ctx.network]: { Aliases: [`world-${id}`] } },
      },
    };
  }
  async command(docker: DockerProvider, id: string, cmd: string) {
    return docker.exec(id, ["send-command", cmd]);
  }
}
export class Runtime {
  constructor(
    readonly docker: DockerProvider,
    readonly installation: string,
  ) {}
  provider(c: ServerConfig): MinecraftRuntimeProvider {
    return c.edition === "JAVA"
      ? new JavaMinecraftProvider()
      : new BedrockMinecraftProvider();
  }
  async owned(id: string, serverId: string): Promise<ContainerInfo> {
    const info = await this.docker.inspect(id);
    assertOwned(info, this.installation, serverId);
    return info;
  }
  async start(id: string, serverId: string) {
    await this.owned(id, serverId);
    await this.docker.start(id);
  }
  async stop(id: string, serverId: string) {
    const info = await this.owned(id, serverId);
    if (info.State.Running) await this.docker.stop(id);
  }
  async remove(id: string, serverId: string) {
    await this.owned(id, serverId);
    await this.docker.remove(id);
  }
  async command(id: string, serverId: string, c: ServerConfig, cmd: string) {
    if (cmd.length > 2048 || /[\r\n\0]/.test(cmd) || !cmd.trim())
      throw new AppError("COMMAND", "Use a single Minecraft command.");
    await this.owned(id, serverId);
    return this.provider(c).command(this.docker, id, cmd);
  }
}
export function diagnose(
  log: string,
): { title: string; cause: string; action: string }[] {
  const patterns: [RegExp, string, string, string][] = [
    [
      /eula.*(false|agree|accept)/i,
      "EULA needed",
      "The Minecraft agreement has not been accepted.",
      "Open the agreement and explicitly accept it.",
    ],
    [
      /UnsupportedClassVersionError|class file version/i,
      "Java version mismatch",
      "The server needs a different Java runtime.",
      "Select the recommended Java runtime in Advanced settings.",
    ],
    [
      /OutOfMemoryError|Cannot allocate memory|oom.?kill/i,
      "Not enough memory",
      "The server ran out of available memory.",
      "Increase server memory or remove heavy mods.",
    ],
    [
      /Address already in use|bind.*failed/i,
      "Port already used",
      "Another listener is using this port.",
      "Choose another port.",
    ],
    [
      /requires.*(mod|fabric)|Missing.*dependenc/i,
      "Missing dependency",
      "A mod needs another mod or loader version.",
      "Check the content inventory and install required dependencies.",
    ],
    [
      /mixin.*(failed|error)/i,
      "Mod compatibility problem",
      "A mod could not apply its changes.",
      "Check the newest mod changes and restore a recovery point.",
    ],
    [
      /Permission denied/i,
      "Storage permissions",
      "The server cannot write its files.",
      "Check the data-directory owner on the Docker host.",
    ],
    [
      /corrupt|Failed to read.*level/i,
      "World data problem",
      "World data may be damaged.",
      "Stop the server and restore a verified backup.",
    ],
    [
      /download.*(fail|error)|UnknownHostException/i,
      "Download failed",
      "A download service could not be reached.",
      "Check network access and retry.",
    ],
  ];
  return patterns
    .filter(([pattern]) => pattern.test(log))
    .map(([, title, cause, action]) => ({ title, cause, action }));
}
