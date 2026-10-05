import { randomUUID } from "node:crypto";
import { rm, rename, stat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  createArchive,
  extractArchive,
  hashFile,
  swapDirectory,
  retainedBackups,
  type Retention,
} from "../../../packages/backup/src/archive.ts";
import { safePath } from "../../../packages/backup/src/paths.ts";
import {
  AppError,
  now,
  type Backup,
  type Server,
  type InstalledContent,
} from "../../../packages/shared/src/index.ts";
import { allocatePort } from "./host.ts";
import type { Servers } from "./servers.ts";
export class Backups {
  constructor(private servers: Servers) {
    const { jobs } = servers;
    jobs.register("backup", async (op, phase) => {
      const s = servers.get(op.serverId!),
        running = s.desired === "RUNNING",
        sleeping = s.desired === "SLEEPING";
      try {
        phase("Stopping Minecraft for a consistent backup");
        await servers.stop(s);
        phase("Packing and verifying the recovery chest");
        const b = await this.create(
          s,
          servers.actor(op.id),
          String(op.payload.reason ?? "manual"),
        );
        if (running) {
          phase("Restarting Minecraft");
          await servers.start(s);
          await servers.waitReady(s);
        } else {
          if (sleeping) s.desired = "SLEEPING";
          servers.state(s, sleeping ? "SLEEPING" : "STOPPED");
        }
        servers.store.audit(servers.actor(op.id), s.id, "backup.created", {
          backupId: b.id,
        });
        return { backupId: b.id };
      } catch (e) {
        servers.fail(s, e);
        throw e;
      }
    });
    jobs.register("restore", async (op, phase) => {
      const s = servers.get(op.serverId!),
        actor = servers.actor(op.id);
      try {
        phase("Stopping Minecraft");
        await servers.stop(s);
        phase("Saving an emergency recovery point");
        const emergency = await this.create(s, actor, "before restore");
        phase("Verifying the selected backup");
        await this.restore(s, String(op.payload.backupId));
        phase("Starting restored Minecraft");
        await servers.start(s);
        await servers.waitReady(s);
        servers.store.audit(actor, s.id, "backup.restored", {
          backupId: op.payload.backupId,
          emergencyBackup: emergency.id,
        });
        return { emergencyBackupId: emergency.id };
      } catch (e) {
        servers.fail(s, e);
        throw e;
      }
    });
  }
  async create(s: Server, actor: string, reason: string): Promise<Backup> {
    if (s.containerId) {
      const info = await this.servers.runtime.owned(s.containerId, s.id);
      if (info.State.Running)
        throw new AppError(
          "CONSISTENCY",
          "Minecraft must stop before making this backup.",
          409,
        );
    }
    this.servers.state(s, "BACKING_UP");
    const id = randomUUID(),
      filename = id + ".zip",
      output = this.servers.paths.server(s.id, "backups") + "/" + filename;
    await import("../../../packages/backup/src/paths.ts").then(
      ({ atomicWrite }) =>
        atomicWrite(
          this.servers.paths.server(s.id) + "/.minemate-content.json",
          JSON.stringify(this.servers.store.content(s.id)),
        ),
    );
    const packed = await createArchive(this.servers.paths.server(s.id), output);
    const b: Backup = {
      id,
      serverId: s.id,
      filename,
      hash: packed.hash,
      bytes: packed.bytes,
      createdAt: now(),
      reason,
      config: { ...s.config, port: s.port },
      creator: actor,
      integrity: "verified",
    };
    this.servers.store.run(
      "INSERT INTO backups VALUES(?,?,?,?,?,?,?,?,?,?)",
      b.id,
      b.serverId,
      b.filename,
      b.hash,
      b.bytes,
      b.createdAt,
      b.reason,
      JSON.stringify(b.config),
      b.creator,
      b.integrity,
    );
    this.servers.events.send("backup.completed", b, s.id);
    this.servers.store.notify(
      s.id,
      "info",
      "A verified recovery chest is ready.",
    );
    await this.applyRetention(s.id);
    this.servers.state(s, "STOPPED");
    return b;
  }
  async restore(s: Server, id: string) {
    const b = this.servers.store.backups(s.id).find((b) => b.id === id);
    if (!b)
      throw new AppError(
        "NOT_FOUND",
        "This recovery chest was not found.",
        404,
      );
    if (b.config.port && b.config.port !== s.port) {
      const protocol = s.endpoint.protocol,
        taken = new Set(
          this.servers.store
            .servers(this.servers.config.lanIp)
            .filter((v) => v.id !== s.id && v.endpoint.protocol === protocol)
            .map((v) => v.port),
        );
      await allocatePort(
        b.config.port,
        b.config.port,
        protocol,
        taken,
        b.config.port,
      );
    }
    const file = await safePath(
      this.servers.paths.server(s.id, "backups"),
      b.filename,
    );
    if ((await hashFile(file)) !== b.hash) {
      this.servers.store.run(
        "UPDATE backups SET integrity='failed' WHERE id=?",
        id,
      );
      throw new AppError(
        "BACKUP_INTEGRITY",
        "The backup failed integrity verification.",
      );
    }
    this.servers.state(s, "RESTORING");
    const staging = path.join(
      this.servers.paths.server(s.id, "imports"),
      "restore-" + randomUUID(),
    );
    await extractArchive(file, staging);
    const previous = await swapDirectory(
      staging,
      this.servers.paths.server(s.id),
    );
    const snapshotId = randomUUID();
    await rename(
      previous,
      path.join(this.servers.paths.server(s.id, "snapshots"), snapshotId),
    );
    if (b.config.port && b.config.port !== s.port) {
      await this.servers.removeGateway(s.id);
      s.port = b.config.port;
      this.servers.store.run(
        "UPDATE servers SET port=? WHERE id=?",
        s.port,
        s.id,
      );
    }
    await this.servers.replaceContainer(s, b.config);
    await this.servers.ensureGateway(s);
    const manifest = JSON.parse(
      await readFile(
        await safePath(
          this.servers.paths.server(s.id),
          ".minemate-content.json",
        ),
        "utf8",
      ),
    ) as InstalledContent[];
    if (
      !Array.isArray(manifest) ||
      manifest.some(
        (i) => i.serverId !== s.id || typeof i.filename !== "string",
      )
    )
      throw new AppError(
        "BACKUP_MANIFEST",
        "This recovery chest has an invalid content inventory.",
      );
    for (const i of manifest)
      await safePath(this.servers.paths.server(s.id), i.filename);
    this.servers.store.transaction(() => {
      this.servers.store.run(
        "DELETE FROM installed_content WHERE server_id=?",
        s.id,
      );
      for (const i of manifest)
        this.servers.store.run(
          "INSERT INTO installed_content VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
          i.id,
          i.serverId,
          i.source,
          i.projectId,
          i.versionId,
          i.filename,
          i.hash,
          i.gameVersion,
          i.loader,
          i.dependency ? 1 : 0,
          i.managed ? 1 : 0,
          i.installedAt,
          i.installedBy,
        );
    });
    const snapshots = this.servers.paths.server(s.id, "snapshots");
    for (const entry of await readdir(snapshots))
      if (entry !== snapshotId) {
        const target = path.join(snapshots, entry);
        if ((await stat(target)).isDirectory())
          await rm(target, { recursive: true, force: true });
      }
    this.servers.state(s, "STOPPED");
  }
  async applyRetention(id: string) {
    const policy = this.servers.store.setting<Retention>("retention:" + id, {
        keepLast: 20,
        daily: 7,
        weekly: 4,
        maxBytes: 0,
      }),
      backups = this.servers.store.backups(id),
      keep = retainedBackups(backups, policy);
    for (const b of backups)
      if (
        !keep.has(b.id) &&
        !this.servers.store
          .all(
            "SELECT payload FROM operations WHERE server_id=? AND status IN ('RUNNING','QUEUED')",
            id,
          )
          .some((o) => JSON.parse(String(o.payload)).backupId === b.id)
      ) {
        await rm(
          await safePath(this.servers.paths.server(id, "backups"), b.filename),
          { force: true },
        );
        this.servers.store.run("DELETE FROM backups WHERE id=?", b.id);
      }
  }
  async file(id: string, backupId: string) {
    const b = this.servers.store.backups(id).find((b) => b.id === backupId);
    if (!b) throw new AppError("NOT_FOUND", "Backup not found.", 404);
    const filename = await safePath(
      this.servers.paths.server(id, "backups"),
      b.filename,
    );
    await stat(filename);
    return { b, filename };
  }
}
