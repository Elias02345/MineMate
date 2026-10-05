# Install a prebuilt Docker image archive

Release downloads provide ready-to-load MineMate images for `linux/amd64` and
`linux/arm64`, alongside the normal registry-based Compose installation. Use
these archives when the registry image is unavailable or to prepare a host
offline. No Git checkout, Node installation or source build is required.

For 0.3.0, GitHub Actions initially failed to assign hosted runners during the
[Actions incident](https://www.githubstatus.com/). The image archives provide an
installation path while the native registry publishing workflow is retried.

## Existing installation

In your existing `.env`, set:

```dotenv
MINEMATE_IMAGE=ghcr.io/elias02345/minemate:0.3.0
MINEMATE_PORT=18080
```

Run these commands in the directory containing your Compose file:

```sh
case "$(docker info --format '{{.Architecture}}')" in
  x86_64|amd64) minemate_arch=amd64 ;;
  aarch64|arm64) minemate_arch=arm64 ;;
  *) echo 'This release supports amd64 and arm64 Docker hosts.'; exit 1 ;;
esac
minemate_release=https://github.com/Elias02345/MineMate/releases/download/v0.3.0
minemate_archive="minemate-0.3.0-linux-${minemate_arch}.tar.gz"
curl -fL --retry 3 -o "$minemate_archive" "$minemate_release/$minemate_archive"
curl -fL --retry 3 -o SHA256SUMS "$minemate_release/SHA256SUMS"
awk -v target="$minemate_archive" '$2 == target' SHA256SUMS | sha256sum -c -
docker load --input "$minemate_archive"
docker compose up -d --wait
```

The archive supplies the same image tag that Compose and the game gateway use.
Open `http://HOST-IP:18080`. Your existing LAN and data settings continue to apply.
Loading an image does not replace the persistent data directory.

## New installation

Create your installation directory. Download `docker-compose.yml` and
`default.env.example` from the same release, save the latter as `.env`, and set
`MINEMATE_LAN_IP` to your Docker host's LAN address. Then follow the archive-load
commands above. Compose prepares the persistent `data` directory automatically.

When the registry image is available, subsequent installations and updates can
use the normal `docker compose pull` flow. Native Bedrock requires amd64.

## Archive validation

Both archives contain the production runtime, default entrypoint and healthcheck,
with version and source-revision labels. The amd64 production image passes the
full Compose smoke. The arm64 archive uses the official arm64 Node base and the
same production app/dependencies, including the supplied arm64 native modules.
Its arm64 Node runtime passes the same Compose ownership, socket-proxy,
bootstrap/authentication and persisted-session checks through an isolated test
wrapper with QEMU. The emulator and wrapper are excluded from the shipped image.
Native arm64 builds remain part of the queued release workflow.
