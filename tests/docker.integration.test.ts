import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Engine, labels, assertOwned } from "../packages/docker/src/index.ts";
it.skipIf(process.env.RUN_DOCKER_TESTS !== "1")(
  "controls an owned real container without touching foreign containers",
  async () => {
    const engine = new Engine(
        process.env.MINEMATE_DOCKER_ENDPOINT ?? "unix:///var/run/docker.sock",
      ),
      installation = randomUUID(),
      world = randomUUID();
    let id: string | undefined;
    try {
      const info = await engine.ping();
      expect(Number(info.Version.split(".")[0])).toBeGreaterThanOrEqual(25);
      await engine.pull("alpine:3.22.1");
      id = await engine.create("minemate-engine-test-" + world, {
        Image: "alpine:3.22.1",
        Cmd: ["sh", "-c", "echo controlled-engine-test; sleep 120"],
        Labels: labels(installation, world),
        HostConfig: {
          NetworkMode: "none",
          ReadonlyRootfs: true,
          Memory: 32 * 1024 ** 2,
          CapDrop: ["ALL"],
          SecurityOpt: ["no-new-privileges:true"],
        },
      });
      await engine.start(id);
      const container = await engine.inspect(id);
      assertOwned(container, installation, world);
      expect(container.State.Running).toBe(true);
      expect(() => assertOwned(container, "foreign", world)).toThrow();
      expect(await engine.exec(id, ["printf", "real exec works"])).toContain(
        "real exec works",
      );
      expect(await engine.logs(id)).toContain("controlled-engine-test");
      await engine.stop(id, 1);
      expect((await engine.inspect(id)).State.Running).toBe(false);
    } finally {
      if (id) {
        const container = await engine.inspect(id);
        assertOwned(container, installation, world);
        if (container.State.Running) await engine.stop(id, 1);
        await engine.remove(id);
      }
    }
  },
  120000,
);
