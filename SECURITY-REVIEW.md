# SubarnaPasal — Security Review

**Date:** 19 August 2026
**Scope:** Electron desktop shell, license/activation system, Laravel backend (bundled + hosted), Node/Express API server, browser frontend, Supabase config, secrets handling.
**Method:** source review of `desktop-app/`, `laravel-backend/`, `artifacts/` at the current working tree. No live testing against a deployed server.

---

## Summary

The desktop shell itself is built sensibly — `contextIsolation: true`, `nodeIntegration: false`, no preload on the main window, navigation and `window.open` blocked, permission requests denied, backend bound to `127.0.0.1`. Ed25519 key signing is implemented correctly (real signature verification, not a checksum). Secrets are properly gitignored and the repo history is clean. Database access goes through the query builder, so there is no SQL injection.

The serious problems are not in the shell. They are in the **multi-tenant central server**, which is protected by a single shared static token that ships to every customer's computer in plaintext, and in the **frontend's handling of shop-entered text**, which is inserted into the page as raw HTML everywhere.

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Critical** | One shared `SYNC_API_TOKEN` gives every customer full control of every other customer's data and licenses |
| 2 | **Critical** | `sync/push kind:"users"` is a password-hash overwrite primitive; sync ships all password hashes off-device |
| 3 | **High** | Stored XSS across the whole UI — shop data rendered as raw HTML, no output escaping, no CSP |
| 4 | **High** | `/api/license/list` returns every customer's license key in plaintext |
| 5 | **High** | Unauthenticated `sync/restore`, `sync/run`, `sync/status` |
| 6 | **Medium** | `shared/gold-rates/ticks` accepts unauthenticated writes to the pricing feed |
| 7 | **Medium** | Weak password policy (6 chars), broken password reset, generous login throttle |
| 8 | **Medium** | Licensing is disabled in shipped builds, and is client-side only by design |
| 9 | **Medium** | No update channel — no way to ship a security fix to installed shops |
| 10 | **Low** | Wildcard CORS, `file://` navigation allowed, unencrypted signing key on the dev Mac, `APP_DEBUG=true` in the local `.env` |

---

## 1. Critical — one shared token controls the entire fleet

`SYNC_API_TOKEN` is a single static string that is the same for every shop. It is:

- typed into the app's **Server sync settings** window by the shop,
- written in **plaintext** to `pos-config.json` in the user-data folder (`desktop-app/main.js:412-422`, `saveConfig`),
- passed to the bundled PHP process as an environment variable (`main.js:149`),
- and — critically — reused as the **license admin token** (`LicenseController::adminAuthorized()` → `SyncService::token()`, `LicenseController.php:44-51`).

Any shop owner, employee, repair technician, or piece of commodity malware that can read one file on one customer's PC obtains, against the central server:

| Request | Effect |
|---|---|
| `GET /api/sync/pull?userId=<any>` | Download any other shop's complete book — sales, customers, phone numbers, dues, karigar ledger |
| `POST /api/sync/push {kind:"store", userId:<any>}` | Overwrite or destroy any shop's data |
| `POST /api/sync/push {kind:"users", …}` | Overwrite any user row, **including the password hash** → take over any shop's account |
| `GET /api/license/list` | Dump every license row **including the plaintext `license_key`** and every activation |
| `POST /api/license/issue` | Mint unlimited free keys with any expiry |
| `POST /api/license/revoke {id}` | Remotely lock every other shop's app |

There is no per-tenant scoping anywhere: `pull` and `push` take `userId` straight from the request and the token check is identical for all of them.

**Fix (architectural — not applied, needs your decision):**

1. Issue a **distinct random token per shop**, stored server-side as a hash (`hash('sha256', …)`), never as plaintext.
2. Resolve the token to a `userId` server-side and **ignore the `userId` in the request body** — a shop can only ever push or pull its own store.
3. Use a **separate admin token** (server `.env` only, never on a customer machine) for `license/issue|list|revoke|unrevoke`.
4. Rotate the current token immediately, and treat every value that has been shipped so far as compromised.

Until (1)–(3) exist, the central server should be assumed readable and writable by anyone who has ever installed the app.

## 2. Critical — password-hash write primitive in sync

`SyncController::push()` with `kind: "users"` (`SyncController.php:57-70`) accepts an array of user rows and does `updateOrInsert` on the `users` table with a whitelist that includes `password` and `remember_token`. Combined with finding 1, that is direct account takeover for every shop on the server.

Separately, `SyncService::pushAccounts()` (`SyncService.php:118-126`) sends **every local user row, bcrypt hashes included**, to the central server on every sync pass. Password hashes should not leave the device that owns them.

**Applied fix:** `password` and `remember_token` removed from the accepted column whitelist on the receiving side, and stripped on the sending side. Existing accounts keep working; passwords simply no longer replicate. If you need shops to log in on a replacement PC, do it with a server-side account rather than by replicating hashes.

## 3. High — stored XSS throughout the UI

There is **no output escaping anywhere in the frontend**. Shop-entered text is interpolated straight into `innerHTML`:

- `artifacts/subarnapasal/public/app.js` — 62 `innerHTML` assignments, e.g. line 4453 `<strong>${name}</strong>` (customer name), line 4435 `${item.name}` (item name)
- `karigar.js` (16), `requests.js` (11), `options.js` (10), `pos-extras.js` (9), and others

A customer named `<img src=x onerror="…">`, an item description, or a karigar note is enough. There is **no Content-Security-Policy** on any page.

Impact differs by build:

- **Desktop app** — `contextIsolation` and the absence of a preload on the main window mean the injected script gets no Node access, and `will-navigate` / `setWindowOpenHandler` block navigation. But `fetch()` to an arbitrary host is not blocked, so the payload can quietly exfiltrate the entire shop book and the bearer token.
- **Hosted web build** (`subarna-pasal.vercel.app`, referenced in `desktop/launcher.sh:16`) — same payload, ordinary browser, bearer token sits in `localStorage` (`auth.js:30-36`). That is straightforward account takeover.

**Applied fix:** an `escapeHtml()` helper added and applied to user-controlled interpolations in the render paths. See "What was changed" below.

**Also recommended (not applied — needs a run-through in your app to confirm nothing breaks):** add a CSP. For the desktop build, in `main.js` inside `app.whenReady()`:

```js
const { session } = require('electron');
session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
  cb({ responseHeaders: { ...details.responseHeaders,
    'Content-Security-Policy': [
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; " +
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    ] } });
});
```

For the hosted build the same policy plus `https://cdn.jsdelivr.net` in `script-src` and your Supabase origin in `connect-src`. Load it report-only first if you want to be careful.

## 4. High — license keys returned in plaintext

`LicenseController::list()` selects `DB::table('licenses')` with no column filter, and the table stores the full `license_key` (`issueKey()`, line 137). One admin-token request returns every customer's working key. Combined with finding 1, any customer can pull the whole key list.

**Applied fix:** `list()` now returns `license_key_masked` (`SP.…` + last 8 characters) instead of the working key, so no single request bulk-dumps keys. Because you still need to resend a key to a shop for a renewal, a new admin endpoint `POST /api/license/reveal {id}` returns one key at a time (throttled 20/min), and the admin page's "Copy key" button now calls it on demand. Consider also dropping the `license_key` column entirely — `key_hash` is all the server needs for `activate` and `check`, and storing the key means a database leak hands out working licenses.

## 5. High — unauthenticated sync endpoints

`routes/api.php:44-48` places `sync/run`, `sync/status` and `sync/restore` outside every auth group:

- `POST /api/sync/restore` takes an arbitrary `userId` and **overwrites the local store** with whatever the server returns. On the desktop that means any local process — or any other user account on a shared shop PC — can wipe the shop's book, or pull down a different shop's data into it.
- `GET /api/sync/status` leaks the configured server URL.
- `GET /api/sync/run` lets anything local force a sync pass.

The backend binds to `127.0.0.1` only (`main.js:189`), which limits this to local attackers — but a shop counter PC with a shared Windows login is exactly that scenario. On the **hosted** deployment these same routes are exposed to the internet.

**Applied fix:** `restore` now requires the sync token. `run` and `status` are left open because the Electron shell calls them over loopback without credentials — flagged rather than broken. If you want them closed too, have `main.js` pass the token on those two calls.

## 6. Medium — unauthenticated writes to the shared price feed

`POST /api/shared/gold-rates/ticks` (`RatesController::appendTicks`) has no auth on either backend, and the same route in the Node server is in `PUBLIC_PATHS` (`middlewares/auth.ts:6-9`). Anyone on the internet can push arbitrary gold prices into the shared rate table. When a shop runs `priceMode: 'api'`, those numbers drive sale prices. For a gold retailer that is a direct financial-integrity problem, not a cosmetic one.

**Applied fix:** the Laravel route moved inside the `attach.user` group. In no-login mode it still passes through as `local-dev`, so desktop behaviour is unchanged; on the hosted server it now requires a signed-in user. The Node server needs the same change (`PUBLIC_PATHS`).

## 7. Medium — account security basics

- **6-character minimum, no complexity rule** (`AuthController::isValidPassword`, `LicenseController::signup`). For a system holding a jeweller's full customer and dues ledger, 8–10 minimum is the floor.
- **`forgotPassword()` is a stub** that always replies "a reset link was sent to your email". Nothing is sent. Users will lock themselves out and believe a reset is in flight.
- **Login throttle is `10,1`** — 10 attempts per minute per IP, 14,400/day. Against a 6-character password that is a real risk. Add per-account lockout with backoff, not just per-IP throttling.
- No email/phone verification on signup, so `LicenseController::signup` will happily create accounts and one-year licenses for anyone who can reach the endpoint (rate-limited to 5/min).

I did not raise the password minimum in code: `login()` validates length *before* checking the hash, so raising it would lock out every existing user with a shorter password. Raise it on signup and change-password only, and prompt existing users at next login.

## 8. Medium — licensing

Two separate points.

**It is switched off.** `desktop-app/main.js:23` — `const LICENSING_ENABLED = false;`. Every build produced from this tree has no activation, no expiry, no revocation. Whatever protection you believe is in the shipped installers is not running.

**It cannot be strong where it lives.** The cryptography is right: Ed25519 signatures on both the key and the activation receipt, verified against a baked-in public key, so a fake server cannot mint a valid receipt and forging a key is infeasible. But the *check* runs in JavaScript inside an unencrypted asar. `npx asar extract app.asar out/` → flip one boolean → repack. Roughly ten minutes' work. Related weaknesses:

- `license.json` and `license-state.json` are plain JSON in the user-data folder. Deleting `license-state.json` clears the clock-rollback guard and the revocation flag.
- The revocation kill switch only fires when the machine is online; an offline shop runs indefinitely.
- `DEFAULT_LICENSE_SERVER` is still the `https://YOUR-SERVER.example.com` placeholder (`license.js:29`). Ship a build with that and every activation fails.

Client-side licensing in Electron buys you honesty from honest customers, nothing more. If the licensing needs to be real, the lever is server-side: gate something the shop actually needs from your server — the sync backup, the shared gold-rate feed — on a valid, unrevoked license, and refuse to serve it otherwise.

## 9. Medium — no update channel

`package.json` has no `electron-updater`, no `publish` block, no update check anywhere in `main.js`. Every fix in this document reaches installed shops only if you personally rebuild, redistribute, and talk each shop through reinstalling. Electron ships a browser engine; Chromium CVEs land monthly. An app with no update path accumulates them.

Add `electron-updater` with a signed release feed, or at minimum a version check on launch that tells the shop an update is available and where to get it.

## 10. Low

- **Wildcard CORS** — `app.use(cors())` in `artifacts/api-server/src/app.ts:22` allows any origin. Auth is bearer-token rather than cookie, so this is not directly exploitable, but it removes a useful layer. Pin it to your own origins.
- **`file://` navigation permitted** — `main.js:451` allows navigation to any `file://` URL. Combined with an XSS this becomes local-file read in the renderer. Restrict to the two bundled HTML files.
- **`sandbox` not set explicitly** — Electron 33 defaults it on, but state it in `webPreferences` so a future refactor cannot silently drop it.
- **Signing key unencrypted on disk** — `desktop-app/license-signing/license-private.pem` has no passphrase. Correctly gitignored and absent from git history, but it is the root of the whole licensing scheme and there is no rotation path (the public key is baked into every installed copy). Move it to a password manager or a hardware token; keep an offline backup.
- **`laravel-backend/.env` has `APP_DEBUG=true` and `LOG_LEVEL=debug`.** Harmless locally — the desktop shell forces `APP_DEBUG=false` at runtime (`main.js:132`) — but if that file is ever the basis for the hosted deployment, every 500 response leaks a stack trace with environment values.
- **`desktop/launcher.sh`** opens the hosted app in a normal Chrome profile via `--app=`. The bearer token then lives in that profile's `localStorage`, shared with everything else the shop browses. Prefer the Electron build.

---

## What was changed

Applied to the **source of truth** — `laravel-backend/` and `artifacts/subarnapasal/`. Note that `desktop-app/backend/` is a *generated* copy: `desktop-app/scripts/prepare-backend.sh` rebuilds it from these directories, so run that before the next `npm run dist:mac` / `dist:win`.

1. `laravel-backend/app/Http/Controllers/Api/SyncController.php` — `password` and `remember_token` removed from the `kind:"users"` column whitelist; `restore()` now requires the sync token.
2. `laravel-backend/app/Services/SyncService.php` — `pushAccounts()` strips `password` and `remember_token` before sending.
3. `laravel-backend/app/Http/Controllers/Api/LicenseController.php` — `list()` returns a masked key; new admin-only `reveal()` returns one key at a time.
4. `laravel-backend/public/admin-licenses.html` — shows the masked key; "Copy key" fetches the real one on demand.
5. `laravel-backend/routes/api.php` — `shared/gold-rates/ticks` moved behind `attach.user`; `license/reveal` route added (throttle 20/min).
6. `artifacts/subarnapasal/public/*.js` — `escapeHtml()` added to `app.js` and applied to 162 user-controlled interpolations across `app.js` (115), `options.js` (15), `requests.js` (12), `pos-extras.js` (11), `karigar.js` (4), `hero-carousel.js` (3), `item-jarti.js` (2), including attribute contexts (`title=`, `value=`, `data-*`, `alt=`). Formatter output, computed numbers, static `t()` translations and app-built HTML fragments were deliberately left unescaped. All 20 files pass `node --check`.
7. `desktop-app/main.js` — `sandbox: true` set explicitly on all three windows; `will-navigate` narrowed from "any `file://`" to the app's own origin plus `license.html` and `settings.html`.

Also worth a follow-up: `karigar.js` and `pos-extras.js` each declare a *global* `escHtml`, and the two versions differ (the `karigar.js` one does not escape `'`). Whichever script loads last wins. It is harmless today because every attribute in those files is double-quoted and the stricter version loads later, but reordering the script tags would silently downgrade the escaping. Consolidate both onto the new `escapeHtml`.

PHP files verified with `php -l`, JS with `node --check`. No runtime testing was performed — please click through the POS, the karigar screen, a bill print, and the license admin page once before shipping.

## What was deliberately not changed

- **Per-shop sync tokens (finding 1).** This is a schema and protocol change affecting every deployed installation; it needs your decision on migration, not a silent edit.
- **CSP (finding 3).** The policy above is correct as far as static review can tell, but a CSP that is slightly wrong breaks the app silently. Add it and click through the POS once.
- **Password minimum (finding 7).** Raising it in `isValidPassword` would lock out existing users, because `login()` validates length before comparing the hash.
- **`sync/run` and `sync/status` (finding 5).** The Electron shell calls these over loopback with no credentials; adding auth requires a matching change in `main.js`.
- **`LICENSING_ENABLED` (finding 8).** Turning it back on is a business decision, and the placeholder license-server URL must be filled in first.

## Priority order

1. Rotate `SYNC_API_TOKEN` and move to per-shop tokens with server-side `userId` resolution (finding 1).
2. Redeploy the backend with the applied fixes (findings 2, 4, 5, 6).
3. Rebuild and redistribute the desktop app with the escaping fix (finding 3).
4. Add a CSP, then an update channel (findings 3, 9).
5. Password policy, real password reset, per-account lockout (finding 7).
