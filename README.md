# SubarnaPasal

Gold store inventory management and POS for Nepali jewelry stores.

## Run

```bash
sh start.sh
```

- Frontend: http://localhost:19951/
- API: http://localhost:8080

Requires Node.js and pnpm (a local copy under `.tools/node` works if present).

## Storage

Prefers Supabase when configured (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), always mirrors to local JSON, and falls back to local JSON if the server database is unavailable.
