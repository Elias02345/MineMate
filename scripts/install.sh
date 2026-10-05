#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker version >/dev/null
docker compose version >/dev/null
mkdir -p data
minemate_data_root="$(cd data && pwd -P)"
minemate_lan_ip="$(hostname -I | awk '{print $1}')"
if [ -z "$minemate_lan_ip" ]; then
  printf 'Could not detect a LAN address. Set MINEMATE_LAN_IP in .env.\n' >&2
  exit 1
fi
if [ ! -e .env ]; then
  (umask 077; printf 'MINEMATE_HOST_DATA_PATH=%s\nMINEMATE_LAN_IP=%s\nMINEMATE_PORT=8080\nMINEMATE_IMAGE=minemate:0.1.0\n' "$minemate_data_root" "$minemate_lan_ip" > .env)
else
  if ! grep -q '^MINEMATE_HOST_DATA_PATH=' .env; then printf 'MINEMATE_HOST_DATA_PATH=%s\n' "$minemate_data_root" >> .env; fi
  if ! grep -q '^MINEMATE_LAN_IP=' .env; then printf 'MINEMATE_LAN_IP=%s\n' "$minemate_lan_ip" >> .env; fi
fi
# Resolve the actual Compose mount, including an existing custom .env setting.
# This utility needs only Docker; Node is supplied by the pinned build base image.
minemate_data_root="$(docker compose config --format json | docker run --rm -i --network none \
  --entrypoint node node:24.19.0-bookworm-slim -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const service = JSON.parse(input).services.minemate;
      const source = service.volumes.find(volume => volume.target === "/data" && volume.type === "bind")?.source;
      if (!source || !source.startsWith("/") || source === "/" || source !== service.environment.MINEMATE_HOST_DATA_PATH) {
        console.error("Set MINEMATE_DATA_PATH and MINEMATE_HOST_DATA_PATH to the same absolute data directory in .env.");
        process.exitCode = 1;
        return;
      }
      process.stdout.write(source);
    });
  ')"
# Only the new data root is adjusted; existing world files are never recursively changed.
docker run --rm --network none -v "$minemate_data_root:/data" alpine:3.22.1 chown 1000:1000 /data
docker compose up -d --build
printf 'MineMate is starting. Open your Docker host LAN address on port 8080.\n'
