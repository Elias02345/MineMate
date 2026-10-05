import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  AppError,
  credentialsSchema,
  now,
  type User,
} from "../../../../packages/shared/src/index.ts";
import { routeHelpers, type RouteContext } from "./context.ts";
export function registerAccountsRoutes(context: RouteContext) {
  const { app, store, auth } = context;
  const { params, id, user } = routeHelpers(context);
  app.get("/api/v1/auth/status", async (r) => ({
    setupRequired: !store.get("SELECT id FROM users LIMIT 1"),
    user: r.user,
    csrf: r.csrfToken,
  }));
  app.post(
    "/api/v1/auth/bootstrap",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (r, reply) => auth.session(await auth.bootstrap(r.body), reply),
  );
  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (r, reply) => auth.session(await auth.login(r.body), reply),
  );
  app.post("/api/v1/auth/logout", async (r, reply) => {
    auth.logout(r, reply);
    return { ok: true };
  });
  app.get("/api/v1/auth/sessions", async (r) =>
    store.all(
      "SELECT id,created_at,expires_at FROM sessions WHERE user_id=?",
      user(r).id,
    ),
  );
  app.delete("/api/v1/auth/sessions/:session", async (r) => {
    store.run(
      "DELETE FROM sessions WHERE id=? AND user_id=?",
      params(r).session!,
      user(r).id,
    );
    return { ok: true };
  });
  app.get("/api/v1/users", async (r) => {
    auth.admin(r);
    return store.users();
  });
  app.post("/api/v1/users", async (r) => {
    const actor = auth.admin(r),
      c = credentialsSchema
        .extend({ role: z.enum(["admin", "member"]).default("member") })
        .parse(r.body),
      hash = await auth.hash(c.password),
      u: User = {
        id: randomUUID(),
        username: c.username,
        role: c.role,
        enabled: true,
        createdAt: now(),
      };
    try {
      store.run(
        "INSERT INTO users VALUES(?,?,?,?,1,?)",
        u.id,
        u.username,
        hash,
        u.role,
        u.createdAt,
      );
    } catch (e) {
      if (String(e).includes("UNIQUE"))
        throw new AppError("USERNAME", "This username is already taken.", 409);
      throw e;
    }
    store.audit(actor.id, null, "user.created", { userId: u.id });
    return u;
  });
  app.patch("/api/v1/users/:id", async (r) => {
    const actor = auth.admin(r),
      uid = id(r),
      row = store.get("SELECT * FROM users WHERE id=?", uid);
    if (!row) throw new AppError("NOT_FOUND", "User not found.", 404);
    const c = z
      .object({
        enabled: z.boolean().optional(),
        role: z.enum(["admin", "member"]).optional(),
        password: z.string().min(12).max(256).optional(),
      })
      .parse(r.body);
    if (row.role === "owner" && (c.enabled === false || c.role))
      throw new AppError(
        "OWNER",
        "The installation owner must remain enabled and keep ownership.",
      );
    if (row.role === "owner" && actor.id !== uid)
      throw new AppError(
        "OWNER",
        "Only the owner may change their password.",
        403,
      );
    if (c.password)
      store.run(
        "UPDATE users SET password_hash=? WHERE id=?",
        await auth.hash(c.password),
        uid,
      );
    if (c.enabled !== undefined)
      store.run(
        "UPDATE users SET enabled=? WHERE id=?",
        c.enabled ? 1 : 0,
        uid,
      );
    if (c.role) store.run("UPDATE users SET role=? WHERE id=?", c.role, uid);
    if (c.password || c.enabled === false)
      store.run("DELETE FROM sessions WHERE user_id=?", uid);
    store.audit(actor.id, null, "user.changed", { userId: uid });
    return store.user(store.get("SELECT * FROM users WHERE id=?", uid)!);
  });
}
