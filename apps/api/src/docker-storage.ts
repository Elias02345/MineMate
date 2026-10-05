import os from "node:os";
import path from "node:path";
import type { DockerProvider } from "../../../packages/docker/src/index.ts";
import { AppError } from "../../../packages/shared/src/index.ts";

/** Discover the daemon-side bind source of this application's own data mount. */
export async function discoverHostDataRoot(
  docker: DockerProvider,
  dataRoot: string,
  hostname = os.hostname(),
) {
  if (!/^[a-f0-9]{12,64}$/.test(hostname))
    throw new AppError(
      "HOST_PATH",
      "Automatic data-path discovery requires the default Docker hostname. Set MINEMATE_HOST_DATA_PATH when overriding hostname.",
    );
  const container = await docker.inspect(hostname);
  if (!container.Id.startsWith(hostname))
    throw new AppError(
      "HOST_PATH",
      "Docker could not identify this MineMate container.",
    );
  const mount = container.Mounts?.find(
    (m) => m.Destination === path.resolve(dataRoot),
  );
  if (
    !mount ||
    mount.Type !== "bind" ||
    !mount.RW ||
    !path.isAbsolute(mount.Source) ||
    mount.Source === "/" ||
    mount.Source.includes("\0")
  )
    throw new AppError(
      "HOST_PATH",
      "Mount a writable host directory at /data, as shown in docker-compose.yml.",
    );
  return mount.Source;
}
