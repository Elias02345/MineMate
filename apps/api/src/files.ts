import {
  readdir,
  readFile,
  stat,
  mkdir,
  rm,
  rename,
  copyFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  safePath,
  atomicWrite,
  relativeSafe,
  readWorldText,
} from "../../../packages/backup/src/paths.ts";
import {
  extractArchive,
  createArchive,
  walk,
  swapDirectory,
  inspectArchive,
} from "../../../packages/backup/src/archive.ts";
import {
  parseProperties,
  mergeProperties,
  validateProperties,
  settings,
} from "../../../packages/settings-schema/src/index.ts";
import {
  AppError,
  now,
  type Server,
} from "../../../packages/shared/src/index.ts";
import type { Servers } from "./servers.ts";
import type { Backups } from "./backups.ts";
export const revision = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const managed = new Set([
  "server-port",
  "server-portv6",
  "server-ip",
  "rcon.port",
  "rcon.password",
  "enable-rcon",
  "enable-query",
  "query.port",
]);
const redact = (text: string) =>
  text.replace(/^(rcon\.password\s*=).*/gm, "$1[managed by MineMate]");
export class Files {
  constructor(
    private servers: Servers,
    private backups: Backups,
  ) {
    servers.jobs.register("settings", async (op, phase) => {
      const s = servers.get(op.serverId!),
        running = s.desired === "RUNNING";
      try {
        phase("Saving a configuration recovery point");
        await servers.stop(s);
        await backups.create(s, servers.actor(op.id), "before settings change");
        const current = await this.properties(s),
          expected = String(op.payload.revision);
        if (current.revision !== expected)
          throw new AppError(
            "REVISION_CONFLICT",
            "The configuration changed. Reload it before saving.",
            409,
          );
        const values = op.payload.values as Record<string, string>;
        validateProperties(values, s.config.edition, true);
        await atomicWrite(
          servers.paths.server(s.id) + "/server.properties",
          mergeProperties(current.raw, values),
        );
        servers.store.run(
          "INSERT INTO server_configurations VALUES(?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET revision=excluded.revision,properties=excluded.properties,updated_at=excluded.updated_at",
          s.id,
          revision(mergeProperties(current.raw, values)),
          JSON.stringify(values),
          now(),
        );
        if (values["max-players"]) {
          s.config.maxPlayers = Number(values["max-players"]);
          if (s.config.edition === "BEDROCK")
            await servers.replaceContainer(s, s.config);
          servers.store.saveServer(s);
        }
        servers.store.audit(servers.actor(op.id), s.id, "settings.changed", {
          keys: Object.keys(values),
        });
        if (op.payload.restart && running) {
          phase("Starting with the new configuration");
          await servers.start(s);
          await servers.waitReady(s);
        } else servers.state(s, "STOPPED");
        return { restartRequired: !op.payload.restart };
      } catch (e) {
        servers.fail(s, e);
        throw e;
      }
    });
    servers.jobs.register("file", async (op, phase) => {
      const s = servers.get(op.serverId!);
      try {
        phase("Saving a recovery point");
        await servers.stop(s);
        await backups.create(s, servers.actor(op.id), "before file change");
        const action = String(op.payload.action),
          name = String(op.payload.path),
          root = servers.paths.server(s.id),
          target = await safePath(
            root,
            name,
            action === "mkdir" || action === "write",
          );
        if (target === (await safePath(root, "")))
          throw new AppError(
            "UNSAFE_PATH",
            "The world root cannot be changed.",
          );
        phase("Applying the confirmed file change");
        if (action === "mkdir")
          await mkdir(target, { recursive: false, mode: 0o700 });
        else if (action === "rename") {
          const dest = await safePath(
            root,
            String(op.payload.destination),
            true,
          );
          try {
            await stat(dest);
            throw new AppError(
              "FILE_EXISTS",
              "The destination already exists.",
            );
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          await rename(target, dest);
        } else if (action === "delete") await rm(target, { recursive: true });
        else if (action === "archive") {
          const destination = await safePath(
            root,
            String(op.payload.destination),
            true,
          );
          if (!destination.endsWith(".zip"))
            throw new AppError("ARCHIVE_NAME", "Choose a ZIP filename.");
          await createArchive(target, destination);
        } else if (action === "write") {
          let content = String(op.payload.text);
          if (Buffer.byteLength(content) > 2 * 1024 ** 2)
            throw new AppError("FILE_LIMIT", "This text file is too large.");
          const current = await readFile(target, "utf8").catch((e) => {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
            throw e;
          });
          if (revision(current) !== op.payload.revision)
            throw new AppError(
              "REVISION_CONFLICT",
              "This file changed. Reload before saving.",
              409,
            );
          if (name === "server.properties") {
            const proposed = parseProperties(content),
              existing = parseProperties(current);
            for (const key of managed) {
              if (
                proposed[key] !== undefined &&
                proposed[key] !== existing[key] &&
                !(
                  key === "rcon.password" &&
                  proposed[key] === "[managed by MineMate]"
                )
              )
                throw new AppError(
                  "MANAGED_SETTING",
                  `${key} is managed by MineMate.`,
                );
              delete proposed[key];
            }
            validateProperties(proposed, s.config.edition, true);
            content = mergeProperties(current, proposed);
          }
          if (/\.json$/i.test(name)) {
            try {
              JSON.parse(content);
            } catch {
              throw new AppError(
                "CONFIG_SYNTAX",
                "This JSON configuration has a syntax error.",
              );
            }
          }
          if (/\.ya?ml$/i.test(name)) {
            try {
              const doc = parseDocument(content);
              if (doc.errors.length) throw doc.errors[0];
              doc.toJS({ maxAliasCount: 100 });
            } catch {
              throw new AppError(
                "CONFIG_SYNTAX",
                "This YAML configuration has a syntax error or excessive aliases.",
              );
            }
          }
          await atomicWrite(target, content);
        } else if (action === "extract") {
          const staging =
            servers.paths.server(s.id, "imports") + "/extract-" + randomUUID();
          await extractArchive(target, staging);
          const destination = await safePath(
            root,
            String(op.payload.destination),
            true,
          );
          try {
            await stat(destination);
            throw new AppError(
              "FILE_EXISTS",
              "Choose a new destination folder.",
            );
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          }
          await rename(staging, destination);
        } else throw new AppError("FILE_ACTION", "Unsupported file action");
        servers.store.audit(servers.actor(op.id), s.id, "file." + action, {
          path: name,
        });
        servers.state(s, "STOPPED");
        return {};
      } catch (e) {
        servers.fail(s, e);
        throw e;
      }
    });
    servers.jobs.register("import", async (op, phase) => {
      const s = this.servers.get(op.serverId!),
        folderUpload = typeof op.payload.folder === "string",
        upload = await safePath(
          servers.paths.server(s.id, "uploads"),
          String(folderUpload ? op.payload.folder : op.payload.filename),
        ),
        kind = String(op.payload.kind),
        stage =
          servers.paths.server(s.id, "imports") + "/import-" + randomUUID(),
        running = s.desired === "RUNNING";
      let backupId: string | null = null,
        changed = false;
      try {
        phase("Inspecting and staging the uploaded world");
        if (folderUpload) await rename(upload, stage);
        else await extractArchive(upload, stage);
        const entries = await walk(stage);
        let source = stage;
        if (kind === "server") {
          const roots = entries.filter(
            (f) => path.posix.basename(f.path) === "server.properties",
          );
          const root =
            roots.find((f) => f.path === "server.properties") ??
            (roots.length === 1 ? roots[0] : undefined);
          if (!root)
            throw new AppError(
              "SERVER_FORMAT",
              "Choose a server folder ZIP containing server.properties. Use world import for a saved world.",
            );
          source = await safePath(
            stage,
            path.posix.dirname(root.path) === "."
              ? ""
              : path.posix.dirname(root.path),
          );
        } else {
          const roots = entries.filter(
            (f) => path.posix.basename(f.path) === "level.dat",
          );
          if (roots.length !== 1)
            throw new AppError(
              "WORLD_FORMAT",
              roots.length
                ? "This upload contains multiple worlds. Choose one complete world folder."
                : "Choose a complete Minecraft world folder or ZIP containing level.dat.",
            );
          const prefix = path.posix.dirname(roots[0]!.path);
          source = await safePath(stage, prefix === "." ? "" : prefix);
          const worldEntries = await walk(source),
            bedrock = worldEntries.some((f) => f.path.startsWith("db/"));
          if ((s.config.edition === "BEDROCK") !== bedrock)
            throw new AppError(
              "WORLD_EDITION",
              bedrock
                ? "This is a Bedrock world. Import it into a Bedrock server."
                : "This is a Java world. Import it into a Java server; Bedrock worlds need their db folder.",
            );
        }
        phase("Saving a recovery point before replacing the world");
        await servers.stop(s);
        changed = true;
        const backup = await backups.create(
          s,
          servers.actor(op.id),
          "before " + kind + " import",
        );
        backupId = backup.id;
        phase("Applying the validated import");
        let target = servers.paths.server(s.id);
        if (kind !== "server") {
          const p = await this.properties(s),
            world = p.values["level-name"] ?? "world";
          target = await safePath(
            servers.paths.server(s.id),
            s.config.edition === "JAVA" ? world : "worlds/" + world,
            true,
          );
        }
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        let exists = true;
        try {
          await stat(target);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          exists = false;
        }
        if (exists) {
          const previous = await swapDirectory(source, target);
          await rename(
            previous,
            servers.paths.server(s.id, "snapshots") + "/" + randomUUID(),
          );
        } else await rename(source, target);
        if (running) {
          phase("Checking Minecraft with the imported world");
          await servers.start(s);
          await servers.waitReady(s);
        } else servers.state(s, "STOPPED");
        servers.store.audit(servers.actor(op.id), s.id, "world.imported", {
          kind,
          format: folderUpload ? "folder" : "zip",
        });
        return { backupId, files: entries.length };
      } catch (e) {
        if (changed) {
          phase("Restoring the previous world after the unsuccessful import");
          await servers.stop(s);
          if (backupId) await backups.restore(s, backupId);
          if (running) {
            await servers.start(s);
            await servers.waitReady(s);
          } else servers.state(s, "STOPPED");
        }
        throw e;
      } finally {
        await rm(stage, { recursive: true, force: true });
        await rm(upload, { recursive: folderUpload, force: true });
      }
    });
    servers.jobs.register("files.upload", async (op, phase) => {
      const s = servers.get(op.serverId!),
        inputs = op.payload.files as { filename: string; name: string }[],
        directory = String(op.payload.directory ?? ""),
        root = servers.paths.server(s.id);
      try {
        const staged: { source: string; target: string }[] = [];
        for (const input of inputs) {
          relativeSafe(input.name);
          if (input.name.includes("/"))
            throw new AppError("UPLOAD_NAME", "Choose a simple filename.");
          const relative = directory
            ? directory + "/" + input.name
            : input.name;
          if (
            [
              "server.properties",
              "eula.txt",
              "custom-server.jar",
              ".minemate-content.json",
            ].includes(relative)
          )
            throw new AppError(
              "MANAGED_FILE",
              "Use the dedicated settings, agreement or server JAR flow for this file.",
            );
          const target = await safePath(root, relative, true),
            source = await safePath(
              servers.paths.server(s.id, "uploads"),
              input.filename,
            );
          if (staged.some((f) => f.target === target))
            throw new AppError(
              "UPLOAD_NAME",
              "Two uploads have the same filename.",
            );
          if (/\.(json|ya?ml)$/i.test(input.name)) {
            if ((await stat(source)).size > 2 * 1024 ** 2)
              throw new AppError(
                "FILE_LIMIT",
                "Configuration files must be smaller than 2 MB.",
              );
            const text = await readFile(source, "utf8");
            try {
              if (input.name.endsWith(".json")) JSON.parse(text);
              else {
                const doc = parseDocument(text);
                if (doc.errors.length) throw doc.errors[0];
                doc.toJS({ maxAliasCount: 100 });
              }
            } catch {
              throw new AppError(
                "CONFIG_SYNTAX",
                "This configuration has invalid JSON or YAML.",
              );
            }
          }
          staged.push({ source, target });
        }
        phase("Saving a recovery point");
        await servers.stop(s);
        const backup = await backups.create(
          s,
          servers.actor(op.id),
          "before file upload",
        );
        try {
          phase("Applying the complete file upload");
          for (const file of staged) await rename(file.source, file.target);
          servers.state(s, "STOPPED");
          servers.store.audit(servers.actor(op.id), s.id, "files.uploaded", {
            count: staged.length,
          });
          return { backupId: backup.id };
        } catch (e) {
          await backups.restore(s, backup.id);
          throw e;
        }
      } finally {
        await Promise.all(
          inputs.map((f) =>
            safePath(
              servers.paths.server(s.id, "uploads"),
              f.filename,
              true,
            ).then((file) => rm(file, { force: true })),
          ),
        );
      }
    });
  }
  async properties(s: Server) {
    const raw = await readWorldText(
        this.servers.paths.server(s.id),
        "server.properties",
      ).catch((e) => {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw e;
      }),
      values = parseProperties(raw);
    for (const key of managed) delete values[key];
    return {
      values,
      revision: revision(raw),
      raw,
      schema: settings.filter(
        (d) => d.edition === "both" || d.edition === s.config.edition,
      ),
    };
  }
  async list(s: Server, input: string) {
    const root = this.servers.paths.server(s.id),
      directory = await safePath(root, input),
      entries = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const child = input ? input + "/" + entry.name : entry.name;
      const filename = await safePath(root, child),
        info = await stat(filename);
      entries.push({
        name: entry.name,
        path: child,
        directory: entry.isDirectory(),
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
    return entries.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.localeCompare(b.name),
    );
  }
  async text(s: Server, input: string) {
    const raw = await readWorldText(this.servers.paths.server(s.id), input);
    if (raw.includes("\0"))
      throw new AppError("BINARY_FILE", "This is a binary file. Use Download.");
    return {
      text: input === "server.properties" ? redact(raw) : raw,
      revision: revision(raw),
    };
  }
  async worlds(s: Server) {
    const p = await this.properties(s),
      name = p.values["level-name"] ?? "world",
      root = this.servers.paths.server(s.id),
      base = s.config.edition === "JAVA" ? "" : "worlds";
    const entries = await this.list(s, base).catch(() => []),
      result = [];
    for (const e of entries.filter((e) => e.directory)) {
      const files = await walk(await safePath(root, e.path));
      if (files.some((f) => f.path === "level.dat" || f.path.startsWith("db/")))
        result.push({
          name: e.name,
          path: e.path,
          bytes: files.reduce((sum, f) => sum + f.bytes, 0),
          active: e.name === name,
          seed: p.values["level-seed"] ?? null,
          dimensions:
            files.filter(
              (f) => f.path.startsWith("DIM-1/") || f.path.startsWith("DIM1/"),
            ).length > 0,
        });
    }
    return result;
  }
  async export(s: Server, input: string) {
    const root = await safePath(this.servers.paths.server(s.id), input),
      out =
        this.servers.paths.server(s.id, "uploads") +
        "/" +
        randomUUID() +
        ".zip";
    const info = await createArchive(root, out);
    return { file: out, ...info };
  }
  async stageJar(s: Server, upload: string, filename: string, custom: boolean) {
    relativeSafe(filename);
    if (!/^[a-zA-Z0-9 _().+-]+\.jar$/i.test(filename))
      throw new AppError("JAR", "Upload a file ending in .jar.");
    const entries = await inspectArchive(upload);
    if (!entries.some((e) => e.name === "META-INF/MANIFEST.MF"))
      throw new AppError(
        "JAR",
        "This file is not a recognizable Java archive.",
      );
    const directory = custom
      ? ""
      : s.config.software === "PAPER" || s.config.software === "PURPUR"
        ? "plugins"
        : "mods";
    if (s.config.edition !== "JAVA")
      throw new AppError("CAPABILITY", "Bedrock does not support Java JARs.");
    await this.servers.stop(s);
    await this.backups.create(s, "manual", "before manual JAR upload");
    await mkdir(path.join(this.servers.paths.server(s.id), directory), {
      recursive: true,
    });
    const name = custom ? "custom-server.jar" : filename,
      target = await safePath(
        this.servers.paths.server(s.id),
        directory ? directory + "/" + name : name,
        true,
      );
    await copyFile(upload, target);
    await rm(upload, { force: true });
    this.servers.state(s, "STOPPED");
    return { filename: name };
  }
}
