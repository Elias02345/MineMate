import {
  randomUUID,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import "@fastify/cookie";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Store } from "../../../packages/database/src/index.ts";
import {
  AppError,
  credentialsSchema,
  now,
  type User,
} from "../../../packages/shared/src/index.ts";
import type { Config } from "./config.ts";
declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
    csrfToken: string | null;
  }
}
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export class Auth {
  constructor(
    readonly store: Store,
    private config: Config,
  ) {}
  async hash(password: string) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
    });
  }
  async bootstrap(input: unknown) {
    const credentials = credentialsSchema.parse(input),
      hash = await this.hash(credentials.password);
    return this.store.transaction(() => {
      if (
        this.store.get("SELECT id FROM bootstrap WHERE id=1") ||
        this.store.get("SELECT id FROM users LIMIT 1")
      )
        throw new AppError(
          "BOOTSTRAP_CLOSED",
          "An owner already exists. Sign in instead.",
          409,
        );
      const user: User = {
        id: randomUUID(),
        username: credentials.username,
        role: "owner",
        enabled: true,
        createdAt: now(),
      };
      this.store.run(
        "INSERT INTO users VALUES(?,?,?,?,1,?)",
        user.id,
        user.username,
        hash,
        user.role,
        user.createdAt,
      );
      this.store.run("INSERT INTO bootstrap VALUES(1,?)", user.id);
      this.store.audit(user.id, null, "owner.created");
      return user;
    });
  }
  async login(input: unknown) {
    const c = credentialsSchema.parse(input),
      row = this.store.get("SELECT * FROM users WHERE username=?", c.username);
    const dummy =
      "$argon2id$v=19$m=65536,t=3,p=1$dGVzdHNhbHR0ZXN0c2FsdA$aW52YWxpZGhhc2hhbmRtb3JlYnl0ZXM";
    let valid = false;
    try {
      valid = await argon2.verify(
        row ? String(row.password_hash) : dummy,
        c.password,
      );
    } catch {
      /* invalid credentials */
    }
    if (!row || !valid || !row.enabled)
      throw new AppError("LOGIN", "Username or password is incorrect.", 401);
    const user = this.store.user(row);
    this.store.audit(user.id, null, "auth.login");
    return user;
  }
  session(user: User, reply: FastifyReply) {
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(24).toString("base64url"),
      id = digest(token),
      expires = new Date(Date.now() + 7 * 86400000);
    this.store.run(
      "INSERT INTO sessions VALUES(?,?,?,?,?)",
      id,
      user.id,
      csrf,
      expires.toISOString(),
      now(),
    );
    reply.setCookie("minemate_session", token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: this.config.secureCookies,
      expires,
    });
    return { user, csrf };
  }
  authenticate(request: FastifyRequest) {
    request.user = null;
    request.sessionId = null;
    request.csrfToken = null;
    const token = request.cookies.minemate_session;
    if (!token) return;
    const row = this.store.get(
      "SELECT users.*,sessions.id AS session_id,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.id=? AND sessions.expires_at>? AND users.enabled=1",
      digest(token),
      now(),
    );
    if (row) {
      request.user = this.store.user(row);
      request.sessionId = String(row.session_id);
      request.csrfToken = String(row.csrf);
    }
  }
  require(request: FastifyRequest) {
    if (!request.user)
      throw new AppError("UNAUTHENTICATED", "Sign in to continue.", 401);
    return request.user;
  }
  admin(request: FastifyRequest) {
    const u = this.require(request);
    if (u.role === "member")
      throw new AppError(
        "FORBIDDEN",
        "An administrator must perform this action.",
        403,
      );
    return u;
  }
  checkOrigin(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (!origin)
      throw new AppError(
        "CSRF",
        "A same-origin browser request is required.",
        403,
      );
    const expected = new URL(`${request.protocol}://${request.host}`).origin;
    if (origin !== expected)
      throw new AppError(
        "CSRF",
        "This request came from another website.",
        403,
      );
  }
  mutation(request: FastifyRequest) {
    this.checkOrigin(request);
    if (request.user) {
      const supplied = String(request.headers["x-csrf-token"] ?? ""),
        expected = request.csrfToken ?? "";
      if (
        !expected ||
        supplied.length !== expected.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
      )
        throw new AppError(
          "CSRF",
          "Your session changed. Reload and try again.",
          403,
        );
    }
  }
  logout(request: FastifyRequest, reply: FastifyReply) {
    if (request.sessionId)
      this.store.run("DELETE FROM sessions WHERE id=?", request.sessionId);
    reply.clearCookie("minemate_session", { path: "/" });
  }
}
