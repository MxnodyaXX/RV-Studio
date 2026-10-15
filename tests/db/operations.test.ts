import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, balance, colomboDate, createCustomer, createDb, expectSqlError, rpc, type Db } from './harness'

let db: Db
let customer: string

const asAdmin = <T>(fn: () => Promise<T>) => db.as(ADMIN_ID, fn)
const setStatus = (type: string, id: string, s: string) =>
  asAdmin(() => db.query(`select public.set_document_status($1::public.source_type, $2, $3)`, [type, id, s]))
const pay = (type: string, id: string, amount: string, extra: Record<string, unknown> = {}) =>
  rpc(db, 'record_payment', { source_type: type, source_id: id, amount, method: 'cash', ...extra })

beforeAll(async () => {
  db = await createDb()
  customer = await createCustomer(db, 'Sanduni Silva')
})

describe('The Frame House orders', () => {
  const order = () =>
    rpc<string>(db, 'save_frame_order', {
      customer_id: customer,
      expected_completion_date: colomboDate(5),
      items: [
        { frame_type: 'Wooden', frame_size: '12x18', quantity: 2, unit_price: '4500' },
        { frame_type: 'Glass', frame_size: 'A4', quantity: 1, unit_price: '3000.50' },
      ],
    })

  it('totals the line items exactly', async () => {
    const id = await order()
    const o = await db.one<{ ref: string; total_amount: string }>(`select ref, total_amount from public.frame_orders where id = $1`, [id])
    expect(o.ref).toMatch(/^FO-\d{6}$/)
    expect(Number(o.total_amount)).toBe(12000.5)
  })

  it('can only be delivered after full payment', async () => {
    const id = await order()
    await pay('frame_order', id, '5000')
    await setStatus('frame_order', id, 'processing')
    await setStatus('frame_order', id, 'ready')
    await expectSqlError(setStatus('frame_order', id, 'delivered'), '23514', /Full payment is required/)
    await pay('frame_order', id, '4000', { method: 'card' })
    await pay('frame_order', id, '3000.50', { method: 'bank_transfer' })
    expect((await balance(db, id)).outstanding).toBe(0)
    await setStatus('frame_order', id, 'delivered')
    const o = await db.one<{ delivered_on: string | null }>(`select delivered_on::text from public.frame_orders where id = $1`, [id])
    expect(o.delivered_on).toBe(colomboDate(0))
    await setStatus('frame_order', id, 'closed')
  })

  it('rejects invalid status jumps', async () => {
    const id = await order()
    await expectSqlError(setStatus('frame_order', id, 'closed'), '23514', /Cannot change status/)
  })

  it('locks items after delivery', async () => {
    const id = await order()
    await pay('frame_order', id, '12000.50')
    await setStatus('frame_order', id, 'ready')
    await setStatus('frame_order', id, 'delivered')
    await expectSqlError(
      rpc(db, 'save_frame_order', { id, customer_id: customer, items: [{ frame_type: 'X', frame_size: 'Y', quantity: 1, unit_price: '1' }] }),
      '23514',
    )
  })

  it('a refund with price reduction keeps the order balanced', async () => {
    const id = await order()
    await pay('frame_order', id, '12000.50')
    await rpc(db, 'record_refund', { source_type: 'frame_order', source_id: id, amount: '1000', method: 'cash', reason: 'Scratched glass discount' })
    const b = await balance(db, id)
    expect(b.amountDue).toBe(11000.5)
    expect(b.netPaid).toBe(11000.5)
    expect(b.outstanding).toBe(0)
  })
})

describe('RV Camera Rent rentals', () => {
  let camera: string
  let lens: string

  beforeAll(async () => {
    camera = await asAdmin(() => db.val<string>(
      `insert into public.camera_equipment (name, serial_number, daily_rate, default_deposit) values ('Sony A7 IV', 'SN-A7-001', 8000, 50000) returning id`))
    lens = await asAdmin(() => db.val<string>(
      `insert into public.camera_equipment (name, category, serial_number, daily_rate) values ('Sony 24-70 GM', 'Lens', 'SN-L-002', 3000) returning id`))
  })

  const at = (days: number, hour = 10) => {
    const d = new Date(Date.now() + days * 86_400_000)
    d.setUTCHours(hour - 5, 30, 0, 0) // hh:00 Asia/Colombo
    return d.toISOString()
  }
  const rental = (from: number, to: number, items = [camera], deposit = '50000') =>
    rpc<string>(db, 'save_camera_rental', {
      customer_id: customer, pickup_at: at(from), expected_return_at: at(to), deposit_required: deposit,
      items: items.map((equipment_id) => ({ equipment_id })),
    })

  it('calculates the rental charge from daily rates × days', async () => {
    const id = await rental(1, 4, [camera, lens])
    const r = await db.one<{ rental_days: number; rental_charge: string; ref: string }>(
      `select rental_days, rental_charge, ref from public.camera_rentals where id = $1`, [id])
    expect(r.ref).toMatch(/^CR-\d{6}$/)
    expect(r.rental_days).toBe(3)
    expect(Number(r.rental_charge)).toBe((8000 + 3000) * 3)
  })

  it('prevents the same equipment being rented for overlapping dates', async () => {
    await rental(30, 33)
    await expectSqlError(rental(32, 35), '23P01', /already booked for overlapping dates/)
    await rental(33, 35) // starts exactly when the first ends
    const avail = await asAdmin(() => db.query<{ equipment_id: string; is_available: boolean; conflict_ref: string }>(
      `select * from public.check_equipment_availability($1, $2)`, [at(31), at(32)]))
    const cam = avail.rows.find((r) => r.equipment_id === camera)!
    expect(cam.is_available).toBe(false)
    expect(cam.conflict_ref).toMatch(/^CR-/)
  })

  it('runs pickup → return → settlement and only closes when everything is settled', async () => {
    const id = await rental(40, 42)
    // Deposit is a liability, not income.
    await pay('camera_rental', id, '50000', { purpose: 'deposit' })
    await pay('camera_rental', id, '6000') // advance
    await expectSqlError(setStatus('camera_rental', id, 'rented_out'), '23514', /Verify the customer/)
    await asAdmin(() => db.query(`select public.camera_pickup($1, $2::jsonb)`, [id, JSON.stringify({
      verified: true, id_type: 'nic', id_last4: '123V', original_held: true,
      items: [{ equipment_id: camera, condition: 'excellent', accessories: 'Battery x2, charger, strap' }],
    })]))
    const out = await db.one<{ status: string; id_status: string }>(`select status, id_status from public.camera_rentals where id = $1`, [id])
    expect(out).toEqual({ status: 'rented_out', id_status: 'held' })
    expect((await db.one<{ id_last4: string }>(`select id_last4 from public.camera_rental_id_handover_records where rental_id = $1`, [id])).id_last4).toBe('123V')

    // Returned one day late → late fee = daily rate × 1 day (multiplier 1).
    const res = await asAdmin(() => db.val<{ late_days: number; late_fee: number }>(`select public.camera_return($1, $2::jsonb)`, [id, JSON.stringify({
      returned_at: at(43), damage_charge: '2500', items: [{ equipment_id: camera, condition: 'fair', accessories: 'Battery x2, charger' }],
    })]))
    expect(res.late_days).toBe(1)
    expect(Number(res.late_fee)).toBe(8000)

    let b = await balance(db, id)
    expect(b.amountDue).toBe(16000 + 8000 + 2500)
    expect(b.outstanding).toBe(20500)
    expect(b.depositHeld).toBe(50000)

    await expectSqlError(setStatus('camera_rental', id, 'closed'), '23514', /balance must be paid/)
    // Apply part of the deposit to the balance, return the rest, give the ID back.
    await pay('camera_rental', id, '20500', { method: 'deposit' })
    await expectSqlError(setStatus('camera_rental', id, 'closed'), '23514', /Settle the security deposit/)
    await rpc(db, 'record_refund', { source_type: 'camera_rental', source_id: id, kind: 'deposit_return', amount: '29500', method: 'cash', reason: 'Deposit balance returned' })
    await expectSqlError(setStatus('camera_rental', id, 'closed'), '23514', /Return the customer's ID/)
    await asAdmin(() => db.query(`select public.camera_return_id($1, 'NIC handed back')`, [id]))
    await setStatus('camera_rental', id, 'closed')

    b = await balance(db, id)
    expect(b).toMatchObject({ outstanding: 0, depositHeld: 0, status: 'closed' })
  })

  it('cannot apply more deposit than is held', async () => {
    const id = await rental(50, 51)
    await pay('camera_rental', id, '1000', { purpose: 'deposit' })
    await expectSqlError(pay('camera_rental', id, '2000', { method: 'deposit' }), '23514', /deposit is available/)
  })

  it('deposits are only allowed on rentals', async () => {
    const order = await rpc<string>(db, 'save_frame_order', {
      customer_id: customer, items: [{ frame_type: 'A', frame_size: 'B', quantity: 1, unit_price: '100' }] })
    await expectSqlError(pay('frame_order', order, '100', { purpose: 'deposit' }), '23514')
  })
})

describe('Gift Park orders and inventory', () => {
  let mug: string

  beforeAll(async () => {
    mug = await asAdmin(() => db.val<string>(
      `insert into public.gift_products (sku, name, unit_price, cost_price) values ('MUG-1', 'Photo Mug', 1500, 600) returning id`))
    await asAdmin(() => db.query(`insert into public.inventory_movements (product_id, quantity, reason) values ($1, 10, 'purchase')`, [mug]))
  })

  const stock = () => db.val<number>(`select stock_quantity from public.gift_products where id = $1`, [mug])
  const order = (qty: number) =>
    rpc<string>(db, 'save_gift_order', { items: [{ product_id: mug, quantity: qty }], delivery_charge: '500' })

  it('deducts stock on order and prices from the product', async () => {
    const id = await order(3)
    expect(await stock()).toBe(7)
    expect((await balance(db, id)).amountDue).toBe(3 * 1500 + 500)
  })

  it('re-saving an order adjusts stock by the difference only', async () => {
    const id = await order(2)
    expect(await stock()).toBe(5)
    await rpc(db, 'save_gift_order', { id, items: [{ product_id: mug, quantity: 4 }] })
    expect(await stock()).toBe(3)
  })

  it('refuses orders beyond available stock', async () => {
    await expectSqlError(order(50), '23514', /Insufficient stock/)
    expect(await stock()).toBe(3)
  })

  it('restores stock when an order is cancelled', async () => {
    const id = await order(1)
    expect(await stock()).toBe(2)
    await asAdmin(() => db.query(`select public.cancel_document('gift_order', $1, 'Customer no longer needs it')`, [id]))
    expect(await stock()).toBe(3)
  })

  it('applies the configurable full-payment-before-delivery rule', async () => {
    const id = await order(1)
    await expectSqlError(setStatus('gift_order', id, 'delivered'), '23514', /Full payment/)
    await asAdmin(() => db.query(`update public.system_settings set gift_require_full_payment_before_delivery = false`))
    await setStatus('gift_order', id, 'delivered')
    await expectSqlError(setStatus('gift_order', id, 'completed'), '23514', /outstanding/)
    await pay('gift_order', id, '2000')
    await setStatus('gift_order', id, 'completed')
  })

  it('stock movements are append-only and stock cannot be set directly', async () => {
    await expectSqlError(asAdmin(() => db.query(`update public.inventory_movements set quantity = 100`)), '42501')
    await expectSqlError(asAdmin(() => db.query(`update public.gift_products set stock_quantity = 100`)), '42501')
    await expectSqlError(asAdmin(() =>
      db.query(`insert into public.inventory_movements (product_id, quantity, reason) values ($1, -1, 'sale')`, [mug])), '42501')
  })
})
