# Integration & database security tests

These verify Row Level Security against a **real, non-production** Supabase project.
They are not run by `npm test` (unit tests only).

## 1. Live RLS tests (Vitest)

1. Create a separate Supabase project for testing and apply `supabase/migrations/*`.
2. Create two users in *Authentication → Users*: an admin and a non-admin.
3. Allowlist only the admin (SQL Editor):
   ```sql
   select private.grant_admin('test-admin@example.com', 'Test Admin');
   ```
4. Run:
   ```bash
   TEST_SUPABASE_URL=... TEST_SUPABASE_ANON_KEY=... \
   TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... \
   TEST_NON_ADMIN_EMAIL=... TEST_NON_ADMIN_PASSWORD=... \
   npm run test:integration
   ```
   Without these variables the suite is skipped.

The tests create a test customer and a small frame order that is paid and delivered
(kept as test data — the ledger is append-only by design, so use a staging project).

## 2. Local database tests (no Docker)

`npm run test:db` applies the real migrations to PGlite (Postgres in WebAssembly) with a
small Supabase shim and checks RLS, workflows, money rules, reporting and reminders.
See `tests/db/`.
