import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/misc'
import { Input, Select } from '@/components/ui/form-controls'
import { ErrorState } from '@/components/common'
import { SectionCard, Stat } from '@/components/shared'
import { BusinessSelect, DateRangeFilter, RangeCaption } from '@/components/dashboard/FilterBar'
import { DistributionBars } from '@/components/dashboard/DistributionBars'
import { TrendChart, TrendLegend } from '@/components/dashboard/TrendChart'
import { useBusinesses, usePaymentMethods, useSummary, useTrend } from '@/hooks/queries'
import { useFinanceFilters } from '@/hooks/useDateRangeFilter'
import { exportLedger, type LedgerFilters } from '@/services/finance'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants'
import { addMonths, businessToday, describeRange, enumeratePeriods, formatDisplayDate, monthBounds, monthName } from '@/lib/dates'
import { buildTrend, consolidate, distribution, profitMargin, summarizeByBusiness, type BusinessSummary, type SummaryCents } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { formatPercent } from '@/lib/utils'
import type { ExportDocument, ExportTable } from '@/lib/exporters'
import type { DateRange, MoneyMethod } from '@/types/domain'
import { AccountingNote, ReportShell, StatementTable } from './ReportShell'
import { cn } from '@/lib/utils'

const L = formatLKR

function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-72 w-full rounded-xl" />
    </div>
  )
}

function Net({ cents }: { cents: number }) {
  return <span className={cn('font-semibold', cents < 0 ? 'text-expense-text' : 'text-income-text')}>{L(cents)}</span>
}

function useSummaries(range: DateRange) {
  const businesses = useBusinesses()
  const summary = useSummary(range)
  const per = useMemo(() => summarizeByBusiness(summary.data ?? [], businesses.data ?? []), [summary.data, businesses.data])
  const total = useMemo(() => consolidate(per), [per])
  return { per, total, loading: summary.isLoading || businesses.isLoading, error: summary.error ?? businesses.error, refetch: summary.refetch }
}

const METRICS: { key: keyof SummaryCents; label: string; count?: boolean }[] = [
  { key: 'earned', label: 'Earned revenue' },
  { key: 'jobRevenue', label: '  from completed jobs' },
  { key: 'directSales', label: '  from direct sales' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'net', label: 'Net profit' },
  { key: 'collected', label: 'Payments collected' },
  { key: 'advances', label: 'Advance payments received' },
  { key: 'cash', label: 'Cash received' },
  { key: 'card', label: 'Card payments' },
  { key: 'bank', label: 'Bank transfers' },
  { key: 'depositApplied', label: 'Paid from deposits' },
  { key: 'refunds', label: 'Refunds paid' },
  { key: 'outstanding', label: 'Outstanding (current)' },
  { key: 'depositsHeld', label: 'Deposits held (liability)' },
  { key: 'documents', label: 'Bookings / orders / rentals', count: true },
  { key: 'completed', label: 'Completed in period', count: true },
]

function metricsTable(per: BusinessSummary[], total: SummaryCents): ExportTable {
  return {
    title: 'Business details',
    columns: [{ header: 'Measure' }, ...per.map((b) => ({ header: b.name, money: true })), { header: 'RV Business Hub', money: true }],
    rows: METRICS.map((m) => [m.label.trim(), ...per.map((b) => (m.count ? String(b[m.key]) : b[m.key])), m.count ? String(total[m.key]) : total[m.key]]),
  }
}

function consolidatedTable(per: BusinessSummary[], total: SummaryCents): ExportTable {
  return {
    title: 'Consolidated summary',
    columns: [{ header: 'Business' }, { header: 'Revenue', money: true }, { header: 'Expenses', money: true }, { header: 'Net Profit', money: true }],
    rows: per.map((b) => [b.name, b.earned, b.expenses, b.net]),
    total: ['TOTAL', total.earned, total.expenses, total.net],
  }
}

async function transactionsTable(range: DateRange, businessId: string | null, names: Map<string, string>): Promise<ExportTable> {
  const f: LedgerFilters = { search: '', businessId, entryType: null, method: null, from: range.from, to: range.to, includeVoided: false, sort: 'oldest' }
  const { rows } = await exportLedger(f)
  return {
    title: 'Transaction history',
    columns: [{ header: 'Date' }, { header: 'ID' }, { header: 'Business' }, { header: 'Type' }, { header: 'Record' }, { header: 'Method' }, { header: 'Amount', money: true }],
    rows: rows.map((e) => [
      formatDisplayDate(e.entry_date), e.ref ?? '', names.get(e.business_id ?? '') ?? '', (e.entry_type ?? '').replace('_', ' '),
      e.source_ref ?? e.category_name ?? '', PAYMENT_METHOD_LABELS[e.method!] ?? '', (e.direction === 'in' ? 1 : -1) * toCents(e.amount),
    ]),
  }
}

function ConsolidatedCard({ per, total }: { per: BusinessSummary[]; total: SummaryCents }) {
  return (
    <SectionCard title="RV Business Hub — consolidated" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
      <StatementTable
        head={['Business', 'Revenue', 'Expenses', 'Net profit']}
        rows={per.map((b) => [b.name, L(b.earned), L(b.expenses), <Net key="n" cents={b.net} />])}
        total={['TOTAL', L(total.earned), L(total.expenses), <Net key="t" cents={total.net} />]}
      />
    </SectionCard>
  )
}

function HeadlineStats({ total }: { total: SummaryCents }) {
  const margin = profitMargin(total)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Earned revenue" value={L(total.earned)} />
      <Stat label="Expenses" value={L(total.expenses)} tone="expense" />
      <Stat label="Net profit" value={L(total.net)} tone={total.net < 0 ? 'expense' : 'income'} hint={margin !== null ? `${formatPercent(margin)} margin` : undefined} />
      <Stat label="Collected (cash/card/bank)" value={L(total.cash + total.card + total.bank)} hint={`Outstanding now ${L(total.outstanding)}`} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Monthly report
// ---------------------------------------------------------------------------
export function MonthlyReportPage() {
  const [month, setMonth] = useState(addMonths(monthBounds(businessToday()).from, 0).slice(0, 7))
  const range = monthBounds(`${month}-01`)
  const { per, total, loading, error, refetch } = useSummaries(range)
  const businesses = useBusinesses()
  const title = `Monthly Report — ${monthName(`${month}-01`)}`

  return (
    <ReportShell
      title="Monthly Report"
      description="Per-business and consolidated results for one month."
      ready={!loading && !error}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Month
            <Input type="month" value={month} max={businessToday().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} className="w-48" />
          </label>
          <RangeCaption range={range} />
        </div>
      }
      buildExport={async (): Promise<ExportDocument> => ({
        fileName: `rv-monthly-report-${month}`,
        title,
        subtitle: describeRange(range),
        summary: [
          { label: 'Earned revenue', value: L(total.earned) },
          { label: 'Expenses', value: L(total.expenses) },
          { label: 'Net profit', value: L(total.net) },
          { label: 'Outstanding', value: L(total.outstanding) },
        ],
        tables: [consolidatedTable(per, total), metricsTable(per, total), await transactionsTable(range, null, new Map((businesses.data ?? []).map((b) => [b.id, b.name])))],
      })}
    >
      {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
        <>
          <HeadlineStats total={total} />
          <ConsolidatedCard per={per} total={total} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            {per.map((b) => (
              <SectionCard key={b.businessId} title={b.name} description={b.category}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {METRICS.filter((m) => !m.label.startsWith('  ')).map((m) => (
                    <div key={m.key} className="flex justify-between gap-3 border-b border-border/60 py-1">
                      <dt className="text-muted-foreground">{m.label}</dt>
                      <dd className={cn('tabular whitespace-nowrap font-medium', m.key === 'net' && (b.net < 0 ? 'text-expense-text' : 'text-income-text'))}>
                        {m.count ? b[m.key] : L(b[m.key])}
                      </dd>
                    </div>
                  ))}
                </dl>
              </SectionCard>
            ))}
          </div>
          <AccountingNote />
        </>
      )}
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------
// Profit & Loss
// ---------------------------------------------------------------------------
export function ProfitLossPage() {
  const filters = useFinanceFilters('month')
  const businesses = useBusinesses()
  const { per, total, loading, error, refetch } = useSummaries(filters.range)
  const expenseRows = useQuery({
    queryKey: ['pl-expenses', filters.range],
    queryFn: () => exportLedger({ search: '', businessId: null, entryType: 'expense', method: null, from: filters.range.from, to: filters.range.to, includeVoided: false, sort: 'oldest' }),
  })
  const visible = filters.businessId ? per.filter((b) => b.businessId === filters.businessId) : per
  const cols = visible.length > 1 ? [...visible, null] : visible

  // Expense categories × business (cents)
  const categories = useMemo(() => {
    const map = new Map<string, Map<string, number>>()
    for (const e of expenseRows.data?.rows ?? []) {
      const cat = e.category_name ?? 'Uncategorised'
      const m = map.get(cat) ?? new Map<string, number>()
      m.set(e.business_id!, (m.get(e.business_id!) ?? 0) + toCents(e.amount))
      map.set(cat, m)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [expenseRows.data])

  const cell = (b: BusinessSummary | null, key: keyof SummaryCents) => (b ? b[key] : visible.reduce((s, x) => s + x[key], 0))
  const catCell = (m: Map<string, number>, b: BusinessSummary | null) => (b ? m.get(b.businessId) ?? 0 : visible.reduce((s, x) => s + (m.get(x.businessId) ?? 0), 0))
  const head = ['', ...cols.map((b) => (b ? b.name : 'Total'))]

  const statementRows = (): { label: string; values: number[]; strong?: boolean; indent?: boolean }[] => [
    { label: 'Revenue from completed jobs', values: cols.map((b) => cell(b, 'jobRevenue')), indent: true },
    { label: 'Direct sales', values: cols.map((b) => cell(b, 'directSales')), indent: true },
    { label: 'Total earned revenue', values: cols.map((b) => cell(b, 'earned')), strong: true },
    ...categories.map(([name, m]) => ({ label: name, values: cols.map((b) => -catCell(m, b)), indent: true })),
    { label: 'Total expenses', values: cols.map((b) => -cell(b, 'expenses')), strong: true },
    { label: 'Net profit', values: cols.map((b) => cell(b, 'net')), strong: true },
  ]

  return (
    <ReportShell
      title="Profit & Loss"
      description="Earned revenue less expenses by category, per business."
      ready={!loading && !expenseRows.isLoading}
      filters={
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <DateRangeFilter preset={filters.preset} customFrom={filters.customFrom} customTo={filters.customTo} onPresetChange={filters.setPreset} onCustomApply={filters.setCustomRange} />
          <div className="space-y-2">
            <BusinessSelect businesses={businesses.data ?? []} value={filters.businessId} onChange={filters.setBusinessId} className="lg:w-60" />
            <RangeCaption range={filters.range} />
          </div>
        </div>
      }
      buildExport={() => ({
        fileName: `rv-profit-loss-${filters.range.from ?? 'all'}-${filters.range.to ?? 'time'}`,
        title: 'Profit & Loss Statement',
        subtitle: describeRange(filters.range),
        tables: [{
          title: 'Profit & Loss',
          columns: [{ header: 'Line' }, ...cols.map((b) => ({ header: b ? b.name : 'Total', money: true }))],
          rows: statementRows().map((r) => [r.label, ...r.values]),
        }],
      })}
    >
      {loading || expenseRows.isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
        <>
          <HeadlineStats total={filters.businessId ? consolidate(visible) : total} />
          <SectionCard title="Statement" description={describeRange(filters.range)} bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            <StatementTable
              head={head}
              rows={statementRows().map((r) => [
                <span key="l" className={cn(r.strong && 'font-semibold', r.indent && 'pl-3 text-muted-foreground')}>{r.label}</span>,
                ...r.values.map((v, i) => <span key={i} className={cn(r.strong && 'font-semibold', r.label === 'Net profit' && (v < 0 ? 'text-expense-text' : 'text-income-text'))}>{v < 0 ? `(${L(-v)})` : L(v)}</span>),
              ])}
            />
          </SectionCard>
          <AccountingNote />
        </>
      )}
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------
// Business comparison
// ---------------------------------------------------------------------------
export function BusinessComparisonPage() {
  const filters = useFinanceFilters('year')
  const { per, total, loading, error, refetch } = useSummaries(filters.range)
  const rows = per.map((b) => {
    const m = profitMargin(b)
    return [b.name, L(b.earned), L(b.expenses), <Net key="n" cents={b.net} />, m === null ? '—' : formatPercent(m), L(b.cash + b.card + b.bank), L(b.outstanding), String(b.documents)]
  })
  return (
    <ReportShell
      title="Business Comparison"
      description="How the four businesses perform side by side."
      ready={!loading && !error}
      filters={
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <DateRangeFilter preset={filters.preset} customFrom={filters.customFrom} customTo={filters.customTo} onPresetChange={filters.setPreset} onCustomApply={filters.setCustomRange} />
          <RangeCaption range={filters.range} />
        </div>
      }
      buildExport={() => ({
        fileName: `rv-business-comparison-${filters.range.from ?? 'all'}`,
        title: 'Business Comparison',
        subtitle: describeRange(filters.range),
        tables: [{
          title: 'Comparison',
          columns: [{ header: 'Business' }, { header: 'Revenue', money: true }, { header: 'Expenses', money: true }, { header: 'Net profit', money: true }, { header: 'Margin', align: 'right' }, { header: 'Collected', money: true }, { header: 'Outstanding', money: true }, { header: 'Records', align: 'right' }],
          rows: per.map((b) => { const m = profitMargin(b); return [b.name, b.earned, b.expenses, b.net, m === null ? '—' : formatPercent(m), b.cash + b.card + b.bank, b.outstanding, String(b.documents)] }),
          total: ['TOTAL', total.earned, total.expenses, total.net, profitMargin(total) === null ? '—' : formatPercent(profitMargin(total)!), total.cash + total.card + total.bank, total.outstanding, String(total.documents)],
        }],
      })}
    >
      {loading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
        <>
          <SectionCard title="Comparison" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            <StatementTable
              head={['Business', 'Revenue', 'Expenses', 'Net profit', 'Margin', 'Collected', 'Outstanding', 'Records']}
              rows={rows}
              total={['TOTAL', L(total.earned), L(total.expenses), <Net key="t" cents={total.net} />, profitMargin(total) === null ? '—' : formatPercent(profitMargin(total)!), L(total.cash + total.card + total.bank), L(total.outstanding), String(total.documents)]}
            />
          </SectionCard>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <SectionCard title="Share of revenue"><DistributionBars slices={distribution(per, 'earned')} type="income" /></SectionCard>
            <SectionCard title="Share of expenses"><DistributionBars slices={distribution(per, 'expenses')} type="expense" /></SectionCard>
          </div>
          <AccountingNote />
        </>
      )}
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------
// Payment method report
// ---------------------------------------------------------------------------
export function PaymentMethodReportPage() {
  const filters = useFinanceFilters('month')
  const businesses = useBusinesses()
  const q = usePaymentMethods(filters.range, filters.businessId)
  const methods: MoneyMethod[] = ['cash', 'card', 'bank_transfer', 'deposit', 'other']
  const sums = useMemo(() => {
    const by = new Map<MoneyMethod, { cp: number; dr: number; rf: number; dret: number; ex: number }>()
    for (const r of q.data ?? []) {
      const b = by.get(r.method) ?? { cp: 0, dr: 0, rf: 0, dret: 0, ex: 0 }
      b.cp += toCents(r.charge_payments); b.dr += toCents(r.deposits_received); b.rf += toCents(r.refunds_paid); b.dret += toCents(r.deposits_returned); b.ex += toCents(r.expenses_paid)
      by.set(r.method, b)
    }
    return methods.map((m) => ({ method: m, ...(by.get(m) ?? { cp: 0, dr: 0, rf: 0, dret: 0, ex: 0 }) })).filter((r) => r.cp || r.dr || r.rf || r.dret || r.ex || ['cash', 'card', 'bank_transfer'].includes(r.method))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data])
  const net = (r: (typeof sums)[number]) => (r.method === 'deposit' ? 0 : r.cp + r.dr - r.rf - r.dret - r.ex)
  const tot = sums.reduce((a, r) => ({ cp: a.cp + r.cp, dr: a.dr + r.dr, rf: a.rf + r.rf, dret: a.dret + r.dret, ex: a.ex + r.ex, net: a.net + net(r) }), { cp: 0, dr: 0, rf: 0, dret: 0, ex: 0, net: 0 })

  return (
    <ReportShell
      title="Payment Method Report"
      description="Money in and out by cash, card and bank transfer — tracked independently."
      ready={!q.isLoading}
      filters={
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <DateRangeFilter preset={filters.preset} customFrom={filters.customFrom} customTo={filters.customTo} onPresetChange={filters.setPreset} onCustomApply={filters.setCustomRange} />
          <div className="space-y-2">
            <BusinessSelect businesses={businesses.data ?? []} value={filters.businessId} onChange={filters.setBusinessId} className="lg:w-60" />
            <RangeCaption range={filters.range} />
          </div>
        </div>
      }
      buildExport={() => ({
        fileName: `rv-payment-methods-${filters.range.from ?? 'all'}`,
        title: 'Payment Method Report',
        subtitle: `${describeRange(filters.range)}${filters.businessId ? ` · ${businesses.data?.find((b) => b.id === filters.businessId)?.name}` : ' · All businesses'}`,
        tables: [{
          title: 'By payment method',
          columns: [{ header: 'Method' }, { header: 'Customer payments', money: true }, { header: 'Deposits received', money: true }, { header: 'Refunds paid', money: true }, { header: 'Deposits returned', money: true }, { header: 'Expenses paid', money: true }, { header: 'Net cash flow', money: true }],
          rows: sums.map((r) => [PAYMENT_METHOD_LABELS[r.method], r.cp, r.dr, r.rf, r.dret, r.ex, net(r)]),
          total: ['TOTAL', tot.cp, tot.dr, tot.rf, tot.dret, tot.ex, tot.net],
        }],
      })}
    >
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(['cash', 'card', 'bank_transfer'] as const).map((m) => {
              const r = sums.find((x) => x.method === m)!
              return <Stat key={m} label={`${PAYMENT_METHOD_LABELS[m]} received`} value={L(r?.cp ?? 0)} tone="income" hint={`Net flow ${L(r ? net(r) : 0)}`} />
            })}
            <Stat label="Paid from held deposits" value={L(sums.find((x) => x.method === 'deposit')?.cp ?? 0)} hint="No new cash — moved from deposit" />
          </div>
          <SectionCard title="By payment method" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            <StatementTable
              head={['Method', 'Customer payments', 'Deposits in', 'Refunds', 'Deposits out', 'Expenses', 'Net flow']}
              rows={sums.map((r) => [PAYMENT_METHOD_LABELS[r.method], L(r.cp), L(r.dr), L(r.rf), L(r.dret), L(r.ex), r.method === 'deposit' ? '—' : <Net key="n" cents={net(r)} />])}
              total={['TOTAL', L(tot.cp), L(tot.dr), L(tot.rf), L(tot.dret), L(tot.ex), <Net key="t" cents={tot.net} />]}
            />
          </SectionCard>
          <p className="text-xs text-muted-foreground">Net flow = money received (payments and deposits) − money paid out (refunds, deposit returns and expenses) for each method. This is a collections report, separate from profit and loss.</p>
        </>
      )}
    </ReportShell>
  )
}

// ---------------------------------------------------------------------------
// Annual report
// ---------------------------------------------------------------------------
export function AnnualReportPage() {
  const thisYear = Number(businessToday().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const range = { from: `${year}-01-01`, to: `${year}-12-31` }
  const { per, total, loading, error, refetch } = useSummaries(range)
  const trend = useTrend(range, null, 'month')
  const points = useMemo(() => buildTrend(trend.data ?? [], range, 'month', businessToday()), [trend.data, year]) // eslint-disable-line react-hooks/exhaustive-deps
  const months = enumeratePeriods(range.from, range.to, 'month')

  return (
    <ReportShell
      title="Annual Report"
      description="Month-by-month results and yearly totals for RV Business Hub."
      ready={!loading && !trend.isLoading}
      filters={
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Year
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-36">
              {Array.from({ length: 6 }).map((_, i) => <option key={i} value={thisYear - i}>{thisYear - i}</option>)}
            </Select>
          </label>
          <RangeCaption range={range} />
        </div>
      }
      buildExport={() => ({
        fileName: `rv-annual-report-${year}`,
        title: `Annual Report ${year}`,
        subtitle: 'RV Business Hub',
        summary: [
          { label: 'Earned revenue', value: L(total.earned) },
          { label: 'Expenses', value: L(total.expenses) },
          { label: 'Net profit', value: L(total.net) },
          { label: 'Collected', value: L(total.collected) },
        ],
        tables: [
          {
            title: 'Month by month',
            columns: [{ header: 'Month' }, { header: 'Earned revenue', money: true }, { header: 'Collected', money: true }, { header: 'Expenses', money: true }, { header: 'Net profit', money: true }],
            rows: points.map((p) => [monthName(p.period, false), p.earnedCents, p.collectedCents, p.expenseCents, p.netCents]),
            total: ['TOTAL', total.earned, points.reduce((s, p) => s + p.collectedCents, 0), total.expenses, total.net],
          },
          consolidatedTable(per, total),
          metricsTable(per, total),
        ],
      })}
    >
      {loading || trend.isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => void refetch()} /> : (
        <>
          <HeadlineStats total={total} />
          <SectionCard title="Earned revenue vs expenses" description={`Monthly, ${year}`} actions={<TrendLegend />}>
            <TrendChart points={points} granularity="month" />
          </SectionCard>
          <SectionCard title="Month by month" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            <StatementTable
              head={['Month', 'Earned revenue', 'Collected', 'Expenses', 'Net profit']}
              rows={months.map((m) => {
                const p = points.find((x) => x.period === m)
                return [monthName(m, false), L(p?.earnedCents ?? 0), L(p?.collectedCents ?? 0), L(p?.expenseCents ?? 0), <Net key="n" cents={p?.netCents ?? 0} />]
              })}
              total={['TOTAL', L(total.earned), L(points.reduce((s, p) => s + p.collectedCents, 0)), L(total.expenses), <Net key="t" cents={total.net} />]}
            />
          </SectionCard>
          <ConsolidatedCard per={per} total={total} />
          <AccountingNote />
        </>
      )}
    </ReportShell>
  )
}
