// Live RLS / authorisation tests against a real NON-PRODUCTION Supabase project.
// Requires TEST_* variables (see .env.example and tests/integration/README.md).
// Skipped automatically when they are not set. (The same rules are also tested
// locally, without a project, by `npm run test:db`.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '../../src/types/database'

const env = process.env
const configured = !!(env.TEST_SUPABASE_URL && env.TEST_SUPABASE_ANON_KEY && env.TEST_ADMIN_EMAIL && env.TEST_ADMIN_PASSWORD)
const hasNonAdmin = !!(env.TEST_NON_ADMIN_EMAIL && env.TEST_NON_ADMIN_PASSWORD)

function client(): SupabaseClient<Database> {
  return createClient<Database>(env.TEST_SUPABASE_URL!, env.TEST_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
}

const TABLES = ['customers', 'studio_bookings', 'frame_orders', 'camera_rentals', 'gift_orders', 'payments', 'refunds', 'expenses', 'audit_logs', 'receivables', 'ledger_entries'] as const

describe.skipIf(!configured)('RLS & authorisation (live Supabase)', () => {
  let anon: SupabaseClient<Database>
  let admin: SupabaseClient<Database>
  let intruder: SupabaseClient<Database>
  let customerId = ''
  let orderId = ''

  beforeAll(async () => {
    anon = client()
    admin = client()
    intruder = client()
    const { error } = await admin.auth.signInWithPassword({ email: env.TEST_ADMIN_EMAIL!, password: env.TEST_ADMIN_PASSWORD! })
    if (error) throw error
    if (hasNonAdmin) {
      const r = await intruder.auth.signInWithPassword({ email: env.TEST_NON_ADMIN_EMAIL!, password: env.TEST_NON_ADMIN_PASSWORD! })
      if (r.error) throw r.error
    }
    const c = await admin.from('customers').insert({ full_name: `Integration Test ${Date.now()}` }).select('id').single()
    if (c.error) throw c.error
    customerId = c.data.id
  })

  afterAll(async () => {
    if (orderId) await admin.rpc('cancel_document', { p_source_type: 'frame_order', p_id: orderId, p_reason: 'Integration test clean-up', p_refund_amount: 0, p_refund_method: null }).then(() => undefined, () => undefined)
  })

  it.each(TABLES)('anonymous visitors cannot read %s', async (table) => {
    const { data, error } = await anon.from(table as 'customers').select('*').limit(1)
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('anonymous visitors cannot call business RPCs', async () => {
    const { error } = await anon.rpc('record_payment', { p: {} })
    expect(error).not.toBeNull()
  })

  it('the administrator can run a full order → payment → delivery flow', async () => {
    const id = await admin.rpc('save_frame_order', {
      p: { customer_id: customerId, client_request_id: randomUUID(), items: [{ frame_type: 'Test', frame_size: 'A4', quantity: 1, unit_price: '1000.00' }] },
    })
    expect(id.error).toBeNull()
    orderId = id.data as string
    const deliver = await admin.rpc('set_document_status', { p_source_type: 'frame_order', p_id: orderId, p_status: 'ready' })
    expect(deliver.error).toBeNull()
    const blocked = await admin.rpc('set_document_status', { p_source_type: 'frame_order', p_id: orderId, p_status: 'delivered' })
    expect(blocked.error?.message).toMatch(/Full payment/)
    const key = randomUUID()
    const pay = await admin.rpc('record_payment', { p: { source_type: 'frame_order', source_id: orderId, amount: '1000.00', method: 'cash', client_request_id: key } })
    expect(pay.error).toBeNull()
    const dup = await admin.rpc('record_payment', { p: { source_type: 'frame_order', source_id: orderId, amount: '1000.00', method: 'cash', client_request_id: key } })
    expect((dup.data as { duplicate: boolean }).duplicate).toBe(true)
    const ok = await admin.rpc('set_document_status', { p_source_type: 'frame_order', p_id: orderId, p_status: 'delivered' })
    expect(ok.error).toBeNull()
    const bal = await admin.from('receivables').select('outstanding').eq('source_id', orderId).single()
    expect(Number(bal.data!.outstanding)).toBe(0)
    orderId = '' // delivered orders can't be cancelled; leave it as test data
  })

  it('the administrator cannot write payments directly or alter audit logs', async () => {
    const direct = await admin.from('payments').insert({ business_id: randomUUID(), amount: 1, method: 'cash', paid_on: '2026-01-01' } as never)
    expect(direct.error).not.toBeNull()
    const del = await admin.from('audit_logs').delete().neq('entity_type', '')
    expect(del.error).not.toBeNull()
  })

  describe.skipIf(!hasNonAdmin)('authenticated non-admin', () => {
    it('is not recognised as admin and sees no data', async () => {
      expect((await intruder.rpc('current_user_is_admin')).data).toBe(false)
      for (const table of TABLES) {
        const { data } = await intruder.from(table as 'customers').select('*').limit(5)
        expect(data ?? []).toHaveLength(0)
      }
    })

    it('cannot call business RPCs', async () => {
      const r = await intruder.rpc('save_frame_order', { p: { customer_id: customerId, items: [{ frame_type: 'x', frame_size: 'y', quantity: 1, unit_price: '1' }] } })
      expect(r.error).not.toBeNull()
      const d = await intruder.rpc('dashboard_operations', {})
      expect(d.data).toBeNull()
    })
  })
})
