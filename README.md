# RV BUSINESS HUB

Private business management system for four businesses under one secure admin dashboard:

| Business | Module |
|---|---|
| **Studio of RV** | Photography bookings: advance → confirm → shoot → balance → close |
| **The Frame House** | Frame orders: items, production, payment, delivery |
| **RV Camera Rent** | Equipment rentals: availability, pickup and ID check, return inspection, deposits |
| **Gift Park** | Gift orders and sales, product catalogue and stock |

Shared across all four: customers, central payments ledger, expenses (including shared bills), pending payments, receipts, calendar and reminders, in-app notifications, dashboards, and reports with PDF and Excel export.

**LKR · Asia/Colombo · DD/MM/YYYY** · React 19 + TypeScript + Tailwind 4 · Supabase (Postgres, Auth, RLS) · Vercel · PWA · light and dark mode

---

## Accounting rules (applied identically everywhere)

| Concept | Rule |
|---|---|
| **Earned revenue (P&L)** | Recognised when the work is done: shoot completed · frame delivered · camera returned · gift delivered. The amount is the job's final amount due (charges ± adjustments). Direct sales count on the day received. |
| **Collections** | Money actually received, by method (cash / card / bank transfer), on the payment date. Shown separately from P&L. |
| **Advance payments** | Payments received before the job was completed. They are collections now and earned when the job completes, so they are **never counted twice**. |
| **Refundable deposits** | Liabilities. **Never income or profit.** Applying part of a deposit to the bill moves it to charges ("Deposit applied"), and the rest is returned. |
| **Expenses** | Counted on the date paid, always under one business. A **shared expense** is split by an explicit rule (equal, percentage or fixed). Only the per-business shares are counted, so consolidated totals are never inflated. |
| **Net profit** | Earned revenue − expenses. |
| **Outstanding** | Amount due − (charge payments − charge refunds). |
| **Cancellation** | Any amount kept (for example, a non-refunded advance) is recorded as cancellation revenue on the cancellation date. Nothing stays outstanding. |
| **Corrections** | Entries are **voided with a reason**, never deleted. Amounts can't be edited after recording. Every change is in the audit log. |

## Business rules enforced by the database

The app can't bypass these. They are triggers, constraints and admin-only RPCs:

- A studio booking is **confirmed only after the required advance** is recorded. Recording it confirms the booking automatically and reserves the date.
- A photographer or studio resource **can't have overlapping confirmed shoots** (exclusion constraint).
- A frame is **delivered only after full payment**.
- Camera equipment **can't be double-booked** for overlapping dates. Rental charge = daily rates × days, with part days rounded up. The late fee is calculated from your settings.
- A camera rental **closes only when** the equipment is returned, the balance is paid, the deposit is settled, and any held ID is returned. Handover requires identity verification. Only the ID type and last 4 characters are stored, never full numbers or images.
- Gift delivery follows a configurable full-payment rule. Stock is tracked in an append-only movement ledger.
- Payments can't exceed the balance. Deposits apply to rentals only. Duplicate submissions (same request key) are ignored.
- Status changes follow fixed workflows. Closed or cancelled records can't be edited.

---

## Updating an existing installation (you already ran migrations 1–3)

Run the **new** migrations **in order** in the Supabase **SQL Editor**, pasting each file and clicking *Run*:

1. `supabase/migrations/20261016000004_operations_schema.sql`
2. `supabase/migrations/20261016000005_finance_schema.sql`, which **moves every existing Phase 1 income and expense transaction** into the new `payments` and `expenses` tables and then removes the old `transactions` table. Nothing is lost.
3. `supabase/migrations/20261016000006_workflows.sql`
4. `supabase/migrations/20261016000007_reminders.sql`
5. `supabase/migrations/20261016000008_reporting.sql`
6. `supabase/migrations/20261016000009_security.sql`

Or use the CLI: `npx supabase link --project-ref <ref>` and then `npx supabase db push`.

To check the result:
```sql
select count(*) from public.businesses;            -- 4
select relname from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity;  -- no rows
select * from public.system_settings;              -- one row of defaults
```

## Fresh installation

1. Create a Supabase project. Under **Authentication**, turn **off** “Allow new users to sign up”. Set the Site URL to your production URL, and add `https://<domain>/reset-password` and `http://localhost:5173/reset-password` to the Redirect URLs.
2. Run **all nine** files in `supabase/migrations/` in filename order.
3. Create the administrator in **Authentication → Users → Add user** (tick *Auto confirm*). Then, in the SQL Editor:
   ```sql
   select private.grant_admin('owner@example.com', 'Your Name');
   ```
   Only one administrator is allowed. That's enforced by the database.
4. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (from Project Settings → API). **Never** put the service-role or secret key in any `VITE_*` variable.

## First-time setup in the app

- **Settings → Studio setup**: add photography packages and photographers or studios.
- **Inventory → Camera equipment**: add each camera or lens, with serial number, daily rate and default deposit.
- **Inventory → Gift Park products**: add products, then use *Purchase / restock* to set the opening stock.
- **Settings → Rules & reminders**: reminder intervals, the default studio advance %, the late-fee multiplier and grace period, the Gift Park delivery rule, and the receipt footer.
- **Settings → Categories**: add or deactivate income and expense categories.

## Commands

```bash
npm install
npm run dev              # http://localhost:5173
npm run typecheck
npm test                 # unit & component tests (Vitest)
npm run test:db          # database tests: runs the REAL migrations in PGlite (no Docker needed)
npm run build            # production build + PWA service worker
npm run db:types         # regenerate src/types/database.ts from the migrations
npm run test:integration # optional live tests against a staging Supabase project (see tests/integration)
```

`npm run test:db` checks RLS on every table and view, anonymous and non-admin lockout, every workflow rule above, overlap prevention, payment, refund, deposit and void flows, report maths, shared-expense allocation, reminders and notifications, and the migration of Phase 1 data.

## Deploying to Vercel

1. Push the repository and import it into Vercel. The Vite framework is detected, and `vercel.json` provides the SPA rewrites and the security headers (CSP, HSTS, frame-deny).
2. Add the environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Deploy, then add the production URL to the Supabase Site URL and Redirect URLs.
4. On phones, install the app with *Add to Home Screen* (iOS) or *Install app* (Android).

### Reminders and notifications

Automatic reminders are rebuilt whenever a booking, order, rental, payment or setting changes. While the app is open, it turns due reminders into stored notifications every 5 minutes, so they appear on any device you sign in from. To generate them even when nobody has the app open, you can optionally enable **pg_cron** in Supabase and schedule:

```sql
select cron.schedule('rv-notifications', '*/10 * * * *', $$
  insert into public.notifications (reminder_id, business_id, kind, title, body, link)
  select r.id, r.business_id, r.kind, r.title, r.body, '/calendar' from public.reminders r
  where r.status = 'pending' and r.notified_at is null and r.due_at <= now()
  on conflict (reminder_id) do nothing;
  update public.reminders set notified_at = now() where status = 'pending' and notified_at is null and due_at <= now();
$$);
```

The `channel` column (`in_app` / `email` / `whatsapp`) is ready for email or WhatsApp delivery in a later phase.

## Security model

- Supabase Auth with email and password, and no public sign-up. The single administrator is on an allowlist in a private schema that the API can't reach.
- **RLS is on for every table and view.** Anonymous visitors get nothing, and a signed-in non-admin gets empty results.
- **Least privilege:** money and workflow changes go only through admin-checked RPCs. Ledger rows are append-only (void, don't delete). Stock changes only through movements. Audit logs are read-only.
- Customer ID data is minimised to the ID type and last 4 characters.
- Sign-out clears every cached record. The PWA caches only the app shell, never API responses.

## Verifying security after deployment

1. Open the app in a private window: you're redirected to sign-in.
2. Call the API with only the anon key: `curl "$VITE_SUPABASE_URL/rest/v1/payments?select=*" -H "apikey: $VITE_SUPABASE_ANON_KEY"`. You should get a permission error or `[]`.
3. Sign in as a second, non-allowlisted user: you'll see *Access denied* and be signed out.
4. Optionally, run `npm run test:integration` against a staging project.

## Project structure

```
src/
  app/            router, auth provider, route guard, query client
  components/     ui/ primitives · documents/ (list, detail frame, money dialogs) · customers/ · forms/ · dashboard/ · layout/
  pages/          dashboard · transactions · customers · studio · frames · camera · gifts · inventory · payments · calendar · reports · receipts · businesses · settings · auth
  services/       all Supabase access (typed RPC calls)
  hooks/          TanStack Query hooks, URL-backed filters
  lib/            money (integer cents), dates (Colombo, DD/MM/YYYY), finance previews, validation (Zod), status machines, exporters (PDF/Excel), theme
  types/          database.ts (generated) · domain.ts
supabase/migrations/   0001–0003 Phase 1 · 0004 operations · 0005 finance · 0006 workflows · 0007 reminders · 0008 reporting · 0009 security
tests/db/              PGlite database tests · tests/integration/ live Supabase tests
scripts/               gen-db-types.ts
```

## Known limitations

- Single administrator only, by design. Adding staff roles means dropping the single-admin index and adding role checks.
- Email and WhatsApp reminder delivery isn't built yet. The data model is ready for it.
- PDF and Excel exports are generated in the browser. CSV export of the transaction history is capped at 10,000 rows per export.
- Gift Park operational rules are configurable but deliberately simple (full-payment rule, stock deduction timing) until the details are finalised.
- No offline data entry. A connection is required to read or record anything.
