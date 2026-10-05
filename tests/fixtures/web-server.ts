import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../apps/api/src/app.ts";
import { loadConfig } from "../../apps/api/src/config.ts";
import { FixtureDocker } from "./docker.ts";
import { fixtureProtocol } from "./protocol.ts";
const root = await mkdtemp(path.join(os.tmpdir(), "minemate-e2e-")),
  protocol = await fixtureProtocol();
const instance = await createApp({
  config: loadConfig({
    MINEMATE_DATA_PATH: root,
    MINEMATE_HOST_DATA_PATH: root,
    MINEMATE_PORT: "8091",
    MINEMATE_DISABLE_GATEWAY: "true",
    MINEMATE_LAN_IP: "192.168.1.50",
    MINEMATE_JAVA_PORT_START: "65000",
  }),
  docker: new FixtureDocker(),
  logger: false,
});
instance.updates.versions = async () => ({
  recommended: "1.21.1",
  versions: ["1.21.1", "1.20.4"],
});
await instance.app.listen({ host: "127.0.0.1", port: 8091 });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void instance.app.close().then(async () => {
      protocol.close();
      await rm(root, { recursive: true, force: true });
      process.exit(0);
    });
  });
