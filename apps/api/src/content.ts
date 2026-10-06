import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile, rename, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  ModrinthProvider,
  CurseForgeProvider,
  resolveDependencies,
  downloadVerified,
  type ContentPlatformProvider,
  type ContentVersion,
  type InstallPlan,
} from "../../../packages/mod-platforms/src/index.ts";
import { parseProperties } from "../../../packages/settings-schema/src/index.ts";
import {
  safePath,
  relativeSafe,
  atomicWrite,
  readWorldText,
} from "../../../packages/backup/src/paths.ts";
import {
  inspectArchive,
  extractArchive,
  hashFile,
  walk,
  readArchiveMember,
} from "../../../packages/backup/src/archive.ts";
import {
  AppError,
  serverConfigSchema,
  serverJarFilename,
  now,
  type Server,
  type ServerConfig,
  type InstalledContent,
} from "../../../packages/shared/src/index.ts";
import type { Servers } from "./servers.ts";
import type { Backups } from "./backups.ts";
import { validateJar } from "./jars.ts";
export class Content {
  constructor(
    private servers: Servers,
    private backups: Backups,
  ) {
    servers.jobs.register("content.install", async (op, phase) => {
      const s = servers.get(op.serverId!),
        actor = servers.actor(op.id),
        running = s.desired === "RUNNING";
      try {
        phase("Resolving compatible versions and dependencies");
        const provider = this.provider(String(op.payload.source)),
          plan = await this.plan(
            s,
            provider.source,
            String(op.payload.projectId),
            op.payload.versionId ? String(op.payload.versionId) : undefined,
          );
        if (
          plan.versions.some(
            (v) =>
              v.filename.endsWith(".mrpack") ||
              (v.filename.endsWith(".zip") && !v.loaders.includes("datapack")),
          )
        )
          throw new AppError(
            "MODPACK",
            "Use the modpack import flow for this project.",
          );
        phase("Downloading and verifying inventory items");
        const downloaded = await this.download(plan.versions, s.id);
        phase("Creating a recovery point");
        await servers.stop(s);
        const recovery = await backups.create(
          s,
          actor,
          "before content installation",
        );
        try {
          await this.apply(s, downloaded, actor, String(op.payload.projectId));
          phase("Checking Minecraft with the new content");
          await servers.start(s);
          await servers.waitReady(s);
          if (!running) await servers.stop(s);
        } catch (e) {
          phase("Rolling back the unsuccessful content change");
          await servers.stop(s);
          await backups.restore(s, recovery.id);
          if (running) {
            await servers.start(s);
            await servers.waitReady(s);
          }
          throw e;
        }
        servers.store.audit(actor, s.id, "content.installed", {
          projectId: op.payload.projectId,
        });
        return { backupId: recovery.id };
      } catch (e) {
        servers.fail(s, e);
        throw e;
      }
    });
    servers.jobs.register("content.remove", async (op, phase) => {
      const s = servers.get(op.serverId!),
        item = servers.store
          .content(s.id)
          .find((i) => i.id === op.payload.contentId),
        running = s.desired === "RUNNING";
      if (!item)
        throw new AppError("NOT_FOUND", "This item is not installed.", 404);
      phase("Saving a recovery point");
      await servers.stop(s);
      const backup = await backups.create(
        s,
        servers.actor(op.id),
        "before content removal",
      );
      try {
        await rm(await safePath(servers.paths.server(s.id), item.filename));
        servers.store.run(
          "DELETE FROM installed_content WHERE id=? AND server_id=?",
          item.id,
          s.id,
        );
        await this.manifest(s);
        if (running) {
          phase("Checking the remaining content");
          await servers.start(s);
          await servers.waitReady(s);
        } else servers.state(s, "STOPPED");
        servers.store.audit(servers.actor(op.id), s.id, "content.removed", {
          contentId: item.id,
        });
        return { backupId: backup.id };
      } catch (e) {
        phase("Restoring content required by this world");
        await servers.stop(s);
        await backups.restore(s, backup.id);
        if (running) {
          await servers.start(s);
          await servers.waitReady(s);
        }
        throw e;
      }
    });
    servers.jobs.register("jar", (op, phase) =>
      this.uploadJars(
        servers.get(op.serverId!),
        [op.payload],
        servers.actor(op.id),
        phase,
      ),
    );
    servers.jobs.register("jars", (op, phase) =>
      this.uploadJars(
        servers.get(op.serverId!),
        z.array(z.record(z.string(), z.unknown())).parse(op.payload.files),
        servers.actor(op.id),
        phase,
      ),
    );
    servers.jobs.register("modpack", async (op, phase) => {
      const s = servers.get(op.serverId!),
        actor = servers.actor(op.id),
        upload = await safePath(
          servers.paths.server(s.id, "uploads"),
          String(op.payload.filename),
        );
      let recoveryId: string | null = null;
      const running = s.desired === "RUNNING",
        staging =
          servers.paths.server(s.id, "imports") + "/pack-" + randomUUID();
      try {
        phase("Validating the modpack archive");
        await extractArchive(upload, staging);
        let configuration = s.config;
        const versions: ContentVersion[] = [];
        const indexFile = await safePath(staging, "modrinth.index.json", true);
        try {
          const raw = await readFile(indexFile, "utf8"),
            index = mrpackSchema.parse(JSON.parse(raw));
          configuration = this.packConfig(s.config, index.dependencies);
          for (const f of index.files) {
            if (f.env?.server === "unsupported") continue;
            relativeSafe(f.path);
            if (f.path.startsWith("client-overrides/")) continue;
            const target = await safePath(staging, "resolved/" + f.path, true);
            await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
            const hash = f.hashes.sha512 ?? f.hashes.sha1;
            if (!hash)
              throw new AppError(
                "MODPACK_HASH",
                "A modpack file has no verification hash.",
              );
            await downloadVerified(
              f.downloads[0]!,
              target,
              hash,
              f.hashes.sha512 ? "sha512" : "sha1",
            );
          }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          const manifest = cursepackSchema.parse(
            JSON.parse(
              await readFile(await safePath(staging, "manifest.json"), "utf8"),
            ),
          );
          const primary =
            manifest.minecraft.modLoaders.find((l) => l.primary) ??
            manifest.minecraft.modLoaders[0];
          if (!primary)
            throw new AppError(
              "MODPACK_LOADER",
              "This pack has no server loader.",
            );
          const [loader, ...loaderVersion] = primary.id.split("-");
          configuration = this.packConfig(s.config, {
            minecraft: manifest.minecraft.version,
            [loader + "-loader"]: loaderVersion.join("-"),
          });
          const provider = this.provider("curseforge");
          for (const f of manifest.files) {
            const v = await provider.version(
              String(f.fileID),
              String(f.projectID),
            );
            versions.push(v);
          }
        }
        phase("Saving the current world and inventory");
        await servers.stop(s);
        const recovery = await backups.create(
          s,
          actor,
          "before modpack import",
        );
        recoveryId = recovery.id;
        phase("Applying verified server content");
        s.config = configuration;
        if (versions.length) {
          const files = await this.download(versions, s.id);
          await this.apply(s, files, actor, "modpack");
        }
        for (const area of ["resolved", "overrides", "server-overrides"]) {
          const from = path.join(staging, area);
          try {
            for (const f of await walk(from)) {
              const destination = await safePath(
                servers.paths.server(s.id),
                f.path,
                true,
              );
              if (
                f.path === "eula.txt" ||
                f.path === "server.properties" ||
                f.path.startsWith(".minemate")
              )
                continue;
              await mkdir(path.dirname(destination), {
                recursive: true,
                mode: 0o700,
              });
              await copyFile(await safePath(from, f.path), destination);
            }
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
        }
        await this.inventory(s);
        await servers.replaceContainer(s, configuration);
        phase("Verifying the imported server pack");
        await servers.start(s);
        await servers.waitReady(s);
        if (!running) await servers.stop(s);
        servers.store.audit(actor, s.id, "modpack.imported");
        return { backupId: recovery.id, config: configuration };
      } catch (e) {
        if (recoveryId) {
          phase("Restoring the previous pack and world");
          await servers.stop(s);
          await backups.restore(s, recoveryId);
          if (running) {
            await servers.start(s);
            await servers.waitReady(s);
          }
        } else servers.fail(s, e);
        throw e;
      } finally {
        await rm(upload, { force: true });
        await rm(staging, { recursive: true, force: true });
      }
    });
  }
  async uploadJars(
    s: Server,
    files: Record<string, unknown>[],
    actor: string,
    phase: (text: string) => void,
  ) {
    if (s.config.edition !== "JAVA")
      throw new AppError("CAPABILITY", "Bedrock cannot run Java archives.");
    const validated: { file: string; relative: string; server: boolean }[] = [];
    const destinations = new Set<string>();
    let targetConfig = s.config;
    try {
      for (const [index, input] of files.entries()) {
        phase(
          `Validating JAR ${index + 1}/${files.length}: ${String(input.name)}`,
        );
        const file = await safePath(
            this.servers.paths.server(s.id, "uploads"),
            String(input.filename),
          ),
          name = String(input.name),
          custom = !!input.custom;
        if (custom && files.length !== 1)
          throw new AppError("CUSTOM_JAR", "Upload one server JAR at a time.");
        if (custom)
          targetConfig = serverConfigSchema.parse({
            ...s.config,
            software: input.software ?? s.config.software,
            serverSource: "upload",
          });
        await validateJar(file, name, targetConfig, custom);
        const relative = custom
          ? serverJarFilename(targetConfig)
          : (["PAPER", "PURPUR"].includes(s.config.software)
              ? "plugins/"
              : "mods/") + name;
        if (destinations.has(relative))
          throw new AppError(
            "JAR_COLLISION",
            "Two uploads use the same filename.",
          );
        destinations.add(relative);
        validated.push({ file, relative, server: custom });
      }
      phase("Saving a recovery point");
      const running = s.desired === "RUNNING";
      await this.servers.stop(s);
      const backup = await this.backups.create(
        s,
        actor,
        "before manual JAR upload",
      );
      try {
        phase("Applying the complete upload");
        for (const { file, relative, server } of validated) {
          const target = await safePath(
            this.servers.paths.server(s.id),
            relative,
            true,
          );
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await copyFile(file, target);
          if (!server)
            this.record({
              id: randomUUID(),
              serverId: s.id,
              source: "manual",
              projectId: "",
              versionId: "",
              filename: relative,
              hash: await hashFile(file),
              gameVersion: s.config.version,
              loader: s.config.software.toLowerCase(),
              dependency: false,
              managed: false,
              installedAt: now(),
              installedBy: actor,
            });
        }
        if (validated.some((f) => f.server)) {
          this.servers.store.run(
            "DELETE FROM installed_content WHERE server_id=? AND filename IN ('custom-server.jar','server-installer.jar')",
            s.id,
          );
          await this.servers.replaceContainer(s, targetConfig);
        }
        await this.manifest(s);
        if (running) {
          phase("Checking Minecraft after the upload");
          await this.servers.start(s);
          await this.servers.waitReady(s);
        } else this.servers.state(s, "STOPPED");
        this.servers.store.audit(actor, s.id, "content.uploaded", {
          files: validated.map((f) => f.relative),
        });
        return { backupId: backup.id };
      } catch (e) {
        phase("Restoring the upload recovery point");
        await this.servers.stop(s);
        await this.backups.restore(s, backup.id);
        if (running) {
          await this.servers.start(s);
          await this.servers.waitReady(s);
        }
        throw e;
      }
    } finally {
      await Promise.all(
        files.map((f) =>
          safePath(
            this.servers.paths.server(s.id, "uploads"),
            String(f.filename),
          )
            .then((file) => rm(file, { force: true }))
            .catch(() => {}),
        ),
      );
    }
  }
  provider(source: string): ContentPlatformProvider {
    if (source === "modrinth") return new ModrinthProvider();
    if (source === "curseforge") {
      const sealed = this.servers.store.setting<string>("curseforgeKey", "");
      return new CurseForgeProvider(
        sealed
          ? this.servers.secrets.unseal(sealed)
          : this.servers.config.curseforgeKey,
      );
    }
    throw new AppError("PLATFORM", "Choose Modrinth or CurseForge.");
  }
  async plan(s: Server, source: string, projectId: string, versionId?: string) {
    const provider = this.provider(source),
      installed = this.servers.store.content(s.id),
      plan = await resolveDependencies(
        provider,
        projectId,
        s.config,
        installed,
        versionId,
      );
    if (s.config.software === "FABRIC") {
      const checked = new Set<string>();
      for (let index = 0; index < plan.versions.length; index++) {
        const v = plan.versions[index]!;
        if (checked.has(v.id)) continue;
        checked.add(v.id);
        if (!v.filename.endsWith(".jar")) continue;
        const file = await this.cachedJar(v),
          raw = await readArchiveMember(file, "fabric.mod.json");
        if (!raw) continue;
        const manifest = z
            .object({ depends: z.record(z.string(), z.unknown()).optional() })
            .parse(JSON.parse(raw)),
          required = Object.keys(manifest.depends ?? {}),
          extra: string[] = [];
        if (
          required.some(
            (k) =>
              k === "fabric" ||
              k === "fabric-api" ||
              /^fabric-(api-base|command-api|lifecycle-events)/.test(k),
          )
        )
          extra.push("fabric-api");
        if (required.includes("fabric-language-kotlin"))
          extra.push("fabric-language-kotlin");
        for (const dependency of extra) {
          const dep = await resolveDependencies(
            provider,
            dependency,
            s.config,
            installed,
          );
          for (const item of dep.versions) {
            const existing = plan.versions.find(
              (p) => p.projectId === item.projectId,
            );
            if (existing && existing.id !== item.id)
              throw new AppError(
                "DEPENDENCY_CONFLICT",
                "Fabric manifests require conflicting library versions.",
              );
            if (!existing) plan.versions.push(item);
          }
          plan.warnings.push(...dep.warnings);
        }
      }
    }
    return plan;
  }
  async cachedJar(version: ContentVersion) {
    if (!/^[a-fA-F0-9]{40,128}$/.test(version.hash))
      throw new AppError(
        "HASH",
        "This content has an invalid verification hash.",
      );
    const file = path.join(
      this.servers.paths.root,
      "cache/downloads",
      version.hash.toLowerCase() + ".jar",
    );
    try {
      if (
        (await hashFile(file, version.hashAlgorithm)) ===
        version.hash.toLowerCase()
      )
        return file;
      await rm(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const temporary = file + "." + randomUUID();
    await downloadVerified(
      version.url,
      temporary,
      version.hash,
      version.hashAlgorithm,
    );
    await inspectArchive(temporary);
    await rename(temporary, file);
    return file;
  }

  async download(versions: ContentVersion[], serverId: string) {
    const result: { version: ContentVersion; file: string }[] = [];
    try {
      for (const version of versions) {
        relativeSafe(version.filename);
        if (version.filename.includes("/"))
          throw new AppError("CONTENT_FILENAME", "Invalid content filename.");
        const file = path.join(
          this.servers.paths.server(serverId, "uploads"),
          randomUUID() + ".jar",
        );
        await downloadVerified(
          version.url,
          file,
          version.hash,
          version.hashAlgorithm,
        );
        await inspectArchive(file);
        result.push({ version, file });
      }
      return result;
    } catch (e) {
      await Promise.all(result.map((f) => rm(f.file, { force: true })));
      throw e;
    }
  }
  async apply(
    s: Server,
    downloaded: { version: ContentVersion; file: string }[],
    actor: string,
    rootProject: string,
  ) {
    const folder = ["PAPER", "PURPUR"].includes(s.config.software)
      ? "plugins"
      : "mods";
    await mkdir(path.join(this.servers.paths.server(s.id), folder), {
      recursive: true,
      mode: 0o700,
    });
    const installed = this.servers.store.content(s.id),
      metadata: InstalledContent[] = [];
    try {
      for (const { version: v, file } of downloaded) {
        const world =
            parseProperties(
              await readWorldText(
                this.servers.paths.server(s.id),
                "server.properties",
              ).catch(() => ""),
            )["level-name"] ?? "world",
          relative = v.loaders.includes("datapack")
            ? world + "/datapacks/" + v.filename
            : folder + "/" + v.filename;
        await mkdir(
          path.dirname(
            await safePath(this.servers.paths.server(s.id), relative, true),
          ),
          { recursive: true, mode: 0o700 },
        );
        const target = await safePath(
            this.servers.paths.server(s.id),
            relative,
            true,
          ),
          existing = installed.find(
            (i) => i.source === v.source && i.projectId === v.projectId,
          );
        const collision = installed.find(
          (i) => i.filename === relative && i.projectId !== v.projectId,
        );
        if (
          collision ||
          (!existing &&
            (await stat(target)
              .then(() => true)
              .catch(() => false)))
        )
          throw new AppError(
            "CONTENT_COLLISION",
            "This filename belongs to another or manually uploaded item.",
          );
        if (existing && existing.filename !== relative)
          await rm(
            await safePath(this.servers.paths.server(s.id), existing.filename),
            { force: true },
          );
        await rename(file, target);
        metadata.push({
          id: existing?.id ?? randomUUID(),
          serverId: s.id,
          source: v.source,
          projectId: v.projectId,
          versionId: v.id,
          filename: relative,
          hash: v.hash,
          gameVersion: s.config.version,
          loader: s.config.software.toLowerCase(),
          dependency: v.projectId !== rootProject,
          managed: true,
          installedAt: now(),
          installedBy: actor,
        });
      }
      this.servers.store.transaction(() => {
        for (const item of metadata) this.record(item);
      });
      await this.manifest(s);
    } finally {
      await Promise.all(downloaded.map((f) => rm(f.file, { force: true })));
    }
  }
  record(i: InstalledContent) {
    this.servers.store.run(
      "INSERT INTO installed_content VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(server_id,filename) DO UPDATE SET project_id=excluded.project_id,version_id=excluded.version_id,hash=excluded.hash,source=excluded.source,game_version=excluded.game_version,loader=excluded.loader,dependency=excluded.dependency,managed=excluded.managed,installed_at=excluded.installed_at,installed_by=excluded.installed_by",
      i.id,
      i.serverId,
      i.source,
      i.projectId,
      i.versionId,
      i.filename,
      i.hash,
      i.gameVersion,
      i.loader,
      i.dependency ? 1 : 0,
      i.managed ? 1 : 0,
      i.installedAt,
      i.installedBy,
    );
  }
  async manifest(s: Server) {
    await atomicWrite(
      this.servers.paths.server(s.id) + "/.minemate-content.json",
      JSON.stringify(this.servers.store.content(s.id)),
    );
  }
  async inventory(s: Server) {
    const root = this.servers.paths.server(s.id),
      installed = this.servers.store.content(s.id),
      properties = parseProperties(
        await readWorldText(root, "server.properties").catch((e) => {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
          throw e;
        }),
      ),
      world = properties["level-name"] ?? "world";
    for (const area of ["mods", "plugins", world + "/datapacks"]) {
      let entries: { path: string; bytes: number }[];
      try {
        entries = await walk(await safePath(root, area));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw e;
      }
      for (const entry of entries) {
        if (!/\.(jar|zip)$/i.test(entry.path)) continue;
        const filename = area + "/" + entry.path,
          existing = installed.find((i) => i.filename === filename),
          hash = await hashFile(
            await safePath(root, filename),
            existing?.hash.length === 40
              ? "sha1"
              : existing?.hash.length === 128
                ? "sha512"
                : "sha256",
          );
        if (existing?.hash === hash) continue;
        this.record({
          id: existing?.id ?? randomUUID(),
          serverId: s.id,
          source: "manual",
          projectId: "",
          versionId: "",
          filename,
          hash,
          gameVersion: s.config.version,
          loader: s.config.software.toLowerCase(),
          dependency: false,
          managed: false,
          installedAt: now(),
          installedBy: "import",
        });
      }
    }
    for (const item of installed) {
      try {
        await stat(await safePath(root, item.filename));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        this.servers.store.run(
          "DELETE FROM installed_content WHERE id=? AND server_id=?",
          item.id,
          s.id,
        );
      }
    }
    await this.manifest(s);
    return this.servers.store.content(s.id);
  }
  private packConfig(
    base: ServerConfig,
    deps: Record<string, string>,
  ): ServerConfig {
    const mappings: Record<string, ServerConfig["software"]> = {
      "fabric-loader": "FABRIC",
      forge: "FORGE",
      "forge-loader": "FORGE",
      neoforge: "NEOFORGE",
      "neoforge-loader": "NEOFORGE",
    };
    const entry = Object.entries(deps).find(([k]) => mappings[k]);
    if (!deps.minecraft || !entry)
      throw new AppError(
        "MODPACK_LOADER",
        "This pack uses an unsupported server loader.",
      );
    return {
      ...base,
      edition: "JAVA",
      version: deps.minecraft,
      software: mappings[entry[0]]!,
      loaderVersion: entry[1],
    };
  }
}
const mrpackSchema = z.object({
  formatVersion: z.literal(1),
  game: z.literal("minecraft"),
  dependencies: z.record(z.string(), z.string()),
  files: z
    .array(
      z.object({
        path: z.string(),
        hashes: z.object({
          sha512: z.string().optional(),
          sha1: z.string().optional(),
        }),
        downloads: z.array(z.url()).min(1),
        env: z
          .object({ server: z.enum(["required", "optional", "unsupported"]) })
          .optional(),
      }),
    )
    .max(100000),
});
const cursepackSchema = z.object({
  minecraft: z.object({
    version: z.string(),
    modLoaders: z.array(z.object({ id: z.string(), primary: z.boolean() })),
  }),
  files: z
    .array(
      z.object({
        projectID: z.number().int().positive(),
        fileID: z.number().int().positive(),
        required: z.boolean(),
      }),
    )
    .max(10000),
});
export type { InstallPlan };
