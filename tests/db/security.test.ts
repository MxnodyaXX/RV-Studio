import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, INTRUDER_ID, createCustomer, createDb, expectSqlError, type Db } from './harness'

let db: Db

const TABLES = [
  'businesses', 'transaction_categories', 'admin_profiles', 'audit_logs', 'system_settings', 'customers',
  'studio_packages', 'studio_resources', 'studio_bookings', 'frame_orders', 'frame_order_items', 'camera_equipment',
  'camera_rentals', 'camera_rental_items', 'camera_condition_checks', 'camera_rental_id_handover_records',
  'gift_products', 'gift_orders', 'gift_order_items', 'inventory_movements', 'payments', 'refunds',
  'financial_adjustments', 'shared_expenses', 'expenses', 'reminders', 'notifications',
]
const VIEWS = ['source_documents', 'receivables', 'ledger_entries']

beforeAll(async () => {
  db = await createDb()
  await createCustomer(db)
})

describe('row level security', () => {
  it('is enabled on every table in the public schema', async () => {
    const rows = await db.query<{ relname: string }>(
      `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`)
    expect(rows.rows).toEqual([])
  })

  it('views run with the caller\'s privileges', async () => {
    const rows = await db.query<{ relname: string; opts: string[] | null }>(
      `select relname, reloptions as opts from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'`)
    for (const r of rows.rows) expect(r.opts ?? []).toContain('security_invoker=true')
  })

  it.each([...TABLES, ...VIEWS])('anonymous users cannot read %s', async (table) => {
    await expectSqlError(db.as(null, () => db.query(`select * from public.${table} limit 1`)), '42501')
  })

  it.each([...TABLES, ...VIEWS])('a signed-in non-admin sees nothing in %s', async (table) => {
    const rows = await db.as(INTRUDER_ID, () => db.query(`select * from public.${table} limit 1`).catch(() => ({ rows: [] as unknown[] })))
    expect(rows.rows).toEqual([])
  })

  it('a non-admin cannot call any business RPC', async () => {
    const calls = [
      `select public.save_studio_booking('{}'::jsonb)`,
      `select public.record_payment('{}'::jsonb)`,
      `select public.record_expense('{}'::jsonb)`,
      `select public.void_entry('payment', gen_random_uuid(), 'reason')`,
      `select public.generate_notifications()`,
      `select * from public.check_equipment_availability(now(), now() + interval '1 day')`,
    ]
    for (const sql of calls) await expectSqlError(db.as(INTRUDER_ID, () => db.query(sql)), '42501')
    const summary = await db.as(INTRUDER_ID, () => db.query<Record<string, unknown>>(`select * from public.report_business_summary()`))
    expect(summary.rows.every((r) => Object.values(r).every((v) => v === null || typeof v === 'string' || Number(v) === 0))).toBe(true)
    expect(await db.as(INTRUDER_ID, () => db.val(`select public.dashboard_operations()`))).toBeNull()
  })

  it('anonymous users cannot call RPCs at all', async () => {
    await expectSqlError(db.as(null, () => db.query(`select public.record_payment('{}'::jsonb)`)), '42501')
    await expectSqlError(db.as(null, () => db.query(`select * from public.report_business_summary()`)), '42501')
  })

  it('a non-admin cannot write reference data', async () => {
    await expectSqlError(db.as(INTRUDER_ID, () => db.query(`insert into public.customers (full_name) values ('x')`)), '42501')
    const upd = await db.as(INTRUDER_ID, () => db.query(`update public.customers set full_name = 'hacked' returning id`))
    expect(upd.rows).toEqual([])
  })
})

describe('admin direct edits of reference data (fire triggers as the admin)', () => {
  it('can create and edit customers, packages, equipment, products, stock, settings, reminders and notifications', async () => {
    await db.as(ADMIN_ID, async () => {
      const c = await db.val<string>(`insert into public.customers (full_name) values ('Edit Me') returning id`)
      await db.query(`update public.customers set phone = '0771112222', notes = 'VIP' where id = $1`, [c])
      await db.query(`insert into public.studio_packages (name, base_price) values ('Test pkg', 1000)`)
      await db.query(`update public.studio_packages set base_price = 1200 where name = 'Test pkg'`)
      const e = await db.val<string>(`insert into public.camera_equipment (name, serial_number, daily_rate) values ('Cam', 'SN-EDIT', 100) returning id`)
      await db.query(`update public.camera_equipment set status = 'maintenance' where id = $1`, [e])
      const p = await db.val<string>(`insert into public.gift_products (name, unit_price) values ('Card', 200) returning id`)
      await db.query(`update public.gift_products set unit_price = 250 where id = $1`, [p])
      await db.query(`insert into public.inventory_movements (product_id, quantity, reason) values ($1, 5, 'purchase')`, [p])
      await db.query(`update public.system_settings set studio_reminder_days = '{5,1}', receipt_footer = 'Thanks!'`)
      await db.query(`insert into public.transaction_categories (name, type) values ('Courier', 'expense')`)
      const r = await db.val<string>(`insert into public.reminders (kind, title, due_at) values ('custom', 'x', now()) returning id`)
      await db.query(`update public.reminders set status = 'done' where id = $1`, [r])
      await db.query(`select public.generate_notifications()`)
      await db.query(`update public.notifications set read_at = now()`)
    })
    expect(await db.val<number>(`select stock_quantity from public.gift_products where name = 'Card'`)).toBe(5)
    expect(await db.val<string>(`select phone from public.customers where full_name = 'Edit Me'`)).toBe('0771112222')
  })
})

describe('admin direct-write lockdown', () => {
  it('money can only be recorded through the RPCs', async () => {
    const b = await db.val<string>(`select id from public.businesses limit 1`)
    await expectSqlError(db.as(ADMIN_ID, () => db.query(
      `insert into public.payments (business_id, amount, method, paid_on) values ($1, 1, 'cash', current_date)`, [b])), '42501')
    await expectSqlError(db.as(ADMIN_ID, () => db.query(
      `insert into public.studio_bookings (customer_id) values (gen_random_uuid())`)), '42501')
    await expectSqlError(db.as(ADMIN_ID, () => db.query(`delete from public.audit_logs`)), '42501')
  })

  it('the admin cannot read or grant the allowlist', async () => {
    await expectSqlError(db.as(ADMIN_ID, () => db.query(`select * from private.admin_allowlist`)), '42501')
    await expectSqlError(db.as(ADMIN_ID, () => db.query(`select private.grant_admin('intruder@test.local')`)), '42501')
  })

  it('ID verification stores only the type and last 4 characters', async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'camera_rental_id_handover_records'`)
    const names = cols.rows.map((c) => c.column_name)
    expect(names).toContain('id_last4')
    expect(names.some((n) => /image|photo|scan|full|number/.test(n))).toBe(false)
  })
})

describe('Phase 1 data migration', () => {
  it('moves existing income/expense transactions into payments and expenses without loss', async () => {
    const migrated = await createDb({
      before: {
        file: '20261016000005',
        run: async (pg) => {
          await pg.query(`
            insert into public.transactions (business_id, category_id, type, amount, transaction_date, payment_method, reference, description, client_request_id)
            select b.id, c.id, c.type, v.amount, date '2026-09-10', 'card', 'INV-9', 'legacy', gen_random_uuid()
            from public.businesses b
            cross join (values ('Gift Sales', 1234.56::numeric), ('Transport', 99.99::numeric)) as v(cat, amount)
            join public.transaction_categories c on c.name = v.cat
            where b.slug = 'gift-park' and c.name = v.cat`)
        },
      },
    })
    const p = await migrated.one<{ amount: string; method: string; reference: string }>(`select amount, method, reference from public.payments`)
    expect(p).toMatchObject({ amount: '1234.56', method: 'card', reference: 'INV-9' })
    const e = await migrated.one<{ amount: string; receipt_reference: string }>(`select amount, receipt_reference from public.expenses`)
    expect(e).toMatchObject({ amount: '99.99', receipt_reference: 'INV-9' })
    const s = await migrated.as(ADMIN_ID, () => migrated.one<{ earned_revenue: string; expenses_total: string }>(
      `select earned_revenue, expenses_total from public.report_business_summary('2026-09-01', '2026-09-30') where business_id = (select id from public.businesses where slug = 'gift-park')`))
    expect(Number(s.earned_revenue)).toBe(1234.56)
    expect(Number(s.expenses_total)).toBe(99.99)
  })
})
