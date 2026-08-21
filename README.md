# SubarnaPasal — webwithkotlin

A complete, self-contained SubarnaPasal web application:

- **`frontend/`** — the full POS user interface (login, dashboard, inventory,
  checkout, orders, karigar, repairs, schemes, records, reports, settings,
  customer request link). Plain HTML/JS/CSS — no build step needed.
- **`backend/`** — the Kotlin Spring Boot microservices (api-gateway,
  auth-service, store-service, rates-service) that serve the entire `/api`.
- **`nginx.conf` + `docker-compose.yml`** — glue that serves the UI and the
  API from ONE origin, so everything works with zero frontend configuration.

```
 browser ──▶ nginx :3000 ── static files (frontend/)
                   └── /api/* ──▶ api-gateway :8080 ──▶ auth / store / rates ──▶ PostgreSQL
```

## Run it

Requires Docker (Docker Desktop on Mac/Windows, or Docker on a VPS).

```bash
cd webwithkotlin
cp .env.example .env      # set JWT_SECRET and DB_PASSWORD at minimum
docker compose up -d --build
```

Open **http://localhost:3000** — sign up a shop account and start selling.
The first build compiles the Kotlin services and takes a few minutes;
subsequent starts are seconds.

Useful commands:

```bash
docker compose logs -f store-service   # tail one service's logs
docker compose down                    # stop (data persists in the pgdata volume)
docker compose down -v                 # stop AND delete all data
```

## Deploy on a Hostinger VPS

1. VPS with the Docker template (or install Docker on Ubuntu).
2. Copy this `webwithkotlin/` folder to the server (git clone your repo).
3. `cp .env.example .env`, set real secrets, set `APP_URL=https://yourdomain.com`
   and `WEB_PORT=80` (or keep 3000 and put Caddy/Cloudflare in front for HTTPS).
4. `docker compose up -d --build`
5. Point your domain's A record at the VPS IP.

Note: Hostinger **shared** hosting cannot run this (no Java/Docker) — a VPS
plan is required.

## How the pieces talk

The frontend calls relative `/api/...` URLs. nginx proxies those to the
Kotlin api-gateway, which routes by path: `/api/auth/**` and `/api/license/**`
to auth-service, `/api/metal-rates`, `/api/shared/**`, `/api/cron/**` to
rates-service, everything else to store-service. `/order/<code>` (the customer
share link) is rewritten by nginx to `customer.html`, matching the Laravel
`routes/web.php` behaviour. Auth is JWT (HS256) signed with `JWT_SECRET`;
see `backend/README.md` for the full service-level details and env reference.
