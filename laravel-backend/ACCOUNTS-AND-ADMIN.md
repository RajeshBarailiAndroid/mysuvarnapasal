# Shop accounts, the administrator, and password reset

Backend implementation of the moderation + auth flow that the Android app and
the web sign-in pages were already written against.

Everything here is **additive**. No existing route, table or feature was
removed; `route:list` goes from 93 to 101 API routes and every previous route
still resolves.

## Deploy

```bash
cd laravel-backend
php artisan migrate            # adds the new columns + reset-token table
php artisan pos:create-admin --username=admin --email=you@yourdomain.com
```

The command prints a random password **once**. Sign in with it, change the
password, and only then does the admin console open — `EnsureAdmin` refuses
every `/api/admin/*` call while `must_change_password` is set.

Rotate it later with `php artisan pos:create-admin --reset-password`
(this also signs the admin out everywhere). To make an existing shop the
admin instead, use `--promote=<username>`.

### Mail

Reset links are sent with whatever `MAIL_MAILER` is configured. With the
default `log` driver they land in `storage/logs/laravel.log` — fine for
testing, but set real SMTP before shops rely on it. Also set:

```
FRONTEND_URL=https://yourdomain.com     # where reset-password.html is served
```

The link is built as `{FRONTEND_URL}/reset-password.html?token=<64 hex>&email=…`,
which is exactly what the existing `reset-password-page.js` parses.

## Existing shops are safe

The migration back-fills every account that already exists to
`status = approved` with **no expiry**. Shipping it without that back-fill
would have locked every current shop out of their own data the moment it ran.
Only accounts created after this deploy start as `pending`.

## Account states

```
signup (mobile only) ──▶ pending ──approve──▶ approved ──unapprove──▶ pending
                            │                    │  ▲
                          deny                   │  └── extend (+1 year)
                            ▼                    │
                         denied ──approve────────┤
                                                 ▼
                                           deactivated  (read-only)
                                                 │
                                            reactivate
```

| State | Can sign in | Can read | Can write |
|---|---|---|---|
| `pending` | no | – | – |
| `approved` | yes | yes | yes |
| `denied` | no | – | – |
| `deactivated` | yes | yes | **no** |
| approved but expired | no | – | – |

`deactivated` is deliberately softer than `denied`: the shop keeps its session
and can still read and export its own records, but every write is refused.
That is the state to use when someone is behind on payment.

Approval grants **1 year** (`User::SUBSCRIPTION_YEARS`). Extend adds another
year, counted from the current expiry when it is still in the future, so
renewing early does not cost a shop the time it already paid for.

## Endpoints added

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/reset-password` | was missing; the web page already called it |
| GET | `/api/admin/users` | `?status=pending&q=` — list + counts |
| POST | `/api/admin/users/{id}/approve` | starts/renews the subscription |
| POST | `/api/admin/users/{id}/extend` | +1 year |
| POST | `/api/admin/users/{id}/unapprove` | back to pending, signs them out |
| POST | `/api/admin/users/{id}/deny` | blocks, signs them out |
| POST | `/api/admin/users/{id}/deactivate` | read-only, session kept |
| POST | `/api/admin/users/{id}/reactivate` | back to approved |
| DELETE | `/api/admin/users/{id}` | `?confirmUsername=` required; purges shop data |

Response shapes match `data/ApiModels.kt` exactly (`Account`,
`AdminUsersResponse`, `AdminCounts`, `AdminUserResponse`,
`DeleteAccountResponse`). **Renaming a key here breaks the mobile admin
screen** — it was written first and this backend was fitted to it.

## Security decisions worth knowing

- **Signup is mobile-only, enforced server-side.** The API requires
  `X-SP-Client: mobile` (which `ApiClient.kt` already sends) and answers 403
  otherwise. The web having no signup form was never the actual control.
- **There is no code path that creates an admin.** Signup hardcodes
  `pending` + non-admin and ignores any role in the body, so privilege
  escalation has nothing to attack. Only the artisan command grants admin.
- **Approval is re-checked on every request**, not just at login
  (`AttachUser`). Suspending a shop ends their access on their next request
  rather than whenever their token happens to expire. Moderation actions that
  remove access also delete their tokens.
- **`/api/admin/*` answers 404, not 403, to non-admins**, so the admin
  surface is not discoverable by probing. It also ignores `AUTH_ENABLED=false`
  — no-login desktop mode must never confer moderation powers over every shop.
- **Reset tokens are stored only as `sha256(token)`**, single use, 60-minute
  expiry, and requesting a new link invalidates outstanding ones. A database
  dump yields no working reset links.
- **`forgot-password` always returns the same 200 and message**, whether or
  not the account exists, and mail failures are swallowed and logged —
  otherwise a 500 would itself confirm the address exists.
- **A completed reset deletes every token**, because a reset is the standard
  response to "someone else is in my account" and has to actually evict them.
- **New passwords need 8+ characters** and may not contain the username or
  email local part (matching `validateNewPassword` in the web frontend).
  Presented passwords still accept 6, so shops created under the old rule can
  still sign in.
- **Deletion requires typing the username back** and purges the shop's POS
  rows explicitly. The POS tables use a composite `(user_id, id)` key with no
  FK to `users`, so nothing would cascade and the data would otherwise linger.

## Tenant isolation

Unchanged in shape: every POS table is keyed by `user_id` and every controller
scopes through `ApiController::userId()`, which reads the id the middleware
resolved from the token — never from the request body. That remains the
boundary. Two things to consider next:

- Add a regression test that signs in as shop A, requests shop B's item by id,
  and asserts a miss. That single test is what stops a future refactor from
  quietly widening a query.
- If you later want database-level enforcement as well, Postgres row-level
  security keyed on a per-request `SET LOCAL app.user_id` would catch any
  query that forgets its `WHERE user_id = ?`. That is a bigger change than it
  sounds on MySQL/SQLite and was deliberately not attempted here.

## What was verified

Run against a scratch SQLite database with the API actually booted:

- migration applies; **two pre-existing shops came out `approved` with no expiry**
- web signup 403 / mobile signup 201 → `pending`, no token issued
- pending login 403; approved login 200
- shop token gets **404** on `/api/admin/users`
- suspending a shop killed its live token on the next request (401)
- deactivate → `GET /items` 200, `POST /items` 403
- approve → `remainingDays: 365`; extend → 731
- backdated expiry blocks login with the expiry message
- reset link parsed, token is 64 hex, stored only as a hash, single use,
  mismatch rejected, old password stopped working, new one worked
- delete refused on wrong confirmation and on the admin itself; on success the
  shop's `items` and `settings` rows went to zero
- 101 API routes registered; `items`, `sales`, `sync`, `license`, `public`,
  `metal-rates` all still resolve
