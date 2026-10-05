# Docker deployment

MineMate uses the Docker Engine HTTP API v1.49. Docker 25+ supports the required
calls. This implementation was tested against Engine 28.4.0. Compose uses a
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

## Prepare a host

`./scripts/install.sh` writes `.env`, determines the canonical `data` path,
detects the LAN IP and starts Compose. Existing `.env` keys are preserved. Review
LAN detection on machines with VPNs or multiple interfaces. Set
`MINEMATE_LAN_IP` to the address friends can actually reach. Override
`MINEMATE_GAME_BIND_ADDRESS` through Compose's `MINEMATE_BIND_ADDRESS` to limit
published listeners.

A moved installation needs both the new bind source and new absolute host path.
MineMate refuses creation when the host-path sentinel does not match. A remote
Docker daemon needs storage shared at the configured host path; mounting a
similarly named directory inside MineMate is insufficient.

For HTTPS behind a trusted reverse proxy, enable `MINEMATE_SECURE_COOKIES` and
`MINEMATE_TRUST_PROXY`, configure WebSocket forwarding and preserve the public
Host/Origin. Trust only the reverse proxy that owns the ingress. The default
HTTP configuration is intended for a trusted private LAN.

## Build and update

```sh
docker compose build
docker compose up -d
```

Published releases can set `MINEMATE_IMAGE=ghcr.io/elias02345/minemate:<version>`
then use `docker compose pull` and `docker compose up -d`. Such a release has not
been published by this task. Never rely on a mutable `latest` tag for rollback.
Back up the complete data directory before changing MineMate releases. Database
migrations are numbered and transactionally applied; do not downgrade across an
incompatible migration without restoring the matching data copy.

A cloud build can optionally mount trusted proxy settings/CA as BuildKit secrets
`proxyenv` and `proxyca`. Those files are not copied into the image. TLS remains
verified. Normal hosts need neither secret. The cloud Docker daemon used here has
a separate filesystem namespace and an unusually expensive VFS storage driver;
its disposable runtime data is not part of a workspace snapshot.

## External services

Java downloads use Mojang, Paper, Purpur and loader Maven APIs. Bedrock uses the
official Minecraft download-links service and the official binary URL. Minecraft
account services must be reachable for authenticated gameplay. Version and
marketplace outages do not block local stop, files or backup management.

CurseForge API access and S3 credentials are optional. Some CurseForge authors
forbid API downloads; MineMate explains the restriction and permits a confirmed
manual upload. Native Bedrock supports amd64; MineMate does not substitute an
unofficial ARM binary.
