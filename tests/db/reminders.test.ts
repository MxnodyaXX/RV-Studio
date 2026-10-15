import { beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, colomboDate, createCustomer, createDb, rpc, type Db } from './harness'

let db: Db
let customer: string
const asAdmin = <T>(fn: () => Promise<T>) => db.as(ADMIN_ID, fn)

beforeAll(async () => {
  db = await createDb()
  customer = await createCustomer(db, 'Dilini Fernando')
})

describe('reminders and notifications', () => {
  it('respects the configured studio reminder intervals', async () => {
    await asAdmin(() => db.query(`update public.system_settings set studio_reminder_days = '{5,2}'`))
    const id = await rpc<string>(db, 'save_studio_booking', {
      customer_id: customer, package_name: 'Family', shoot_date: colomboDate(9), start_time: '08:00', end_time: '10:00',
      location: 'Kandy', package_price: '30000', required_advance: '10000' })
    await rpc(db, 'record_payment', { source_type: 'studio_booking', source_id: id, amount: '10000', method: 'cash' })
    const titles = (await db.query<{ title: string }>(
      `select title from public.reminders where studio_booking_id = $1 and kind = 'studio_shoot' order by due_at`, [id])).rows
    expect(titles.map((t) => t.title.split(' – ')[0])).toEqual(['Shoot in 5 days', 'Shoot in 2 days'])

    // Changing settings rebuilds reminders for open bookings.
    await asAdmin(() => db.query(`update public.system_settings set studio_reminder_days = '{1}'`))
    const after = await db.val<number>(`select count(*)::int from public.reminders where studio_booking_id = $1 and kind = 'studio_shoot'`, [id])
    expect(after).toBe(1)
  })

  it('creates payment-due reminders and removes them once paid', async () => {
    const id = await rpc<string>(db, 'save_frame_order', {
      customer_id: customer, expected_completion_date: colomboDate(4),
      items: [{ frame_type: 'Teak', frame_size: '16x20', quantity: 1, unit_price: '8000' }] })
    const due = () => db.val<number>(`select count(*)::int from public.reminders where frame_order_id = $1 and kind = 'payment_due' and status = 'pending'`, [id])
    expect(await due()).toBeGreaterThan(0)
    await rpc(db, 'record_payment', { source_type: 'frame_order', source_id: id, amount: '8000', method: 'card' })
    expect(await due()).toBe(0)
  })

  it('turns due reminders into notifications exactly once', async () => {
    await asAdmin(() => db.query(`insert into public.reminders (title, due_at, kind) values ('Call the framer', now() - interval '1 minute', 'custom')`))
    const first = await asAdmin(() => db.val<number>(`select public.generate_notifications()`))
    const second = await asAdmin(() => db.val<number>(`select public.generate_notifications()`))
    expect(first).toBeGreaterThanOrEqual(1)
    expect(second).toBe(0)
    const n = await db.one<{ title: string; link: string }>(`select title, link from public.notifications where title = 'Call the framer'`)
    expect(n.link).toBe('/calendar')
  })

  it('creates an overdue alert for rentals not returned on time', async () => {
    const cam = await asAdmin(() => db.val<string>(`insert into public.camera_equipment (name, serial_number, daily_rate) values ('GoPro', 'SN-GP', 2000) returning id`))
    const id = await rpc<string>(db, 'save_camera_rental', {
      customer_id: customer, pickup_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      expected_return_at: new Date(Date.now() - 86_400_000).toISOString(), items: [{ equipment_id: cam }] })
    await asAdmin(() => db.query(`select public.camera_pickup($1, '{"verified": true, "id_type": "nic"}'::jsonb)`, [id]))
    await asAdmin(() => db.val(`select public.generate_notifications()`))
    const overdue = await db.val<number>(`select count(*)::int from public.notifications n join public.reminders r on r.id = n.reminder_id where r.camera_rental_id = $1 and r.kind = 'rental_overdue'`, [id])
    expect(overdue).toBe(1)
    const ops = await asAdmin(() => db.val<{ camera: { overdue_rentals: number } }>(`select public.dashboard_operations()`))
    expect(ops.camera.overdue_rentals).toBe(1)
  })

  it('the calendar shows events from every business', async () => {
    const rows = await asAdmin(() => db.query<{ event_type: string }>(
      `select distinct event_type from public.calendar_events($1, $2)`, [colomboDate(-10), colomboDate(15)]))
    const types = rows.rows.map((r) => r.event_type)
    expect(types).toEqual(expect.arrayContaining(['studio_shoot', 'frame_completion', 'rental_return', 'reminder']))
  })

  it('automatic reminders cannot be deleted, manual ones can', async () => {
    const auto = await db.val<string>(`select id from public.reminders where auto_generated limit 1`)
    const del = await asAdmin(() => db.query(`delete from public.reminders where id = $1 returning id`, [auto]))
    expect(del.rows).toHaveLength(0)
    const manual = await db.val<string>(`select id from public.reminders where not auto_generated limit 1`)
    const del2 = await asAdmin(() => db.query(`delete from public.reminders where id = $1 returning id`, [manual]))
    expect(del2.rows).toHaveLength(1)
  })
})
