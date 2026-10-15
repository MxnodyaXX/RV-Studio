import { supabase } from '@/integrations/supabase/client'
import { CSV_EXPORT_LIMIT } from '@/lib/constants'
import { allocateSharedExpense } from '@/lib/finance'
import { normalizeAmountInput, toCents } from '@/lib/money'
import { callRpc, nullIfBlank, searchFilter, unwrap } from './api'
import type { ExpenseValues } from '@/lib/validation'
import type {
  Business,
  BusinessSummaryRow,
  CalendarEvent,
  Customer,
  DashboardOperations,
  Granularity,
  LedgerEntry,
  MoneyMethod,
  Payment,
  PaymentMethodRow,
  Receivable,
  Refund,
  SourceType,
  TrendRow,
} from '@/types/domain'

// ---------------------------------------------------------------------------
// Ledger (Transaction History)
// ---------------------------------------------------------------------------
export type LedgerFilters = {
  search: string
  businessId: string | null
  entryType: string | null
  method: MoneyMethod | null
  from: string | null
  to: string | null
  includeVoided: boolean
  sort: 'newest' | 'oldest'
}

// Minimal structural view of the PostgREST filter builder (method syntax keeps it assignable).
type FilterableQuery<Q> = {
  eq(column: string, value: unknown): Q
  gte(column: string, value: unknown): Q
  lte(column: string, value: unknown): Q
  or(filters: string): Q
  order(column: string, options: { ascending: boolean }): Q
}

function applyLedgerFilters<Q extends FilterableQuery<Q>>(q: Q, f: LedgerFilters): Q {
  if (f.businessId) q = q.eq('business_id', f.businessId)
  if (f.entryType) q = q.eq('entry_type', f.entryType)
  if (f.method) q = q.eq('method', f.method)
  if (f.from) q = q.gte('entry_date', f.from)
  if (f.to) q = q.lte('entry_date', f.to)
  if (!f.includeVoided) q = q.eq('is_voided', false)
  const s = searchFilter(f.search, ['ref', 'source_ref', 'description', 'reference', 'category_name'])
  if (s) q = q.or(s)
  const asc = f.sort === 'oldest'
  return q.order('entry_date', { ascending: asc }).order('created_at', { ascending: asc })
}

export async function listLedger(f: LedgerFilters, page: number, pageSize: number): Promise<{ rows: LedgerEntry[]; total: number }> {
  const from = (page - 1) * pageSize
  const { data, error, count } = await applyLedgerFilters(supabase.from('ledger_entries').select('*', { count: 'exact' }), f).range(from, from + pageSize - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}

export async function exportLedger(f: LedgerFilters): Promise<{ rows: LedgerEntry[]; truncated: boolean }> {
  const rows: LedgerEntry[] = []
  for (let offset = 0; offset < CSV_EXPORT_LIMIT; offset += 1000) {
    const { data, error } = await applyLedgerFilters(supabase.from('ledger_entries').select('*'), f).range(offset, offset + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

export async function recentLedger(limit: number, businessId: string | null): Promise<LedgerEntry[]> {
  let q = supabase.from('ledger_entries').select('*').eq('is_voided', false)
  if (businessId) q = q.eq('business_id', businessId)
  return unwrap(await q.order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit)) ?? []
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export async function recordExpense(v: ExpenseValues, source: { type: SourceType; id: string } | null, businesses: Business[], requestId: string) {
  if (v.mode === 'single') {
    return callRpc('record_expense', {
      p: {
        business_id: nullIfBlank(v.businessId),
        source_type: source?.type ?? null,
        source_id: source?.id ?? null,
        category_id: v.categoryId,
        amount: normalizeAmountInput(v.amount),
        method: v.method,
        paid_on: v.paidOn,
        description: nullIfBlank(v.description),
        receipt_reference: nullIfBlank(v.receiptReference),
        client_request_id: requestId,
      },
    })
  }
  const chosen = v.allocations.filter((a) => a.selected && businesses.some((b) => b.id === a.businessId))
  return callRpc('create_shared_expense', {
    p: {
      category_id: v.categoryId,
      total_amount: normalizeAmountInput(v.amount),
      method: v.method,
      paid_on: v.paidOn,
      description: (v.description ?? '').trim(),
      receipt_reference: nullIfBlank(v.receiptReference),
      allocation_method: v.allocationMethod,
      allocations: chosen.map((a) => ({
        business_id: a.businessId,
        percent: v.allocationMethod === 'percentage' ? Number(a.percent) : undefined,
        amount: v.allocationMethod === 'fixed' ? normalizeAmountInput(a.amount) : undefined,
      })),
      client_request_id: requestId,
    },
  })
}

/** Preview of a shared split in cents, identical to the database's rounding. */
export function previewAllocation(v: ExpenseValues) {
  const chosen = v.allocations.filter((a) => a.selected)
  return allocateSharedExpense(
    toCents(v.amount),
    v.allocationMethod,
    chosen.map((a) => ({ businessId: a.businessId, percent: Number(a.percent) || 0, amountCents: toCents(a.amount) })),
  )
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------
export type ReceiptData = {
  kind: 'payment' | 'refund'
  entry: Payment | Refund
  business: Business | null
  customer: Customer | null
  document: Receivable | null
  categoryName: string | null
  footer: string
}

export async function getReceipt(kind: 'payment' | 'refund', id: string): Promise<ReceiptData | null> {
  const entryRes =
    kind === 'payment'
      ? await supabase.from('payments').select('*').eq('id', id).maybeSingle()
      : await supabase.from('refunds').select('*').eq('id', id).maybeSingle()
  const entry = unwrap(entryRes as { data: Payment | Refund | null; error: unknown })
  if (!entry) return null
  const [business, customer, document, settings, category] = await Promise.all([
    supabase.from('businesses').select('*').eq('id', entry.business_id).maybeSingle(),
    entry.customer_id ? supabase.from('customers').select('*').eq('id', entry.customer_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    entry.source_id ? supabase.from('receivables').select('*').eq('source_id', entry.source_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('system_settings').select('receipt_footer').limit(1).maybeSingle(),
    'category_id' in entry && entry.category_id
      ? supabase.from('transaction_categories').select('name').eq('id', entry.category_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  return {
    kind,
    entry,
    business: unwrap(business),
    customer: unwrap(customer) as Customer | null,
    document: unwrap(document) as Receivable | null,
    categoryName: (unwrap(category) as { name: string } | null)?.name ?? null,
    footer: (unwrap(settings) as { receipt_footer: string } | null)?.receipt_footer ?? '',
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export async function getBusinessSummary(from: string | null, to: string | null, businessId: string | null = null): Promise<BusinessSummaryRow[]> {
  return (await callRpc('report_business_summary', { p_from: from, p_to: to, p_business_id: businessId })) as BusinessSummaryRow[]
}

export async function getTrend(from: string | null, to: string | null, businessId: string | null, granularity: Granularity): Promise<TrendRow[]> {
  return (await callRpc('report_trend', { p_from: from, p_to: to, p_business_id: businessId, p_granularity: granularity })) as TrendRow[]
}

export async function getPaymentMethods(from: string | null, to: string | null, businessId: string | null): Promise<PaymentMethodRow[]> {
  return (await callRpc('report_payment_methods', { p_from: from, p_to: to, p_business_id: businessId })) as PaymentMethodRow[]
}

export async function getDashboardOperations(from: string | null, to: string | null): Promise<DashboardOperations | null> {
  return (await callRpc('dashboard_operations', { p_from: from, p_to: to })) as unknown as DashboardOperations | null
}

export async function getCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  return (await callRpc('calendar_events', { p_from: from, p_to: to })) as CalendarEvent[]
}
