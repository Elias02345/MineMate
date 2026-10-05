import { z } from "zod";

export const editions = ["JAVA", "BEDROCK"] as const;
export const softwares = [
  "VANILLA",
  "PAPER",
  "PURPUR",
  "FABRIC",
  "FORGE",
  "NEOFORGE",
  "CUSTOM",
  "BEDROCK",
] as const;
export const states = [
  "CREATING",
  "STOPPED",
  "STARTING",
  "RUNNING",
  "STOPPING",
  "RESTARTING",
  "SLEEPING",
  "WAKING",
  "UPDATING",
  "BACKING_UP",
  "RESTORING",
  "ERROR",
  "DELETING",
  "UNKNOWN",
] as const;
export type ServerState = (typeof states)[number];
export const permissions = [
  "view",
  "start",
  "stop",
  "restart",
  "console",
  "players",
  "settings",
  "content",
  "files",
  "backups",
  "update",
  "delete",
] as const;
export type Permission = (typeof permissions)[number];
export const idSchema = z.uuid();
export const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(48)
    .regex(/^[\p{L}\p{N}_.-]+$/u),
  password: z.string().min(12).max(256),
});
export const serverConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    edition: z.enum(editions),
    software: z.enum(softwares),
    version: z
      .string()
      .max(40)
      .regex(/^(\d+([.-]\d+)*|LATEST)$/),
    loaderVersion: z
      .string()
      .max(60)
      .regex(/^[a-zA-Z0-9._+-]*$/)
      .default(""),
    memoryMb: z.number().int().min(512).max(262144).default(2048),
    cpu: z.number().min(0.25).max(128).default(2),
    port: z.number().int().min(1024).max(65535).optional(),
    java: z.enum(["auto", "8", "11", "16", "17", "21", "25"]).default("auto"),
    sleepMinutes: z.number().int().min(0).max(10080).default(0),
    maxPlayers: z.number().int().min(1).max(10000).default(20),
    eula: z.literal(true),
    jvmFlags: z.string().max(1024).default(""),
    seed: z.string().max(128).default(""),
  })
  .superRefine((c, ctx) => {
    if ((c.edition === "BEDROCK") !== (c.software === "BEDROCK"))
      ctx.addIssue({
        code: "custom",
        message: "Software does not support this edition",
        path: ["software"],
      });
    if (c.edition === "JAVA" && c.version === "LATEST")
      ctx.addIssue({
        code: "custom",
        message: "Select an explicit Java version",
        path: ["version"],
      });
    if (/[\r\n\0]/.test(c.jvmFlags))
      ctx.addIssue({
        code: "custom",
        message: "Invalid JVM options",
        path: ["jvmFlags"],
      });
  });
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export interface User {
  id: string;
  username: string;
  role: "owner" | "admin" | "member";
  enabled: boolean;
  createdAt: string;
}
export interface Metrics {
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimit: number | null;
  uptimeSeconds: number | null;
  diskBytes: number | null;
  players: number | null;
  playerNames: string[];
  at: string;
}
export interface Server {
  id: string;
  name: string;
  config: ServerConfig;
  port: number;
  state: ServerState;
  desired: "RUNNING" | "STOPPED" | "SLEEPING";
  containerId: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  error: string | null;
  metrics: Metrics | null;
  endpoint: { host: string; port: number; protocol: "TCP" | "UDP" };
  permissions: Permission[];
}
export interface Operation {
  id: string;
  serverId: string | null;
  kind: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "INTERRUPTED";
  phase: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
}
export interface Backup {
  id: string;
  serverId: string;
  filename: string;
  hash: string;
  bytes: number;
  createdAt: string;
  reason: string;
  config: ServerConfig;
  creator: string;
  integrity: "verified" | "unknown" | "failed";
}
export interface InstalledContent {
  id: string;
  serverId: string;
  source: "modrinth" | "curseforge" | "manual";
  projectId: string;
  versionId: string;
  filename: string;
  hash: string;
  gameVersion: string;
  loader: string;
  dependency: boolean;
  managed: boolean;
  installedAt: string;
  installedBy: string;
}
export interface Event {
  type: string;
  serverId?: string;
  operationId?: string;
  data: unknown;
  at: string;
}
export interface Notification {
  id: string;
  serverId: string | null;
  level: "info" | "warning" | "error";
  message: string;
  createdAt: string;
  read: boolean;
}
export interface HostCheck {
  key: string;
  ok: boolean;
  message: string;
  detail?: string;
}
export interface HostStatus {
  checks: HostCheck[];
  ready: boolean;
  memoryMb: number;
  cpus: number;
  architecture: string;
  lanIp: string;
  freeBytes: number;
  dockerVersion: string | null;
}
export const capabilities = (edition: (typeof editions)[number]) => ({
  mods: edition === "JAVA",
  plugins: edition === "JAVA",
  rcon: edition === "JAVA",
  java: edition === "JAVA",
  udp: edition === "BEDROCK",
  worlds: true,
  backups: true,
  sleep: true,
});
export function can(
  user: User,
  grants: readonly Permission[],
  permission: Permission,
): boolean {
  return (
    user.enabled &&
    (user.role === "owner" ||
      user.role === "admin" ||
      grants.includes(permission))
  );
}
const transitions: Record<ServerState, ServerState[]> = {
  CREATING: ["STOPPED", "ERROR"],
  STOPPED: [
    "STARTING",
    "RESTORING",
    "UPDATING",
    "BACKING_UP",
    "DELETING",
    "SLEEPING",
    "ERROR",
  ],
  STARTING: ["RUNNING", "STOPPING", "ERROR", "STOPPED"],
  RUNNING: ["STOPPING", "RESTARTING", "BACKING_UP", "UPDATING", "ERROR"],
  STOPPING: ["STOPPED", "SLEEPING", "ERROR"],
  RESTARTING: ["STARTING", "RUNNING", "STOPPED", "ERROR"],
  SLEEPING: ["WAKING", "STARTING", "STOPPED", "DELETING", "RESTORING", "ERROR"],
  WAKING: ["STARTING", "RUNNING", "STOPPING", "ERROR"],
  UPDATING: ["STARTING", "RUNNING", "STOPPED", "ERROR"],
  BACKING_UP: ["STARTING", "RUNNING", "STOPPED", "ERROR"],
  RESTORING: ["STARTING", "RUNNING", "STOPPED", "ERROR"],
  ERROR: [
    "STARTING",
    "STOPPED",
    "RESTORING",
    "DELETING",
    "UPDATING",
    "BACKING_UP",
  ],
  DELETING: ["ERROR"],
  UNKNOWN: ["RUNNING", "STOPPED", "ERROR"],
};
export function transition(from: ServerState, to: ServerState): ServerState {
  if (from !== to && !transitions[from].includes(to))
    throw new Error(`Invalid transition ${from} → ${to}`);
  return to;
}
export function javaRuntime(
  version: string,
  override: ServerConfig["java"] = "auto",
) {
  if (override !== "auto") return override;
  const [major = 1, minor = 0, patch = 0] = version.split(".").map(Number);
  if (major >= 26) return "25";
  if (minor > 20 || (minor === 20 && patch >= 5)) return "21";
  if (minor >= 18) return "17";
  if (minor === 17) return "16";
  return "8";
}
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public detail?: string,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
