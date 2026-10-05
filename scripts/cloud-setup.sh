#!/usr/bin/env bash
set -euo pipefail
cd /workspace/MineMate
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major !== 24 || minor < 19) throw new Error("MineMate requires Node 24.19 or newer within Node 24")'
npm ci --fetch-timeout=60000 --fetch-retries=2
npm run check
if command -v chromium >/dev/null 2>&1; then
  chromium --version
else
  npx playwright install chromium
fi
docker version --format '{{.Server.Version}}'
docker compose version
