import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DockerProvider,
  ContainerInfo,
  ContainerSummary,
  CreateContainer,
  DockerStats,
} from "../../packages/docker/src/index.ts";
import { AppError } from "../../packages/shared/src/index.ts";
export class FixtureDocker implements DockerProvider {
  private containers = new Map<
    string,
    { spec: CreateContainer; info: ContainerInfo; logs: string }
  >();
  async ping() {
    return {
      Version: "28.4.0",
      Arch: "amd64",
      MemTotal: 16 * 1024 ** 3,
      NCPU: 4,
    };
  }
  async list(): Promise<ContainerSummary[]> {
    return [...this.containers].map(([id, c]) => ({
      Id: id,
      Labels: c.spec.Labels,
      State: c.info.State.Status,
      Names: [c.info.Name],
      Ports: [],
    }));
  }
  async inspect(id: string) {
    const c = this.containers.get(id);
    if (!c) throw new AppError("DOCKER", "Not found", 404);
    return structuredClone(c.info);
  }
  async create(name: string, spec: CreateContainer) {
    const id = randomUUID();
    this.containers.set(id, {
      spec,
      logs: "",
      info: {
        Id: id,
        Name: name,
        Config: { Labels: spec.Labels, Image: spec.Image },
        State: {
          Status: "created",
          Running: false,
          ExitCode: 0,
          StartedAt: "",
          FinishedAt: "",
        },
        NetworkSettings: {
          Networks: { "minemate-servers": { IPAddress: "127.0.0.1" } },
        },
        HostConfig: { Memory: spec.HostConfig.Memory ?? 0 },
        RestartCount: 0,
      },
    });
    return id;
  }
  async start(id: string) {
    const c = this.containers.get(id)!;
    if (c.spec.Labels["io.minemate.kind"] === "host-check") {
      const root = c.spec.HostConfig.Binds![0]!.split(":")[0]!,
        filename = c.spec.Cmd![1]!.replace("/probe/", "");
      c.logs =
        new Date().toISOString() +
        " " +
        (await readFile(path.join(root, filename), "utf8"));
      c.info.State = { ...c.info.State, Status: "exited", Running: false };
      return;
    }
    const root = c.spec.HostConfig.Binds?.[0]?.split(":")[0];
    if (root) {
      await mkdir(path.join(root, "world"), { recursive: true });
      await writeFile(
        path.join(root, "world", "level.dat"),
        "controlled test world",
      );
      try {
        await readFile(path.join(root, "server.properties"));
      } catch {
        await writeFile(
          path.join(root, "server.properties"),
          "motd=Controlled test runtime\nlevel-name=world\nmax-players=20\nrcon.password=fixture-internal-secret\n",
        );
      }
    }
    c.info.State = {
      Status: "running",
      Running: true,
      ExitCode: 0,
      StartedAt: new Date().toISOString(),
      FinishedAt: "",
      Health: { Status: "healthy" },
    };
    c.logs =
      new Date().toISOString() +
      " Controlled test runtime ready (not Minecraft)\n";
  }
  async stop(id: string) {
    const c = this.containers.get(id)!;
    c.info.State = {
      ...c.info.State,
      Status: "exited",
      Running: false,
      FinishedAt: new Date().toISOString(),
    };
  }
  async remove(id: string) {
    this.containers.delete(id);
  }
  async logs(id: string) {
    return this.containers.get(id)!.logs;
  }
  async exec(id: string, args: string[]) {
    const container = this.containers.get(id)!,
      command = args[1] ?? "";
    const output =
      command === "list"
        ? "There are 0 of a max of 20 players online:"
        : "Command received by controlled test runtime";
    // Only the controlled browser/API fixture models list persistence; this is
    // never part of a production Minecraft runtime.
    const match = /^(whitelist|allowlist) (add|remove) (.+)$/.exec(command);
    if (match) {
      const name = match[3]!.startsWith('"')
        ? (JSON.parse(match[3]!) as string)
        : match[3]!;
      const directory = container.spec.HostConfig.Binds![0]!.split(":")[0]!;
      const file = path.join(directory, match[1] + ".json");
      const list = await readFile(file, "utf8")
        .then((text) => JSON.parse(text) as { name: string }[])
        .catch(() => []);
      const retained = list.filter((entry) => entry.name !== name);
      await writeFile(
        file,
        JSON.stringify(match[2] === "add" ? [...retained, { name }] : retained),
      );
    }
    container.logs += `> ${command}\n${output}\n`;
    return output;
  }
  async stats(id: string): Promise<DockerStats> {
    return {
      cpu_stats: {
        cpu_usage: { total_usage: 100 },
        system_cpu_usage: 1000,
        online_cpus: 2,
      },
      precpu_stats: { cpu_usage: { total_usage: 90 }, system_cpu_usage: 900 },
      memory_stats: {
        usage: 1024 ** 2,
        limit: this.containers.get(id)!.spec.HostConfig.Memory ?? 1024 ** 3,
      },
    };
  }
  async pull(_image: string) {}
  async ensureNetwork(_name: string) {}
}
