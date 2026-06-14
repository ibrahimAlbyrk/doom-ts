#!/usr/bin/env bash
# Ship the built DOOM-TS to a VPS and (re)start it under systemd. Idempotent — run it again to
# redeploy. Builds the client locally (needs assets extracted: `npm run extract-assets`), rsyncs
# the repo, installs deps on the box, and restarts the service. Caddy/firewall/user provisioning
# is a ONE-TIME manual step — see DEPLOY.md; this script is the repeatable build+ship+restart.
#
# Usage:   deploy/deploy.sh <user@host> [remote_dir]
# Example: deploy/deploy.sh doom@203.0.113.5 /opt/doom
set -euo pipefail

TARGET="${1:?usage: deploy/deploy.sh <user@host> [remote_dir]}"
REMOTE_DIR="${2:-/opt/doom}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Building client locally (dist/)"
if [ ! -e public/assets/palette.json ]; then
  echo "ERROR: public/assets is empty. Run 'npm run extract-assets' first (see DEPLOY.md)." >&2
  exit 1
fi
npm run build

echo "==> Syncing repo to ${TARGET}:${REMOTE_DIR}"
# Ship source + the freshly built dist/. Exclude local-only/heavy dirs; the box runs npm ci itself.
rsync -avz --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .eos \
  --exclude 'tools/extract-wad/.cache' \
  ./ "${TARGET}:${REMOTE_DIR}/"

echo "==> Installing deps + restarting service on the box"
ssh "$TARGET" "cd '${REMOTE_DIR}' && npm ci && sudo systemctl restart doom && sleep 1 && systemctl --no-pager status doom | head -5"

echo "==> Done. Tail logs with:  ssh ${TARGET} journalctl -u doom -f"
