import { z } from "zod";
import { AppError } from "../../shared/src/index.ts";
export interface SettingDefinition {
  key: string;
  label: string;
  description: string;
  type: "boolean" | "number" | "select" | "text";
  default: string;
  min?: number;
  max?: number;
  options?: string[];
  category: string;
  edition: "both" | "JAVA" | "BEDROCK";
  software?: string[];
  version?: string;
  restart: boolean;
  advanced: boolean;
}
export const settings: SettingDefinition[] = [
  {
    key: "motd",
    label: "Welcome message",
    description: "The greeting shown in the multiplayer list.",
    type: "text",
    default: "A MineMate world",
    category: "Players",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "server-name",
    label: "Welcome message",
    description: "The name shown in the multiplayer list.",
    type: "text",
    default: "A MineMate world",
    category: "Players",
    edition: "BEDROCK",
    restart: true,
    advanced: false,
  },
  {
    key: "gamemode",
    label: "Game mode",
    description: "How players explore your world.",
    type: "select",
    default: "survival",
    options: ["survival", "creative", "adventure", "spectator"],
    category: "Gameplay",
    edition: "both",
    restart: true,
    advanced: false,
  },
  {
    key: "difficulty",
    label: "Difficulty",
    description: "How challenging your world is.",
    type: "select",
    default: "easy",
    options: ["peaceful", "easy", "normal", "hard"],
    category: "Gameplay",
    edition: "both",
    restart: true,
    advanced: false,
  },
  {
    key: "max-players",
    label: "Player slots",
    description: "Maximum simultaneous players.",
    type: "number",
    default: "20",
    min: 1,
    max: 10000,
    category: "Players",
    edition: "both",
    restart: true,
    advanced: false,
  },
  {
    key: "pvp",
    label: "Player combat",
    description: "Allow players to damage each other.",
    type: "boolean",
    default: "true",
    category: "Gameplay",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "allow-flight",
    label: "Allow flight",
    description: "Permit flight from mods or special clients.",
    type: "boolean",
    default: "false",
    category: "Gameplay",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "white-list",
    label: "Guest list",
    description: "Only invited players can join.",
    type: "boolean",
    default: "false",
    category: "Security",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "allow-list",
    label: "Guest list",
    description: "Only invited players can join.",
    type: "boolean",
    default: "false",
    category: "Security",
    edition: "BEDROCK",
    restart: true,
    advanced: false,
  },
  {
    key: "online-mode",
    label: "Verify player accounts",
    description: "Authenticate player identities. Keep enabled.",
    type: "boolean",
    default: "true",
    category: "Security",
    edition: "both",
    restart: true,
    advanced: true,
  },
  {
    key: "spawn-protection",
    label: "Spawn protection",
    description: "Protect blocks around spawn from non-operators.",
    type: "number",
    default: "16",
    min: 0,
    max: 1000,
    category: "World",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "view-distance",
    label: "View distance",
    description: "More chunks use more memory.",
    type: "number",
    default: "10",
    min: 3,
    max: 32,
    category: "Performance",
    edition: "both",
    restart: true,
    advanced: false,
  },
  {
    key: "simulation-distance",
    label: "Simulation distance",
    description: "Distance where the world stays active.",
    type: "number",
    default: "10",
    min: 4,
    max: 32,
    category: "Performance",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "tick-distance",
    label: "Simulation distance",
    description: "Distance where the world stays active.",
    type: "number",
    default: "4",
    min: 4,
    max: 12,
    category: "Performance",
    edition: "BEDROCK",
    restart: true,
    advanced: false,
  },
  {
    key: "level-seed",
    label: "World seed",
    description: "Used when generating a new world.",
    type: "text",
    default: "",
    category: "World",
    edition: "both",
    restart: true,
    advanced: false,
  },
  {
    key: "level-name",
    label: "World folder",
    description: "Folder containing the active world.",
    type: "text",
    default: "world",
    category: "World",
    edition: "both",
    restart: true,
    advanced: true,
  },
  {
    key: "hardcore",
    label: "Hardcore",
    description: "One life, permanent consequences.",
    type: "boolean",
    default: "false",
    category: "Gameplay",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "enable-command-block",
    label: "Command blocks",
    description: "Allow command blocks in your world.",
    type: "boolean",
    default: "false",
    category: "Gameplay",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
  {
    key: "allow-nether",
    label: "The Nether",
    description: "Allow travel to the Nether.",
    type: "boolean",
    default: "true",
    category: "World",
    edition: "JAVA",
    restart: true,
    advanced: false,
  },
];
export function parseProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || /^[#!]/.test(line.trim())) continue;
    const i = line.indexOf("=");
    if (i >= 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const reserved = [
  "server-port",
  "server-ip",
  "rcon.port",
  "rcon.password",
  "enable-rcon",
  "query.port",
  "enable-query",
  "server-portv6",
];
export function validateProperties(
  values: Record<string, string>,
  edition: "JAVA" | "BEDROCK",
  raw = false,
) {
  for (const [key, value] of Object.entries(values)) {
    if (
      !/^[a-zA-Z0-9_.-]+$/.test(key) ||
      /[\r\n\0]/.test(value) ||
      value.length > 2048
    )
      throw new AppError("INVALID_SETTING", `Invalid value for ${key}`);
    if (reserved.includes(key))
      throw new AppError("MANAGED_SETTING", `${key} is managed by MineMate.`);
    const d = settings.find(
      (s) => s.key === key && (s.edition === "both" || s.edition === edition),
    );
    if (!d) {
      if (raw) continue;
      throw new AppError("INVALID_SETTING", `Unsupported setting ${key}`);
    }
    if (
      d.type === "number" &&
      !z.coerce
        .number()
        .int()
        .min(d.min ?? 0)
        .max(d.max ?? 65535)
        .safeParse(value).success
    )
      throw new AppError(
        "INVALID_SETTING",
        `Choose a valid number for ${d.label}.`,
      );
    if (d.type === "boolean" && !["true", "false"].includes(value))
      throw new AppError("INVALID_SETTING", `Choose on or off for ${d.label}.`);
    if (d.options && !d.options.includes(value))
      throw new AppError("INVALID_SETTING", `Choose a supported ${d.label}.`);
    if (key === "level-name" && !/^[a-zA-Z0-9 _-]{1,64}$/.test(value))
      throw new AppError("INVALID_SETTING", "Use a simple world folder name.");
    if (edition === "BEDROCK" && key === "gamemode" && value === "spectator")
      throw new AppError(
        "INVALID_SETTING",
        "Bedrock does not support this game mode setting.",
      );
  }
}
export function mergeProperties(
  text: string,
  changes: Record<string, string>,
): string {
  const current = parseProperties(text);
  return (
    Object.entries({ ...current, ...changes })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );
}
