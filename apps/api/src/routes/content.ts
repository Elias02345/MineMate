import { z } from "zod";
import { randomUUID } from "node:crypto";
import { rm, mkdir } from "node:fs/promises";
import { Transform } from "node:stream";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import {
  inspectArchive,
  archiveLimits,
} from "../../../../packages/backup/src/archive.ts";
import {
  relativeSafe,
  safePath,
} from "../../../../packages/backup/src/paths.ts";
import { validateJar } from "../jars.ts";
import {
  AppError,
  idSchema,
  serverConfigSchema,
} from "../../../../packages/shared/src/index.ts";
import { routeHelpers, type RouteContext } from "./context.ts";
export function registerContentRoutes(context: RouteContext) {
  const { app, paths, store, jobs, servers, content, updates } = context;
  const { params, query, user, world } = routeHelpers(context);
  app.post("/api/v1/servers/:id/uploads", async (r, reply) => {
    const kind = z
        .enum([
          "world",
          "world-folder",
          "server",
          "modpack",
          "jar",
          "custom",
          "file",
        ])
        .parse(query(r).kind),
      s = world(
        r,
        ["jar", "custom", "modpack"].includes(kind) ? "content" : "files",
      );
    if (query(r).confirm !== "true")
      throw new AppError("CONFIRM", "Explicitly confirm this upload.");
    const software =
      kind === "custom"
        ? serverConfigSchema.shape.software.parse(
            query(r).software ?? s.config.software,
          )
        : s.config.software;
    if (kind === "custom") world(r, "settings");
    if (["jar", "custom"].includes(kind) && s.config.edition !== "JAVA")
      throw new AppError("CAPABILITY", "Bedrock cannot run Java archives.");
    const targetConfig =
      kind === "custom"
        ? serverConfigSchema.parse({
            ...s.config,
            software,
            serverSource: "upload",
          })
        : s.config;
    const operations: {
      filename: string;
      name: string;
      custom: boolean;
      software: string;
    }[] = [];
    const folderName =
      kind === "world-folder" ? "folder-" + randomUUID() : null;
    const folder = folderName
      ? path.join(paths.server(s.id, "uploads"), folderName)
      : null;
    let relativePaths: string[] | null = null,
      folderCount = 0,
      bytes = 0;
    let queued = false;
    try {
      if (folder) await mkdir(folder, { mode: 0o700 });
      for await (const part of r.parts({
        limits: {
          files: folder ? 10000 : 100,
          parts: folder ? 10002 : 110,
          fieldSize: 2 * 1024 ** 2,
        },
      })) {
        if (part.type !== "file") {
          if (folder && part.fieldname === "relativePaths") {
            if (relativePaths || folderCount || part.valueTruncated)
              throw new AppError(
                "WORLD_FOLDER",
                "Send one complete folder file list before its files.",
              );
            let value: unknown;
            try {
              value = JSON.parse(String(part.value));
            } catch {
              throw new AppError(
                "WORLD_FOLDER",
                "The folder file list is invalid.",
              );
            }
            relativePaths = z
              .array(z.string().min(1).max(512))
              .min(1)
              .max(10000)
              .parse(value)
              .map((p) => {
                relativeSafe(p);
                if (p.endsWith("/"))
                  throw new AppError(
                    "WORLD_FOLDER",
                    "Choose files inside a world folder.",
                  );
                return path.posix.normalize(p);
              });
            if (new Set(relativePaths).size !== relativePaths.length)
              throw new AppError(
                "UPLOAD_COLLISION",
                "The folder contains duplicate file paths.",
              );
          }
          continue;
        }
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > archiveLimits.bytes
                ? new AppError(
                    "UPLOAD_LIMIT",
                    "The complete upload exceeds 20 GB.",
                  )
                : null,
              chunk,
            );
          },
        });
        if (folder) {
          const relative = relativePaths?.[folderCount++];
          if (!relative)
            throw new AppError(
              "WORLD_FOLDER",
              "The folder file list does not match the uploaded files.",
            );
          const target = await safePath(folder, relative, true);
          await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await pipeline(
            part.file,
            limit,
            createWriteStream(target, { flags: "wx", mode: 0o600 }),
          );
          if (part.file.truncated)
            throw new AppError(
              "UPLOAD_LIMIT",
              "One file exceeds 512 MB. Use a ZIP for larger world folders.",
            );
          continue;
        }
        const name = path.basename(part.filename),
          ext = path.extname(name).toLowerCase();
        if (["jar", "custom"].includes(kind) && ext !== ".jar")
          throw new AppError("JAR", "Choose a JAR file.");
        if (
          kind !== "file" &&
          ![
            ".zip",
            ".mrpack",
            ".jar",
            ...(kind === "world" ? [".mcworld"] : []),
          ].includes(ext)
        )
          throw new AppError(
            "UPLOAD_TYPE",
            "Upload a ZIP, MRPACK or JAR archive.",
          );
        const filename =
            randomUUID() +
            ([".zip", ".mrpack", ".jar"].includes(ext) ? ext : ".upload"),
          target = path.join(paths.server(s.id, "uploads"), filename);
        if (operations.some((f) => f.name === name))
          throw new AppError(
            "UPLOAD_COLLISION",
            "Two selected files have the same filename.",
          );
        operations.push({
          filename,
          name,
          custom: kind === "custom",
          software,
        });
        await pipeline(
          part.file,
          limit,
          createWriteStream(target, { flags: "wx", mode: 0o600 }),
        );
        if (part.file.truncated)
          throw new AppError("UPLOAD_LIMIT", "This upload exceeds 512 MB.");
        if (["jar", "custom"].includes(kind))
          await validateJar(target, name, targetConfig, kind === "custom");
        else if (kind !== "file") await inspectArchive(target);
      }
      if (folder) {
        if (!relativePaths || folderCount !== relativePaths.length)
          throw new AppError(
            "WORLD_FOLDER",
            "The uploaded world folder is incomplete.",
          );
        const operation = jobs.enqueue(s.id, user(r).id, "import", {
          folder: folderName,
          kind: "world",
        });
        queued = true;
        return reply
          .code(202)
          .send({
            operation,
            summary: { files: folderCount, bytes, format: "folder" },
          });
      }
      if (!operations.length)
        throw new AppError("UPLOAD", "Select at least one file.");
      if (kind === "custom" && operations.length !== 1)
        throw new AppError(
          "CUSTOM_JAR",
          "Select exactly one server JAR. Upload mods separately.",
        );
      let operation, summary;
      if (kind === "file")
        operation = jobs.enqueue(s.id, user(r).id, "files.upload", {
          files: operations,
          directory: query(r).directory ?? "",
        });
      else if (kind === "jar" || kind === "custom")
        operation =
          operations.length > 1
            ? jobs.enqueue(s.id, user(r).id, "jars", { files: operations })
            : jobs.enqueue(s.id, user(r).id, "jar", operations[0]!);
      else {
        if (operations.length !== 1)
          throw new AppError("UPLOAD", "Import one archive at a time.");
        const item = operations[0]!,
          entries = await inspectArchive(
            path.join(paths.server(s.id, "uploads"), item.filename),
          );
        summary = {
          files: entries.length,
          bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
          world: entries.some((e) => e.name.endsWith("level.dat")),
          modpack: entries.some(
            (e) =>
              e.name === "modrinth.index.json" || e.name === "manifest.json",
          ),
        };
        operation = jobs.enqueue(
          s.id,
          user(r).id,
          kind === "modpack" ? "modpack" : "import",
          { filename: item.filename, kind },
        );
      }
      queued = true;
      return reply.code(202).send({ operation, summary });
    } finally {
      if (!queued && folder) await rm(folder, { recursive: true, force: true });
      if (!queued)
        await Promise.all(
          operations.map((f) =>
            rm(path.join(paths.server(s.id, "uploads"), f.filename), {
              force: true,
            }),
          ),
        );
    }
  });
  app.get("/api/v1/servers/:id/content", async (r) =>
    content.inventory(world(r, "content")),
  );
  app.delete("/api/v1/servers/:id/content/:contentId", async (r, reply) => {
    const s = world(r, "content");
    z.object({ confirm: z.literal(true) }).parse(r.body);
    return reply.code(202).send(
      jobs.enqueue(s.id, user(r).id, "content.remove", {
        contentId: idSchema.parse(params(r).contentId),
      }),
    );
  });
  app.get("/api/v1/marketplace", async (r) => {
    const sid = idSchema.parse(query(r).serverId),
      s = servers.authorized(user(r), sid, "content"),
      source = query(r).source ?? "modrinth",
      kind = z
        .enum(["mod", "plugin", "modpack", "datapack"])
        .parse(
          query(r).kind ??
            (["PAPER", "PURPUR"].includes(s.config.software)
              ? "plugin"
              : "mod"),
        );
    return content
      .provider(source)
      .search((query(r).q ?? "").slice(0, 256), s.config, kind);
  });
  app.get("/api/v1/marketplace/:source/:projectId", async (r) => {
    const s = servers.authorized(
        user(r),
        idSchema.parse(query(r).serverId),
        "content",
      ),
      p = content.provider(params(r).source!);
    return {
      project: await p.project(params(r).projectId!),
      versions: await p.versions(params(r).projectId!, s.config),
    };
  });
  app.post("/api/v1/servers/:id/content/plan", async (r) => {
    const s = world(r, "content"),
      c = z
        .object({
          source: z.enum(["modrinth", "curseforge"]),
          projectId: z.string().min(1).max(64),
          versionId: z.string().max(64).optional(),
        })
        .parse(r.body);
    return content.plan(s, c.source, c.projectId, c.versionId);
  });
  app.post("/api/v1/servers/:id/content/install", async (r, reply) => {
    const s = world(r, "content"),
      c = z
        .object({
          source: z.enum(["modrinth", "curseforge"]),
          projectId: z.string().min(1).max(64),
          versionId: z.string().max(64).optional(),
          confirm: z.literal(true),
        })
        .parse(r.body);
    return reply
      .code(202)
      .send(jobs.enqueue(s.id, user(r).id, "content.install", c));
  });
  app.get("/api/v1/versions", async () => updates.versions());
  app.get("/api/v1/servers/:id/updates", async (r) =>
    updates.check(
      world(r, "update"),
      query(r).version,
      query(r).software
        ? serverConfigSchema.shape.software.parse(query(r).software)
        : undefined,
    ),
  );
  app.post("/api/v1/servers/:id/updates", async (r, reply) => {
    const s = world(r, "update"),
      c = z
        .object({
          config: serverConfigSchema,
          override: z.boolean().default(false),
          confirm: z.literal(true),
        })
        .parse(r.body);
    if (c.config.edition !== s.config.edition)
      throw new AppError(
        "EDITION",
        "Create a separate world when changing Minecraft editions.",
      );
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, "update", c));
  });
  app.get("/api/v1/servers/:id/updates/history", async (r) =>
    store.all(
      "SELECT * FROM update_records WHERE server_id=? ORDER BY created_at DESC",
      world(r, "update").id,
    ),
  );
}
