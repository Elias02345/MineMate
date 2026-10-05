import { z } from "zod";
import { createReadStream } from "node:fs";
import { AppError, idSchema } from "../../../../packages/shared/src/index.ts";
import { routeHelpers, type RouteContext } from "./context.ts";
export function registerBackupsRoutes(context: RouteContext) {
  const { app, store, jobs, backups, auth } = context;
  const { params, user, world } = routeHelpers(context);
  app.get("/api/v1/servers/:id/backups", async (r) =>
    store.backups(world(r, "backups").id),
  );
  app.post("/api/v1/servers/:id/backups", async (r, reply) => {
    const s = world(r, "backups");
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, "backup"));
  });
  app.post(
    "/api/v1/servers/:id/backups/:backupId/restore",
    async (r, reply) => {
      const s = world(r, "backups"),
        c = z.object({ confirm: z.string() }).parse(r.body);
      if (c.confirm !== s.name)
        throw new AppError(
          "CONFIRM",
          "Type the world name to restore this backup.",
        );
      return reply.code(202).send(
        jobs.enqueue(s.id, user(r).id, "restore", {
          backupId: idSchema.parse(params(r).backupId),
        }),
      );
    },
  );
  app.get(
    "/api/v1/servers/:id/backups/:backupId/download",
    async (r, reply) => {
      const s = world(r, "backups"),
        { b, filename } = await backups.file(
          s.id,
          idSchema.parse(params(r).backupId),
        );
      return reply
        .header("Content-Disposition", `attachment; filename="${b.filename}"`)
        .type("application/zip")
        .send(createReadStream(filename));
    },
  );
  app.post("/api/v1/servers/:id/backups/:backupId/remote", async (r) => {
    auth.admin(r);
    const s = world(r, "backups");
    return jobs.enqueue(s.id, user(r).id, "backup.remote", {
      backupId: idSchema.parse(params(r).backupId),
    });
  });
  app.put("/api/v1/servers/:id/backups/policy", async (r) => {
    const s = world(r, "backups"),
      c = z
        .object({
          keepLast: z.number().int().min(1).max(10000),
          daily: z.number().int().min(0).max(365),
          weekly: z.number().int().min(0).max(520),
          maxBytes: z.number().int().min(0),
          intervalMinutes: z.number().int().min(0).max(10080),
        })
        .parse(r.body);
    store.setSetting("retention:" + s.id, c);
    store.setSetting("schedule:" + s.id, {
      intervalMinutes: c.intervalMinutes,
      lastAt: Date.now(),
    });
    store.audit(user(r).id, s.id, "backup.policy");
    return { ok: true };
  });
  app.get("/api/v1/servers/:id/backups/policy", async (r) => {
    const s = world(r, "backups");
    return {
      ...store.setting("retention:" + s.id, {
        keepLast: 20,
        daily: 7,
        weekly: 4,
        maxBytes: 0,
      }),
      ...store.setting("schedule:" + s.id, {
        intervalMinutes: 0,
        lastAt: Date.now(),
      }),
    };
  });
}
