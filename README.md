# MineMate

A self-hosted Minecraft home for your worlds and friends. MineMate manages real,
separate Docker containers for Java and Bedrock, with an English/German landscape
interface, guided setup, an inventory, configuration books and recovery chests.

![MineMate world overview](docs/screenshots/server.png)

## ATM10 8.2 startup and retry · 0.4.7

The complete official `ServerFiles-8.2.zip` with 464 mods now imports as an
ATM world and starts with Minecraft 1.21.1 and NeoForge 21.1.251. MineMate
reserves memory outside the Java heap for large mod loaders: the default 8 GiB
heap receives a 12 GiB Docker limit. An 8.5 GiB limit killed this exact pack
during startup; 12 GiB reached Minecraft readiness in a real server test.
Failed ATM imports now show their original cause, restore the uninstalled
world correctly, and retain the checked ZIP for a retry without sending the
same gigabytes again. See [upload guidance](docs/UPLOADS.md#import-an-all-the-mods-server-pack).

## ATM packs with duplicated JAR resources · 0.4.6

Some valid mods, including `ars_nouveau-1.21.1-5.13.1.jar`, contain repeated
license and notice files inside the JAR. MineMate now verifies that repeated
entries have identical contents and accepts the original JAR automatically.
You can upload the complete ATM ServerFiles ZIP without editing the mod. If an
earlier upload left a world in the creation wizard, select the ZIP again and
retry there; MineMate uses the same world. Conflicting entries and duplicate
paths in the outer ServerFiles ZIP still fail validation.

## One-step ATM setup · 0.4.5

In the Java world creator, choose **All the Mods (ATM)** and upload the official
**ServerFiles ZIP**. MineMate discovers the Minecraft and Forge/NeoForge versions
from the bundled installer, validates the mods, imports the pack and starts the
server. There is no separate version, server JAR or mod selection. Choose the
server's memory, accept the Minecraft EULA and give the world a name. See
[the upload guide](docs/UPLOADS.md#import-an-all-the-mods-server-pack).

## All the Mods server packs · 0.4.4

Import an official Forge or NeoForge **ServerFiles ZIP** directly through the
modpack step in the creation wizard or an existing Java world's Inventory.
MineMate detects the bundled installer, Minecraft and loader versions, verifies
each mod JAR (including NeoForge Jar-in-Jar containers), and installs the mods,
configuration and KubeJS content with a recovery point. Host startup scripts,
JVM options and EULA files in the pack are ignored. The official ATM-11
0.10.0-beta server ZIP with 258 mods passed the complete import fixture; see
[the upload guide](docs/UPLOADS.md#import-an-all-the-mods-server-pack).

## Clear mod upload errors and quick retries · 0.4.3

During Java world creation, a rejected mod JAR now appears by filename with a
specific reason. Forge and NeoForge installers accidentally placed in the mod
batch are identified and directed to Server installation. After removing an
invalid JAR, retrying the batch reuses the already transferred files and checks
their hashes again, so a large modpack does not need another full transfer.

## Reliable large uploads · 0.4.2

Bulk mods, plugins, world folders and multi-GB modpack archives now transfer in
1 MiB checked parts. MineMate resumes interrupted sessions, verifies complete
files before installation and keeps the server running until every selected
file passes validation. The browser shows the current file during transfer and
checking. The 512 MiB per-file browser limit is gone; the 20 GiB total and safe
archive expansion limits remain. See [the upload guide](docs/UPLOADS.md).

## Large upload batches · 0.4.1

Mod, plugin and ordinary file uploads no longer have a fixed file-count limit.
Select complete mod collections in the creation wizard or add them later from
Inventory. World folder selection also removes the previous 10,000-file cap.
Large streamed uploads no longer expire after 30 seconds; duplicate names and
invalid JARs still reject the whole batch before replacing content. See
[the upload guide](docs/UPLOADS.md) for byte and archive limits.

## Console, players and sharing · 0.4.0

Open a world and use its browser console for live logs and commands. Common
commands have buttons for player lists, saving, day/night, weather and difficulty;
broadcast a message through a form. Search logs and recall commands with the
arrow keys. Controls are disabled while the server is offline.

Players now shows a graphical whitelist/allowlist, operators and bans with
removal actions. A switch saves the guest-list setting with a recovery point
and restart of an online server. Bedrock allowlist actions support gamertags
containing spaces.

Play together provides a copyable Minecraft invitation and a visible link to
management sharing. World permissions no longer requires advanced mode; choose
a member, use view/operator presets or individual permissions, and save or revoke
access. Clipboard copying also works on ordinary HTTP LAN deployments. See
[the management guide](docs/ADMINISTRATION.md).

## Complete upload flows · 0.3.1

Dialogs keep their heading and action buttons visible while the form scrolls.
Server controls, tabs, forms, inventory and file actions wrap at small widths;
long names fit mobile layouts and short laptop windows.

Choose the server software and either automatic download or your own server JAR
in the creation wizard. Forge and NeoForge use their installer JARs; directly
executable JARs use the custom launch flow. Server software can also be uploaded
later from Inventory. The wizard now has a separate, optional bulk-upload step
for mods (Fabric, Forge, NeoForge and Custom) or plugins (Paper and Purpur).
Choose several JARs together, add more or remove individual files before creation.
They are installed into `mods/` or `plugins/`, with a recovery point and rollback.
Custom Java servers can also receive manual mod JARs.

Saved worlds can be selected as a complete folder, ZIP, or Bedrock `.mcworld`.
Relative folder paths and nested ZIP wrappers are handled, dimensions are retained,
and a wrong-edition or incomplete world is rejected. Imports protect the previous
world and restore it if startup fails. Upload progress follows the actual transfer
and operation completion. See [the upload guide](docs/UPLOADS.md).

The default **host** port is **18080**. The container continues listening on 8080.

## Adventure UI · 0.2.0

A detailed pixel landscape, inventory-style navigation, beveled wood and stone
controls, floating items, fireflies, crafting animations and celebration particles
bring the entire interface into the world. All management screens support English
and German and fit desktop and mobile layouts.

Alex, a Creeper, a pig and a bee wander along the bottom of the interface. Click a
friend to play, drag them around, or focus them and use the arrow keys. They react
to the current view: tools in the workshop, treasure near backups, portal effects
in networking, and a happy dance when an operation finishes. Their own strip keeps
the management controls accessible. The companion menu can pause, celebrate or
hide them; Settings can bring them back.

Enable the sound button for original synthesized clicks, chest sounds, portal
tones, character reactions and quiet ambient chords. Separate volume controls,
instant mute, zero-volume silence and reduced visual effects are supported.
Sound starts muted. OS reduced-motion preferences also stop decorative movement.
Assets and fonts are served locally; see [the UI guide](docs/ADVENTURE_UI.md).

To upgrade an existing installation, set
`MINEMATE_IMAGE=ghcr.io/elias02345/minemate:0.4.7` and `MINEMATE_PORT=18080` in your
existing `.env`, then run `docker compose pull` and `docker compose up -d --wait`.
Keep your existing data directory and LAN settings. Open `http://HOST-IP:18080`.
An older `.env` with `MINEMATE_PORT=8080` keeps that port until you change it.

The older 0.3.0 release also provides Docker image archives for offline
installation. Those archives do not include the wizard fix or the new management controls. See
[the image archive guide](docs/IMAGE_ARCHIVES.md).

## Install with Docker Compose

Requirements: Docker Engine 25+ and Docker Compose v2 on a Linux host. Plan at
least 4 GB RAM for a small Java world. The MineMate image supports amd64 and arm64;
native Bedrock requires amd64.

Download just the two configuration files from the release:

```sh
mkdir minemate
cd minemate
curl -fL -o docker-compose.yml https://github.com/Elias02345/MineMate/releases/download/v0.4.7/docker-compose.yml
curl -fL -o .env https://github.com/Elias02345/MineMate/releases/download/v0.4.7/default.env.example
```

Set **MINEMATE_LAN_IP** in `.env` to your Docker host's LAN address, then start:

```sh
docker compose up -d --wait
```

Compose downloads **ghcr.io/elias02345/minemate:0.4.7**. You do not need Git, Node,
source code or a local image build. The one-shot `prepare-data` service adjusts
only the data directory's owner, then the non-root MineMate service starts. It
reads the actual host bind path from Docker and verifies it with a sentinel.
Your worlds, accounts, secrets and backups live under `./data`.

Open your Docker host's LAN address on port **18080**, create your owner account,
and choose **Create a world**. Each world requires explicit Minecraft EULA
acceptance. First registration closes public signup; the owner adds members and
per-world permissions. No Minecraft server starts during Compose installation.

For another data directory, change `MINEMATE_DATA_PATH` in `.env`. The matching
absolute Docker host path is discovered automatically. See [Docker deployment](docs/DOCKER.md)
for reverse proxies, upgrades and custom configuration.

```sh
docker compose logs -f minemate    # startup and application logs
docker compose down               # stop MineMate; keep ./data
```

Minecraft containers are independent: stop worlds in the UI before stopping the
whole installation or copying its data. See [data layout](docs/DATA_LAYOUT.md).

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
