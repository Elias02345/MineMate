import { z } from "zod";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { inspectArchive } from "../../../../packages/backup/src/archive.ts";
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
        .enum(["world", "server", "modpack", "jar", "custom", "file"])
        .parse(query(r).kind),
      s = world(
        r,
        ["jar", "custom", "modpack"].includes(kind) ? "content" : "files",
      );
    if (query(r).confirm !== "true")
      throw new AppError("CONFIRM", "Explicitly confirm this upload.");
    const operations: { filename: string; name: string; custom: boolean }[] =
      [];
    let queued = false;
    try {
      for await (const part of r.parts()) {
        if (part.type !== "file") continue;
        const name = path.basename(part.filename),
          ext = path.extname(name).toLowerCase();
        if (kind !== "file" && ![".zip", ".mrpack", ".jar"].includes(ext))
          throw new AppError(
            "UPLOAD_TYPE",
            "Upload a ZIP, MRPACK or JAR archive.",
          );
        const filename =
            randomUUID() +
            ([".zip", ".mrpack", ".jar"].includes(ext) ? ext : ".upload"),
          target = path.join(paths.server(s.id, "uploads"), filename);
        operations.push({ filename, name, custom: kind === "custom" });
        await pipeline(
          part.file,
          createWriteStream(target, { flags: "wx", mode: 0o600 }),
        );
        if (part.file.truncated)
          throw new AppError("UPLOAD_LIMIT", "This upload exceeds 512 MB.");
        if (kind !== "file") await inspectArchive(target);
      }
      if (!operations.length)
        throw new AppError("UPLOAD", "Select at least one file.");
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
