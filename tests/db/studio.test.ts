import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, balance, colomboDate, createCustomer, createDb, expectSqlError, rpc, type Db } from './harness'

let db: Db
let customer: string

async function booking(extra: Record<string, unknown> = {}) {
  return rpc<string>(db, 'save_studio_booking', {
    customer_id: customer,
    package_name: 'Wedding Gold',
    shoot_date: colomboDate(10),
    start_time: '09:00',
    end_time: '13:00',
    location: 'Galle Face Hotel',
    package_price: '50000',
    additional_charges: '0',
    required_advance: '20000',
    ...extra,
  })
}

const pay = (sourceId: string, amount: string, method = 'cash', extra: Record<string, unknown> = {}) =>
  rpc<{ id: string; confirmed: boolean; duplicate: boolean }>(db, 'record_payment', {
    source_type: 'studio_booking', source_id: sourceId, amount, method, ...extra,
  })

const status = (id: string, s: string) =>
  db.as(ADMIN_ID, () => db.query(`select public.set_document_status('studio_booking', $1, $2)`, [id, s]))

beforeAll(async () => {
  db = await createDb()
  customer = await createCustomer(db)
})

describe('Studio of RV booking workflow', () => {
  it('starts as Pending Advance with a generated booking ID', async () => {
    const id = await booking()
    const row = await db.one<{ ref: string; status: string }>(`select ref, status from public.studio_bookings where id = $1`, [id])
    expect(row.ref).toMatch(/^SB-\d{6}$/)
    expect(row.status).toBe('pending_advance')
  })

  it('cannot be confirmed before the advance is recorded', async () => {
    const id = await booking()
    await expectSqlError(status(id, 'confirmed'), '23514', /advance payment/)
  })

  it('advance payment confirms the booking and creates 7/3/1/0-day reminders', async () => {
    const id = await booking()
    const res = await pay(id, '20000', 'bank_transfer')
    expect(res.confirmed).toBe(true)
    expect((await balance(db, id)).status).toBe('confirmed')
    const kinds = await db.query<{ title: string }>(
      `select title from public.reminders where studio_booking_id = $1 and kind = 'studio_shoot' order by due_at`, [id])
    expect(kinds.rows.map((r) => r.title.split(' – ')[0])).toEqual(['Shoot in 7 days', 'Shoot in 3 days', 'Shoot in 1 day', 'Shoot today'])
  })

  it('a smaller advance does not confirm', async () => {
    const id = await booking()
    const res = await pay(id, '5000')
    expect(res.confirmed).toBe(false)
    expect((await balance(db, id)).status).toBe('pending_advance')
  })

  it('recalculates the balance after every partial payment (spec example)', async () => {
    const id = await booking()
    await pay(id, '20000')
    expect((await balance(db, id)).outstanding).toBe(30000)
    await pay(id, '10000', 'card')
    expect((await balance(db, id)).outstanding).toBe(20000)
    await status(id, 'in_progress')
    await status(id, 'shoot_completed')
    await expectSqlError(status(id, 'closed'), '23514', /fully paid/)
    await pay(id, '20000', 'bank_transfer')
    const b = await balance(db, id)
    expect(b.outstanding).toBe(0)
    expect(b.paymentStatus).toBe('paid')
    await status(id, 'closed')
    expect((await balance(db, id)).status).toBe('closed')
  })

  it('rejects payments above the outstanding balance and on closed bookings', async () => {
    const id = await booking({ package_price: '10000', required_advance: '1000' })
    await expectSqlError(pay(id, '10000.01'), '23514', /outstanding balance/)
    await pay(id, '10000')
    await status(id, 'shoot_completed')
    await status(id, 'closed')
    await expectSqlError(pay(id, '1'), '23514', /closed or cancelled/)
  })

  it('does not duplicate a payment submitted twice', async () => {
    const id = await booking()
    const key = '9a7b1e0c-1111-4a2b-8c3d-000000000001'
    const first = await pay(id, '20000', 'cash', { client_request_id: key })
    const second = await pay(id, '20000', 'cash', { client_request_id: key })
    expect(second.duplicate).toBe(true)
    expect(second.id).toBe(first.id)
    expect((await balance(db, id)).netPaid).toBe(20000)
  })

  it('prevents overlapping confirmed shoots for the same photographer', async () => {
    const photographer = await db.as(ADMIN_ID, () =>
      db.val<string>(`insert into public.studio_resources (name) values ('Kasun (photographer)') returning id`))
    const a = await booking({ resource_id: photographer, shoot_date: colomboDate(20), start_time: '09:00', end_time: '12:00' })
    await pay(a, '20000')
    const b = await booking({ resource_id: photographer, shoot_date: colomboDate(20), start_time: '11:00', end_time: '14:00' })
    // Booking B can exist while pending, but its advance can't confirm an overlapping slot.
    await expectSqlError(pay(b, '20000'), '23P01', /already booked/)
    expect((await balance(db, b)).netPaid).toBe(0) // the payment was rolled back
    const c = await booking({ resource_id: photographer, shoot_date: colomboDate(20), start_time: '12:00', end_time: '15:00' })
    expect((await pay(c, '20000')).confirmed).toBe(true) // back-to-back is fine
  })

  it('links shoot expenses to the booking and computes shoot profit', async () => {
    const id = await booking({ package_price: '40000', additional_charges: '5000', required_advance: '10000' })
    const transport = await db.val<string>(`select id from public.transaction_categories where name = 'Transport'`)
    const photographer = await db.val<string>(`select id from public.transaction_categories where name = 'Photographer Payments'`)
    await rpc(db, 'record_expense', { source_type: 'studio_booking', source_id: id, category_id: transport, amount: '3000', method: 'cash' })
    await rpc(db, 'record_expense', { source_type: 'studio_booking', source_id: id, category_id: photographer, amount: '12000', method: 'bank_transfer' })
    const exp = await db.one<{ total: string; business: string }>(
      `select sum(e.amount) as total, min(b.slug) as business from public.expenses e join public.businesses b on b.id = e.business_id where e.studio_booking_id = $1`, [id])
    expect(Number(exp.total)).toBe(15000)
    expect(exp.business).toBe('studio-of-rv')
    const due = (await balance(db, id)).amountDue
    expect(due - Number(exp.total)).toBe(30000)
  })

  it('cancelling keeps a retained advance as revenue and clears the balance', async () => {
    const id = await booking()
    await pay(id, '20000')
    await db.as(ADMIN_ID, () => db.query(`select public.cancel_document('studio_booking', $1, 'Customer changed plans')`, [id]))
    const b = await balance(db, id)
    expect(b.status).toBe('cancelled')
    expect(b.outstanding).toBe(0)
    expect(b.amountDue).toBe(20000) // retained advance recognised as revenue
    const pending = await db.val<number>(`select count(*)::int from public.reminders where studio_booking_id = $1 and status = 'pending'`, [id])
    expect(pending).toBe(0)
  })
})
