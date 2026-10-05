#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker version >/dev/null
docker compose version >/dev/null
if [ ! -e .env ]; then
  minemate_lan_ip="$(hostname -I | awk '{print $1}')"
  if [ -z "$minemate_lan_ip" ]; then
    printf 'Set MINEMATE_LAN_IP to your Docker host LAN address in .env.\n' >&2
    exit 1
  fi
  (umask 077; printf 'MINEMATE_LAN_IP=%s\n' "$minemate_lan_ip" > .env)
fi
docker compose pull
docker compose up -d --wait --wait-timeout 120
printf 'MineMate is ready. Open your Docker host LAN address on port 18080 (or MINEMATE_PORT).\n'
