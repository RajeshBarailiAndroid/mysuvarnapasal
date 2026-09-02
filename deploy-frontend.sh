#!/usr/bin/env bash
# Push the built frontend to Hostinger.
#   bash deploy-frontend.sh            # only the files changed for the mobile-only signup
#   bash deploy-frontend.sh --all      # the whole dist/public tree
#
# Run this from your Mac's own Terminal — it needs network access to the server.
set -euo pipefail

HOST="u971057202@88.223.84.40"
PORT=65002
REMOTE="/home/u971057202/domains/mysuvarnapasal.com/public_html/frontend-dist"  # served docroot — NOT ~/public_html (see deploy-all.sh)
SRC="$(cd "$(dirname "$0")" && pwd)/artifacts/subarnapasal/dist/public"

if [ "${1:-}" = "--all" ]; then
  echo "==> Uploading the whole frontend from $SRC"
  scp -P "$PORT" -r "$SRC"/* "$HOST:$REMOTE/"
else
  FILES=(login.html login-page.js auth.js i18n.js)
  echo "==> Uploading: ${FILES[*]}"
  for f in "${FILES[@]}"; do
    scp -P "$PORT" "$SRC/$f" "$HOST:$REMOTE/$f"
  done
fi

echo "==> Verifying the live login page has no signup form"
if curl -s http://mysuvarnapasal.com/login.html | grep -qi 'signup-form\|Create new account'; then
  echo "!! Signup markup is still being served — check caching or the remote path ($REMOTE)."
  exit 1
fi
echo "==> Done. Sign-up is gone from the web login page."
