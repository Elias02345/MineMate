import { registerBackupsRoutes } from "./routes/backups.ts";
import { registerContentRoutes } from "./routes/content.ts";
import { registerConfigurationRoutes } from "./routes/configuration.ts";
import { registerServersRoutes } from "./routes/servers.ts";
import { registerAccountsRoutes } from "./routes/accounts.ts";
import { registerSystemRoutes } from "./routes/system.ts";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import serveStatic from "@fastify/static";
import { ZodError } from "zod";
import { stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../../packages/shared/src/index.ts";
import { Store } from "../../../packages/database/src/index.ts";
import {
  Engine,
  type DockerProvider,
} from "../../../packages/docker/src/index.ts";
import { DataPaths } from "../../../packages/backup/src/paths.ts";
import { loadConfig, type Config } from "./config.ts";
import { SecretStore } from "./secrets.ts";
import { Auth } from "./auth.ts";
import { Events } from "./events.ts";
import { Jobs } from "./jobs.ts";
import { Servers } from "./servers.ts";
import { Backups } from "./backups.ts";
import { Files } from "./files.ts";
import { Content } from "./content.ts";
import { Updates } from "./updates.ts";
import { Monitor } from "./monitor.ts";
import { S3Backups } from "./s3.ts";
import { discoverHostDataRoot } from "./docker-storage.ts";
export interface AppOptions {
  config?: Config;
  docker?: DockerProvider;
  monitor?: boolean;
  logger?: boolean;
  static?: boolean;
}
export async function createApp(options: AppOptions = {}) {
  const config = { ...(options.config ?? loadConfig()) },
    docker = options.docker ?? new Engine(config.dockerEndpoint);
  if (config.hostRoot === "auto")
    config.hostRoot = await discoverHostDataRoot(docker, config.dataRoot);
  const paths = new DataPaths(config.dataRoot, config.hostRoot);
  await paths.initialize();
  const store = new Store(
      path.join(config.dataRoot, "app/database/minemate.sqlite"),
    ),
    secrets = await SecretStore.open(config.dataRoot),
    events = new Events(),
    jobs = new Jobs(store, events),
    servers = new Servers(store, docker, paths, config, secrets, jobs, events),
    backups = new Backups(servers),
    files = new Files(servers, backups),
    content = new Content(servers, backups),
    updates = new Updates(servers, backups, content),
    monitor = new Monitor(servers),
    s3 = new S3Backups(servers),
    auth = new Auth(store, config);
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: config.trustProxy,
    bodyLimit: 3 * 1024 ** 2,
    requestTimeout: 30000,
  });
  updates.registerConfiguration();
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    allowList: (r) => !r.url.startsWith("/api/"),
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  await app.register(multipart, {
    limits: { fileSize: 512 * 1024 ** 2, files: 100, parts: 110 },
  });
  app.decorateRequest("user", null);
  app.decorateRequest("sessionId", null);
  app.decorateRequest("csrfToken", null);
  const publicRoutes = new Set([
    "/api/v1/health",
    "/api/v1/auth/status",
    "/api/v1/auth/bootstrap",
    "/api/v1/auth/login",
  ]);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "same-origin")
      .header("X-Frame-Options", "DENY")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    auth.authenticate(req);
    const route = req.url.split("?")[0]!;
    if (route.startsWith("/api/v1") && !publicRoutes.has(route))
      auth.require(req);
    if (
      route.startsWith("/api/v1") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    )
      auth.mutation(req);
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) {
      void reply.code(400).send({
        code: "VALIDATION",
        message: "Check the highlighted values.",
        detail: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("\n"),
      });
      return;
    }
    if (error instanceof AppError) {
      void reply.code(error.status).send({
        code: error.code,
        message: error.message,
        detail: error.detail,
      });
      return;
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    app.log.error({ err: error }, "request failed");
    void reply.code(status).send({
      code: "INTERNAL",
      message:
        status === 413
          ? "This upload is too large."
          : "This action could not be completed. Review the operation and try again.",
    });
  });
  const context = {
    app,
    config,
    paths,
    store,
    secrets,
    events,
    jobs,
    docker,
    servers,
    backups,
    files,
    content,
    updates,
    s3,
    auth,
  };
  registerSystemRoutes(context);
  registerAccountsRoutes(context);
  registerServersRoutes(context);
  registerConfigurationRoutes(context);
  registerContentRoutes(context);
  registerBackupsRoutes(context);
  if (options.static !== false) {
    try {
      await stat(config.webRoot);
      await app.register(serveStatic, { root: config.webRoot, prefix: "/" });
      app.setNotFoundHandler((r, reply) =>
        r.url.startsWith("/api/")
          ? reply
              .code(404)
              .send({ code: "NOT_FOUND", message: "Unknown API route." })
          : reply.sendFile("index.html"),
      );
    } catch {
      app.get("/", async (_r, reply) =>
        reply
          .type("text/plain")
          .send(
            "MineMate API is running. Build the frontend with npm run build:web.",
          ),
      );
    }
  }
  if (options.monitor !== false) {
    await monitor.reconcile();
    monitor.start();
    jobs.resume();
  }
  app.addHook("onClose", async () => {
    await monitor.close();
    await jobs.close();
    store.close();
  });
  return {
    app,
    store,
    servers,
    backups,
    content,
    files,
    updates,
    auth,
    jobs,
    monitor,
    config,
  };
}
export type MineMateApp = Awaited<ReturnType<typeof createApp>>;
export async function listen(app: FastifyInstance, config: Config) {
  await app.listen({ host: config.bind, port: config.port });
}
