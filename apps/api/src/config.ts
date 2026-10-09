import path from "node:path";
import os from "node:os";
import { z } from "zod";
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const int = (key: string, value: number) =>
    z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env[key] ?? value);
  const dataRoot = path.resolve(env.MINEMATE_DATA_PATH ?? "data");
  const detected =
    Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i?.family === "IPv4" && !i.internal)?.address ?? "127.0.0.1";
  const config = {
    dataRoot,
    hostRoot: env.MINEMATE_HOST_DATA_PATH ?? dataRoot,
    port: int("MINEMATE_PORT", 18080),
    bind: env.MINEMATE_BIND_ADDRESS ?? "0.0.0.0",
    lanIp: env.MINEMATE_LAN_IP ?? detected,
    dockerEndpoint:
      env.MINEMATE_DOCKER_ENDPOINT ?? "unix:///var/run/docker.sock",
    network: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
      .parse(env.MINEMATE_SERVER_NETWORK ?? "minemate-servers"),
    javaStart: int("MINEMATE_JAVA_PORT_START", 25565),
    javaEnd: int("MINEMATE_JAVA_PORT_END", 65535),
    bedrockStart: int("MINEMATE_BEDROCK_PORT_START", 19132),
    bedrockEnd: int("MINEMATE_BEDROCK_PORT_END", 65535),
    secureCookies: env.MINEMATE_SECURE_COOKIES === "true",
    trustProxy: env.MINEMATE_TRUST_PROXY === "true",
    webRoot: path.resolve("apps/web/dist"),
    version: "0.4.7",
    curseforgeKey: env.CURSEFORGE_API_KEY ?? "",
    gatewayBind: env.MINEMATE_GAME_BIND_ADDRESS ?? "0.0.0.0",
    disableGateway: env.MINEMATE_DISABLE_GATEWAY === "true",
  };
  if (
    config.javaEnd < config.javaStart ||
    config.bedrockEnd < config.bedrockStart
  )
    throw new Error("Invalid Minecraft port range");
  return config;
}
export type Config = ReturnType<typeof loadConfig>;
