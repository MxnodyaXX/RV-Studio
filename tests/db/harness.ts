// Runs the real Supabase migrations inside PGlite (Postgres compiled to WASM)
// with a minimal shim of the Supabase environment (auth schema, roles, auth.uid()).
// Lets RLS, constraints, triggers and reporting functions be tested with no Docker.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

const MIGRATIONS_DIR = join(import.meta.dirname, '../../supabase/migrations')

const SUPABASE_SHIM = /* sql */ `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema if not exists extensions;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create table auth.users (
    id uuid primary key,
    email text unique,
    aud text default 'authenticated',
    role text default 'authenticated',
    instance_id uuid,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated;
`

export const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
export const INTRUDER_ID = '22222222-2222-4222-8222-222222222222'

export type Db = PGlite & {
  /** Run as the database owner (like the Supabase SQL Editor). */
  asOwner: <T>(fn: () => Promise<T>) => Promise<T>
  /** Run as an authenticated API user with the given id, or as anon when null. */
  as: <T>(userId: string | null, fn: () => Promise<T>) => Promise<T>
  one: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T>
  val: <T = unknown>(sql: string, params?: unknown[]) => Promise<T>
}

export async function createDb({ withAdmin = true, before }: { withAdmin?: boolean; before?: { file: string; run: (db: PGlite) => Promise<void> } } = {}): Promise<Db> {
  const pg = (await PGlite.create({ extensions: { btree_gist } })) as unknown as Db
  await pg.exec(SUPABASE_SHIM)

  let adminGranted = false
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (before && file.startsWith(before.file)) {
      await seedUsers(pg)
      if (withAdmin) await pg.query(`select private.grant_admin('admin@test.local', 'Test Admin')`)
      adminGranted = true
      await before.run(pg)
    }
    try {
      await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`)
    }
  }

  pg.asOwner = async (fn) => {
    await pg.exec(`reset role; select set_config('request.jwt.claims', '', false);`)
    return fn()
  }
  pg.as = async (userId, fn) => {
    const claims = userId ? JSON.stringify({ sub: userId, role: 'authenticated' }) : ''
    await pg.exec(`reset role;`)
    await pg.query(`select set_config('request.jwt.claims', $1, false)`, [claims])
    await pg.exec(`set role ${userId ? 'authenticated' : 'anon'};`)
    try {
      return await fn()
    } finally {
      await pg.exec(`reset role; select set_config('request.jwt.claims', '', false);`)
    }
  }
  pg.one = async (sql, params) => (await pg.query(sql, params)).rows[0] as never
  pg.val = async (sql, params) => {
    const row = (await pg.query(sql, params)).rows[0] as Record<string, unknown> | undefined
    return (row ? Object.values(row)[0] : undefined) as never
  }

  if (!adminGranted) {
    await seedUsers(pg)
    if (withAdmin) await pg.query(`select private.grant_admin('admin@test.local', 'Test Admin')`)
  }
  return pg
}

async function seedUsers(pg: PGlite) {
  await pg.query(`insert into auth.users (id, email) values ($1, 'admin@test.local'), ($2, 'intruder@test.local')`, [ADMIN_ID, INTRUDER_ID])
}

/** Calls an RPC as the admin with a JSON payload and returns its single value. */
export async function rpc<T = unknown>(db: Db, fn: string, payload: Record<string, unknown>): Promise<T> {
  return db.as(ADMIN_ID, () => db.val<T>(`select public.${fn}($1::jsonb)`, [JSON.stringify(payload)]))
}

/** Creates a customer as the admin and returns its id. */
export async function createCustomer(db: Db, name = 'Nimal Perera'): Promise<string> {
  return db.as(ADMIN_ID, () => db.val<string>(`insert into public.customers (full_name, phone) values ($1, '0771234567') returning id`, [name]))
}

/** Balance row from the receivables view, with numbers as JS numbers. */
export async function balance(db: Db, sourceId: string) {
  const row = await db.as(ADMIN_ID, () =>
    db.one<Record<string, string>>(
      `select amount_due, net_paid, outstanding, deposit_held, payment_status, status from public.receivables where source_id = $1`,
      [sourceId],
    ),
  )
  return {
    amountDue: Number(row.amount_due),
    netPaid: Number(row.net_paid),
    outstanding: Number(row.outstanding),
    depositHeld: Number(row.deposit_held),
    paymentStatus: row.payment_status,
    status: row.status,
  }
}

/** YYYY-MM-DD in Asia/Colombo, offset by n days from today. */
export function colomboDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(d)
}

/** Expects a promise to reject with the given SQLSTATE (and optional message fragment). */
export async function expectSqlError(p: Promise<unknown>, code: string, message?: RegExp) {
  try {
    await p
  } catch (e) {
    const err = e as { code?: string; message: string }
    if (err.code !== code) throw new Error(`Expected SQLSTATE ${code}, got ${err.code}: ${err.message}`)
    if (message && !message.test(err.message)) throw new Error(`Error message "${err.message}" does not match ${message}`)
    return err
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`)
}
