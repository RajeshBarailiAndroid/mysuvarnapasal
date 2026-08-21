# SubarnaPasal — Kotlin Spring Boot Microservices

Kotlin/Spring Boot port of the Laravel backend, split into microservices
behind an API gateway. **Every `/api/...` path and response shape matches the
Laravel backend**, so the existing frontend works unchanged — just point it
at the gateway.

## Architecture

```
                         ┌────────────────────┐
   frontend / desktop ──▶│  api-gateway :8080 │  Spring Cloud Gateway
                         └─────────┬──────────┘
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
 ┌─────────────────┐    ┌──────────────────┐     ┌──────────────────┐
 │ auth-service    │    │ store-service    │     │ rates-service    │
 │ :8081           │    │ :8082            │     │ :8083            │
 │ accounts (JWT)  │    │ POS domain:      │     │ live metal API   │
 │ desktop licenses│    │ items, sales,    │     │ shared gold-rate │
 │ (Ed25519)       │    │ orders, karigar, │     │ ticks + history  │
 └────────┬────────┘    │ repairs, schemes,│     └────────┬─────────┘
          │             │ dashboard, sync  │              │
          │             └────────┬─────────┘              │
          └──────────────────────┼────────────────────────┘
                                 ▼
                        PostgreSQL (one instance)
```

Route map (gateway):

| Path                                        | Service       |
|---------------------------------------------|---------------|
| `/api/auth/**`, `/api/license/**`           | auth-service  |
| `/api/metal-rates`, `/api/shared/**`, `/api/cron/**` | rates-service |
| everything else under `/api/**`             | store-service |

Auth: auth-service issues **JWTs (HS256)** signed with the shared
`JWT_SECRET`; store/rates services validate tokens locally — no DB hop, no
shared session store. `AUTH_ENABLED=false` keeps the single-shop desktop
mode where everything runs as the `local-dev` user. Password changes bump a
`token_version`, which invalidates all previously issued tokens.

Data: store-service keeps each shop's POS data as **one JSONB document per
user** (`store_docs`), read-modified-written inside a row-locked transaction —
the same atomic checkout model as the Laravel `Store` class, with the same
document shape.

## Run locally

Requires JDK 21. Start PostgreSQL, then each service:

```bash
docker run -d --name sp-pg -e POSTGRES_DB=subarnapasal -e POSTGRES_USER=subarnapasal \
  -e POSTGRES_PASSWORD=subarnapasal -p 5432:5432 postgres:16-alpine

export JWT_SECRET="dev-secret-change-me-0123456789-0123456789"
./gradlew :auth-service:bootRun    # :8081
./gradlew :store-service:bootRun   # :8082
./gradlew :rates-service:bootRun   # :8083
./gradlew :api-gateway:bootRun     # :8080  ← point the frontend here
```

## Deploy on a Hostinger VPS

1. Get a VPS with Docker (Hostinger's Ubuntu + Docker template works).
2. Copy this folder to the server (`git clone` your repo, or `scp`).
3. `cp .env.example .env` and set real secrets (at minimum `JWT_SECRET`
   and `DB_PASSWORD`).
4. `docker compose up -d --build`
5. The API is at `http://<vps-ip>:8080/api/...`. Put nginx/Caddy or
   Cloudflare in front for HTTPS and point your domain at it.
6. Serve the frontend build (`artifacts/subarnapasal` → `pnpm run build`)
   from the same domain and proxy `/api/*` to the gateway — same
   one-origin setup as `host-together.sh`.

## Environment variables

See `.env.example`. Highlights: `JWT_SECRET` (shared JWT signing key),
`AUTH_ENABLED`, `SYNC_API_TOKEN` (admin token for sync + license admin),
`LICENSE_PRIVATE_SEED` / `LICENSE_PUBLIC_KEY` (Ed25519, base64, same values
as the Laravel install), `PUBLIC_REQUEST_SALT` (rotating it invalidates all
shared customer links), `METAL_PRICE_PROVIDER` (gold-api / goldapi.io /
metals-api), `CRON_SECRET` for the rate-capture cron.

## Differences from the Laravel backend

- Tokens are stateless JWTs instead of Sanctum DB tokens. `POST /api/auth/logout`
  is client-side (drop the token); `change-password` still force-logs-out
  every device via `token_version`.
- `GET /api/sync/run|status` and `POST /api/sync/restore` report
  `not_configured`: this deployment *is* the central server. The desktop
  (shop role) keeps using its local Laravel backend to push here.
- `/api/health` reports PostgreSQL instead of MySQL.
- Rate limiting (Laravel `throttle:`) is not built in — add it at the
  gateway or nginx level if the API is public.
