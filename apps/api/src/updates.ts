import { randomUUID } from "node:crypto";
import {
  apiRequest,
  type ContentVersion,
} from "../../../packages/mod-platforms/src/index.ts";
import {
  AppError,
  serverConfigSchema,
  now,
  type Server,
  type ServerConfig,
} from "../../../packages/shared/src/index.ts";
import type { Servers } from "./servers.ts";
import { allocatePort } from "./host.ts";
import type { Backups } from "./backups.ts";
import type { Content } from "./content.ts";
export class Updates {
  private async configure(
    s: Server,
    op: import("../../../packages/shared/src/index.ts").Operation,
    phase: (text: string) => void,
  ) {
    const target = serverConfigSchema.parse(op.payload.config),
      actor = this.servers.actor(op.id),
      running = s.desired === "RUNNING";
    const info = await this.servers.docker.ping();
    if (target.memoryMb > info.MemTotal / 1024 ** 2)
      throw new AppError("MEMORY", "This allocation exceeds the host memory.");
    phase("Saving a configuration recovery point");
    await this.servers.stop(s);
    const b = await this.backups.create(
      s,
      actor,
      "before runtime configuration",
    );
    try {
      if (target.port && target.port !== s.port) {
        const protocol = s.endpoint.protocol,
          taken = new Set(
            this.servers.store
              .servers(this.servers.config.lanIp)
              .filter((v) => v.id !== s.id && v.endpoint.protocol === protocol)
              .map((v) => v.port),
          );
        s.port = await allocatePort(
          target.port,
          target.port,
          protocol,
          taken,
          target.port,
        );
        await this.servers.removeGateway(s.id);
        this.servers.store.run(
          "UPDATE servers SET port=? WHERE id=?",
          s.port,
          s.id,
        );
      }
      await this.servers.replaceContainer(s, target);
      await this.servers.ensureGateway(s);
      if (running) {
        phase("Checking the new resource configuration");
        await this.servers.start(s);
        await this.servers.waitReady(s);
      } else this.servers.state(s, "STOPPED");
      this.servers.store.audit(actor, s.id, "runtime.changed");
      return { backupId: b.id };
    } catch (e) {
      phase("Restoring the previous resource and network configuration");
      try {
        await this.servers.stop(s);
        await this.backups.restore(s, b.id);
        if (running) {
          await this.servers.start(s);
          await this.servers.waitReady(s);
        }
      } catch (recoveryError) {
        this.servers.fail(s, recoveryError);
        throw new AppError(
          "RECOVERY_FAILED",
          "Configuration and automatic recovery failed. Restore the saved recovery chest.",
          409,
          String(recoveryError),
        );
      }
      throw new AppError(
        "CONFIG_ROLLED_BACK",
        "This configuration could not start. The previous configuration was restored.",
        409,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  registerConfiguration() {
    this.servers.jobs.register("configure", (op, phase) =>
      this.configure(this.servers.get(op.serverId!), op, phase),
    );
  }
  constructor(
    private servers: Servers,
    private backups: Backups,
    private content: Content,
  ) {
    servers.jobs.register("update", async (op, phase) => {
      const s = servers.get(op.serverId!),
        actor = servers.actor(op.id),
        target = serverConfigSchema.parse(op.payload.config),
        previous = s.config;
      phase("Checking content compatibility");
      const check = await this.check(s, target.version, target.software),
        id = randomUUID();
      if (check.blocked.length && !op.payload.override)
        throw new AppError(
          "UPDATE_BLOCKED",
          "Some installed items do not support this version.",
        );
      const versions = check.items.flatMap((i) =>
        i.version ? [i.version] : [],
      );
      phase("Downloading verified compatible content");
      const downloaded = await content.download(versions, s.id);
      phase("Creating an update recovery point");
      await servers.stop(s);
      const backup = await backups.create(s, actor, "before update");
      servers.store.run(
        "INSERT INTO update_records VALUES(?,?,?,?,?,?,?)",
        id,
        s.id,
        JSON.stringify(previous),
        JSON.stringify(target),
        backup.id,
        "APPLYING",
        now(),
      );
      try {
        phase("Applying runtime and content changes");
        await servers.replaceContainer(s, target);
        await content.apply(s, downloaded, actor, "updates");
        servers.state(s, "UPDATING");
        await servers.start(s);
        phase("Verifying Minecraft readiness");
        await servers.waitReady(s);
        servers.store.run(
          "UPDATE update_records SET status='INSTALLED' WHERE id=?",
          id,
        );
        servers.store.audit(actor, s.id, "server.updated", {
          version: target.version,
        });
        return { backupId: backup.id, updateId: id };
      } catch (e) {
        phase("Rolling back the failed update");
        await servers.stop(s);
        await backups.restore(s, backup.id);
        await servers.start(s);
        await servers.waitReady(s);
        servers.store.run(
          "UPDATE update_records SET status='ROLLED_BACK' WHERE id=?",
          id,
        );
        throw new AppError(
          "UPDATE_ROLLED_BACK",
          "The update failed. The previous working state was restored.",
          409,
          e instanceof Error ? e.message : String(e),
        );
      }
    });
  }
  async versions() {
    const manifest = await apiRequest<{
      latest: { release: string };
      versions: { id: string; type: string }[];
    }>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    return {
      recommended: manifest.latest.release,
      versions: manifest.versions
        .filter((v) => v.type === "release")
        .map((v) => v.id),
    };
  }
  async check(
    s: Server,
    targetVersion = s.config.version,
    targetSoftware: ServerConfig["software"] = s.config.software,
  ) {
    const items: {
        id: string;
        filename: string;
        state: string;
        version: ContentVersion | null;
        message: string;
      }[] = [],
      blocked: string[] = [],
      config = {
        ...s.config,
        version: targetVersion,
        software: targetSoftware,
      };
    for (const item of await this.content.inventory(s)) {
      if (!item.managed || item.source === "manual") {
        items.push({
          id: item.id,
          filename: item.filename,
          state: "UNCERTAIN",
          version: null,
          message: "Manual content needs a compatibility review.",
        });
        if (
          targetVersion !== s.config.version ||
          targetSoftware !== s.config.software
        )
          blocked.push(item.filename);
        continue;
      }
      try {
        const version = (
          await this.content
            .provider(item.source)
            .versions(item.projectId, config)
        )[0];
        if (!version) {
          blocked.push(item.filename);
          items.push({
            id: item.id,
            filename: item.filename,
            state: "BLOCKED",
            version: null,
            message: "No compatible version exists.",
          });
        } else
          items.push({
            id: item.id,
            filename: item.filename,
            state: version.id === item.versionId ? "INSTALLED" : "COMPATIBLE",
            version: version.id === item.versionId ? null : version,
            message:
              version.id === item.versionId
                ? "Up to date."
                : "Compatible update available.",
          });
      } catch (e) {
        blocked.push(item.filename);
        items.push({
          id: item.id,
          filename: item.filename,
          state: "UNCERTAIN",
          version: null,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { targetVersion, items, blocked, compatible: blocked.length === 0 };
  }
}
