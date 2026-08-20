# SubarnaPasal — Laravel Backend

PHP/Laravel port of the SubarnaPasal POS backend (originally Express + Supabase).
Same `/api/*` endpoints, same request/response shapes, same money-safety rules —
now backed by **MySQL** with **Laravel Sanctum** username/password auth.

## Stack

- Laravel 12 (PHP 8.2+)
- MySQL 8 (SQLite also works — handy for a quick local run)
- Laravel Sanctum bearer-token auth (replaces Supabase auth)

## Quick start

```bash
cd laravel-backend
composer install

cp .env.example .env        # already configured for MySQL, edit credentials
php artisan key:generate

# create the database first:  CREATE DATABASE subarnapasal;
php artisan migrate

# serve the API on port 8080 (the frontend's Vite proxy expects this port)
php artisan serve --port=8080
```

> **No MySQL handy?** Set `DB_CONNECTION=sqlite` in `.env`, comment out the
> other `DB_*` lines, run `touch database/database.sqlite`, then migrate.

## Connecting the existing frontend

The vanilla-JS frontend keeps working — its Vite dev server already proxies
`/api/*` to `http://localhost:8080`:

```bash
pnpm --filter @workspace/subarnapasal run dev   # frontend on :19951
php artisan serve --port=8080                   # Laravel API
```

One file must be swapped: the frontend's `public/auth.js` was written for
Supabase auth. Replace it with the Sanctum version shipped here:

```bash
cp laravel-backend/frontend-adapter/auth.js artifacts/subarnapasal/public/auth.js
```

(The original is kept at `public/auth-supabase-backup.js` if you ever want to
switch back to the Node/Supabase backend.)

## Auth

- `AUTH_ENABLED=true` (default): users sign up / log in with username +
  password (`POST /api/auth/signup`, `POST /api/auth/login`). The API returns a
  Sanctum bearer token; every `/api/*` call sends `Authorization: Bearer <token>`.
  Each user gets their own isolated shop data.
- `AUTH_ENABLED=false`: single-shop mode with no login — all data is stored
  under the built-in `local-dev` user (like the original local-dev fallback).

Endpoints: `/api/auth/config`, `/signup`, `/login`, `/me`, `/logout`,
`/change-password`, `/forgot-password` (stub — email delivery not wired up).

## What's ported (1:1 with the Express backend)

- **POS sales** — `POST /api/sales` is the single atomic checkout: validates
  stock, freezes metal/FX rates + weights/karat/jarti onto the invoice
  (`rateSnapshot`), assigns gap-free `INV-XXXXXX` numbers, deducts stock,
  writes audit transactions. Skill Promotion Fee (0.5%), guarantee-bill
  fields, old-gold trade-in and gold-scheme redemption all included.
- **Voids** — `POST /api/sales/{id}/void` (reason required, blocked once
  payments exist; restores stock, tags transactions `[VOIDED]`, reverts
  trade-in / reactivates scheme).
- **Dues (udharo)** — credit sales, `POST /api/sales/{id}/payments`,
  `?due=open` filter, `outstandingTotal`, opening-balance dues via
  `POST /api/sales/manual-due` (`DUE-XXXX` series, excluded from revenue).
- **Inventory** — items CRUD with SKU checks, jarti (flat / percent / grams /
  per_gram / per_tola), silver + "Other" metal pricing, HS code & stone amount.
- **Orders** — custom-order workflow incl. tola/aana/laal weights, karigar
  assignment, advances; completing an order deducts stock.
- **Customers, Transactions, Karigars + gold ledger, Old-gold buy-back,
  Repairs, Gold savings schemes, Options (Taken/Given/Kept)** — all CRUD +
  lifecycle rules.
- **Dashboard** (`GET /api/dashboard`) and **Reports** (`GET /api/reports`).
- **Settings** — shop info, VAT, FX rates (snapshotted per sale), gold/silver
  rates, locations, categories, unique shop-name check.
- **Metal rates** — gold-api.com (free, default) / goldapi.io / metals-api,
  5-minute cache; shared gold-rate history + intraday ticks
  (`/api/shared/gold-rates`); cron capture at
  `GET /api/cron/capture-gold-rate` guarded by `CRON_SECRET`.

## Database layout

`users`, `settings` (per-user shop settings + counters in `extras` JSON),
`items`, `transactions`, `orders`, `customers` as typed tables; `sales`,
`repairs`, `schemes`, `karigars`, `gold_ledger`, `old_gold_exchanges`,
`options` as `(user_id, id, data JSON)` document tables — the same layout the
Supabase version used (`supabase/pos-upgrade.sql`), so records keep their
exact original JSON shape. `shared_gold_rates` holds the global price history.

All writes for one request happen inside a single DB transaction, so checkout
stays atomic (stock, counters, invoice, transactions all-or-nothing).

## Production notes

- Serve with any standard Laravel setup (nginx + php-fpm, Apache, Herd,
  cPanel/shared hosting with the `public/` docroot).
- Point the frontend's production `/api` path at this app (same-domain path
  routing or a reverse proxy — same as before).
- Set a strong `CRON_SECRET` and schedule
  `curl -H "x-cron-secret: $CRON_SECRET" https://your-host/api/cron/capture-gold-rate`
  (e.g. every 15 min) if you want automatic gold-rate history.
