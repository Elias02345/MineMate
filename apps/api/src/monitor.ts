import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  now,
  AppError,
  type Server,
} from "../../../packages/shared/src/index.ts";
import { assertOwned } from "../../../packages/docker/src/index.ts";
import { walk } from "../../../packages/backup/src/archive.ts";
import type { Servers } from "./servers.ts";
export class Monitor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private logs = new Map<string, string>();
  private lastDisk = new Map<string, number>();
  private lastFailure = new Map<string, string>();
  constructor(private servers: Servers) {}
  async reconcile() {
    const s = this.servers;
    try {
      const containers = await s.docker.list();
      for (const world of s.store.servers(s.config.lanIp)) {
        const owned = containers.filter(
          (c) =>
            c.Labels["io.minemate.managed"] === "true" &&
            c.Labels["io.minemate.installation"] === s.installation &&
            c.Labels["io.minemate.server-id"] === world.id &&
            c.Labels["io.minemate.kind"] === "minecraft-server",
        );
        if (owned.length === 1 && world.containerId !== owned[0]!.Id) {
          world.containerId = owned[0]!.Id;
          s.store.saveServer(world);
        }
        if (owned.length > 1)
          s.store.notify(
            world.id,
            "warning",
            "Multiple containers claim this world. Review Docker ownership before changing it.",
          );
      }
      for (const c of containers)
        if (
          c.Labels["io.minemate.installation"] === s.installation &&
          !s.store.get(
            "SELECT id FROM servers WHERE id=?",
            c.Labels["io.minemate.server-id"] ?? "",
          )
        )
          s.store.notify(
            null,
            "warning",
            "An owned container has no world record. It has been left untouched.",
          );
    } catch (e) {
      s.store.notify(
        null,
        "error",
        "Docker reconciliation failed: " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }
  start() {
    this.timer = setInterval(() => {
      void this.tick().catch((e) =>
        this.servers.events.send("monitor.error", { message: String(e) }),
      );
    }, 5000);
    this.timer.unref();
    void this.tick();
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 50));
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const worlds = this.servers.store.servers(this.servers.config.lanIp);
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, worlds.length) }, async () => {
          for (;;) {
            const world = worlds[index++];
            if (!world) break;
            try {
              await this.inspect(world);
            } catch (e) {
              if (e instanceof AppError && e.status === 404) {
                world.containerId = null;
                world.error =
                  "The Minecraft container is missing. Start this world to recreate it.";
                this.servers.state(world, "ERROR");
              } else
                this.servers.events.send(
                  "monitor.error",
                  { message: e instanceof Error ? e.message : String(e) },
                  world.id,
                );
            }
          }
        }),
      );
    } finally {
      this.busy = false;
    }
  }
  private async inspect(world: Server) {
    const s = this.servers,
      busy = !!s.store.get(
        "SELECT id FROM operations WHERE server_id=? AND status IN ('RUNNING','QUEUED')",
        world.id,
      );
    if (world.archived) return;
    const wake = path.join(s.paths.root, "gateway", world.id, "wake.json");
    try {
      await readFile(wake);
      await rm(wake, { force: true });
      if (!busy && world.state === "SLEEPING") {
        s.state(world, "WAKING");
        const owner = s.store.get("SELECT id FROM users WHERE role='owner'");
        if (owner) s.jobs.enqueue(world.id, String(owner.id), "start");
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const schedule = s.store.setting<{
      intervalMinutes: number;
      lastAt: number;
    }>("schedule:" + world.id, { intervalMinutes: 0, lastAt: Date.now() });
    if (
      !busy &&
      schedule.intervalMinutes > 0 &&
      Date.now() - schedule.lastAt > schedule.intervalMinutes * 60000
    ) {
      const owner = s.store.get("SELECT id FROM users WHERE role='owner'");
      if (owner) {
        s.store.setSetting("schedule:" + world.id, {
          ...schedule,
          lastAt: Date.now(),
        });
        s.jobs.enqueue(world.id, String(owner.id), "backup", {
          reason: "scheduled",
        });
      }
    }
    if (!world.containerId) return;
    const info = await s.docker.inspect(world.containerId);
    assertOwned(info, s.installation, world.id);
    s.store.run(
      "UPDATE server_runtimes SET docker_state=?,minecraft_ready=?,updated_at=? WHERE server_id=?",
      info.State.Status,
      world.state === "RUNNING" ? 1 : 0,
      now(),
      world.id,
    );
    const raw = await s.docker.logs(world.containerId, 150),
      lines = raw.trim().split("\n"),
      last = this.logs.get(world.id);
    let newLines = lines;
    if (last) {
      const i = lines.lastIndexOf(last);
      if (i >= 0) newLines = lines.slice(i + 1);
    }
    this.logs.set(world.id, lines.at(-1) ?? "");
    for (const line of newLines.slice(-150))
      s.events.send(
        "server.log",
        {
          line: line.replace(/(rcon\.password\s*[=:]\s*)\S+/gi, "$1[redacted]"),
        },
        world.id,
      );
    if (!info.State.Running) {
      if (
        busy ||
        s.store.get(
          "SELECT id FROM operations WHERE server_id=? AND status IN ('RUNNING','QUEUED')",
          world.id,
        )
      )
        return;
      if (world.desired === "RUNNING" && info.State.ExitCode !== 0) {
        const exit = info.State.FinishedAt;
        if (this.lastFailure.get(world.id) !== exit) {
          this.lastFailure.set(world.id, exit);
          const failures = s.store
            .setting<number[]>("crashes:" + world.id, [])
            .filter((t) => Date.now() - t < 600000);
          failures.push(Date.now());
          s.store.setSetting("crashes:" + world.id, failures);
          world.error =
            failures.length >= 4
              ? "Minecraft crashed 4 times in 10 minutes. Automatic restart is paused."
              : "Minecraft crashed. Open Repair to inspect its logs.";
          s.state(world, "ERROR");
          s.store.notify(world.id, "error", world.error);
          if (failures.length < 4) {
            const owner = s.store.get(
              "SELECT id FROM users WHERE role='owner'",
            );
            if (owner) s.jobs.enqueue(world.id, String(owner.id), "start");
          }
        }
      } else if (world.state !== "SLEEPING" && world.state !== "ERROR")
        s.state(world, "STOPPED");
      return;
    }
    const stats = await s.docker.stats(world.containerId),
      cpuDelta =
        stats.cpu_stats.cpu_usage.total_usage -
        stats.precpu_stats.cpu_usage.total_usage,
      systemDelta =
        stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    let players = world.metrics?.players ?? null,
      names = world.metrics?.playerNames ?? [];
    try {
      const status = await s.probe(world);
      if (status) {
        players = status.players;
        names = status.names;
        if (
          !busy &&
          !s.store.get(
            "SELECT id FROM operations WHERE server_id=? AND status IN ('RUNNING','QUEUED')",
            world.id,
          ) &&
          world.state !== "RUNNING"
        )
          s.state(s.get(world.id), "RUNNING");
      }
    } catch {
      /* Minecraft may still be starting */
    }
    if (world.config.edition === "JAVA" && players !== null && players > 0) {
      try {
        const list = await s.runtime.command(
          world.containerId,
          world.id,
          world.config,
          "list",
        );
        const match = list.match(/players online:\s*(.*)/);
        if (match)
          names = match[1]!
            .split(",")
            .map((n) => n.trim())
            .filter(Boolean);
      } catch {
        /* retain protocol sample */
      }
    }
    let disk = world.metrics?.diskBytes ?? null;
    if (Date.now() - (this.lastDisk.get(world.id) ?? 0) > 60000) {
      disk = (await walk(s.paths.server(world.id))).reduce(
        (sum, f) => sum + f.bytes,
        0,
      );
      this.lastDisk.set(world.id, Date.now());
    }
    world.metrics = {
      cpuPercent:
        systemDelta > 0
          ? Math.max(
              0,
              (cpuDelta / systemDelta) *
                (stats.cpu_stats.online_cpus ?? 1) *
                100,
            )
          : null,
      memoryBytes:
        stats.memory_stats.usage === undefined
          ? null
          : Math.max(
              0,
              stats.memory_stats.usage -
                (stats.memory_stats.stats?.inactive_file ?? 0),
            ),
      memoryLimit: stats.memory_stats.limit ?? null,
      diskBytes: disk,
      uptimeSeconds: Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(info.State.StartedAt).getTime()) / 1000,
        ),
      ),
      players,
      playerNames: names,
      at: now(),
    };
    s.store.run(
      "UPDATE servers SET metrics=? WHERE id=?",
      JSON.stringify(world.metrics),
      world.id,
    );
    s.events.send("server.metrics", world.metrics, world.id);
    if (
      !busy &&
      world.state === "RUNNING" &&
      world.config.sleepMinutes > 0 &&
      players === 0
    ) {
      const idle = s.store.setting<number>("idle:" + world.id, Date.now());
      s.store.setSetting("idle:" + world.id, idle);
      if (Date.now() - idle >= world.config.sleepMinutes * 60000) {
        const owner = s.store.get("SELECT id FROM users WHERE role='owner'");
        if (owner) s.jobs.enqueue(world.id, String(owner.id), "sleep");
      }
    } else if (players !== 0)
      s.store.setSetting("idle:" + world.id, Date.now());
  }
}
