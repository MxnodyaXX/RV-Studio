// Pure financial calculations. All arithmetic is in integer cents.
// Report figures come from the database (report_business_summary / report_trend);
// these helpers consolidate them, and mirror the database rules for live form
// previews (order totals, rental days, late fees, shared-expense splits) so what
// the admin sees before saving matches what the database will store.

import { toCents } from './money'
import { enumeratePeriods } from './dates'
import type { Business, BusinessSummaryRow, DateRange, Granularity, TrendRow } from '@/types/domain'

export type SummaryCents = {
  earned: number
  jobRevenue: number
  directSales: number
  collected: number
  cash: number
  card: number
  bank: number
  other: number
  depositApplied: number
  refunds: number
  advances: number
  expenses: number
  net: number
  depositsReceived: number
  depositsReturned: number
  depositsHeld: number
  outstanding: number
  overdue: number
  documents: number
  completed: number
}

export type BusinessSummary = SummaryCents & { businessId: string; name: string; slug: string; category: string }

export const EMPTY_SUMMARY: SummaryCents = {
  earned: 0, jobRevenue: 0, directSales: 0, collected: 0, cash: 0, card: 0, bank: 0, other: 0, depositApplied: 0,
  refunds: 0, advances: 0, expenses: 0, net: 0, depositsReceived: 0, depositsReturned: 0, depositsHeld: 0,
  outstanding: 0, overdue: 0, documents: 0, completed: 0,
}

export function netProfit(earnedCents: number, expenseCents: number): number {
  return earnedCents - expenseCents
}

export function toSummaryCents(r: BusinessSummaryRow): SummaryCents {
  const earned = toCents(r.earned_revenue)
  const expenses = toCents(r.expenses_total)
  return {
    earned,
    jobRevenue: toCents(r.job_revenue),
    directSales: toCents(r.direct_sales),
    collected: toCents(r.collected_total),
    cash: toCents(r.collected_cash),
    card: toCents(r.collected_card),
    bank: toCents(r.collected_bank),
    other: toCents(r.collected_other),
    depositApplied: toCents(r.deposit_applied),
    refunds: toCents(r.refunds_total),
    advances: toCents(r.advance_payments),
    expenses,
    net: netProfit(earned, expenses),
    depositsReceived: toCents(r.deposits_received),
    depositsReturned: toCents(r.deposits_returned),
    depositsHeld: toCents(r.deposits_held),
    outstanding: toCents(r.outstanding),
    overdue: toCents(r.overdue),
    documents: Number(r.documents_count) || 0,
    completed: Number(r.completed_count) || 0,
  }
}

/** Adds summaries field by field (consolidated RV Business Hub totals). */
export function consolidate(rows: SummaryCents[]): SummaryCents {
  const total = { ...EMPTY_SUMMARY }
  for (const r of rows) for (const k of Object.keys(total) as (keyof SummaryCents)[]) total[k] += r[k]
  total.net = netProfit(total.earned, total.expenses)
  return total
}

/** Per-business summaries in display order, with zeros for businesses without activity. */
export function summarizeByBusiness(rows: BusinessSummaryRow[], businesses: Business[]): BusinessSummary[] {
  const byId = new Map(rows.map((r) => [r.business_id, toSummaryCents(r)]))
  return [...businesses]
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((b) => ({ businessId: b.id, name: b.name, slug: b.slug, category: b.category, ...(byId.get(b.id) ?? EMPTY_SUMMARY) }))
}

/** Restricts rows to one business; null means all businesses. */
export function filterByBusiness<T extends { business_id: string | null }>(rows: T[], businessId: string | null): T[] {
  if (!businessId) return rows
  return rows.filter((r) => r.business_id === businessId)
}

/** Business with the highest earned revenue; null when nothing has been earned. */
export function highestEarningBusiness(summaries: BusinessSummary[]): BusinessSummary | null {
  let best: BusinessSummary | null = null
  for (const s of summaries) {
    if (s.earned <= 0) continue
    if (!best || s.earned > best.earned) best = s
  }
  return best
}

export type DistributionSlice = { businessId: string; name: string; cents: number; share: number }

export function distribution(summaries: BusinessSummary[], key: 'earned' | 'expenses' | 'collected'): DistributionSlice[] {
  const total = summaries.reduce((acc, s) => acc + Math.max(s[key], 0), 0)
  return summaries.map((s) => ({
    businessId: s.businessId,
    name: s.name,
    cents: s[key],
    share: total > 0 ? Math.max(s[key], 0) / total : 0,
  }))
}

export function profitMargin(summary: Pick<SummaryCents, 'earned' | 'net'>): number | null {
  if (summary.earned <= 0) return null
  return summary.net / summary.earned
}

export type TrendPoint = { period: string; earnedCents: number; collectedCents: number; expenseCents: number; netCents: number }

/** Continuous series (gaps filled with zero); unbounded ranges span the first to last period with data. */
export function buildTrend(rows: TrendRow[], range: DateRange, granularity: Granularity, today: string): TrendPoint[] {
  const byPeriod = new Map<string, { e: number; c: number; x: number }>()
  for (const r of rows) {
    const b = byPeriod.get(r.period) ?? { e: 0, c: 0, x: 0 }
    b.e += toCents(r.earned_revenue)
    b.c += toCents(r.collected)
    b.x += toCents(r.expenses)
    byPeriod.set(r.period, b)
  }
  const periods = [...byPeriod.keys()].sort()
  const from = range.from ?? periods[0]
  const to = range.to ?? (periods.length ? periods[periods.length - 1] : today)
  if (!from) return []
  return enumeratePeriods(from, to, granularity).map((period) => {
    const b = byPeriod.get(period) ?? { e: 0, c: 0, x: 0 }
    return { period, earnedCents: b.e, collectedCents: b.c, expenseCents: b.x, netCents: netProfit(b.e, b.x) }
  })
}

// ---------------------------------------------------------------------------
// Form previews (mirror the database rules)
// ---------------------------------------------------------------------------

export function lineTotalCents(quantity: number | string, unitPrice: string | number): number {
  const q = Math.trunc(Number(quantity))
  if (!Number.isFinite(q) || q <= 0) return 0
  return q * toCents(unitPrice)
}

export function itemsTotalCents(items: { quantity: number | string; unitPrice: string | number }[]): number {
  return items.reduce((acc, i) => acc + lineTotalCents(i.quantity, i.unitPrice), 0)
}

/** Rental days: part days round up, minimum 1 (private.camera_rental_days). */
export function rentalDays(pickupIso: string, returnIso: string): number {
  const ms = new Date(returnIso).getTime() - new Date(pickupIso).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.max(1, Math.ceil(ms / 86_400_000))
}

export function rentalChargeCents(dailyRates: (string | number)[], days: number): number {
  return dailyRates.reduce<number>((acc, r) => acc + toCents(r), 0) * days
}

/** Late fee: whole late days (after the grace period) × daily rates × multiplier (public.camera_return). */
export function lateFee(dailyRatesCents: number, expectedIso: string, returnedIso: string, graceMinutes: number, multiplier: number) {
  const lateMs = new Date(returnedIso).getTime() - new Date(expectedIso).getTime()
  if (lateMs <= graceMinutes * 60_000) return { lateDays: 0, feeCents: 0 }
  const lateDays = Math.ceil(lateMs / 86_400_000)
  return { lateDays, feeCents: Math.round(dailyRatesCents * lateDays * multiplier) }
}

/** Advance suggested from the configured percentage. */
export function defaultAdvanceCents(totalCents: number, percent: number): number {
  return Math.round((totalCents * percent) / 100)
}

export type AllocationInput = { businessId: string; percent?: number; amountCents?: number }

/**
 * Splits a shared expense (create_shared_expense). The last business absorbs
 * rounding so the allocations always add up exactly to the total.
 */
export function allocateSharedExpense(
  totalCents: number,
  method: 'equal' | 'percentage' | 'fixed',
  allocations: AllocationInput[],
): { businessId: string; cents: number }[] {
  const n = allocations.length
  let assigned = 0
  return allocations.map((a, i) => {
    let cents: number
    if (i === n - 1) cents = totalCents - assigned
    else if (method === 'equal') cents = Math.trunc(totalCents / n)
    else if (method === 'percentage') cents = Math.round((totalCents * (a.percent ?? 0)) / 100)
    else cents = a.amountCents ?? 0
    assigned += cents
    return { businessId: a.businessId, cents }
  })
}
