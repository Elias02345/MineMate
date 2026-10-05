import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import {
  AppError,
  type ServerConfig,
  type InstalledContent,
} from "../../shared/src/index.ts";
import { hashFile } from "../../backup/src/archive.ts";
export interface Project {
  id: string;
  source: "modrinth" | "curseforge";
  title: string;
  description: string;
  icon: string | null;
  author: string;
  downloads: number;
  type: string;
  categories: string[];
  serverSide: string;
  gallery: string[];
}
export interface ContentVersion {
  id: string;
  projectId: string;
  source: Project["source"];
  name: string;
  gameVersions: string[];
  loaders: string[];
  filename: string;
  url: string;
  hash: string;
  hashAlgorithm: "sha512" | "sha1";
  dependencies: {
    projectId: string | null;
    versionId: string | null;
    type: "required" | "optional" | "incompatible" | "embedded";
  }[];
  published: string;
}
export interface ContentPlatformProvider {
  source: Project["source"];
  search(query: string, config: ServerConfig, kind: string): Promise<Project[]>;
  project(id: string): Promise<Project>;
  versions(id: string, config: ServerConfig): Promise<ContentVersion[]>;
  version(id: string, projectId?: string): Promise<ContentVersion>;
}
export const loaders = (c: ServerConfig) =>
  c.software === "PAPER"
    ? ["paper", "spigot", "bukkit"]
    : c.software === "PURPUR"
      ? ["purpur", "paper", "spigot", "bukkit"]
      : c.software === "VANILLA"
        ? ["minecraft", "datapack"]
        : [c.software.toLowerCase()];
const cache = new Map<string, { at: number; value: unknown }>();
export async function apiRequest<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < 300000) return cached.value as T;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "MineMate/0.1.0 (private self-hosted server manager)",
          Accept: "application/json",
          ...headers,
        },
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      if (attempt === 3)
        throw new AppError(
          "PLATFORM_OFFLINE",
          "The content service is unavailable. Your worlds can still be managed.",
          502,
          String(e),
        );
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) =>
        setTimeout(
          r,
          Math.min(
            10000,
            Number(res.headers.get("retry-after") ?? 0) * 1000 ||
              500 * 2 ** attempt,
          ),
        ),
      );
      continue;
    }
    if (!res.ok)
      throw new AppError(
        "PLATFORM",
        res.status === 403
          ? "This platform requires valid API access."
          : "The content service could not complete this request.",
        502,
        `HTTP ${res.status}`,
      );
    const value = (await res.json()) as T;
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(url, { at: Date.now(), value });
    return value;
  }
  throw new AppError(
    "PLATFORM_OFFLINE",
    "The content service is unavailable.",
    502,
  );
}
const modrinthVersion = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  date_published: z.string(),
  game_versions: z.array(z.string()),
  loaders: z.array(z.string()),
  files: z.array(
    z.object({
      url: z.string(),
      filename: z.string(),
      primary: z.boolean(),
      hashes: z.object({
        sha512: z.string().optional(),
        sha1: z.string().optional(),
      }),
    }),
  ),
  dependencies: z.array(
    z.object({
      project_id: z.string().nullable(),
      version_id: z.string().nullable(),
      dependency_type: z.enum([
        "required",
        "optional",
        "incompatible",
        "embedded",
      ]),
    }),
  ),
});
const modrinthProject = z.object({
  id: z.string().optional(),
  project_id: z.string().optional(),
  title: z.string(),
  description: z.string(),
  icon_url: z.string().nullable().optional(),
  author: z.string().optional(),
  downloads: z.number(),
  project_type: z.string(),
  categories: z.array(z.string()),
  server_side: z.string(),
  gallery: z
    .array(z.union([z.string(), z.object({ url: z.string() })]))
    .optional(),
});
export class ModrinthProvider implements ContentPlatformProvider {
  source = "modrinth" as const;
  private convertProject(data: unknown): Project {
    const p = modrinthProject.parse(data);
    return {
      id: p.id ?? p.project_id!,
      source: this.source,
      title: p.title,
      description: p.description,
      icon: p.icon_url ?? null,
      author: p.author ?? "",
      downloads: p.downloads,
      type: p.project_type,
      categories: p.categories,
      serverSide: p.server_side,
      gallery: p.gallery?.map((g) => (typeof g === "string" ? g : g.url)) ?? [],
    };
  }
  private convertVersion(data: unknown): ContentVersion {
    const v = modrinthVersion.parse(data),
      file = v.files.find((f) => f.primary) ?? v.files[0];
    if (!file)
      throw new AppError("CONTENT", "This version has no downloadable files.");
    const hash = file.hashes.sha512 ?? file.hashes.sha1;
    if (!hash)
      throw new AppError("CONTENT", "This content has no verification hash.");
    return {
      id: v.id,
      projectId: v.project_id,
      source: this.source,
      name: v.name,
      gameVersions: v.game_versions,
      loaders: v.loaders,
      filename: file.filename,
      url: file.url,
      hash,
      hashAlgorithm: file.hashes.sha512 ? "sha512" : "sha1",
      dependencies: v.dependencies.map((d) => ({
        projectId: d.project_id,
        versionId: d.version_id,
        type: d.dependency_type,
      })),
      published: v.date_published,
    };
  }
  async search(query: string, c: ServerConfig, kind: string) {
    const facets = [
      ["versions:" + c.version],
      loaders(c).map((l) => "categories:" + l),
      ["server_side:required", "server_side:optional"],
      ["project_type:" + kind],
    ];
    const result = await apiRequest<{ hits: unknown[] }>(
      `https://api.modrinth.com/v2/search?${new URLSearchParams({ query, facets: JSON.stringify(facets), limit: "30", index: "relevance" })}`,
    );
    return result.hits.map((p) => this.convertProject(p));
  }
  async project(id: string) {
    return this.convertProject(
      await apiRequest(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`,
      ),
    );
  }
  async versions(id: string, c: ServerConfig) {
    const query = new URLSearchParams({
      game_versions: JSON.stringify([c.version]),
      loaders: JSON.stringify(loaders(c)),
    });
    const result = await apiRequest<unknown[]>(
      `https://api.modrinth.com/v2/project/${encodeURIComponent(id)}/version?${query}`,
    );
    return result.map((v) => this.convertVersion(v));
  }
  async version(id: string) {
    return this.convertVersion(
      await apiRequest(
        `https://api.modrinth.com/v2/version/${encodeURIComponent(id)}`,
      ),
    );
  }
}
const cfFile = z.object({
  id: z.number(),
  modId: z.number(),
  displayName: z.string(),
  fileName: z.string(),
  fileDate: z.string(),
  downloadUrl: z.string().nullable(),
  gameVersions: z.array(z.string()),
  hashes: z.array(z.object({ value: z.string(), algo: z.number() })),
  dependencies: z.array(
    z.object({ modId: z.number(), relationType: z.number() }),
  ),
});
const cfProject = z.object({
  id: z.number(),
  name: z.string(),
  summary: z.string(),
  logo: z.object({ url: z.string() }).nullable(),
  authors: z.array(z.object({ name: z.string() })),
  downloadCount: z.number(),
  classId: z.number(),
  categories: z.array(z.object({ name: z.string() })),
  screenshots: z.array(z.object({ url: z.string() })),
});
export class CurseForgeProvider implements ContentPlatformProvider {
  source = "curseforge" as const;
  constructor(private key: string) {}
  private request<T>(p: string) {
    if (!this.key)
      throw new AppError(
        "CURSEFORGE_KEY",
        "An administrator must configure CurseForge API access in settings.",
        503,
      );
    return apiRequest<{ data: T }>("https://api.curseforge.com/v1" + p, {
      "x-api-key": this.key,
    });
  }
  private projectData(data: unknown): Project {
    const p = cfProject.parse(data);
    return {
      id: String(p.id),
      source: this.source,
      title: p.name,
      description: p.summary,
      icon: p.logo?.url ?? null,
      author: p.authors.map((a) => a.name).join(", "),
      downloads: p.downloadCount,
      type: p.classId === 4471 ? "modpack" : p.classId === 5 ? "plugin" : "mod",
      categories: p.categories.map((c) => c.name),
      serverSide: "unknown",
      gallery: p.screenshots.map((s) => s.url),
    };
  }
  private fileData(data: unknown): ContentVersion {
    const v = cfFile.parse(data),
      hash = v.hashes.find((h) => h.algo === 1);
    if (!v.downloadUrl || !hash)
      throw new AppError(
        "CONTENT_RESTRICTED",
        "The author has not enabled a verifiable API download. Upload the file manually.",
      );
    const types: Record<
      number,
      ContentVersion["dependencies"][number]["type"]
    > = {
      1: "embedded",
      2: "optional",
      3: "required",
      4: "embedded",
      5: "incompatible",
    };
    return {
      id: String(v.id),
      projectId: String(v.modId),
      source: this.source,
      name: v.displayName,
      filename: v.fileName,
      url: v.downloadUrl,
      hash: hash.value,
      hashAlgorithm: "sha1",
      gameVersions: v.gameVersions,
      loaders: v.gameVersions
        .map((s) => s.toLowerCase())
        .filter((s) =>
          ["forge", "fabric", "neoforge", "quilt", "bukkit", "paper"].includes(
            s,
          ),
        ),
      dependencies: v.dependencies
        .filter((d) => types[d.relationType])
        .map((d) => ({
          projectId: String(d.modId),
          versionId: null,
          type: types[d.relationType]!,
        })),
      published: v.fileDate,
    };
  }
  async search(q: string, c: ServerConfig, kind: string) {
    const loader: Record<string, string> = {
      FORGE: "1",
      FABRIC: "4",
      NEOFORGE: "6",
    };
    const query = new URLSearchParams({
      gameId: "432",
      searchFilter: q,
      gameVersion: c.version,
      classId: kind === "modpack" ? "4471" : kind === "plugin" ? "5" : "6",
      pageSize: "30",
      ...(loader[c.software] ? { modLoaderType: loader[c.software]! } : {}),
    });
    const r = await this.request<unknown[]>("/mods/search?" + query);
    return r.data.map((p) => this.projectData(p));
  }
  async project(id: string) {
    const r = await this.request<unknown>("/mods/" + encodeURIComponent(id));
    return this.projectData(r.data);
  }
  async versions(id: string, c: ServerConfig) {
    const r = await this.request<unknown[]>(
      `/mods/${encodeURIComponent(id)}/files?${new URLSearchParams({ gameVersion: c.version, pageSize: "50" })}`,
    );
    return r.data
      .map((v) => this.fileData(v))
      .filter((v) => compatible(v, c))
      .sort((a, b) => b.published.localeCompare(a.published));
  }
  async version(id: string, projectId?: string) {
    if (!projectId)
      throw new AppError(
        "CONTENT",
        "CurseForge requires a project identifier.",
      );
    const r = await this.request<unknown>(
      `/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(id)}`,
    );
    return this.fileData(r.data);
  }
}
export function compatible(v: ContentVersion, c: ServerConfig) {
  return (
    v.gameVersions.includes(c.version) &&
    (v.loaders.length === 0 || v.loaders.some((l) => loaders(c).includes(l)))
  );
}
export interface InstallPlan {
  versions: ContentVersion[];
  alreadyInstalled: string[];
  warnings: string[];
}
export async function resolveDependencies(
  provider: ContentPlatformProvider,
  projectId: string,
  config: ServerConfig,
  installed: InstalledContent[],
  versionId?: string,
): Promise<InstallPlan> {
  const resolved = new Map<string, ContentVersion>(),
    visiting = new Set<string>(),
    alreadyInstalled: string[] = [],
    warnings: string[] = [];
  async function visit(project: string, version?: string) {
    if (visiting.has(project))
      throw new AppError(
        "DEPENDENCY_CYCLE",
        "These projects contain a circular dependency.",
      );
    if (resolved.size >= 128)
      throw new AppError(
        "DEPENDENCY_LIMIT",
        "This installation has too many dependencies.",
      );
    const existing = resolved.get(project);
    if (existing) {
      if (version && existing.id !== version)
        throw new AppError(
          "DEPENDENCY_CONFLICT",
          "Two projects require different versions of the same dependency.",
        );
      return;
    }
    const candidate = version
      ? await provider.version(version, project)
      : (await provider.versions(project, config))[0];
    if (!candidate || !compatible(candidate, config))
      throw new AppError(
        "INCOMPATIBLE",
        "No compatible version exists for this Minecraft version and loader.",
      );
    const metadata = await provider.project(project);
    if (metadata.serverSide === "unsupported")
      throw new AppError(
        "CLIENT_ONLY",
        "This project runs only on Minecraft clients.",
      );
    visiting.add(project);
    for (const d of candidate.dependencies) {
      if (d.type === "required") {
        if (!d.projectId && !d.versionId)
          throw new AppError(
            "DEPENDENCY_UNKNOWN",
            "A required dependency cannot be identified.",
          );
        const dependency =
          d.projectId ?? (await provider.version(d.versionId!)).projectId;
        await visit(dependency, d.versionId ?? undefined);
      } else if (d.type === "optional")
        warnings.push(
          `Optional dependency: ${d.projectId ?? d.versionId ?? "unidentified"}`,
        );
    }
    visiting.delete(project);
    resolved.set(project, candidate);
  }
  await visit(projectId, versionId);
  for (const v of resolved.values())
    for (const d of v.dependencies.filter((d) => d.type === "incompatible"))
      if (
        (d.projectId &&
          (resolved.has(d.projectId) ||
            installed.some((i) => i.projectId === d.projectId))) ||
        (d.versionId &&
          ([...resolved.values()].some((r) => r.id === d.versionId) ||
            installed.some((i) => i.versionId === d.versionId)))
      )
        throw new AppError(
          "INCOMPATIBLE",
          "An installed project conflicts with this installation.",
        );
  for (const [id, v] of resolved)
    if (
      installed.some(
        (i) =>
          i.source === provider.source &&
          i.projectId === id &&
          i.versionId === v.id,
      )
    )
      alreadyInstalled.push(id);
  return { versions: [...resolved.values()], alreadyInstalled, warnings };
}
const downloadHosts = new Set([
  "cdn.modrinth.com",
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
]);
export function validateDownloadUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !downloadHosts.has(url.hostname)
  )
    throw new AppError(
      "DOWNLOAD_HOST",
      "This archive references an unsupported download host.",
    );
  return url;
}
export async function downloadVerified(
  url: string,
  file: string,
  hash: string,
  algorithm: "sha512" | "sha1",
  maxBytes = 1024 ** 3,
) {
  let target = validateDownloadUrl(url),
    response: Response | undefined;
  for (let i = 0; i < 5; i++) {
    response = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(300000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      target = validateDownloadUrl(
        new URL(response.headers.get("location") ?? "", target).href,
      );
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body)
    throw new AppError(
      "DOWNLOAD",
      "This content could not be downloaded.",
      502,
    );
  if (Number(response.headers.get("content-length") ?? 0) > maxBytes)
    throw new AppError("DOWNLOAD_LIMIT", "This download is too large.");
  let bytes = 0;
  const stream = Readable.fromWeb(
    response.body as import("node:stream/web").ReadableStream,
  );
  stream.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > maxBytes)
      stream.destroy(
        new AppError("DOWNLOAD_LIMIT", "This download is too large."),
      );
  });
  try {
    await pipeline(
      stream,
      createWriteStream(file, { flags: "wx", mode: 0o600 }),
    );
    if ((await hashFile(file, algorithm)).toLowerCase() !== hash.toLowerCase())
      throw new AppError(
        "HASH_MISMATCH",
        "The downloaded file failed integrity verification.",
      );
  } catch (e) {
    await rm(file, { force: true });
    throw e;
  }
}
