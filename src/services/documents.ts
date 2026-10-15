// Shared operations for bookings, orders and rentals ("documents").
import { supabase } from '@/integrations/supabase/client'
import { normalizeAmountInput } from '@/lib/money'
import { callRpc, newRequestId, nullIfBlank, searchFilter, unwrap } from './api'
import type { Adjustment, LedgerEntry, Receivable, Reminder, SourceType } from '@/types/domain'

export type DocumentFilters = {
  sourceType?: SourceType | null
  search?: string
  status?: string | null
  paymentStatus?: string | null
  businessId?: string | null
  customerId?: string | null
  from?: string | null
  to?: string | null
  /** Which date the from/to range applies to. */
  dateField?: 'event_date' | 'due_date' | 'created_at'
  outstandingOnly?: boolean
  overdueOnly?: boolean
  openOnly?: boolean
  sort?: 'newest' | 'oldest' | 'event_asc' | 'due_asc'
}

export async function listDocuments(filters: DocumentFilters, page = 1, pageSize = 20): Promise<{ rows: Receivable[]; total: number }> {
  let q = supabase.from('receivables').select('*', { count: 'exact' })
  if (filters.sourceType) q = q.eq('source_type', filters.sourceType)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.paymentStatus) q = q.eq('payment_status', filters.paymentStatus)
  if (filters.businessId) q = q.eq('business_id', filters.businessId)
  if (filters.customerId) q = q.eq('customer_id', filters.customerId)
  if (filters.outstandingOnly) q = q.gt('outstanding', 0).eq('is_cancelled', false)
  if (filters.overdueOnly) q = q.eq('is_overdue', true)
  if (filters.openOnly) q = q.eq('is_closed', false)
  const field = filters.dateField ?? 'event_date'
  if (filters.from) q = q.gte(field, filters.from)
  if (filters.to) q = q.lte(field, field === 'created_at' ? `${filters.to}T23:59:59.999+05:30` : filters.to)
  const s = searchFilter(filters.search ?? '', ['ref', 'title', 'customer_name', 'customer_phone'])
  if (s) q = q.or(s)
  switch (filters.sort ?? 'newest') {
    case 'oldest': q = q.order('created_at', { ascending: true }); break
    case 'event_asc': q = q.order('event_date', { ascending: true, nullsFirst: false }).order('created_at'); break
    case 'due_asc': q = q.order('due_date', { ascending: true, nullsFirst: false }).order('created_at'); break
    default: q = q.order('created_at', { ascending: false })
  }
  const from = (page - 1) * pageSize
  const { data, error, count } = await q.range(from, from + pageSize - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}

export async function getReceivable(sourceId: string): Promise<Receivable | null> {
  return unwrap(await supabase.from('receivables').select('*').eq('source_id', sourceId).maybeSingle())
}

export async function ledgerForSource(sourceId: string): Promise<{ entries: LedgerEntry[]; adjustments: Adjustment[] }> {
  const [entries, adjustments] = await Promise.all([
    supabase.from('ledger_entries').select('*').eq('source_id', sourceId).order('entry_date').order('created_at'),
    supabase.from('financial_adjustments').select('*').eq('source_id', sourceId).order('created_at'),
  ])
  return { entries: unwrap(entries) ?? [], adjustments: unwrap(adjustments) ?? [] }
}

export async function remindersForSource(sourceId: string): Promise<Reminder[]> {
  return unwrap(await supabase.from('reminders').select('*').eq('source_id', sourceId).order('due_at')) ?? []
}

export async function setDocumentStatus(type: SourceType, id: string, status: string) {
  await callRpc('set_document_status', { p_source_type: type, p_id: id, p_status: status })
}

export async function cancelDocument(type: SourceType, id: string, reason: string, refundAmount: string, refundMethod: string | null) {
  await callRpc('cancel_document', {
    p_source_type: type,
    p_id: id,
    p_reason: reason.trim(),
    p_refund_amount: Number(normalizeAmountInput(refundAmount || '0')),
    p_refund_method: (refundMethod || null) as never,
  })
}

export type PaymentResult = { id: string; ref: string; duplicate: boolean; confirmed?: boolean }

export async function recordPayment(input: {
  sourceType?: SourceType | null
  sourceId?: string | null
  businessId?: string | null
  customerId?: string | null
  categoryId?: string | null
  purpose: 'charge' | 'deposit'
  amount: string
  method: string
  paidOn: string
  reference?: string
  notes?: string
  requestId: string
}): Promise<PaymentResult> {
  return (await callRpc('record_payment', {
    p: {
      source_type: input.sourceType ?? null,
      source_id: input.sourceId ?? null,
      business_id: input.businessId ?? null,
      customer_id: nullIfBlank(input.customerId),
      category_id: input.categoryId ?? null,
      purpose: input.purpose,
      amount: normalizeAmountInput(input.amount),
      method: input.method,
      paid_on: input.paidOn,
      reference: nullIfBlank(input.reference),
      notes: nullIfBlank(input.notes),
      client_request_id: input.requestId,
    },
  })) as PaymentResult
}

export async function recordRefund(input: {
  sourceType: SourceType
  sourceId: string
  kind: 'charge_refund' | 'deposit_return'
  amount: string
  method: string
  reason: string
  reduceAmountDue: boolean
  requestId: string
}) {
  return callRpc('record_refund', {
    p: {
      source_type: input.sourceType,
      source_id: input.sourceId,
      kind: input.kind,
      amount: normalizeAmountInput(input.amount),
      method: input.method,
      reason: input.reason.trim(),
      reduce_amount_due: input.reduceAmountDue,
      client_request_id: input.requestId,
    },
  })
}

export async function refundDirectPayment(paymentId: string, amount: string, method: string, reason: string) {
  return callRpc('record_refund', {
    p: { payment_id: paymentId, amount: normalizeAmountInput(amount), method, reason: reason.trim(), client_request_id: newRequestId() },
  })
}

export async function recordAdjustment(type: SourceType, id: string, kind: string, amount: string, reason: string) {
  return callRpc('record_adjustment', {
    p: { source_type: type, source_id: id, kind, amount: normalizeAmountInput(amount), reason: reason.trim(), client_request_id: newRequestId() },
  })
}

export type LedgerKind = 'payment' | 'refund' | 'expense' | 'adjustment' | 'shared_expense'

export async function voidEntry(kind: LedgerKind, id: string, reason: string) {
  await callRpc('void_entry', { p_kind: kind, p_id: id, p_reason: reason.trim() })
}

export function ledgerKindOf(entryType: string): LedgerKind {
  if (entryType === 'expense') return 'expense'
  if (entryType === 'refund' || entryType === 'deposit_returned') return 'refund'
  return 'payment'
}
