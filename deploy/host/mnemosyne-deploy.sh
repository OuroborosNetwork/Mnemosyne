#!/usr/bin/env bash
#
# Mnemosyne on-box deployer — zero-downtime blue-green rebuild + swap.
#
# Runs on the HOST (never in the container) so it can build images, manage
# containers, and reload nginx — power the app container deliberately does NOT have.
# It is triggered by a request file the container drops in the deploy spool (POST
# /api/admin/deploy) and streams all progress into `<id>.log`, which the container
# tails back to the operator's browser over SSE.
#
# Blue-green: build the new image, start it as the OTHER color on the OTHER port,
# health-check it, flip nginx's upstream to it, then remove the old color. The site
# is served by the old container the entire time until nginx flips — no interruption.
#
# Usage: mnemosyne-deploy.sh <deploy-id>
set -Eeuo pipefail

ID="${1:?usage: mnemosyne-deploy.sh <deploy-id>}"

# ── Box paths (override via env if your layout differs) ──────────────────────────
REPO="${MNEMOSYNE_REPO:-/opt/mnemosyne}"
SITE_ROOT="${MNEMOSYNE_SITE_ROOT:-/var/www/codex.ancientholdings.eu}"
SPOOL="$SITE_ROOT/data/deploy"
ENV_FILE="$SITE_ROOT/.env.local"
DATA_DIR="$SITE_ROOT/data"
IMAGE="${MNEMOSYNE_IMAGE:-ghcr.io/ancientpantheon/mnemosyne:local}"
UPSTREAM_INC="${MNEMOSYNE_NGINX_UPSTREAM:-/etc/nginx/snippets/mnemosyne-upstream.conf}"
BLUE_PORT=3005
GREEN_PORT=3006

LOG="$SPOOL/$ID.log"
STATUS="$SPOOL/$ID.status"

log()  { printf '%s\n' "$*" >>"$LOG"; }
fail() { log "✗ $*"; echo failed >"$STATUS"; exit 1; }
trap 'log "✗ deploy aborted (error near line $LINENO)"; echo failed >"$STATUS"' ERR

echo running >"$STATUS"
log "▶ host deployer started ($(date -u +%FT%TZ))"

# 1) Refresh source and bump constructor pins to @latest. Discard the previous
#    deploy's pin bumps first so `git pull --ff-only` stays clean; @latest re-bumps.
cd "$REPO"
log "→ resetting constructor pins + git pull"
git checkout -- package.json package-lock.json 2>/dev/null || true
git pull --ff-only 2>&1 | tee -a "$LOG"
log "→ npm install @ancientpantheon/codex@latest"
npm install @ancientpantheon/codex@latest --no-audit --no-fund 2>&1 | tee -a "$LOG"

# 2) Build the new image.
log "→ docker build $IMAGE"
docker build -t "$IMAGE" "$REPO" 2>&1 | tee -a "$LOG"

# 3) Pick the target color (the one NOT currently serving).
if docker ps --format '{{.Names}}' | grep -qx 'mnemosyne-green'; then
  OLD=green; NEW=blue;  NEW_PORT=$BLUE_PORT
else
  OLD=blue;  NEW=green; NEW_PORT=$GREEN_PORT
fi
log "→ current live: $OLD · deploying to: $NEW (127.0.0.1:$NEW_PORT)"

# 4) Start the NEW container. Same host volumes → same sealed codex + env + master key.
docker rm -f "mnemosyne-$NEW" >/dev/null 2>&1 || true
docker run -d --name "mnemosyne-$NEW" --restart unless-stopped \
  -p "127.0.0.1:$NEW_PORT:3005" \
  --env-file "$ENV_FILE" \
  -e MNEMOSYNE_ENV_FILE=/app/.env.local \
  -e MNEMOSYNE_CODEX_DIR=/app/data/mnemosyne-codex \
  -v "$ENV_FILE:/app/.env.local" \
  -v "$DATA_DIR:/app/data" \
  "$IMAGE" 2>&1 | tee -a "$LOG"

# 5) Health-check the new container before routing any traffic to it.
log "→ health-checking new container"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$NEW_PORT/api/me" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then
  docker rm -f "mnemosyne-$NEW" >/dev/null 2>&1 || true
  fail "new container failed health check — old container kept live, nothing changed"
fi
log "✓ new container healthy"

# 6) Flip nginx to the new port (atomic write + validate + reload).
log "→ flipping nginx upstream to 127.0.0.1:$NEW_PORT"
tmp="$(mktemp)"
printf 'upstream mnemosyne_app { server 127.0.0.1:%s; }\n' "$NEW_PORT" >"$tmp"
mv "$tmp" "$UPSTREAM_INC"
nginx -t 2>&1 | tee -a "$LOG"
nginx -s reload 2>&1 | tee -a "$LOG"
log "✓ nginx now routing to $NEW (127.0.0.1:$NEW_PORT)"

# 7) Remove the old color — the swap is complete.
docker rm -f "mnemosyne-$OLD" >/dev/null 2>&1 || true
log "✓ old container ($OLD) removed"

log "✓ deploy complete"
echo success >"$STATUS"
