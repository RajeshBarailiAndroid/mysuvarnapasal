#!/bin/sh
# SubarnaPasal — build the frontend and host it from the Laravel backend.
#
# One server, one origin: the shop app at /, the customer request page at
# /order/<code>, and the API at /api/*. No CORS, no proxy, no second domain.
#
# Usage:  sh host-together.sh
# Then deploy laravel-backend/ with laravel-backend/public as the web root.
set -e

cd "$(dirname "$0")"
ROOT=$(pwd)
FRONTEND="$ROOT/artifacts/subarnapasal"
DIST="$FRONTEND/dist/public"
DOCROOT="$ROOT/laravel-backend/public"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed. Install it with:  npm install -g pnpm"
  exit 1
fi

# The frontend must talk to Laravel's auth endpoints, not Supabase's.
if ! grep -q "Laravel (Sanctum)" "$FRONTEND/public/auth.js" 2>/dev/null; then
  echo "NOTE: artifacts/subarnapasal/public/auth.js is not the Laravel adapter."
  echo "      Run this first, then re-run this script:"
  echo "      cp laravel-backend/frontend-adapter/auth.js artifacts/subarnapasal/public/auth.js"
  exit 1
fi

echo "Building the frontend..."
pnpm --filter @workspace/subarnapasal run build

if [ ! -f "$DIST/customer.html" ]; then
  echo "Build finished but $DIST/customer.html is missing."
  echo "customer.html must live in artifacts/subarnapasal/public/ so Vite copies it."
  exit 1
fi

echo "Copying the build into laravel-backend/public/ ..."
cp -R "$DIST/." "$DOCROOT/"

cat <<'EOF'

Done.

Serve laravel-backend/ with public/ as the web root (nginx + php-fpm, Apache,
Herd, or cPanel). On that one domain you then have:

  /                    the shop app (sign-in required)
  /order/<code>        the customer request page only — this is the link you share
  /api/*               the API
  /api/public/<code>/* the no-login endpoints the customer page uses

Get <code> for your shop while signed in to the shop app, from the browser
console on that domain:

  fetch('/api/public-link', { headers: { Authorization: 'Bearer ' + localStorage.sp_auth_token } })
    .then(r => r.json()).then(console.log)

In single-shop mode (AUTH_ENABLED=false) just call:  curl https://your-domain/api/public-link

To invalidate every link you have shared, set PUBLIC_REQUEST_SALT in
laravel-backend/.env to a new random value and run: php artisan config:clear
EOF
