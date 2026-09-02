#!/usr/bin/env bash
# Deploy everything changed on 2 Sep 2026 to mysuvarnapasal.com in one go:
#   • backend: market gold-price history (table, service, command, API) and
#     the cron endpoint feeding it; admin/rate-sync code already on disk
#   • frontend: rate-sync fix + Market gold price card (dist/public)
# Then runs the migration on the server and prints the cron line to add.
#
#   bash deploy-all.sh
#
# You will be asked for the Hostinger SSH password up to three times
# (two uploads + one remote command). Nothing here deletes anything.
set -euo pipefail

HOST="u971057202@88.223.84.40"
PORT="65002"
REMOTE_APP="/home/u971057202/public_html"
REMOTE_FRONT="$REMOTE_APP/frontend-dist"
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/laravel-backend"
DIST="$ROOT/artifacts/subarnapasal/dist/public"

echo "== 1/3  Backend files → $REMOTE_APP"
# scp keeps the directory layout when given the relative paths from inside
# laravel-backend; -r is not needed because every path is a file.
# Everything under app/, routes/, bootstrap/ and the migrations — the audit
# touched a dozen controllers, so the whole tree goes, minus vendor/public.
( cd "$BACKEND" && tar czf /tmp/sp-backend-update.tgz app routes bootstrap/app.php database/migrations )
scp -P "$PORT" /tmp/sp-backend-update.tgz "$HOST:$REMOTE_APP/sp-backend-update.tgz"

echo "== 2/3  Frontend → $REMOTE_FRONT"
scp -P "$PORT" \
  "$DIST/index.html" "$DIST/app.js" "$DIST/styles.css" "$DIST/i18n.js" "$DIST/settings-karat.js" \
  "$DIST/order-extras.js" "$DIST/karigar.js" "$DIST/reset-password-page.js" \
  "$DIST/customer.html" "$DIST/login.html" "$DIST/forgot-password.html" "$DIST/reset-password.html" \
  "$HOST:$REMOTE_FRONT/"

echo "== 3/3  Unpack, migrate, clear caches, first price capture"
ssh -p "$PORT" "$HOST" "cd $REMOTE_APP \
  && tar xzf sp-backend-update.tgz && rm -f sp-backend-update.tgz \
  && php artisan migrate --force \
  && php artisan optimize:clear \
  && (php artisan pos:capture-gold-price || true) \
  && echo '-- production .env check (must be APP_ENV=production, APP_DEBUG=false, AUTH_ENABLED=true):' \
  && grep -E '^(APP_ENV|APP_DEBUG|AUTH_ENABLED|SYNC_API_TOKEN|LICENSE_SIGNUP_ENABLED)=' .env | sed -E 's/(TOKEN=).+/\\1<set>/'"

cat <<'NOTE'

Done. Check the .env lines printed above: if APP_DEBUG is true or APP_ENV is
not production, fix them in /home/u971057202/public_html/.env (debug mode
prints stack traces with file paths to anyone who triggers an error). If
SYNC_API_TOKEN is set, that token gives cross-shop read/write to whoever holds
it — leave it unset on the shared server unless a desktop sync is in use.

Two things left that only you can do on the server:

1. Cron (Hostinger hPanel → Advanced → Cron Jobs), so the price is recorded
   every 15 minutes even when nobody has the site open:

     */15 * * * *  cd /home/u971057202/public_html && php artisan pos:capture-gold-price >> /dev/null 2>&1

   (Without it the chart still fills in whenever someone opens it, because a
   read older than 15 minutes triggers a capture — but with gaps.)

2. If no admin account exists yet:

     ssh -p 65002 u971057202@88.223.84.40
     cd /home/u971057202/public_html
     php artisan pos:create-admin --username=rajeshbaraili --email=rajeshbaraili1983@gmail.com --name="Rajesh Baraili"

NOTE
