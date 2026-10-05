# MineMate

A self-hosted Minecraft home for your worlds and friends. MineMate manages real,
separate Docker containers for Java and Bedrock, with an English/German landscape
interface, guided setup, an inventory, configuration books and recovery chests.

![MineMate world overview](docs/screenshots/server.png)

## Install on a Linux Docker host

Requirements: Docker Engine 25 or newer, Docker Compose v2, at least 4 GB host RAM
for a small Java world, and writable local storage. Bedrock requires amd64. Run:

```sh
git clone https://github.com/Elias02345/MineMate.git
cd MineMate
./scripts/install.sh
```

The installer builds the pinned MineMate image, prepares `data/`, detects the LAN
address, and starts Compose. Open the Docker host's LAN address on port 8080.
Create the installation owner, then use **Create a world**. Each server requires
an explicit Minecraft EULA acceptance; MineMate never accepts it on your behalf.
The first registration closes public account creation. The owner can add members
and grant individual world permissions.

The installer builds the application image from this repository. No registry
release has been published. The included CI builds a release image when a `v*`
tag is pushed. See the validation record for tested runtimes and known limits.

For another data directory, set both `MINEMATE_DATA_PATH` (Compose mount source)
and the absolute `MINEMATE_HOST_DATA_PATH` in `.env`. See [Docker deployment](docs/DOCKER.md).
Do not point MineMate at a production Minecraft directory for initial testing.

## Use

- Create Java Vanilla, Paper, Purpur, Fabric, Forge, NeoForge or trusted Custom JAR
  worlds, or official Bedrock worlds. The wizard chooses a suitable Java runtime.
- Start, stop, restart or sleep worlds; watch actual protocol readiness, resource
  samples, players and bounded console logs. Commands go to Minecraft.
- Change grouped settings, resources, ports and idle sleep through forms.
- Search Modrinth or CurseForge, preview compatible versions/dependencies, install
  verified downloads, import server modpacks and upload trusted JARs.
- Pack, download and restore verified full-server ZIP backups. Set retention,
  scheduled backups or an optional S3 destination. Recovery precedes mutations.
- Use Advanced Mode for files, syntax-highlighted configuration editing, diffs,
  permission grants, loader versions and JVM flags.
- Copy the LAN target into CloudGate for optional external access. Bedrock needs
  a UDP-capable tunnel. No CloudGate account is required for LAN use.

CurseForge requires an administrator's API key. S3 requires a bucket and
credentials. Configure both graphically; keys are encrypted and never returned
in API responses. Modrinth and local management need neither integration.

## Development and verification

Node 24.19.0 and npm are required.

```sh
npm ci
npm run check
npm run test:docker         # disposable real Docker Engine test
npm run test:e2e            # controlled Minecraft protocol/browser fixtures
npm run dev                # backend
npm run dev:web            # frontend, in a second terminal
```

`npm run check` runs strict type checking, lint, unit/API tests and both production
builds. Browser fixtures explicitly identify their runtime as a test fixture.
Production code never creates example worlds or fabricated metrics.

Read [validation evidence](docs/VALIDATION.md) for the exact real-runtime coverage
and remaining integration limitations. Real Minecraft tests are opt-in and need
explicit EULA authorization; CI never needs Mojang downloads.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Data layout](docs/DATA_LAYOUT.md) ·
[Docker](docs/DOCKER.md) · [Backups](docs/BACKUPS.md) ·
[CloudGate](docs/CLOUDGATE.md) · [Security](docs/SECURITY.md) ·
[Development](docs/DEVELOPMENT.md) · [Validation](docs/VALIDATION.md)

The artwork is centralized in `packages/ui`: replaceable SVG pixel assets,
landscape layers, tokens, components and optional synthesized sound. Sound is
muted by default. Reduced motion and reduced effects are supported.
