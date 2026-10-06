# Validation record

Validated in the Codex cloud environment on 2026-10-05. The published cloud
environment restores the implementation, dependency cache, build artifacts and
Docker images. The release pipeline publishes versioned multi-architecture images and checks public pulls before creating the downloadable Compose release.

The [v0.1.0 release](https://github.com/Elias02345/MineMate/releases/tag/v0.1.0)
publishes `ghcr.io/elias02345/minemate:0.1.0` and `latest` with native amd64 and
arm64 builds. The [release workflow](https://github.com/Elias02345/MineMate/actions/runs/37333092514)
passed, including an anonymous image pull. An independent anonymous pull,
byte-for-byte public release download checks and the full production Compose
smoke against that published amd64 image also pass. GitHub names the environment
asset `default.env.example`; download it as `.env`.

## Resumable multi-GB uploads (0.4.2)

On 2026-10-06, strict TypeScript, lint, 72 unit/API checks and production builds
pass. A checked upload session accepts 464 separately acknowledged files without
the previous 300-request/minute route limit; an interrupted chunk resumes from
its stored offset, a checksum mismatch is rejected, and an unchanged finished
session returns the same installation operation. A separate large-file run
transferred and verified 513 MiB in 513 one-MiB requests, beyond the old
512-MiB per-file browser cap. The browser test deliberately breaks one chunk
request and verifies automatic retry and successful mod installation.
All 17 browser tests pass, including the NeoForge wizard's 201-mod upload and
121 later mods, the 201-plugin Paper wizard, and native world-folder import.
A Modrinth `.mrpack` also installs through the session path, applying server
overrides while excluding client overrides.

The browser transfers every file before validating archives/JARs and then
starts one recovery-protected installation. Per-chunk and whole-file SHA-256
checks catch both connection errors and mixed content after reselection.
Sessions survive browser reload or server restart, and stale sessions expire
after 48 hours. Multi-GB archives remain subject to the 20-GiB aggregate and
archive expansion guards. The local 0.4.2 Docker image builds and passes the
production Compose smoke with host port 18080, non-root service, socket proxy,
host bind proof and persistent login after recreation.

## Large upload batches (0.4.1)

On 2026-10-06, strict TypeScript, lint, all 69 unit/API checks and production
builds pass. The upload API accepts 1,001 Fabric mod JARs, 1,001 Paper plugin
JARs and 1,001 ordinary files per request, exceeding both the old 100-file cap
and the multipart parser's default 1,000-part cap. JAR batches make one recovery
point and return an originally running server to RUNNING. A 151-file batch
whose last JAR is invalid leaves the running server untouched, cleans all
staging files and accepts the corrected 150-file retry. A native world-folder
upload with 10,001 files preserves the last region file's relative path.

All 16 browser tests pass. The NeoForge creation flow selects 201 mods in two
selections alongside its server installer, then uploads another 121 mods through
Inventory and verifies all 322 entries. The Paper wizard installs 201 plugins.
Existing atomic retries, server/world upload separation, management controls and
four viewport checks also pass. These use controlled runtime/JAR fixtures;
earlier real Minecraft coverage is recorded below.

Uploads stream to staging without fixed file/part counts or a 30-second request
deadline. Duplicate checks use sets as collections grow. Ordinary-file uploads
also create missing destination directories. Existing byte limits, path checks,
JAR validation, archive expansion checks and recovery behavior remain in place.
The UI host port stays 18080; Docker's internal port stays 8080.
The production 0.4.1 image builds and passes a fresh Compose smoke for the
private socket proxy, automatic data ownership/bind discovery, non-root/read-only
startup and owner/session persistence after recreation.

## Console, players and sharing (0.4.0)

On 2026-10-06, strict TypeScript, lint, all 65 unit/API checks and production
builds pass. Two added route-level tests verify Java player-name and whitelist
validation, Bedrock allowlist commands with quoted spaces/international names,
edition restrictions and explicit confirmation. Existing permission coverage
also denies player-list reads to a view-only member.

The production 0.4.0 Docker image builds and passes a fresh Compose smoke for
non-root/read-only startup, automatic data ownership/bind discovery, socket proxy
and owner/session persistence after recreation. All 16 browser tests pass. The new browser flows exercise console shortcuts, difficulty, announcements,
slash-prefixed free commands/history, graphical Java whitelist add/remove and
its persisted setting after a backed-up restart. Sharing coverage creates a
member through the UI, grants the management preset, signs in separately to use
the console, verifies settings/grant controls remain inaccessible, revokes
access and verifies API denial and disappearance from the dashboard. Invitation
copying also exercises the fallback used when the secure clipboard API is
absent on a normal HTTP LAN deployment. The existing viewport checks cover the
expanded console, player lists and visible permission controls.

Console commands and player actions still use the owned Minecraft runtime, with
authentication and per-world permission checks. New Bedrock allowlist routing is
verified at the API boundary; no new live Bedrock account-service test or game
client join was performed. Live runtime coverage below remains the earlier
0.3.0 validation. Production UI host port remains 18080, with container port 8080.

The complete [0.3.1 release workflow](https://github.com/Elias02345/MineMate/actions/runs/37440272376)
passes all checks, native amd64/arm64 image publication and public configuration
verification. An independent anonymous cloud pull of `0.3.1` also passes. That
release contains the wizard fix; the 0.4.0 management controls are added separately.

## Creation wizard mod uploads (0.3.1)

On 2026-10-06, strict TypeScript, lint, all 63 unit/API checks and production
builds pass. The production Docker image builds, and a fresh Compose smoke
passes automatic ownership/bind discovery, the private socket proxy, non-root
read-only startup and owner/session persistence after recreation. The creation wizard offers a separate optional bulk-JAR step for
Fabric, Forge, NeoForge and Custom, including uploaded server JARs; Paper/Purpur
use plugins, and Vanilla/Bedrock skip the step. Server, world and content uploads
run sequentially, with manual content last.

All 14 browser tests pass. Browser coverage creates NeoForge with its installer and three mods chosen in the
wizard, then adds another mod from Inventory. A Custom server test uploads a
server JAR and saved-world ZIP, rejects an invalid member of a two-mod batch
without installing either mod, corrects the selection and retries only that
batch. It verifies one server creation, one server/world upload, the executable
at the server root, mod content in `mods/`, and intact imported world bytes.
Paper receives two plugins in `plugins/`. Other checks cover duplicate names,
non-JAR selections, software changes clearing mods, and the Vanilla/Bedrock step
sequence. Each viewport test covers the additional step and reachable actions.
The fixture models independent clients using trusted test-only forwarded
addresses so the fast suite does not share one production IP request quota;
production rate limits and proxy defaults are unchanged.

This release changes the creation UI and reuses the existing, previously tested
JAR/import backend. No new live Minecraft client or server run was performed for
this wizard fix. The actual NeoForge/mod/world runtime coverage below belongs
to 0.3.0.

## Adventure UI checks (0.2.0)

The visual upgrade passes strict type checking, lint, 51 unit/API checks and five
browser tests. The added browser coverage checks actual wandering, pointer and
keyboard interaction, scene-dependent companion responses, persisted visibility,
Web Audio opt-in, immediate mute, zero-volume silence and persisted reduced-effects
settings. Every server tab fits the 390-pixel mobile viewport. With either OS or
application reduced motion, decorative animations stop and companions stay usable.
The detailed results below retain the initial real-Minecraft backend coverage;
the UI upgrade does not require starting new Minecraft servers.

## Automated checks

For 0.3.0, the final local checks below pass. GitHub's hosted-runner assignment
failed during its reported Actions incident: the checks job received no runner
after multiple attempts, and the native image/publish jobs were skipped. Both
main and tag workflows were retried. This infrastructure failure is separate
from the earlier combined-viewport browser-test timeout, resolved by checking
each viewport independently with the same assertions.

Ready-to-load amd64 and arm64 Docker image archives are supplied as an alternate
release installation. The amd64 archive contains the tested production image.
The arm64 archive combines the official arm64 Node base with the same production
app/dependencies and supplied arm64 native modules. Its actual arm64 Node runtime
passes the full Compose ownership/proxy/bootstrap/session persistence smoke
through a test-only QEMU wrapper; the emulator is excluded from the archive.
The final [0.3.0 release workflow](https://github.com/Elias02345/MineMate/actions/runs/37370473091)
passes after retry: all checks, native amd64/arm64 builds, manifest publication,
anonymous pull and public configuration-download verification. Version `0.3.0`
and `latest` are public on GHCR. An independent anonymous cloud pull confirms
both CPU architectures and the immutable tag's source revision; public Compose
and environment downloads match the repository. The published amd64 image
passes a fresh full production Compose/persistence smoke. See [the image archive
guide](IMAGE_ARCHIVES.md) for the additional offline installation option.

Independent public downloads of both image archives, Compose, the environment
example, installation guide and checksums match the prepared files byte for byte.
Archive metadata confirms each CPU architecture, image tag and source revision.
The exported amd64 archive also loads back into Docker and passes a fresh
production Compose smoke. Direct-download artifacts are on the separate
`docker-images-v0.3.0` branch because the cloud GitHub asset-upload path rejected
uploads with `Bad Content-Length`; Git publication and anonymous downloads work.

- Strict TypeScript, ESLint and production frontend/backend builds pass.
- 63 unit and API integration checks pass, covering permissions, bootstrap races,
  session revocation, migrations, ZIP/path validation, dependencies, hashes,
  bounded download failures, closed sockets, stale edits, imported content and
  restoring world bytes, inventory, resources and the original LAN port.
  Upload coverage includes atomic multi-JAR validation, installer loader/version
  checks, Java and Bedrock folder imports, nested ZIP worlds, dimension files,
  traversal rejection and recovery after a failed imported-world startup.
- The default suite skips its opt-in Docker test. `npm run test:docker` passes
  separately with an actual, uniquely owned, temporary Engine container.
- Eleven browser tests pass: desktop onboarding, wizard, lifecycle, console,
  settings, backup/restore, CloudGate endpoint and user creation; German mobile
  layout, reduced motion and muted sound. Their explicitly named Docker/protocol
  fixture is a test fixture rather than Minecraft. Companion and audio coverage
  is described above and in [the adventure UI guide](ADVENTURE_UI.md).
  Upload tests create NeoForge using its own installer, add three mod JARs in a
  separate batch and import worlds through ZIP and native directory selection.
  All eleven management tabs and all wizard steps remain reachable at 320×568,
  768×600, 1024×600 and 1920×1080. Dialog actions stay outside their scroll area.
- The final production Docker image builds and runs with the default entrypoint.
- The combined production app starts on its default port 18080 and reports
  version 0.3.0. Compose publishes host port 18080 to the container's port 8080.
- The production Compose definition passes with an already-built image and a
  fresh disposable data directory: non-root/read-only runtime, automatic data
  ownership and daemon-side bind discovery, private socket proxy and strict
  sentinel proof. Owner and session persist after force-recreating the app;
  logout still revokes the persisted session. No Minecraft EULA is accepted.
- Screenshots are in [screenshots](screenshots/).

## Actual Minecraft checks

The user explicitly accepted the Minecraft EULA for temporary test servers.
Cookies, certificates and proxy credentials remain outside Git. TLS and artifact
hash verification remained enabled.

The live-test driver injected the cloud proxy and its trusted certificate into
actual Minecraft containers. This driver is excluded from production builds. The
final production entrypoint was additionally verified against the persisted test
installation: authentication, host bind proof, RCON, staged file upload, recovery
creation, file removal, restart and confirmed server deletion all pass.

| Check              | Observed result                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Fabric Java 1.21.1 | Actual container starts; Java readiness protocol and internal RCON succeed.                                                              |
| Modrinth Spark     | Official API plus JAR manifest resolve Fabric API; verified installation and startup succeed.                                            |
| ServerCore         | Verified dependency installation and actual startup succeed.                                                                             |
| MRPACK             | Verified Fabric API file, loader/version and configuration override import; Minecraft starts.                                            |
| NeoForge upload    | Publisher-verified NeoForge 21.1.255 installer for Java 1.21.1 starts; readiness and RCON succeed.                                       |
| Bulk mod upload    | Publisher-verified ModernFix 5.27.24 and FerriteCore 7.0.3 install together; the actual NeoForge server restarts successfully.           |
| World folder       | All 22 files of the actual saved NeoForge world import through folder upload; Minecraft restarts successfully.                           |
| World ZIP          | The same actual world exports and reimports as ZIP; readiness and RCON succeed again.                                                    |
| Backup/restore     | Consistent backup restores saved configuration and inventory; real Minecraft restarts.                                                   |
| Sleep/wake         | TCP gateway presents sleeping status; login traffic requests startup and the real server becomes ready.                                  |
| Loader update      | An available Fabric loader installs and starts.                                                                                          |
| Failed update      | Unavailable loader `99.99.99` fails; rollback restores the previous loader and running world.                                            |
| Bedrock 1.21.1.03  | Official binary starts; native `list` reaches the console; the published gateway answers UDP status.                                     |
| Bedrock 1.26.52.3  | Official download succeeds; startup cannot reach its required external Minecraft account service in this cloud network. Readiness fails. |
| Second user        | View-only sharing restricts files, console, users and lifecycle; disabling the user revokes the session.                                 |
| App restart        | Owner, sessions, world records, data and container associations persist across app container restarts.                                   |

## Validation limits and supported alternatives

No full game client joined a world, so protocol readiness does not certify
gameplay or authenticated login. Forge, Paper, Purpur, arbitrary custom
JARs, older Java runtimes and ARM64 Java images have adapters but were not each
tested with a live game runtime. Bedrock requires amd64. Retest current Bedrock
1.26 on the intended deployment network; the older successful version does not
establish current-version readiness.

No CurseForge key or S3 credentials were available. Their adapters, configuration,
encryption and error handling are implemented; successful external operations
remain unverified. Optional keys belong in environment settings or the admin UI,
never chat or Git. S3 uploads verified local archives; remote recovery uses the
original downloaded ZIP and the documented local recovery workflow.

Imported files without a reliable platform project identity are conservatively
unmanaged. Target-version compatibility needs review. Marketplace modpack
archives use the archive import flow. CloudGate currently provides correct LAN
targets and setup instructions; it does not create tunnels through an undocumented
API. Player details depend on native runtime output; unavailable UUID/session data
is not invented.

The cloud Docker daemon sees a different filesystem namespace from the shell.
Real worlds require MineMate inside Docker with a daemon-visible data root. The
strict bind proof correctly rejects shell-only paths. The development app and
browser fixture work from the checkout.

For the NeoForge installer, the test driver additionally supplies Java HTTP/HTTPS
proxy properties and a trusted Java CA store. Uploaded installers retain their
runtime's version cache, so a normal restart does not reinstall the same loader.
These cloud-specific network settings remain confined to the test driver.

GitHub main was empty at onboarding. A new cloud instance restored the prepared
filesystem successfully; dependency installation, automated checks and application
startup passed before the initial source publication. Draft saving and cloud
environment publication remain separate operations.
