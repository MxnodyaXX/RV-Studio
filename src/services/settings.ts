import { supabase } from '@/integrations/supabase/client'
import { callRpc, nullIfBlank, unwrap } from './api'
import { fromColomboInput } from '@/lib/dates'
import { parseOffsets, type CategoryValues, type ReminderValues, type SettingsValues } from '@/lib/validation'
import type { AppNotification, Reminder, SystemSettings } from '@/types/domain'

export async function getSettings(): Promise<SystemSettings | null> {
  return unwrap(await supabase.from('system_settings').select('*').limit(1).maybeSingle())
}

export async function saveSettings(id: string, v: SettingsValues) {
  unwrap(
    await supabase
      .from('system_settings')
      .update({
        studio_reminder_days: parseOffsets(v.studioReminderDays),
        frame_reminder_days: parseOffsets(v.frameReminderDays),
        gift_reminder_days: parseOffsets(v.giftReminderDays),
        payment_due_reminder_days: parseOffsets(v.paymentDueReminderDays),
        rental_pickup_reminder_hours: parseOffsets(v.rentalPickupReminderHours),
        rental_return_reminder_hours: parseOffsets(v.rentalReturnReminderHours),
        default_advance_percent: Number(v.defaultAdvancePercent),
        late_fee_multiplier: Number(v.lateFeeMultiplier),
        rental_grace_minutes: Number(v.rentalGraceMinutes),
        gift_require_full_payment_before_delivery: v.giftRequireFullPayment,
        gift_stock_deduction: v.giftStockDeduction,
        receipt_footer: v.receiptFooter.trim(),
      })
      .eq('id', id)
      .select('id')
      .single(),
  )
}

export async function createCategory(v: CategoryValues) {
  unwrap(
    await supabase
      .from('transaction_categories')
      .insert({ name: v.name.trim(), type: v.type, business_id: nullIfBlank(v.businessId), sort_order: 50 })
      .select('id')
      .single(),
  )
}

export async function setCategoryActive(id: string, isActive: boolean) {
  unwrap(await supabase.from('transaction_categories').update({ is_active: isActive }).eq('id', id).select('id').single())
}

// ---------------------------------------------------------------------------
// Reminders & notifications
// ---------------------------------------------------------------------------
export async function upcomingReminders(limit = 8): Promise<Reminder[]> {
  return (
    unwrap(
      await supabase
        .from('reminders')
        .select('*')
        .eq('status', 'pending')
        .lte('due_at', new Date(Date.now() + 7 * 86_400_000).toISOString())
        .order('due_at')
        .limit(limit),
    ) ?? []
  )
}

export async function createReminder(v: ReminderValues) {
  unwrap(
    await supabase
      .from('reminders')
      .insert({ kind: 'custom', title: v.title.trim(), body: nullIfBlank(v.body), due_at: fromColomboInput(v.dueAt) })
      .select('id')
      .single(),
  )
}

export async function setReminderStatus(id: string, status: 'done' | 'dismissed' | 'pending') {
  unwrap(await supabase.from('reminders').update({ status }).eq('id', id).select('id').single())
}

export async function deleteReminder(id: string) {
  unwrap(await supabase.from('reminders').delete().eq('id', id))
}

export async function listNotifications(limit = 30): Promise<AppNotification[]> {
  return unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit)) ?? []
}

export async function markNotificationsRead(ids: string[] | 'all') {
  const now = new Date().toISOString()
  const q = supabase.from('notifications').update({ read_at: now }).is('read_at', null)
  unwrap(await (ids === 'all' ? q : q.in('id', ids)))
}

/** Converts due reminders into notifications on the server (idempotent). */
export async function generateNotifications(): Promise<number> {
  return (await callRpc('generate_notifications', {} as never)) as number
}
