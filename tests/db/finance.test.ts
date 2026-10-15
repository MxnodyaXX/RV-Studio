import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, colomboDate, createCustomer, createDb, expectSqlError, rpc, type Db } from './harness'

let db: Db
let customer: string
let biz: Record<string, string>
let cat: Record<string, string>

const asAdmin = <T>(fn: () => Promise<T>) => db.as(ADMIN_ID, fn)
const setStatus = (type: string, id: string, s: string) =>
  asAdmin(() => db.query(`select public.set_document_status($1::public.source_type, $2, $3)`, [type, id, s]))

type Summary = Record<string, number> & { business_id: string }
async function summary(from: string | null = null, to: string | null = null): Promise<Record<string, Summary>> {
  const rows = await asAdmin(() => db.query<Record<string, string>>(`select * from public.report_business_summary($1, $2)`, [from, to]))
  const bySlug = Object.fromEntries(Object.entries(biz).map(([slug, id]) => [id, slug]))
  return Object.fromEntries(
    rows.rows.map((r) => [bySlug[r.business_id], Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'business_id' ? v : Number(v)])) as Summary]),
  )
}

beforeAll(async () => {
  db = await createDb()
  customer = await createCustomer(db)
  biz = Object.fromEntries((await db.query<{ slug: string; id: string }>(`select slug, id from public.businesses`)).rows.map((r) => [r.slug, r.id]))
  cat = Object.fromEntries((await db.query<{ name: string; id: string }>(`select name, id from public.transaction_categories where business_id is null`)).rows.map((r) => [r.name, r.id]))
})

describe('earned revenue vs collections', () => {
  it('recognises revenue on completion, not on advance payment, and never counts deposits', async () => {
    const before = await summary()

    // Studio: 50,000 package, 20,000 advance → nothing earned yet.
    const shoot = await rpc<string>(db, 'save_studio_booking', {
      customer_id: customer, package_name: 'Portrait', shoot_date: colomboDate(3), start_time: '10:00', end_time: '11:00',
      location: 'Studio', package_price: '50000', required_advance: '20000' })
    await rpc(db, 'record_payment', { source_type: 'studio_booking', source_id: shoot, amount: '20000', method: 'cash' })

    // Camera: deposit 30,000 + charge 6,000 paid by card.
    const cam = await asAdmin(() => db.val<string>(`insert into public.camera_equipment (name, serial_number, daily_rate) values ('Canon R6', 'SN-R6', 6000) returning id`))
    const pickup = new Date(Date.now() + 86_400_000).toISOString()
    const ret = new Date(Date.now() + 2 * 86_400_000).toISOString()
    const rental = await rpc<string>(db, 'save_camera_rental', { customer_id: customer, pickup_at: pickup, expected_return_at: ret, items: [{ equipment_id: cam }] })
    await rpc(db, 'record_payment', { source_type: 'camera_rental', source_id: rental, amount: '30000', method: 'cash', purpose: 'deposit' })
    await rpc(db, 'record_payment', { source_type: 'camera_rental', source_id: rental, amount: '6000', method: 'card' })

    let s = await summary()
    expect(s['studio-of-rv'].earned_revenue - before['studio-of-rv'].earned_revenue).toBe(0)
    expect(s['studio-of-rv'].collected_cash - before['studio-of-rv'].collected_cash).toBe(20000)
    expect(s['studio-of-rv'].advance_payments - before['studio-of-rv'].advance_payments).toBe(20000)
    expect(s['studio-of-rv'].outstanding - before['studio-of-rv'].outstanding).toBe(30000)
    expect(s['rv-camera-rent'].earned_revenue).toBe(0)
    expect(s['rv-camera-rent'].collected_card).toBe(6000)
    expect(s['rv-camera-rent'].collected_cash).toBe(0) // the deposit is not a collection of income
    expect(s['rv-camera-rent'].deposits_received).toBe(30000)
    expect(s['rv-camera-rent'].deposits_held).toBe(30000)

    // Complete the shoot → full 50,000 earned even though 30,000 is still owed.
    await setStatus('studio_booking', shoot, 'shoot_completed')
    s = await summary()
    expect(s['studio-of-rv'].earned_revenue - before['studio-of-rv'].earned_revenue).toBe(50000)
    expect(s['studio-of-rv'].net_profit - before['studio-of-rv'].net_profit).toBe(50000)

    // Later balance payment: collected, but not earned a second time.
    await rpc(db, 'record_payment', { source_type: 'studio_booking', source_id: shoot, amount: '30000', method: 'bank_transfer' })
    const after = await summary()
    expect(after['studio-of-rv'].earned_revenue).toBe(s['studio-of-rv'].earned_revenue)
    expect(after['studio-of-rv'].collected_bank - s['studio-of-rv'].collected_bank).toBe(30000)
    expect(after['studio-of-rv'].outstanding - before['studio-of-rv'].outstanding).toBe(0)
  })

  it('separates periods: completed in one month, paid in another', async () => {
    const id = await rpc<string>(db, 'save_frame_order', { customer_id: customer, items: [{ frame_type: 'Oak', frame_size: 'A3', quantity: 1, unit_price: '10000' }] })
    await rpc(db, 'record_payment', { source_type: 'frame_order', source_id: id, amount: '10000', method: 'cash', paid_on: '2026-01-15' })
    await setStatus('frame_order', id, 'ready')
    await setStatus('frame_order', id, 'delivered')
    const jan = await summary('2026-01-01', '2026-01-31')
    const today = await summary(colomboDate(0), colomboDate(0))
    expect(jan['the-frame-house'].collected_cash).toBe(10000)
    expect(jan['the-frame-house'].earned_revenue).toBe(0)
    expect(today['the-frame-house'].earned_revenue).toBeGreaterThanOrEqual(10000)
  })
})

describe('direct sales, expenses and shared expenses', () => {
  it('records a direct sale as earned and collected on the same day', async () => {
    const before = await summary()
    await rpc(db, 'record_payment', { business_id: biz['gift-park'], category_id: cat['Direct Sale'], amount: '2500.50', method: 'cash' })
    const s = await summary()
    expect(s['gift-park'].earned_revenue - before['gift-park'].earned_revenue).toBeCloseTo(2500.5)
    expect(s['gift-park'].direct_sales - before['gift-park'].direct_sales).toBeCloseTo(2500.5)
  })

  it('splits a shared expense exactly and counts it once in consolidated totals', async () => {
    const before = await summary()
    const res = await rpc<{ allocations: { business_id: string; amount: number }[] }>(db, 'create_shared_expense', {
      category_id: cat['Electricity'], total_amount: '10000', method: 'bank_transfer', description: 'October electricity',
      allocation_method: 'equal', allocations: Object.values(biz).slice(0, 3).map((business_id) => ({ business_id })),
    })
    const amounts = res.allocations.map((a) => Number(a.amount))
    expect(amounts).toEqual([3333.33, 3333.33, 3333.34])
    const s = await summary()
    const totalDelta = Object.keys(s).reduce((acc, k) => acc + (s[k].expenses_total - before[k].expenses_total), 0)
    expect(totalDelta).toBeCloseTo(10000, 2)
  })

  it('validates percentage allocations', async () => {
    await expectSqlError(rpc(db, 'create_shared_expense', {
      category_id: cat['Rent'], total_amount: '1000', method: 'cash', description: 'Rent',
      allocation_method: 'percentage', allocations: [{ business_id: biz['gift-park'], percent: 50 }, { business_id: biz['studio-of-rv'], percent: 40 }],
    }), '22023', /add up to 100/)
  })

  it('rejects a business-specific category on another business', async () => {
    const printing = await db.val<string>(`select id from public.transaction_categories where name = 'Printing Cost'`)
    await expectSqlError(rpc(db, 'record_expense', { business_id: biz['gift-park'], category_id: printing, amount: '100', method: 'cash' }), '23514', /different business/)
  })
})

describe('corrections are traceable', () => {
  it('voids a payment with a reason, keeps the record, and restores the balance', async () => {
    const id = await rpc<string>(db, 'save_frame_order', { customer_id: customer, items: [{ frame_type: 'Pine', frame_size: '8x10', quantity: 1, unit_price: '2000' }] })
    const p = await rpc<{ id: string }>(db, 'record_payment', { source_type: 'frame_order', source_id: id, amount: '2000', method: 'cash' })
    await expectSqlError(asAdmin(() => db.query(`select public.void_entry('payment', $1, '')`, [p.id])), '22023')
    await asAdmin(() => db.query(`select public.void_entry('payment', $1, 'Entered twice by mistake')`, [p.id]))
    const row = await db.one<{ voided_at: string | null; void_reason: string; voided_by: string }>(`select voided_at, void_reason, voided_by from public.payments where id = $1`, [p.id])
    expect(row.voided_at).not.toBeNull()
    expect(row.voided_by).toBe(ADMIN_ID)
    const due = await db.val<string>(`select outstanding from public.receivables where source_id = $1`, [id])
    expect(Number(due)).toBe(2000)
    const ledger = await asAdmin(() => db.one<{ is_voided: boolean }>(`select is_voided from public.ledger_entries where id = $1`, [p.id]))
    expect(ledger.is_voided).toBe(true)
  })

  it('does not allow amounts to be edited or entries deleted', async () => {
    const p = await rpc<{ id: string }>(db, 'record_payment', { business_id: biz['gift-park'], category_id: cat['Gift Sales'], amount: '100', method: 'cash' })
    await expectSqlError(asAdmin(() => db.query(`update public.payments set amount = 1 where id = $1`, [p.id])), '42501')
    await expectSqlError(asAdmin(() => db.query(`delete from public.payments where id = $1`, [p.id])), '42501')
    // Notes may still be edited.
    await asAdmin(() => db.query(`update public.payments set notes = 'Paid at counter' where id = $1`, [p.id]))
  })

  it('every financial change is written to the audit log', async () => {
    const count = await db.val<number>(`select count(*)::int from public.audit_logs where entity_type in ('payments', 'expenses', 'refunds')`)
    expect(count).toBeGreaterThan(5)
  })
})

describe('payment method report', () => {
  it('tracks cash, card and bank transfer independently', async () => {
    const rows = await asAdmin(() => db.query<{ method: string; charge_payments: string }>(
      `select method, sum(charge_payments) as charge_payments from public.report_payment_methods() group by method`))
    const by = Object.fromEntries(rows.rows.map((r) => [r.method, Number(r.charge_payments)]))
    expect(by.cash).toBeGreaterThan(0)
    expect(by.card).toBeGreaterThan(0)
    expect(by.bank_transfer).toBeGreaterThan(0)
  })

  it('consolidated totals equal the sum of the four businesses', async () => {
    const s = await summary()
    const rows = Object.values(s)
    expect(rows).toHaveLength(4)
    const sum = (k: string) => rows.reduce((a, r) => a + r[k], 0)
    const net = sum('net_profit')
    expect(net).toBeCloseTo(sum('earned_revenue') - sum('expenses_total'), 2)
  })
})
