import http from "node:http";
import https from "node:https";
import { AppError } from "../../shared/src/index.ts";
export interface ContainerInfo {
  Id: string;
  Name: string;
  Config: { Labels: Record<string, string>; Image: string };
  State: {
    Status: string;
    Running: boolean;
    ExitCode: number;
    StartedAt: string;
    FinishedAt: string;
    Health?: { Status: string };
  };
  NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
  HostConfig: { Memory: number };
  RestartCount: number;
}
export interface ContainerSummary {
  Id: string;
  Labels: Record<string, string>;
  State: string;
  Names: string[];
  Ports: { PublicPort?: number; PrivatePort: number; Type: string }[];
}
export interface DockerStats {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus?: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: {
    usage?: number;
    limit?: number;
    stats?: { inactive_file?: number };
  };
}
export interface CreateContainer {
  Healthcheck?: { Test: string[] };
  Image: string;
  Env?: string[];
  Cmd?: string[];
  Labels: Record<string, string>;
  ExposedPorts?: Record<string, Record<string, never>>;
  HostConfig: {
    Binds?: string[];
    Memory?: number;
    NanoCpus?: number;
    NetworkMode?: string;
    PortBindings?: Record<string, { HostIp: string; HostPort: string }[]>;
    RestartPolicy?: { Name: string };
    CapDrop?: string[];
    SecurityOpt?: string[];
    ReadonlyRootfs?: boolean;
    Tmpfs?: Record<string, string>;
  };
  NetworkingConfig?: {
    EndpointsConfig: Record<string, { Aliases?: string[] }>;
  };
  OpenStdin?: boolean;
  Tty?: boolean;
  User?: string;
}
export interface DockerProvider {
  ping(): Promise<{
    Version: string;
    Arch: string;
    MemTotal: number;
    NCPU: number;
  }>;
  list(): Promise<ContainerSummary[]>;
  inspect(id: string): Promise<ContainerInfo>;
  create(name: string, spec: CreateContainer): Promise<string>;
  start(id: string): Promise<void>;
  stop(id: string, timeout?: number): Promise<void>;
  remove(id: string): Promise<void>;
  logs(id: string, tail?: number): Promise<string>;
  exec(id: string, args: string[]): Promise<string>;
  stats(id: string): Promise<DockerStats>;
  pull(image: string, onProgress?: (message: string) => void): Promise<void>;
  ensureNetwork(name: string): Promise<void>;
}
export const labels = (
  installation: string,
  serverId: string,
  kind = "minecraft-server",
) => ({
  "io.minemate.managed": "true",
  "io.minemate.server-id": serverId,
  "io.minemate.kind": kind,
  "io.minemate.installation": installation,
});
export function assertOwned(
  info: Pick<ContainerInfo, "Config">,
  installation: string,
  serverId: string,
  kind = "minecraft-server",
) {
  const expected = labels(installation, serverId, kind);
  if (Object.entries(expected).some(([k, v]) => info.Config.Labels?.[k] !== v))
    throw new AppError(
      "NOT_OWNED",
      "MineMate refuses to manage this container.",
      403,
    );
}
export function demux(buffer: Buffer): string {
  let offset = 0,
    out = "";
  if (buffer.length < 8 || buffer[1] !== 0 || buffer[2] !== 0)
    return buffer.toString("utf8");
  while (offset + 8 <= buffer.length) {
    const len = buffer.readUInt32BE(offset + 4);
    if (offset + 8 + len > buffer.length) return buffer.toString("utf8");
    out += buffer.subarray(offset + 8, offset + 8 + len).toString("utf8");
    offset += 8 + len;
  }
  return out;
}
export class Engine implements DockerProvider {
  constructor(private endpoint: string) {}
  private async request(
    method: string,
    resource: string,
    body?: unknown,
    timeout = 30000,
  ): Promise<Buffer> {
    const unix = this.endpoint.startsWith("unix://"),
      url = unix ? null : new URL(this.endpoint);
    return new Promise((resolve, reject) => {
      const client = url?.protocol === "https:" ? https : http;
      const req = client.request(
        {
          agent:
            url?.protocol === "https:" ? new https.Agent() : new http.Agent(),
          method,
          path: "/v1.49" + resource,
          socketPath: unix ? this.endpoint.slice(7) : undefined,
          hostname: url?.hostname,
          port: url?.port,
          headers: body ? { "content-type": "application/json" } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 32 * 1024 * 1024) {
              req.destroy(new Error("Docker response exceeds limit"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => {
            const value = Buffer.concat(chunks);
            if ((res.statusCode ?? 500) >= 400) {
              let message = "Docker request failed";
              try {
                message = (JSON.parse(value.toString()) as { message: string })
                  .message;
              } catch {
                /* retain generic error */
              }
              reject(
                new AppError(
                  "DOCKER",
                  message,
                  res.statusCode === 404 ? 404 : 502,
                ),
              );
            } else resolve(value);
          });
        },
      );
      req.setTimeout(timeout, () =>
        req.destroy(new Error("Docker request timed out")),
      );
      req.on("error", reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }
  private async json<T>(method: string, p: string, body?: unknown) {
    const data = await this.request(method, p, body);
    return (data.length ? JSON.parse(data.toString()) : undefined) as T;
  }
  async ping() {
    const [v, i] = await Promise.all([
      this.json<{ Version: string }>("GET", "/version"),
      this.json<{ Architecture: string; MemTotal: number; NCPU: number }>(
        "GET",
        "/info",
      ),
    ]);
    return {
      Version: v.Version,
      Arch: i.Architecture,
      MemTotal: i.MemTotal,
      NCPU: i.NCPU,
    };
  }
  list() {
    return this.json<ContainerSummary[]>("GET", "/containers/json?all=true");
  }
  inspect(id: string) {
    return this.json<ContainerInfo>(
      "GET",
      `/containers/${encodeURIComponent(id)}/json`,
    );
  }
  async create(name: string, spec: CreateContainer) {
    const result = await this.json<{ Id: string }>(
      "POST",
      "/containers/create?name=" + encodeURIComponent(name),
      spec,
    );
    return result.Id;
  }
  async start(id: string) {
    await this.request("POST", `/containers/${encodeURIComponent(id)}/start`);
  }
  async stop(id: string, timeout = 60) {
    await this.request(
      "POST",
      `/containers/${encodeURIComponent(id)}/stop?t=${timeout}`,
      undefined,
      (timeout + 15) * 1000,
    );
  }
  async remove(id: string) {
    await this.request(
      "DELETE",
      `/containers/${encodeURIComponent(id)}?force=false&v=false`,
    );
  }
  async logs(id: string, tail = 300) {
    return demux(
      await this.request(
        "GET",
        `/containers/${encodeURIComponent(id)}/logs?stdout=true&stderr=true&timestamps=true&tail=${Math.min(tail, 2000)}`,
      ),
    );
  }
  async exec(id: string, args: string[]) {
    const { Id } = await this.json<{ Id: string }>(
      "POST",
      `/containers/${encodeURIComponent(id)}/exec`,
      { AttachStdout: true, AttachStderr: true, Cmd: args },
    );
    const out = demux(
      await this.request(
        "POST",
        `/exec/${Id}/start`,
        { Detach: false, Tty: false },
        60000,
      ),
    );
    const state = await this.json<{ ExitCode: number }>(
      "GET",
      `/exec/${Id}/json`,
    );
    if (state.ExitCode !== 0)
      throw new AppError(
        "COMMAND_FAILED",
        "The server could not execute this command.",
        409,
        out.slice(0, 2000),
      );
    return out;
  }
  stats(id: string) {
    return this.json<DockerStats>(
      "GET",
      `/containers/${encodeURIComponent(id)}/stats?stream=false&one-shot=true`,
    );
  }
  async pull(image: string, onProgress?: (message: string) => void) {
    const response = await this.request(
      "POST",
      "/images/create?fromImage=" + encodeURIComponent(image),
      undefined,
      600000,
    );
    for (const line of response.toString().split("\n").filter(Boolean)) {
      const p = JSON.parse(line) as { error?: string; status?: string };
      if (p.error) throw new AppError("IMAGE_DOWNLOAD", p.error, 502);
      if (p.status) onProgress?.(p.status);
    }
  }
  async ensureNetwork(name: string) {
    try {
      await this.request("GET", "/networks/" + encodeURIComponent(name));
    } catch (e) {
      if (!(e instanceof AppError) || e.status !== 404) throw e;
      await this.request("POST", "/networks/create", {
        Name: name,
        Driver: "bridge",
        Internal: false,
        Labels: { "io.minemate.managed": "true" },
      });
    }
  }
}
