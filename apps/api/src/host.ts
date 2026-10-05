import { randomUUID } from "node:crypto";
import { statfs, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import dgram from "node:dgram";
import {
  labels,
  assertOwned,
  type DockerProvider,
} from "../../../packages/docker/src/index.ts";
import {
  AppError,
  type HostStatus,
} from "../../../packages/shared/src/index.ts";
import type { DataPaths } from "../../../packages/backup/src/paths.ts";
import type { Config } from "./config.ts";
export class Host {
  private proofAt = 0;
  constructor(
    private docker: DockerProvider,
    private paths: DataPaths,
    private config: Config,
    private installation: string,
  ) {}
  async prove() {
    if (Date.now() - this.proofAt < 60000) return;
    if (
      !path.isAbsolute(this.paths.hostRoot) ||
      this.paths.hostRoot === "/" ||
      this.paths.hostRoot.includes("\0")
    )
      throw new AppError(
        "HOST_PATH",
        "Configure the absolute host data directory using the installer.",
      );
    const id = randomUUID(),
      name = ".minemate-bind-" + id,
      expected = randomUUID();
    await writeFile(path.join(this.paths.root, name), expected, {
      flag: "wx",
      mode: 0o644,
    });
    let container: string | undefined;
    try {
      await this.docker.pull("alpine:3.22.1");
      container = await this.docker.create("minemate-check-" + id, {
        Image: "alpine:3.22.1",
        Cmd: ["cat", "/probe/" + name],
        Labels: labels(this.installation, id, "host-check"),
        HostConfig: {
          Binds: [this.paths.hostRoot + ":/probe:ro"],
          NetworkMode: "none",
          ReadonlyRootfs: true,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
        },
      });
      await this.docker.start(container);
      for (let i = 0; i < 50; i++) {
        const info = await this.docker.inspect(container);
        assertOwned(info, this.installation, id, "host-check");
        if (!info.State.Running) {
          if (
            info.State.ExitCode !== 0 ||
            (await this.docker.logs(container))
              .trim()
              .replace(/^\d{4}-\d{2}-\d{2}T\S+ /, "") !== expected
          )
            throw new AppError(
              "HOST_PATH",
              "Docker cannot see the configured MineMate data directory. Run the installation helper on the Docker host.",
            );
          this.proofAt = Date.now();
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new AppError("HOST_PATH", "The host path validation timed out.");
    } finally {
      await rm(path.join(this.paths.root, name), { force: true });
      if (container) {
        const info = await this.docker.inspect(container);
        assertOwned(info, this.installation, id, "host-check");
        if (info.State.Running) await this.docker.stop(container, 1);
        await this.docker.remove(container);
      }
    }
  }
  async check(): Promise<HostStatus> {
    const checks: HostStatus["checks"] = [];
    let dockerVersion: string | null = null,
      memoryMb = Math.floor(os.totalmem() / 1024 ** 2),
      cpus = os.cpus().length;
    try {
      const info = await this.docker.ping();
      dockerVersion = info.Version;
      memoryMb = Math.floor(info.MemTotal / 1024 ** 2);
      cpus = info.NCPU;
      checks.push({
        key: "docker",
        ok: Number(info.Version.split(".")[0]) >= 25,
        message: `Docker ${info.Version}`,
      });
    } catch (e) {
      checks.push({
        key: "docker",
        ok: false,
        message: "Docker is unavailable",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    let freeBytes = 0;
    try {
      const fs = await statfs(this.paths.root);
      freeBytes = fs.bavail * fs.bsize;
      const p = path.join(this.paths.root, "tmp", randomUUID());
      await writeFile(p, "ready", { mode: 0o600 });
      await rm(p);
      checks.push({
        key: "storage",
        ok: freeBytes > 1024 ** 3,
        message: `${Math.floor(freeBytes / 1024 ** 3)} GB free`,
      });
    } catch (e) {
      checks.push({
        key: "storage",
        ok: false,
        message: "The data directory is not writable",
        detail: String(e),
      });
    }
    if (dockerVersion) {
      try {
        await this.prove();
        checks.push({
          key: "hostPath",
          ok: true,
          message: "Docker host path verified",
        });
      } catch (e) {
        checks.push({
          key: "hostPath",
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
      try {
        await this.docker.ensureNetwork(this.config.network);
        checks.push({
          key: "network",
          ok: true,
          message: "Minecraft bridge ready",
        });
      } catch (e) {
        checks.push({ key: "network", ok: false, message: String(e) });
      }
    }
    checks.push(
      {
        key: "lan",
        ok: this.config.lanIp !== "127.0.0.1",
        message: this.config.lanIp,
        detail:
          "Override MINEMATE_LAN_IP if this is not your Docker host LAN address.",
      },
      {
        key: "architecture",
        ok: ["x64", "arm64"].includes(process.arch),
        message: process.arch,
      },
      {
        key: "resources",
        ok: memoryMb >= 1024,
        message: `${memoryMb} MB · ${cpus} CPUs`,
      },
      {
        key: "time",
        ok: new Date().getUTCFullYear() >= 2025,
        message: new Date().toISOString(),
      },
    );
    return {
      checks,
      ready: checks.every((c) => c.ok),
      memoryMb,
      cpus,
      architecture: process.arch,
      lanIp: this.config.lanIp,
      freeBytes,
      dockerVersion,
    };
  }
}
export async function portAvailable(
  port: number,
  protocol: "TCP" | "UDP",
  address = "0.0.0.0",
): Promise<boolean> {
  return new Promise((resolve) => {
    if (protocol === "TCP") {
      const listener = net.createServer();
      listener.once("error", () => resolve(false));
      listener.listen(port, address, () => listener.close(() => resolve(true)));
    } else {
      const listener = dgram.createSocket("udp4");
      listener.once("error", () => {
        listener.close();
        resolve(false);
      });
      listener.bind(port, address, () => listener.close(() => resolve(true)));
    }
  });
}
export async function allocatePort(
  start: number,
  end: number,
  protocol: "TCP" | "UDP",
  reserved: Set<number>,
  requested?: number,
) {
  const first = requested ?? start,
    last = requested ?? end;
  if (first < 1024 || last > 65535 || first > last)
    throw new AppError("PORT", "Choose a port from 1024 to 65535.");
  for (let p = first; p <= last; p++) {
    if (!reserved.has(p) && (await portAvailable(p, protocol))) return p;
  }
  throw new AppError(
    "PORT_CONFLICT",
    requested
      ? "This port is already used."
      : "No unused Minecraft port is available.",
    409,
  );
}
