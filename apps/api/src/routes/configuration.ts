import { z } from "zod";
import { rm } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import {
  openWorldFile,
  readWorldText,
} from "../../../../packages/backup/src/paths.ts";
import {
  AppError,
  serverConfigSchema,
} from "../../../../packages/shared/src/index.ts";
import { routeHelpers, type RouteContext } from "./context.ts";
export function registerConfigurationRoutes(context: RouteContext) {
  const { app, paths, store, jobs, servers, files } = context;
  const { query, user, world } = routeHelpers(context);
  app.get("/api/v1/servers/:id/settings", async (r) => {
    const s = world(r, "settings"),
      p = await files.properties(s);
    return { values: p.values, revision: p.revision, schema: p.schema };
  });
  app.put("/api/v1/servers/:id/settings", async (r, reply) => {
    const s = world(r, "settings"),
      c = z
        .object({
          values: z.record(z.string(), z.string()),
          revision: z.string().length(64),
          restart: z.boolean().default(false),
        })
        .parse(r.body);
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, "settings", c));
  });
  app.put("/api/v1/servers/:id/runtime", async (r, reply) => {
    const s = world(r, "settings"),
      c = z
        .object({ config: serverConfigSchema, confirm: z.literal(true) })
        .parse(r.body);
    if (
      c.config.edition !== s.config.edition ||
      c.config.software !== s.config.software ||
      c.config.version !== s.config.version ||
      c.config.loaderVersion !== s.config.loaderVersion
    )
      throw new AppError(
        "UPDATE_REQUIRED",
        "Use the Update Center for game or loader changes.",
      );
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, "configure", c));
  });
  app.get("/api/v1/servers/:id/players", async (r) => {
    const s = world(r, "players"),
      lists: Record<string, unknown> = {};
    for (const f of [
      "ops.json",
      "whitelist.json",
      "banned-players.json",
      "allowlist.json",
    ]) {
      try {
        lists[f] = JSON.parse(await readWorldText(paths.server(s.id), f));
      } catch {
        /* the runtime may not have created these yet */
      }
    }
    return {
      online: s.metrics?.playerNames ?? [],
      count: s.metrics?.players ?? null,
      maxPlayers: s.config.maxPlayers,
      lists,
    };
  });
  app.post("/api/v1/servers/:id/players", async (r) => {
    const s = world(r, "players"),
      c = z
        .object({
          action: z.enum([
            "kick",
            "op",
            "deop",
            "whitelist",
            "unwhitelist",
            "ban",
            "pardon",
          ]),
          name: z.string().regex(/^[a-zA-Z0-9_ ]{1,32}$/),
          confirm: z.literal(true),
        })
        .parse(r.body);
    if (!s.containerId || s.state !== "RUNNING")
      throw new AppError("OFFLINE", "Start your world first.", 409);
    if (
      s.config.edition === "BEDROCK" &&
      ["ban", "pardon", "unwhitelist", "whitelist"].includes(c.action)
    )
      throw new AppError(
        "CAPABILITY",
        "Use Bedrock allowlist files for persistent access control.",
      );
    const action =
        c.action === "whitelist"
          ? "whitelist add"
          : c.action === "unwhitelist"
            ? "whitelist remove"
            : c.action,
      output = await servers.runtime.command(
        s.containerId,
        s.id,
        s.config,
        `${action} ${s.config.edition === "BEDROCK" ? JSON.stringify(c.name) : c.name}`,
      );
    store.audit(user(r).id, s.id, "player." + c.action, { name: c.name });
    return { output };
  });
  app.get("/api/v1/servers/:id/files", async (r) =>
    files.list(world(r, "files"), query(r).path ?? ""),
  );
  app.get("/api/v1/servers/:id/files/text", async (r) =>
    files.text(world(r, "files"), z.string().min(1).parse(query(r).path)),
  );
  app.post("/api/v1/servers/:id/files", async (r, reply) => {
    const s = world(r, "files"),
      c = z
        .object({
          action: z.enum([
            "mkdir",
            "rename",
            "delete",
            "write",
            "extract",
            "archive",
          ]),
          path: z.string().min(1).max(512),
          destination: z.string().max(512).optional(),
          text: z
            .string()
            .max(2 * 1024 ** 2)
            .optional(),
          revision: z.string().length(64).optional(),
          confirm: z.literal(true),
        })
        .parse(r.body);
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, "file", c));
  });
  app.get("/api/v1/servers/:id/files/download", async (r, reply) => {
    const s = world(r, "files"),
      name = z.string().min(1).parse(query(r).path);
    if (name === "server.properties") {
      const data = await files.text(s, name);
      return reply
        .header(
          "Content-Disposition",
          'attachment; filename="server.properties"',
        )
        .type("text/plain")
        .send(data.text);
    }
    const file = await openWorldFile(paths.server(s.id), name);
    return reply
      .header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`,
      )
      .type("application/octet-stream")
      .send(file.createReadStream());
  });
  app.get("/api/v1/servers/:id/worlds", async (r) =>
    files.worlds(world(r, "files")),
  );
  app.post("/api/v1/servers/:id/worlds/regenerate", async (r, reply) => {
    const s = world(r, "files"),
      c = z.object({ confirm: z.string(), path: z.string() }).parse(r.body);
    if (c.confirm !== s.name)
      throw new AppError("CONFIRM", "Type the world name.");
    const worlds = await files.worlds(s);
    if (!worlds.some((w) => w.path === c.path))
      throw new AppError("WORLD", "Choose an existing world.");
    return reply.code(202).send(
      jobs.enqueue(s.id, user(r).id, "file", {
        action: "delete",
        path: c.path,
      }),
    );
  });
  app.get("/api/v1/servers/:id/worlds/export", async (r, reply) => {
    const s = world(r, "files"),
      name = z.string().min(1).parse(query(r).path);
    if (s.state === "RUNNING")
      throw new AppError(
        "CONSISTENCY",
        "Stop your world before exporting it.",
        409,
      );
    const out = await files.export(s, name);
    reply.raw.once("close", () => {
      void rm(out.file, { force: true });
    });
    return reply
      .header("Content-Disposition", 'attachment; filename="world.zip"')
      .type("application/zip")
      .send(createReadStream(out.file));
  });
}
