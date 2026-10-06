# Docker deployment

MineMate negotiates the Docker Engine API from v1.44 through v1.49. Docker 25+
supports the required calls. This implementation was tested against Engine 28.4.0. Compose uses a
non-root MineMate container with a read-only root, a bounded `/tmp`, all
capabilities dropped, and `no-new-privileges`.

Pinned images:

| Component              | Tag                                                     |
| ---------------------- | ------------------------------------------------------- |
| MineMate build/runtime | `node:24.19.0-bookworm-slim`                            |
| Java runtime           | `itzg/minecraft-server:2026.9.2-java<8/11/16/17/21/25>` |
| Bedrock runtime        | `itzg/minecraft-bedrock-server:2026.9.2`                |
| Socket proxy           | `tecnativa/docker-socket-proxy:v0.5.0`                  |
| Host-path probe        | `alpine:3.22.1`                                         |

Minecraft containers run as 1000:1000 and have only their own server directory
mounted. RCON is internal and is never published. The public game port belongs
to an owned MineMate gateway sidecar. Java uses TCP; Bedrock uses UDP. RAM and
CPU limits apply to the Minecraft container. Java reserves 512 MB beyond its
selected heap for JVM/native overhead.

The socket-proxy network is internal and its port is not published. Only
container/image/network/exec/info/version calls and required mutations are
allowed. An administrator who can create Docker containers still has a powerful
host-equivalent capability; the socket proxy reduces exposed endpoints but is
not a complete Docker authorization boundary. Do not expose it to a LAN or the
Internet. See [security](SECURITY.md).

## Install the published image

Download `docker-compose.yml` and `default.env.example` from the
[v0.4.2 release](https://github.com/Elias02345/MineMate/releases/tag/v0.4.2).
Rename `default.env.example` to `.env` and set `MINEMATE_LAN_IP` to the Docker host's
LAN address. These are the only files needed for deployment:

```sh
docker compose up -d --wait
```

Production Compose uses `ghcr.io/elias02345/minemate:0.4.2` and contains no build
context. Pulls are public and need no registry login. The release workflow verifies
an anonymous pull before publishing its downloadable configuration files.

Ready-to-load amd64 and arm64 image archives are available for the older 0.3.0
release; they do not include the wizard fix or the new management controls. See [the archive installation guide](IMAGE_ARCHIVES.md) for a verified
`docker load` installation when the registry publishing service is delayed.

`prepare-data` runs once without network access and changes only the root of the
data bind to UID/GID 1000. Existing world contents are not recursively changed.
MineMate waits for this operation and the private socket proxy's health check,
then starts with a read-only root and all capabilities dropped.

The default data bind is `./data`. MineMate discovers its daemon-side source by
inspecting its own container's `/data` mount. The normal Docker hostname must be
preserved for this discovery. With a custom hostname, explicitly set
`MINEMATE_HOST_DATA_PATH` to the matching absolute bind source. Named volumes are
not supported for the Minecraft directory contract; use a bind directory.

Set `MINEMATE_DATA_PATH` for another host directory, `MINEMATE_PORT` for another
web port and `MINEMATE_BIND_ADDRESS` to restrict exposed listeners. Multi-interface
or VPN hosts must use the address friends can actually reach. Separate instances
on one Docker host need distinct data directories, web ports, game port ranges and
`MINEMATE_SERVER_NETWORK` values.

A moved installation discovers its new host path on startup. The sentinel still
refuses mismatched mounts; automatic discovery never disables that proof. A remote
Docker daemon must see the bind source on its own host.

For HTTPS behind a trusted reverse proxy, enable `MINEMATE_SECURE_COOKIES` and
`MINEMATE_TRUST_PROXY`, forward WebSockets and preserve Host/Origin. The default
HTTP configuration is intended for a trusted private LAN.

## Update and recover

Back up the full data directory before changing MineMate versions. Set
`MINEMATE_IMAGE` in `.env` to the selected published version, then run:

```sh
docker compose pull
docker compose up -d --wait
```

Tagged releases also publish `latest`, but explicit version tags make upgrades
and rollback reviewable. Database migrations are transactional; do not downgrade
across an incompatible migration without the matching data backup. Stopping
Compose does not stop the independent Minecraft containers; stop worlds first
when preparing a full installation backup.

## Build from source for development

Source builds use a separate override, never the production install path:

```sh
git clone https://github.com/Elias02345/MineMate.git
cd MineMate
cp .env.example .env
# Set MINEMATE_LAN_IP in .env.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait
```

The override builds `minemate:dev` and uses that same image for gateway sidecars.
`npm run test:compose` exercises the production Compose definition with an
already-built test image, a disposable directory and project, actual socket proxy,
automatic host-path discovery and persisted authentication after recreation.
It never accepts a Minecraft EULA.

The cloud build can optionally mount trusted proxy settings/CA as BuildKit secrets
`proxyenv` and `proxyca`; they are excluded from the image and TLS stays verified.
Normal hosts need neither. The onboarding cloud daemon has a separate filesystem
namespace and uses VFS; disposable runtime data is not part of workspace snapshots.

## Publish a release

The maintainer updates `package.json` and the Compose/default image versions, then
pushes the matching `v<version>` Git tag. CI checks types, lint, tests, real Docker,
production Compose, persistence and browser flows. Native amd64 and arm64 runners
build images and publish their digests. The publish job creates the version and
`latest` manifests, checks an anonymous pull and uploads the Compose release assets.

If GHCR creates a private package, set the
[MineMate package](https://github.com/users/Elias02345/packages/container/minemate/settings)
to **Public**, then rerun the publish job if its anonymous-pull check failed. Later
releases keep the package visibility. Never distribute registry credentials in
Compose, `.env` examples or application images.

## External services

Java downloads use Mojang, Paper, Purpur and loader Maven APIs. Bedrock uses the
official Minecraft download-links service and the official binary URL. Minecraft
account services must be reachable for authenticated gameplay. Version and
marketplace outages do not block local stop, files or backup management.

CurseForge API access and S3 credentials are optional. Some CurseForge authors
forbid API downloads; MineMate explains the restriction and permits a confirmed
manual upload. Native Bedrock supports amd64; MineMate does not substitute an
unofficial ARM binary.

## Web UI host port

The default published port is 18080: open `http://HOST-IP:18080`. The container's
internal port is 8080. Set `MINEMATE_PORT` in `.env` to choose another host port.
When upgrading from 0.2.0, change any existing `MINEMATE_PORT=8080` entry explicitly
to `MINEMATE_PORT=18080`; existing environment values take precedence over defaults.
