import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const execute = promisify(execFile),
  project = "minemate-smoke-" + randomUUID().slice(0, 8),
  directory = await mkdtemp(path.join(os.tmpdir(), project + "-"));
const configFile = path.join(directory, "docker-compose.yml"),
  dataPath = path.join(directory, "data");
const listener = net.createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = (listener.address() as net.AddressInfo).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const image = process.env.MINEMATE_TEST_IMAGE ?? "minemate:compose-test",
  env = {
    ...process.env,
    MINEMATE_IMAGE: image,
    MINEMATE_LAN_IP: "192.168.1.50",
    MINEMATE_PORT: String(port),
    MINEMATE_BIND_ADDRESS: "127.0.0.1",
    MINEMATE_DATA_PATH: dataPath,
    MINEMATE_HOST_DATA_PATH: "auto",
    MINEMATE_SERVER_NETWORK: project + "-worlds",
  };
const compose = ["compose", "--project-name", project, "--file", configFile],
  base = `http://127.0.0.1:${port}`;
async function docker(args: string[]) {
  return (
    await execute("docker", args, { env, maxBuffer: 2 * 1024 ** 2 })
  ).stdout.trim();
}
async function request(
  endpoint: string,
  body?: unknown,
  cookie?: string,
  csrf?: string,
) {
  const response = await fetch(base + "/api/v1/" + endpoint, {
    method: body ? "POST" : "GET",
    headers: {
      origin: base,
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert(response.ok, `API ${endpoint}: ${response.status}`);
  return { response, value: await response.json() };
}
async function ready() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      if ((await request("health")).value.ok) return;
    } catch {
      /* startup or recreation */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Compose application did not become ready");
}
await writeFile(
  configFile,
  await readFile(path.resolve("docker-compose.yml"), "utf8"),
);
try {
  const configuration = JSON.parse(
    await docker([...compose, "config", "--format", "json"]),
  );
  assert(
    !configuration.services.minemate.build,
    "Production Compose must use a prebuilt image",
  );
  await docker([
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
  ]);
  await ready();
  const containerId = await docker([...compose, "ps", "--quiet", "minemate"]),
    inspection = JSON.parse(await docker(["inspect", containerId]))[0];
  assert.equal(inspection.Config.User, "node");
  assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
  assert.equal(inspection.State.Health.Status, "healthy");
  const source = inspection.Mounts.find(
    (mount: { Destination: string }) => mount.Destination === "/data",
  ).Source;
  assert.equal(source, dataPath);
  assert.equal((await request("auth/status")).value.setupRequired, true);
  const owner = await request("auth/bootstrap", {
      username: "ComposeOwner",
      password: randomBytes(24).toString("base64url"),
    }),
    cookie = owner.response.headers.get("set-cookie")!.split(";")[0]!,
    csrf = owner.value.csrf;
  const checks = (await request("system/checks", undefined, cookie)).value;
  assert(checks.ready, JSON.stringify(checks.checks));
  assert.equal((await request("servers", undefined, cookie)).value.length, 0);
  await docker([
    ...compose,
    "up",
    "--detach",
    "--no-deps",
    "--force-recreate",
    "minemate",
  ]);
  await ready();
  const restored = (await request("auth/status", undefined, cookie)).value;
  assert.equal(restored.setupRequired, false);
  assert.equal(restored.user.id, owner.value.user.id);
  assert((await request("system/checks", undefined, cookie)).value.ready);
  await request("auth/logout", {}, cookie, csrf);
  assert.equal(
    (await request("auth/status", undefined, cookie)).value.user,
    null,
  );
  console.log(
    "Compose smoke passed: prebuilt image, automatic root ownership and bind discovery, non-root/read-only runtime, actual socket proxy, host proof, owner/session persistence after recreation. No Minecraft EULA was accepted.",
  );
} catch (error) {
  process.stderr.write(
    await docker([...compose, "logs", "--no-color", "--tail", "80"]).catch(
      () => "",
    ),
  );
  throw error;
} finally {
  await docker([...compose, "down", "--timeout", "20"]);
  assert(
    dataPath.startsWith(path.join(os.tmpdir(), project + "-")) &&
      dataPath.endsWith("/data"),
  );
  await docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--volume",
    dataPath + ":/data",
    "alpine:3.22.1",
    "sh",
    "-c",
    "find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
  ]);
  await rm(directory, { recursive: true, force: true });
}
