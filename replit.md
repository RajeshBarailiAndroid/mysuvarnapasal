# SubarnaPasal

Gold store inventory management and POS (point-of-sale) system for Nepali jewelry stores — tracks items, sales, orders, and customers with live gold/silver price integration.

## POS money-safety model (added 2026-07)

- **Sales are immutable invoices.** Checkout goes through `POST /api/sales` (one atomic call): validates stock for all lines, freezes the metal rate, FX rate, weight, karat, jarti and making charge onto the sale (`rateSnapshot` + per-line snapshot), assigns a gap-free sequential invoice number (`INV-000001`, counter in `settings.invoiceCounter`), deducts stock, and writes matching transaction entries. Never recompute an old invoice from current rates.
- **Corrections are voids, not edits.** `POST /api/sales/:id/void` requires a reason; it restores stock, tags the sale's transactions `[VOIDED]` (reports exclude them), reverts a linked old-gold trade-in / scheme redemption, and keeps the invoice on record. Reports → Invoices tab has reprint + void UI. A sale with received payments can no longer be voided.
- **Opening-balance dues**: `POST /api/sales/manual-due` records old paper-khata udharo as a `type:'opening_due'` sale (own `DUE-` number series via `settings.dueCounter`, backdatable). It flows through the normal dues machinery (udharo list, payments, outstanding) but is excluded from all revenue figures. UI: "+ Old due" on the Dashboard udharo panel and in Reports → Invoices.
- **Credit dues (udharo).** A `credit` sale (or partial cash) carries `payment.due`; later receipts go through `POST /api/sales/:id/payments` (amount ≤ remaining, stored on `sale.payments[]` + a `credit_payment` transaction — revenue is NOT re-counted). `GET /api/sales` returns `paidSince`/`dueRemaining` per sale plus `outstandingTotal`; `?due=open` filters open dues. Invoices tab shows Due, "Given" so far, an Outstanding-credit KPI, and a Receive-payment modal.
- **FX is configurable, not hard-coded.** `settings.fxRates` (`{USD, CAD}` → NPR) is editable in Settings and snapshotted onto each sale. The shared cron capture (no user context) uses env `FX_NPR_PER_USD` / `FX_NPR_PER_CAD`.
- **Old-gold trade-in at checkout**: `oldGold` on the sale body values by weight × karat/24 × buy rate and credits the invoice; a linked `oldGoldExchanges` entry carries `saleId`.
- **Repairs** (`/api/repairs`, Repairs tab): received → in_progress → ready → delivered (terminal) / cancelled; delivering records the charge as a sale transaction.
- **Gold savings schemes** (`/api/schemes`, Schemes tab): monthly deposits, auto-matures at duration/target, redeemed as credit on a sale (`schemeId` at checkout); voiding that sale reactivates the scheme.
- **Supabase persistence for jsonb collections**: karigars, gold_ledger, old_gold_exchanges, options, sales, repairs, schemes sync as `(user_id, id, data jsonb)` tables; `settings.extras` holds fxRates + counters. Run `supabase/pos-upgrade.sql` once — until then this data stays in the local JSON mirror (missing tables fall back to local instead of clobbering).
- Frontend additions live in `public/pos-extras.js` (loaded after app.js); wastage is the existing per-item **jarti** fields, snapshotted onto every sale line.
- **Dashboard** (`public/dashboard.js`, default landing view): one aggregate call `GET /api/dashboard` returns today's/this-month invoice revenue, 7-day sales series, outstanding credit + open dues, inventory value/weight/low-stock, pending orders, active repairs/schemes, and recent invoices. KPI cards reuse `.kpi-card`; the 7-day chart is a single-gold-series bar chart with hover tooltip. Quick actions navigate to POS/Inventory/Orders/Repairs/Schemes/Invoices.

## Guarantee bill (ग्यारेन्टी बिल, added 2026-08)

- **Print format**: `buildGuaranteeBillHtml` in `public/app.js` renders the traditional bilingual Nepali jewellery bill-pad layout (H.S. code, type, weight, wastage/jarti, total weight, per-10g rate, amount, stone, making cost columns; old/add weight, Nepali + English amount-in-words, guarantee notes, dual signatures). It is the default style in the bill modal; a "Bill style" select switches back to the classic receipt. Print CSS targets A4 portrait.
- **Checkout extras**: POS sidebar has a "Guarantee bill details" panel (buyer identity no., order/delivery dates, goldsmith/kaligadh, old & add weight) plus a payment-reference input (cheque no. for bank/card, QR ref for eSewa/Khalti). All snapshot onto the sale as `sale.bill` via `POST /api/sales` body `bill` — display-only, never re-priced.
- **0.5% Skill Promotion Fee** (सिप प्रवर्द्धन शुल्क): optional checkbox in the cart summary; both client and server compute `Math.round(afterDiscount * 0.005)` and include it in the invoice total (`sale.skillFee`, `sale.skillFeeAmount`).
- **Per-line H.S. code & stone amount**: optional fields on inventory items (`item.hsCode`, `item.stoneAmount`) and custom cart lines; snapshotted onto sale lines. Stone/making are informational columns on the bill (already inside the unit price); the bill's "Amount" column shows lineTotal − stone − making.
- Nepali amount-in-words: `numberToWordsNepali` / `amountToWordsNepali` in `app.js`.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build + run the API server (port 8080)
- `pnpm --filter @workspace/subarnapasal run dev` — run the frontend Vite dev server (port 19951)
- `pnpm --filter @workspace/api-server run typecheck` — typecheck the API server

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend**: Vanilla JS + HTML/CSS (no framework), served via Vite static assets
- **API**: Express 5, port 8080 in dev (mounted under `/api`)
- **DB**: Optional Supabase (PostgreSQL); falls back to local JSON files in `artifacts/api-server/data/users/`
- **Auth**: Supabase JWT-based auth (optional); falls back to `local-dev` user when unconfigured
- **Metal prices**: Live gold/silver rates via gold-api.com (free, no key needed) or goldapi.io/metals-api (paid)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/subarnapasal/` — vanilla JS frontend (served by Vite)
  - `index.html` — main app HTML entry (original app, not React)
  - `public/` — all static assets: `app.js`, `auth.js`, `styles.css`, images, etc.
  - `vite.config.ts` — proxies `/api/*` → `http://localhost:8080`
- `artifacts/api-server/src/` — Express API server (TypeScript ESM)
  - `lib/` — store.ts, auth.ts, metal-rates.ts, shared-rates.ts, supabase-client.ts, etc.
  - `routes/api.ts` — all business API routes
  - `routes/auth.ts` — auth routes (/auth/login, /auth/signup, etc.)
  - `middlewares/auth.ts` — user identity middleware (attaches `req.userId`)
  - `data/users/` — local JSON store fallback (when Supabase not configured)

## Architecture decisions

- **Vanilla JS frontend, not React**: The original app is a self-contained vanilla JS SPA — migrated as-is into the Vite `public/` folder. Vite serves it as static files and proxies `/api/*` to the Express backend.
- **Supabase optional**: The app runs fully offline using JSON file storage in `data/users/<userId>/store.json`. Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to enable cloud persistence.
- **Local-dev user**: When auth is unconfigured (no Supabase auth keys), all requests get `userId = 'local-dev'` automatically. No login required.
- **Shared gold rates**: The `shared_gold_rates` table/JSON stores global gold price history visible across all users. Cron endpoint `GET /api/cron/capture-gold-rate` writes to it (requires `CRON_SECRET`).
- **Path-based routing**: Frontend (`/`) and API (`/api`) are separate artifacts sharing the same domain via Replit's path router.

## Product

- **POS** — point-of-sale with product catalog, customer lookup, cart, and checkout
- **Inventory** — CRUD for jewelry items with karat, weight, making charge, and automatic pricing
- **Orders** — custom order workflow (pending → confirmed → progress → ready → completed)
- **Customers** — customer directory synced from orders
- **Reports** — sales revenue, inventory value, movement history
- **Settings** — gold/silver rates (manual or live API), shop info, locations, categories
- **Auth** — username/password sign-in via Supabase (optional)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The frontend's `/api/*` calls are proxied by Vite in dev only. In production, the path router handles this directly.
- `artifacts/api-server/data/` is the local JSON fallback; don't commit user data from this folder.
- When adding new routes to `api.ts`, ensure the path is added to `PUBLIC_PATHS` in `middlewares/auth.ts` if it shouldn't require auth.
- The `artifacts/subarnapasal/public/index.html` is a duplicate of the root `index.html` — only the root one is used by Vite.
- Metal rates from gold-api.com are in USD; conversion to NPR uses the configurable `settings.fxRates` (Settings → Currency exchange rates), defaulting to 133. The FX value used is frozen onto each invoice.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Original app backup: `.migration-backup/` (keep for reference)
