import { z } from "zod";
import {
  AppError,
  idSchema,
  now,
  type Event,
} from "../../../../packages/shared/src/index.ts";
import { routeHelpers, type RouteContext } from "./context.ts";
export function registerSystemRoutes(context: RouteContext) {
  const { app, config, store, secrets, events, servers, s3, auth } = context;
  const { id, query, user } = routeHelpers(context);
  app.get("/api/v1/health", async () => ({
    ok: !!store.get("SELECT 1 AS ready"),
    version: config.version,
  }));
  app.get("/api/v1/system", async (r) => {
    auth.admin(r);
    return {
      version: config.version,
      curseforgeConfigured:
        !!config.curseforgeKey || !!store.setting("curseforgeKey", ""),
      s3Configured: !!store.setting("s3Config", null),
      s3: store.setting("s3Config", null),
      audit: store.all(
        "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200",
      ),
    };
  });
  app.get("/api/v1/system/checks", async (r) => {
    auth.admin(r);
    return servers.host.check();
  });
  app.post("/api/v1/system/curseforge", async (r) => {
    const actor = auth.admin(r),
      { key } = z.object({ key: z.string().min(1).max(512) }).parse(r.body);
    store.setSetting("curseforgeKey", secrets.seal(key));
    store.audit(actor.id, null, "settings.curseforge");
    return { ok: true };
  });
  app.post("/api/v1/system/s3", async (r) => {
    const actor = auth.admin(r);
    s3.save(r.body);
    store.audit(actor.id, null, "settings.s3");
    return { ok: true };
  });
  app.post("/api/v1/system/s3/test", async (r) => {
    auth.admin(r);
    return s3.test();
  });
  app.get("/api/v1/operations", async (r) => {
    const u = user(r),
      sid = query(r).serverId;
    if (sid) {
      servers.authorized(u, idSchema.parse(sid), "view");
      return store.operations(sid);
    }
    const visible = new Set(servers.list(u).map((s) => s.id));
    return store
      .operations()
      .filter(
        (o) =>
          (o.serverId && visible.has(o.serverId)) ||
          (!o.serverId && u.role !== "member"),
      );
  });
  app.get("/api/v1/notifications", async (r) => {
    const u = user(r),
      visible = new Set(servers.list(u).map((s) => s.id));
    return store
      .all("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100")
      .filter((n) =>
        n.server_id ? visible.has(String(n.server_id)) : u.role !== "member",
      );
  });
  app.post("/api/v1/notifications/:id/read", async (r) => {
    const n = store.get("SELECT * FROM notifications WHERE id=?", id(r));
    if (!n) throw new AppError("NOT_FOUND", "Notification not found.", 404);
    if (n.server_id) servers.authorized(user(r), String(n.server_id), "view");
    else auth.admin(r);
    store.run("UPDATE notifications SET read=1 WHERE id=?", id(r));
    return { ok: true };
  });
  app.get("/api/v1/events", { websocket: true }, (socket, r) => {
    if (r.headers.origin !== new URL(`${r.protocol}://${r.host}`).origin) {
      socket.close(1008, "Invalid origin");
      return;
    }
    const listener = (event: Event) => {
      const session = store.get(
          "SELECT user_id FROM sessions WHERE id=? AND expires_at>?",
          r.sessionId ?? "",
          now(),
        ),
        row = session
          ? store.get(
              "SELECT * FROM users WHERE id=? AND enabled=1",
              String(session.user_id),
            )
          : undefined;
      if (!row) {
        socket.close(1008, "Session revoked");
        return;
      }
      const u = store.user(row);
      if (event.serverId) {
        try {
          servers.authorized(
            u,
            event.serverId,
            event.type === "server.log" ? "console" : "view",
          );
        } catch {
          return;
        }
      } else if (u.role === "member") return;
      if (socket.readyState === 1 && socket.bufferedAmount < 1024 ** 2)
        socket.send(JSON.stringify(event));
    };
    events.on("event", listener);
    socket.once("close", () => events.off("event", listener));
  });
}
