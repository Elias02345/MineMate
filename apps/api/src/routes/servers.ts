import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  atomicWrite,
  readWorldText,
} from "../../../../packages/backup/src/paths.ts";
import {
  AppError,
  idSchema,
  permissions,
  now,
  capabilities,
  can,
} from "../../../../packages/shared/src/index.ts";
import { diagnose } from "../../../../packages/minecraft/src/index.ts";
import { parseProperties } from "../../../../packages/settings-schema/src/index.ts";
import { routeHelpers, type RouteContext } from "./context.ts";
export function registerServersRoutes(context: RouteContext) {
  const { app, paths, store, events, jobs, docker, servers, auth } = context;
  const { id, user, world } = routeHelpers(context);
  app.get("/api/v1/servers", async (r) => servers.list(user(r)));
  app.post("/api/v1/servers", async (r, reply) => {
    const result = await servers.create(user(r), r.body);
    return reply.code(202).send(result);
  });
  app.get("/api/v1/servers/:id", async (r) => ({
    ...world(r, "view"),
    capabilities: capabilities(world(r, "view").config.edition),
  }));
  app.post("/api/v1/servers/:id/lifecycle", async (r, reply) => {
    const c = z
        .object({ action: z.enum(["start", "stop", "restart", "sleep"]) })
        .parse(r.body),
      s = world(r, c.action === "sleep" ? "stop" : c.action);
    if (c.action === "start") store.setSetting("crashes:" + s.id, []);
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, c.action));
  });
  app.delete("/api/v1/servers/:id", async (r, reply) => {
    const s = world(r, "delete"),
      c = z
        .object({
          mode: z.enum(["container", "archive", "data"]),
          confirm: z.string(),
        })
        .parse(r.body);
    if (c.confirm !== s.name)
      throw new AppError("CONFIRM", "Type the world name to confirm deletion.");
    return reply.code(202).send(jobs.enqueue(s.id, user(r).id, "delete", c));
  });
  app.post("/api/v1/servers/:id/unarchive", async (r) => {
    const s = world(r, "settings");
    s.archived = false;
    store.saveServer(s);
    return s;
  });
  app.get("/api/v1/servers/:id/permissions", async (r) => {
    auth.admin(r);
    const sid = id(r);
    servers.get(sid);
    return store.all(
      "SELECT user_id AS userId,permission FROM server_permissions WHERE server_id=?",
      sid,
    );
  });
  app.put("/api/v1/servers/:id/permissions", async (r) => {
    const actor = auth.admin(r),
      sid = id(r),
      c = z
        .object({ userId: idSchema, permissions: z.array(z.enum(permissions)) })
        .parse(r.body);
    servers.get(sid);
    if (!store.get("SELECT id FROM users WHERE id=?", c.userId))
      throw new AppError("NOT_FOUND", "User not found.", 404);
    store.transaction(() => {
      store.run(
        "DELETE FROM server_permissions WHERE server_id=? AND user_id=?",
        sid,
        c.userId,
      );
      for (const p of new Set(c.permissions))
        store.run(
          "INSERT INTO server_permissions VALUES(?,?,?)",
          sid,
          c.userId,
          p,
        );
      store.audit(actor.id, sid, "permissions.changed", {
        userId: c.userId,
        permissions: c.permissions,
      });
    });
    events.send("server.permissions.changed", {}, sid);
    return { ok: true };
  });
  app.get("/api/v1/servers/:id/eula", async (r) => {
    const s = world(r, "view");
    let accepted = false;
    try {
      accepted =
        parseProperties(await readWorldText(paths.server(s.id), "eula.txt"))
          .eula === "true";
    } catch {
      /* missing EULA requires explicit repair */
    }
    return {
      accepted,
      url: "https://www.minecraft.net/eula",
      acceptances: store.all(
        "SELECT accepted_at AS acceptedAt,user_id AS userId FROM eula_acceptances WHERE server_id=?",
        s.id,
      ),
    };
  });
  app.post("/api/v1/servers/:id/eula", async (r) => {
    const s = world(r, "settings");
    z.object({ accept: z.literal(true) }).parse(r.body);
    await atomicWrite(paths.server(s.id) + "/eula.txt", "eula=true\n");
    store.run(
      "INSERT INTO eula_acceptances VALUES(?,?,?,?,?)",
      randomUUID(),
      s.id,
      user(r).id,
      now(),
      "https://www.minecraft.net/eula",
    );
    store.audit(user(r).id, s.id, "eula.accepted");
    return { ok: true };
  });
  app.get("/api/v1/servers/:id/console", async (r) => {
    const s = world(r, "console");
    if (!s.containerId) return { logs: "" };
    await servers.runtime.owned(s.containerId, s.id);
    return {
      logs: (await docker.logs(s.containerId, 1000)).replace(
        /(rcon\.password\s*[=:]\s*)\S+/gi,
        "$1[redacted]",
      ),
    };
  });
  app.post("/api/v1/servers/:id/console", async (r) => {
    const s = world(r, "console"),
      c = z.object({ command: z.string().min(1).max(2048) }).parse(r.body);
    if (!s.containerId || s.state !== "RUNNING")
      throw new AppError(
        "OFFLINE",
        "Start your world before sending commands.",
        409,
      );
    const output = await servers.runtime.command(
      s.containerId,
      s.id,
      s.config,
      c.command,
    );
    store.audit(user(r).id, s.id, "console.command", {
      verb: c.command.split(" ")[0],
    });
    return { output };
  });
  app.get("/api/v1/servers/:id/repair", async (r) => {
    const s = world(r, "view");
    if (s.containerId) await servers.runtime.owned(s.containerId, s.id);
    const current = s.containerId ? await docker.logs(s.containerId, 300) : "",
      lastFailure = await readFile(
        paths.server(s.id, "metadata") + "/failure.log",
        "utf8",
      ).catch(() => ""),
      logs = lastFailure || current;
    return {
      issues: diagnose(logs),
      state: s.state,
      error: s.error,
      unknown: diagnose(logs).length === 0,
      technical: can(user(r), store.grants(s.id, user(r).id), "console")
        ? logs
        : "",
    };
  });
  app.get("/api/v1/servers/:id/cloudgate", async (r) => {
    const s = world(r, "view");
    return {
      ...s.endpoint,
      edition: s.config.edition,
      recommendation:
        "MineMate recommends CloudGate for access outside your LAN. Configure this LAN target in CloudGate, then connect its Playit/tunnel provider.",
    };
  });
}
