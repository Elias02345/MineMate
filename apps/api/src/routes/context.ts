import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  idSchema,
  permissions,
} from "../../../../packages/shared/src/index.ts";
import type { Store } from "../../../../packages/database/src/index.ts";
import type { DataPaths } from "../../../../packages/backup/src/paths.ts";
import type { DockerProvider } from "../../../../packages/docker/src/index.ts";
import type { Config } from "../config.ts";
import type { SecretStore } from "../secrets.ts";
import type { Events } from "../events.ts";
import type { Jobs } from "../jobs.ts";
import type { Servers } from "../servers.ts";
import type { Backups } from "../backups.ts";
import type { Files } from "../files.ts";
import type { Content } from "../content.ts";
import type { Updates } from "../updates.ts";
import type { S3Backups } from "../s3.ts";
import type { Auth } from "../auth.ts";
export interface RouteContext {
  app: FastifyInstance;
  config: Config;
  paths: DataPaths;
  store: Store;
  secrets: SecretStore;
  events: Events;
  jobs: Jobs;
  docker: DockerProvider;
  servers: Servers;
  backups: Backups;
  files: Files;
  content: Content;
  updates: Updates;
  s3: S3Backups;
  auth: Auth;
}
export function routeHelpers({ auth, servers }: RouteContext) {
  const params = (r: FastifyRequest) => r.params as Record<string, string>,
    id = (r: FastifyRequest) => idSchema.parse(params(r).id),
    query = (r: FastifyRequest) => r.query as Record<string, string>,
    user = (r: FastifyRequest) => auth.require(r),
    world = (r: FastifyRequest, p: (typeof permissions)[number]) =>
      servers.authorized(user(r), id(r), p);
  return { params, id, query, user, world };
}
