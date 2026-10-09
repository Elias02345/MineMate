import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { z } from "zod";
import {
  inspectArchive,
  archiveLimits,
  hashFile,
} from "../../../../packages/backup/src/archive.ts";
import {
  relativeSafe,
  safePath,
} from "../../../../packages/backup/src/paths.ts";
import {
  AppError,
  idSchema,
  serverConfigSchema,
} from "../../../../packages/shared/src/index.ts";
import { validateJar } from "../jars.ts";
import { routeHelpers, type RouteContext } from "./context.ts";

const CHUNK = 1024 * 1024;
const kinds = z.enum([
  "world",
  "world-folder",
  "server",
  "modpack",
  "atm",
  "jar",
  "custom",
  "file",
]);
const input = z.object({
  kind: kinds,
  resumeFrom: idSchema.optional(),
  software: serverConfigSchema.shape.software.optional(),
  directory: z.string().max(512).default(""),
  confirm: z.literal(true),
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        size: z.number().int().nonnegative(),
        relativePath: z.string().max(512).optional(),
        lastModified: z.number().optional(),
      }),
    )
    .min(1),
});
type Input = z.infer<typeof input>;
type Session = Input & {
  id: string;
  serverId: string;
  actor: string;
  createdAt: number;
  operationId?: string;
};

function checked(input: Input) {
  if (
    input.files.reduce((sum, file) => sum + file.size, 0) > archiveLimits.bytes
  )
    throw new AppError("UPLOAD_LIMIT", "The complete upload exceeds 20 GB.");
  if (
    ["custom", "world", "server", "modpack", "atm"].includes(input.kind) &&
    input.files.length !== 1
  )
    throw new AppError("UPLOAD", "Import one archive at a time.");
  relativeSafe(input.directory);
  const names = new Set<string>();
  for (const f of input.files) {
    const name =
      input.kind === "world-folder" ? f.relativePath || f.name : f.name;
    relativeSafe(name);
    if (
      name.endsWith("/") ||
      (!input.kind.endsWith("folder") && path.basename(name) !== name)
    )
      throw new AppError("UPLOAD_TYPE", "Invalid upload filename.");
    if (names.has(name))
      throw new AppError(
        "UPLOAD_COLLISION",
        "Two selected files have the same filename.",
      );
    names.add(name);
    const ext = path.extname(f.name).toLowerCase();
    if (["jar", "custom"].includes(input.kind) && ext !== ".jar")
      throw new AppError("JAR", "Choose a JAR file.");
    if (input.kind === "atm" && ext !== ".zip")
      throw new AppError("UPLOAD_TYPE", "Choose the ATM ServerFiles ZIP.");
    if (
      !["jar", "custom", "file", "world-folder"].includes(input.kind) &&
      ![".zip", ".mrpack", ".jar", ".mcworld"].includes(ext)
    )
      throw new AppError("UPLOAD_TYPE", "Upload a ZIP, MRPACK or JAR archive.");
  }
}

export function registerUploadSessionRoutes(context: RouteContext) {
  const { app, paths, jobs, store } = context;
  const { params, user, world } = routeHelpers(context);
  const locks = new Map<string, Promise<unknown>>();
  const dir = (serverId: string, id: string) =>
    path.join(paths.server(serverId, "uploads"), `session-${id}`);
  const target = async (s: Session, index: number) => {
    const root = dir(s.serverId, s.id);
    return safePath(
      root,
      s.kind === "world-folder"
        ? `folder/${s.files[index]!.relativePath || s.files[index]!.name}`
        : `${index}.part`,
      true,
    );
  };
  const marker = (s: Session, index: number) =>
    path.join(dir(s.serverId, s.id), `${index}.ok`);
  const save = async (s: Session) => {
    const root = dir(s.serverId, s.id);
    const temporary = path.join(root, "manifest.tmp");
    await writeFile(temporary, JSON.stringify(s), { mode: 0o600 });
    await rename(temporary, path.join(root, "manifest.json"));
  };
  const carryOver = async (s: Session, previousId?: string) => {
    if (!previousId || s.kind !== "jar" || previousId === s.id) return;
    await serialized(previousId, async () => {
      let previous: Session;
      try {
        previous = JSON.parse(
          await readFile(
            path.join(dir(s.serverId, previousId), "manifest.json"),
            "utf8",
          ),
        ) as Session;
      } catch {
        return;
      }
      if (
        previous.id !== previousId ||
        previous.serverId !== s.serverId ||
        previous.actor !== s.actor ||
        previous.kind !== s.kind ||
        previous.directory !== s.directory ||
        previous.software !== s.software ||
        previous.operationId
      )
        return;
      const existing = new Map(
        previous.files.map((file, index) => [
          JSON.stringify([file.name, file.size, file.lastModified ?? null]),
          index,
        ]),
      );
      for (const [index, file] of s.files.entries()) {
        const oldIndex = existing.get(
          JSON.stringify([file.name, file.size, file.lastModified ?? null]),
        );
        if (oldIndex === undefined) continue;
        const source = await target(previous, oldIndex);
        const size = await stat(source)
          .then((info) => info.size)
          .catch(() => -1);
        if (size < 0 || size > file.size) continue;
        await rename(source, await target(s, index));
      }
      await rm(dir(s.serverId, previousId), { recursive: true, force: true });
    });
  };
  const load = async (
    r: Parameters<typeof world>[0],
    permission?: "content" | "files",
  ) => {
    const id = idSchema.parse(params(r).sessionId);
    const root = dir(idSchema.parse(params(r).id), id);
    let session: Session;
    try {
      session = JSON.parse(
        await readFile(path.join(root, "manifest.json"), "utf8"),
      ) as Session;
    } catch {
      throw new AppError(
        "UPLOAD_SESSION",
        "Upload session expired. Select the files again.",
        404,
      );
    }
    if (session.serverId !== params(r).id || session.actor !== user(r).id)
      throw new AppError(
        "UPLOAD_SESSION",
        "Upload session is not available.",
        404,
      );
    world(
      r,
      permission ??
        (["jar", "custom", "modpack", "atm"].includes(session.kind)
          ? "content"
          : "files"),
    );
    if (session.kind === "custom") world(r, "settings");
    return session;
  };
  const serialized = async <T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    locks.set(key, task);
    try {
      return await task;
    } finally {
      if (locks.get(key) === task) locks.delete(key);
    }
  };
  const findOperation = (id: string) => {
    const row = store.get("SELECT * FROM operations WHERE id=?", id);
    return row ? store.operation(row) : undefined;
  };
  const state = async (s: Session) => ({
    id: s.id,
    files: await Promise.all(
      s.files.map(async (_f, i) => {
        try {
          return {
            offset: (await stat(await target(s, i))).size,
            validated: await stat(marker(s, i))
              .then(() => true)
              .catch(() => false),
          };
        } catch {
          return { offset: 0, validated: false };
        }
      }),
    ),
    operation: s.operationId ? findOperation(s.operationId) : undefined,
  });
  const sweep = async () => {
    for (const row of store.all("SELECT id FROM servers")) {
      const serverId = String(row.id);
      const uploads = paths.server(serverId, "uploads");
      for (const entry of await readdir(uploads, { withFileTypes: true }).catch(
        () => [],
      )) {
        if (!entry.isDirectory() || !/^session-[0-9a-f-]{36}$/.test(entry.name))
          continue;
        const root = path.join(uploads, entry.name);
        if (Date.now() - (await stat(root)).mtimeMs < 48 * 3600 * 1000)
          continue;
        const session = await readFile(path.join(root, "manifest.json"), "utf8")
          .then((raw) => JSON.parse(raw) as Session)
          .catch(() => null);
        if (
          session?.operationId &&
          ["QUEUED", "RUNNING"].includes(
            findOperation(session.operationId)?.status ?? "",
          )
        )
          continue;
        await rm(root, { recursive: true, force: true });
      }
    }
  };
  const timer = setInterval(() => {
    void sweep().catch((error: unknown) =>
      app.log.error({ error }, "upload cleanup failed"),
    );
  }, 3600 * 1000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  void sweep().catch((error: unknown) =>
    app.log.error({ error }, "upload cleanup failed"),
  );
  app.post(
    "/api/v1/servers/:id/upload-sessions",
    { bodyLimit: 16 * CHUNK },
    async (r, reply) => {
      const spec = input.parse(r.body);
      checked(spec);
      const server = world(
        r,
        ["jar", "custom", "modpack", "atm"].includes(spec.kind)
          ? "content"
          : "files",
      );
      if (spec.kind === "custom") world(r, "settings");
      if (
        ["jar", "custom", "atm"].includes(spec.kind) &&
        server.config.edition !== "JAVA"
      )
        throw new AppError("CAPABILITY", "Bedrock cannot run Java archives.");
      const s: Session = {
        ...spec,
        id: randomUUID(),
        serverId: server.id,
        actor: user(r).id,
        createdAt: Date.now(),
      };
      await mkdir(dir(server.id, s.id), { mode: 0o700 });
      if (s.kind === "world-folder")
        await mkdir(path.join(dir(server.id, s.id), "folder"), { mode: 0o700 });
      for (const [i, file] of s.files.entries())
        if (file.size === 0) {
          const destination = await target(s, i);
          await mkdir(path.dirname(destination), {
            recursive: true,
            mode: 0o700,
          });
          await writeFile(destination, "", { flag: "wx", mode: 0o600 });
        }
      await save(s);
      await carryOver(s, spec.resumeFrom);
      return reply.code(201).send(await state(s));
    },
  );
  app.get("/api/v1/servers/:id/upload-sessions/:sessionId", async (r) =>
    state(await load(r)),
  );
  app.put(
    "/api/v1/servers/:id/upload-sessions/:sessionId/files/:index",
    {
      config: { rateLimit: { max: 12000, timeWindow: "1 minute" } },
      bodyLimit: CHUNK + 4096,
    },
    async (r) => {
      const s = await load(r);
      const index = z.coerce
        .number()
        .int()
        .min(0)
        .max(s.files.length - 1)
        .parse(params(r).index);
      return serialized(s.id, async () => {
        const current = await load(r);
        if (current.operationId)
          throw new AppError(
            "UPLOAD_SESSION",
            "This upload is already installing.",
          );
        const file = current.files[index]!;
        const offset = z.coerce
          .number()
          .int()
          .nonnegative()
          .parse(r.headers["x-upload-offset"]);
        const expectedHash = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(r.headers["x-upload-sha256"]);
        const parts: Buffer[] = [];
        let length = 0;
        for await (const part of r.body as Readable) {
          const chunk = Buffer.from(part as Buffer);
          length += chunk.length;
          if (length > CHUNK)
            throw new AppError(
              "UPLOAD_LIMIT",
              "Upload chunks must be at most 1 MB.",
              413,
            );
          parts.push(chunk);
        }
        if (length === 0 || offset + length > file.size)
          throw new AppError(
            "UPLOAD_OFFSET",
            "The chunk exceeds the selected file.",
            409,
          );
        const data = Buffer.concat(parts);
        if (createHash("sha256").update(data).digest("hex") !== expectedHash)
          throw new AppError(
            "UPLOAD_HASH",
            "The chunk checksum does not match. Retry this part.",
            422,
          );
        const destination = await target(current, index);
        await mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        const handle = await open(destination, "a+", 0o600);
        try {
          const position = (await handle.stat()).size;
          if (position !== offset)
            throw new AppError(
              "UPLOAD_OFFSET",
              `Resume at byte ${position}.`,
              409,
            );
          await handle.writeFile(data);
          await handle.sync();
          await utimes(
            dir(current.serverId, current.id),
            new Date(),
            new Date(),
          );
        } finally {
          await handle.close();
        }
        return { offset: offset + length };
      });
    },
  );
  app.post(
    "/api/v1/servers/:id/upload-sessions/:sessionId/files/:index/validate",
    { config: { rateLimit: { max: 12000, timeWindow: "1 minute" } } },
    async (r) => {
      const s = await load(r);
      const index = z.coerce
        .number()
        .int()
        .min(0)
        .max(s.files.length - 1)
        .parse(params(r).index);
      return serialized(s.id, async () => {
        const current = await load(r);
        const file = current.files[index]!;
        const source = await target(current, index);
        if ((await stat(source).catch(() => ({ size: -1 }))).size !== file.size)
          throw new AppError(
            "UPLOAD_INCOMPLETE",
            "Finish uploading this file first.",
            409,
          );
        const expected = z
          .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
          .parse(r.body).sha256;
        if ((await hashFile(source)) !== expected)
          throw new AppError(
            "UPLOAD_HASH",
            `The checksum of ${file.name} does not match. Retry this file.`,
            422,
          );
        if (
          await stat(marker(current, index))
            .then(() => true)
            .catch(() => false)
        )
          return { validated: true };
        if (["jar", "custom"].includes(current.kind)) {
          const server = world(r, "content");
          const config =
            current.kind === "custom"
              ? serverConfigSchema.parse({
                  ...server.config,
                  software: current.software ?? server.config.software,
                  serverSource: "upload",
                })
              : server.config;
          await validateJar(
            source,
            file.name,
            config,
            current.kind === "custom",
          );
        } else if (!["file", "world-folder"].includes(current.kind))
          await inspectArchive(source);
        await writeFile(marker(current, index), "", {
          flag: "wx",
          mode: 0o600,
        });
        return { validated: true };
      });
    },
  );
  app.post(
    "/api/v1/servers/:id/upload-sessions/:sessionId/files/:index/reset",
    async (r) => {
      const s = await load(r);
      const index = z.coerce
        .number()
        .int()
        .min(0)
        .max(s.files.length - 1)
        .parse(params(r).index);
      return serialized(s.id, async () => {
        const current = await load(r);
        if (current.operationId)
          throw new AppError(
            "UPLOAD_SESSION",
            "This upload is already installing.",
          );
        await rm(await target(current, index), { force: true });
        await rm(marker(current, index), { force: true });
        return { offset: 0 };
      });
    },
  );
  app.post(
    "/api/v1/servers/:id/upload-sessions/:sessionId/finish",
    async (r, reply) => {
      const s = await load(r);
      return serialized(s.id, async () => {
        const current = await load(r);
        if (current.operationId)
          return reply
            .code(202)
            .send({ operation: findOperation(current.operationId) });
        const previous = store.get(
          "SELECT * FROM operations WHERE server_id=? AND json_extract(payload,'$.uploadSessionId')=? ORDER BY created_at DESC LIMIT 1",
          current.serverId,
          current.id,
        );
        const existing = previous ? store.operation(previous) : undefined;
        if (existing) {
          current.operationId = existing.id;
          await save(current);
          return reply.code(202).send({ operation: existing });
        }
        for (let i = 0; i < current.files.length; i++) {
          if (
            !(await stat(marker(current, i))
              .then(() => true)
              .catch(() => false))
          )
            throw new AppError(
              "UPLOAD_INCOMPLETE",
              "Validate every uploaded file first.",
              409,
            );
          if (
            (await stat(await target(current, i))).size !==
            current.files[i]!.size
          )
            throw new AppError(
              "UPLOAD_INCOMPLETE",
              "One file is incomplete.",
              409,
            );
        }
        const files = current.files.map((f, i) => ({
          filename: `session-${current.id}/${i}.part`,
          name: f.name,
          custom: current.kind === "custom",
          software:
            current.software ??
            (current.kind === "jar"
              ? world(r, "content").config.software
              : "CUSTOM"),
        }));
        let operation;
        if (current.kind === "world-folder")
          operation = jobs.enqueue(current.serverId, current.actor, "import", {
            folder: `session-${current.id}/folder`,
            kind: "world",
            uploadSessionId: current.id,
          });
        else if (current.kind === "file")
          operation = jobs.enqueue(
            current.serverId,
            current.actor,
            "files.upload",
            {
              files,
              directory: current.directory,
              uploadSessionId: current.id,
            },
          );
        else if (["jar", "custom"].includes(current.kind))
          operation = jobs.enqueue(
            current.serverId,
            current.actor,
            files.length > 1 ? "jars" : "jar",
            files.length > 1
              ? { files, uploadSessionId: current.id }
              : { ...files[0], uploadSessionId: current.id },
          );
        else
          operation = jobs.enqueue(
            current.serverId,
            current.actor,
            ["modpack", "atm"].includes(current.kind) ? "modpack" : "import",
            {
              filename: files[0]!.filename,
              kind: current.kind,
              uploadSessionId: current.id,
            },
          );
        current.operationId = operation.id;
        await save(current);
        return reply.code(202).send({ operation });
      });
    },
  );
  app.delete("/api/v1/servers/:id/upload-sessions/:sessionId", async (r) => {
    const s = await load(r);
    return serialized(s.id, async () => {
      if (s.operationId)
        throw new AppError(
          "UPLOAD_SESSION",
          "An installation has already started.",
        );
      await rm(dir(s.serverId, s.id), { recursive: true, force: true });
      return { deleted: true };
    });
  });
}
