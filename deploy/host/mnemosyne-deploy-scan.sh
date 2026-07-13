#!/usr/bin/env bash
#
# Claim + run every pending deploy request in the spool. Invoked by the systemd
# path unit (mnemosyne-deploy.path) whenever the container drops a `*.request.json`.
# Each request is renamed to `.processing` first so a second trigger can't double-run
# the same deploy, then handed to the blue-green deployer.
set -uo pipefail

SITE_ROOT="${MNEMOSYNE_SITE_ROOT:-/var/www/codex.ancientholdings.eu}"
SPOOL="$SITE_ROOT/data/deploy"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

shopt -s nullglob
for req in "$SPOOL"/*.request.json; do
  id="$(basename "$req" .request.json)"
  mv "$req" "$req.processing" 2>/dev/null || continue  # lost the claim race → skip
  "$HERE/mnemosyne-deploy.sh" "$id" || true            # errors already land in <id>.status
  rm -f "$req.processing"
done
