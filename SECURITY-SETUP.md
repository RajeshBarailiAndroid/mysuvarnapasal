# SubarnaPasal — accounts, admin & password-reset setup

**Date:** 28 August 2026. Covers the changes to `pasalrepo/backend`, `pasalrepo/frontend`, and the `subarnapasal-mobile` apps.

## What changed

**Sign-up is mobile-only now.** The web login page no longer has a sign-up form — it points new shops at the mobile app. The API enforces it too: `POST /api/auth/signup` refuses requests without the `X-SP-Client: mobile` header, which both phone apps now send on every request. Every new account still starts as `pending` and cannot sign in until an administrator approves it — that approval is the real gate; the header just keeps the web path closed.

**Password reset works for real.** "Forgot password" now emails a one-time link. The flow follows standard practice: the link token is 32 random bytes and only its SHA-256 hash is stored, the link expires after 60 minutes, it works exactly once, the response never reveals whether an account exists, sending is limited to one email per account per 2 minutes on top of the route throttle, and a successful reset signs the account out of every device. The reset page (`reset-password.html`) was rewritten against the new `POST /api/auth/reset-password` endpoint — the old Supabase code is gone.

**New-password policy is 8+ characters** (NIST-style: length over forced symbols, with the worst common passwords refused) — on sign-up, change-password, and reset, on the server and in all three clients. Existing shorter passwords still log in; nobody is locked out.

**Admins can now delete a store.** `DELETE /api/admin/users/{id}` removes the account and *every* row of its data — settings, items, sales, customers, dues, karigar ledger, repairs, schemes, requests, photos — in one transaction. The admin must type the shop's username to confirm (`confirmUsername`), and admins and your own account can never be deleted. Both mobile Admin screens got a "Delete store…" action with that typed confirmation. Approve / extend / unapprove / deny were already in place and are unchanged.

**Deactivate = read-only mode (added 28 Aug, later the same day).** Alongside deny there is now *deactivate*: the shop still signs in and sees all its data, but every add/change/delete is refused by the server with a clear message, and the web app shows a "view-only" banner. Reactivate restores normal access without extending the subscription. Both actions are on the mobile Admin screens; the API endpoints are `POST /api/admin/users/{id}/deactivate` and `/reactivate`.

**Print reports (web).** The Reports view has a new "Print report" button opening `print-report.html`: every feature's data — Inventory, Transactions, Sales, Orders, Customers, Karigar, Gold Ledger, Old Gold, Records, Repairs, Requests, Schemes, Shop Info — as printable sections titled like the app's navigation, with the same columns as the on-screen tables. Sections are selectable, and a From/To date range filters Transactions and Sales before printing. Print uses the browser's print dialog (Ctrl/Cmd+P works too), so it can also save as PDF.

**One admin, set in the database only.** There is deliberately no API that grants admin rights — the only ways are the console or SQL, so nothing that talks HTTP can ever promote an account.

## One-time setup on the server (Hostinger)

### 1. Make your admin

Sign up for a normal account in the mobile app first (or use an existing one), then either:

```bash
ssh -p 65002 u971057202@88.223.84.40
cd /home/u971057202/public_html
php artisan pos:make-admin <your-username>
```

or run this in phpMyAdmin:

```sql
UPDATE users SET is_admin = 1, status = 'approved', expires_at = NULL
WHERE username = 'your-username';
```

Admins never expire and cannot be suspended or deleted from the app. `php artisan pos:revoke-admin <username>` undoes it (it refuses to remove the last admin).

### 2. Turn on email

Create a mailbox in hPanel → Emails (e.g. `no-reply@mysuvarnapasal.com`), then set in the server's `.env`:

```
MAIL_MAILER=smtp
MAIL_HOST=smtp.hostinger.com
MAIL_PORT=465
MAIL_SCHEME=smtps
MAIL_USERNAME=no-reply@mysuvarnapasal.com
MAIL_PASSWORD=<the mailbox password>
MAIL_FROM_ADDRESS=no-reply@mysuvarnapasal.com
MAIL_FROM_NAME=SubarnaPasal
```

then `php artisan config:clear`. Until you do this, reset emails go to `storage/logs/laravel.log` instead of an inbox. If the frontend ever moves to a different host than the API, also set `APP_FRONTEND_URL=https://mysuvarnapasal.com` — the reset link is built from it.

### 3. Deploy

Upload the changed `pasalrepo/backend` files and the `pasalrepo/frontend` files to the server the same way as the original deployment, then `php artisan route:clear && php artisan config:clear`. No new migration is needed — the reset flow uses the `password_reset_tokens` table that has existed since the first migration, and the admin columns were added by the earlier `add_account_status_to_users` migration.

## How each store's data is isolated

Every store is one user, and every row of store data — items, sales, customers, settings, all of it — carries that user's id; every query in the backend goes through one `Store` service that filters on it, and the API attaches the user id from the bearer token, never from the request body. So stores share one MySQL database but can never see or touch each other's rows, and deleting a store removes its rows and only its rows. This is the standard multi-tenant design for an app of this size. Physically separate databases per store would mean provisioning a database, credentials, and migrations for every signup on shared hosting — real cost for no additional practical isolation here. If you ever want it anyway (e.g. a big client demands their own database), say so and I'll lay out what it takes.

## Follow-ups worth doing

The old `SECURITY-REVIEW.md` items about the shared `SYNC_API_TOKEN` still stand for the sync/licensing endpoints. And neither mobile app has been compiled yet — expect to fix an import or two on first build.
