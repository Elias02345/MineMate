import { it, expect } from "vitest";
import http from "node:http";
import {
  Engine,
  type ContainerInfo,
  type DockerProvider,
} from "../packages/docker/src/index.ts";
import { discoverHostDataRoot } from "../apps/api/src/docker-storage.ts";

it("negotiates an older Docker API once across concurrent requests", async () => {
  const requests: string[] = [];
  const server = http.createServer((request, reply) => {
    requests.push(request.url!);
    reply.setHeader("content-type", "application/json");
    if (request.url === "/version")
      reply.end(JSON.stringify({ ApiVersion: "1.48", MinAPIVersion: "1.24" }));
    else if (request.url === "/v1.48/version")
      reply.end(JSON.stringify({ Version: "27.5.1" }));
    else if (request.url === "/v1.48/info")
      reply.end(
        JSON.stringify({ Architecture: "amd64", MemTotal: 1024 ** 3, NCPU: 2 }),
      );
    else if (request.url === "/v1.48/containers/json?all=true") reply.end("[]");
    else {
      reply.statusCode = 400;
      reply.end(JSON.stringify({ message: "client API is too new" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port,
      engine = new Engine(`http://127.0.0.1:${port}`);
    const [info, containers] = await Promise.all([
      engine.ping(),
      engine.list(),
    ]);
    expect(info.Version).toBe("27.5.1");
    expect(containers).toEqual([]);
    expect(requests.filter((p) => p === "/version")).toHaveLength(1);
    expect(requests.some((p) => p.startsWith("/v1.49"))).toBe(false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("discovers the daemon bind source instead of guessing a path inside the app", async () => {
  const hostname = "abcdef012345",
    docker = {
      inspect: async () => ({
        Id: hostname + "6789",
        Mounts: [
          {
            Type: "bind",
            Source: "/srv/minecraft/mine mate",
            Destination: "/data",
            RW: true,
          },
        ],
      }),
    } as unknown as DockerProvider;
  expect(await discoverHostDataRoot(docker, "/data", hostname)).toBe(
    "/srv/minecraft/mine mate",
  );
});
it.each([
  {
    Type: "volume",
    Source: "/var/lib/docker/volumes/data",
    Destination: "/data",
    RW: true,
  },
  { Type: "bind", Source: "/", Destination: "/data", RW: true },
  { Type: "bind", Source: "/srv/data", Destination: "/data", RW: false },
])(
  "rejects an unsupported or unsafe discovered data mount %#",
  async (mount) => {
    const hostname = "abcdef012345",
      docker = {
        inspect: async () => ({ Id: hostname + "6789", Mounts: [mount] }),
      } as unknown as DockerProvider;
    await expect(
      discoverHostDataRoot(docker, "/data", hostname),
    ).rejects.toThrow("Mount a writable host directory");
  },
);
it("refuses discovery from a different container identity", async () => {
  const docker = {
    inspect: async () => ({ Id: "another-container" }) as ContainerInfo,
  } as unknown as DockerProvider;
  await expect(
    discoverHostDataRoot(docker, "/data", "abcdef012345"),
  ).rejects.toThrow("identify");
});
