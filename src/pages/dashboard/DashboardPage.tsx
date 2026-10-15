import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Banknote, Building2, Camera, Clock, CreditCard, Landmark, Scale, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth } from '@/app/auth-context'
import { useProfile } from '@/hooks/useProfile'
import { useBusinesses, useDocuments, useOperations, useSummary, useTrend } from '@/hooks/queries'
import { useFinanceFilters } from '@/hooks/useDateRangeFilter'
import { BusinessSelect, DateRangeFilter, RangeCaption } from '@/components/dashboard/FilterBar'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { TrendChart, TrendLegend } from '@/components/dashboard/TrendChart'
import { ProfitTrend } from '@/components/dashboard/ProfitTrend'
import { DistributionBars } from '@/components/dashboard/DistributionBars'
import { RecentTransactions } from '@/components/transactions/RecentTransactions'
import { UpcomingReminders } from '@/pages/calendar/CalendarPage'
import { BusinessAvatar, EmptyState, ErrorState, PageHeader } from '@/components/common'
import { SectionCard } from '@/components/shared'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { BUSINESS_SLUGS, SOURCE_META, documentPath } from '@/lib/constants'
import { businessToday, formatDateTime, formatDisplayDate, granularityForRange } from '@/lib/dates'
import { buildTrend, consolidate, distribution, profitMargin, summarizeByBusiness, type BusinessSummary } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { cn, formatPercent } from '@/lib/utils'
import type { DashboardOperations, SourceType } from '@/types/domain'

function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Colombo' }).format(new Date()))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const MODULE_LINK: Record<string, string> = {
  [BUSINESS_SLUGS.studio]: '/studio/bookings',
  [BUSINESS_SLUGS.frame]: '/frames/orders',
  [BUSINESS_SLUGS.camera]: '/camera/rentals',
  [BUSINESS_SLUGS.gift]: '/gifts/orders',
}

function opsFor(slug: string, ops: DashboardOperations | null | undefined): { label: string; value: number; alert?: boolean }[] {
  if (!ops) return []
  switch (slug) {
    case BUSINESS_SLUGS.studio:
      return [
        { label: 'Bookings', value: ops.studio.total_bookings },
        { label: 'Confirmed', value: ops.studio.confirmed_shoots },
        { label: 'Upcoming', value: ops.studio.upcoming_shoots },
        { label: 'Awaiting advance', value: ops.studio.pending_advance, alert: ops.studio.pending_advance > 0 },
      ]
    case BUSINESS_SLUGS.frame:
      return [
        { label: 'Orders', value: ops.frame.total_orders },
        { label: 'Processing', value: ops.frame.processing },
        { label: 'Ready', value: ops.frame.ready },
        { label: 'Due soon', value: ops.frame.pending_deliveries, alert: ops.frame.pending_deliveries > 0 },
      ]
    case BUSINESS_SLUGS.camera:
      return [
        { label: 'Active rentals', value: ops.camera.active_rentals },
        { label: 'Available kit', value: ops.camera.available_equipment },
        { label: 'Returns ≤3 days', value: ops.camera.upcoming_returns },
        { label: 'Overdue', value: ops.camera.overdue_rentals, alert: ops.camera.overdue_rentals > 0 },
      ]
    case BUSINESS_SLUGS.gift:
      return [
        { label: 'Orders', value: ops.gift.total_orders },
        { label: 'Pending', value: ops.gift.pending_orders },
        { label: 'Completed', value: ops.gift.completed_orders },
        { label: 'Low stock', value: ops.gift.low_stock, alert: ops.gift.low_stock > 0 },
      ]
    default:
      return []
  }
}

function BusinessCard({ s, ops }: { s: BusinessSummary; ops: DashboardOperations | null | undefined }) {
  const counts = opsFor(s.slug, ops)
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-center gap-3">
        <BusinessAvatar slug={s.slug} />
        <div className="min-w-0 flex-1">
          <Link to={`/businesses/${s.slug}`} className="block truncate font-semibold hover:text-accent">{s.name}</Link>
          <p className="truncate text-xs text-muted-foreground">{s.category}</p>
        </div>
        {MODULE_LINK[s.slug] && (
          <Button asChild size="icon-sm" variant="ghost" aria-label={`Open ${s.name}`}>
            <Link to={MODULE_LINK[s.slug]}><ArrowRight /></Link>
          </Button>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-[11px] text-muted-foreground">Revenue</dt><dd className="tabular truncate font-semibold">{formatLKR(s.earned)}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Expenses</dt><dd className="tabular truncate font-semibold">{formatLKR(s.expenses)}</dd></div>
        <div><dt className="text-[11px] text-muted-foreground">Net profit</dt><dd className={cn('tabular truncate font-semibold', s.net < 0 ? 'text-expense-text' : 'text-income-text')}>{formatLKR(s.net)}</dd></div>
      </dl>
      <dl className="mt-4 grid grid-cols-4 gap-1 border-t border-border pt-3 text-center">
        {counts.map((c) => (
          <div key={c.label}>
            <dd className={cn('text-lg font-semibold', c.alert && 'text-expense-text')}>{c.value}</dd>
            <dt className="text-[10px] leading-tight text-muted-foreground">{c.label}</dt>
          </div>
        ))}
      </dl>
    </Card>
  )
}

function OverduePayments() {
  const q = useDocuments({ overdueOnly: true, sort: 'due_asc', dateField: 'due_date' }, 1, 6)
  if (q.isLoading) return <Skeleton className="h-32 w-full" />
  if (!q.data?.rows.length) return <p className="text-sm text-muted-foreground">No overdue payments. 🎉</p>
  return (
    <ul className="divide-y divide-border">
      {q.data.rows.map((r) => (
        <li key={r.source_id}>
          <Link to={documentPath(r.source_type as SourceType, r.source_id!)} className="flex items-center gap-3 py-2.5 hover:opacity-80">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.customer_name ?? 'Walk-in'}</p>
              <p className="truncate text-xs text-muted-foreground"><span className="font-mono">{r.ref}</span> · due {formatDisplayDate(r.due_date)}</p>
            </div>
            <span className="tabular shrink-0 text-sm font-semibold text-expense-text">{formatLKR(toCents(r.outstanding))}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function RentalReturns() {
  const q = useDocuments({ sourceType: 'camera_rental', status: 'rented_out', sort: 'due_asc', dateField: 'due_date' }, 1, 6)
  if (q.isLoading) return <Skeleton className="h-32 w-full" />
  if (!q.data?.rows.length) return <p className="text-sm text-muted-foreground">No equipment is out right now.</p>
  const now = Date.now()
  return (
    <ul className="divide-y divide-border">
      {q.data.rows.map((r) => {
        const late = r.end_at ? new Date(r.end_at).getTime() < now : false
        return (
          <li key={r.source_id}>
            <Link to={documentPath('camera_rental', r.source_id!)} className="flex items-center gap-3 py-2.5 hover:opacity-80">
              {late ? <AlertTriangle className="size-4 shrink-0 text-destructive" /> : <Camera className="size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.title}</p>
                <p className="truncate text-xs text-muted-foreground">{r.customer_name} · <span className="font-mono">{r.ref}</span></p>
              </div>
              <span className={cn('shrink-0 text-xs', late ? 'font-semibold text-expense-text' : 'text-muted-foreground')}>
                {late ? 'Overdue ' : 'Due '}{r.end_at ? formatDateTime(r.end_at) : ''}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { data: profile } = useProfile()
  const filters = useFinanceFilters('month')
  const businessesQuery = useBusinesses()
  const businesses = useMemo(() => businessesQuery.data ?? [], [businessesQuery.data])
  const granularity = granularityForRange(filters.range)
  const summary = useSummary(filters.range)
  const trend = useTrend(filters.range, filters.businessId, granularity)
  const ops = useOperations(filters.range)

  const per = useMemo(() => summarizeByBusiness(summary.data ?? [], businesses), [summary.data, businesses])
  const visible = filters.businessId ? per.filter((b) => b.businessId === filters.businessId) : per
  const totals = useMemo(() => consolidate(visible), [visible])
  const points = useMemo(() => buildTrend(trend.data ?? [], filters.range, granularity, businessToday()), [trend.data, filters.range, granularity])
  const margin = profitMargin(totals)
  const collectedNet = totals.collected - totals.refunds
  const loading = summary.isLoading || businessesQuery.isLoading
  const error = summary.error ?? businessesQuery.error
  const selected = businesses.find((b) => b.id === filters.businessId)
  const hasActivity = points.some((p) => p.earnedCents || p.expenseCents)

  return (
    <div className={cn('transition-opacity', summary.isFetching && !loading && 'opacity-80')}>
      <PageHeader
        title={`${greeting()}, ${profile?.display_name ?? user?.email?.split('@')[0] ?? 'Administrator'}`}
        description={selected ? `Financial overview for ${selected.name}.` : 'Combined performance of RV Business Hub.'}
      />

      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <DateRangeFilter preset={filters.preset} customFrom={filters.customFrom} customTo={filters.customTo} onPresetChange={filters.setPreset} onCustomApply={filters.setCustomRange} />
          <BusinessSelect businesses={businesses} value={filters.businessId} onChange={filters.setBusinessId} className="lg:w-60" />
        </div>
        <div className="mt-3"><RangeCaption range={filters.range} /></div>
      </Card>

      {error ? (
        <Card><ErrorState error={error} onRetry={() => void summary.refetch()} /></Card>
      ) : (
        <div className="space-y-6">
          <section aria-label="Financial summary" className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Income Collected" icon={TrendingUp} tone="income" loading={loading} value={formatLKR(collectedNet)} footer={`Payments received${totals.refunds ? `, after ${formatLKR(totals.refunds)} refunds` : ''}`} />
            <KpiCard label="Expenses Paid" icon={TrendingDown} tone="expense" loading={loading} value={formatLKR(totals.expenses)} footer="Including shared-expense allocations" />
            <KpiCard
              label="Net Profit"
              icon={Scale}
              tone="primary"
              loading={loading}
              value={formatLKR(totals.net)}
              valueClassName={totals.net < 0 ? 'text-expense-text' : undefined}
              footer={<span title="Earned revenue minus expenses. Revenue is earned when the work is completed.">Earned {formatLKR(totals.earned)}{margin !== null ? ` · ${formatPercent(margin)} margin` : ''}</span>}
            />
            <KpiCard
              label="Pending Payments"
              icon={Clock}
              tone={totals.overdue ? 'expense' : 'muted'}
              loading={loading}
              value={formatLKR(totals.outstanding)}
              footer={<Link to="/pending-payments" className="hover:underline">{totals.overdue ? `${formatLKR(totals.overdue)} overdue →` : 'View pending payments →'}</Link>}
            />
          </section>
          <section aria-label="Payment methods" className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
            <KpiCard label="Cash Received" icon={Banknote} tone="muted" loading={loading} value={formatLKR(totals.cash)} />
            <KpiCard label="Card Payments" icon={CreditCard} tone="muted" loading={loading} value={formatLKR(totals.card)} />
            <KpiCard label="Bank Transfers" icon={Landmark} tone="muted" loading={loading} value={formatLKR(totals.bank)} footer={totals.depositsHeld ? `Deposits held (not income): ${formatLKR(totals.depositsHeld)}` : undefined} />
          </section>

          <section aria-label="Businesses" className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {loading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />) : visible.map((s) => <BusinessCard key={s.businessId} s={s} ops={ops.data} />)}
          </section>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-3">
            <SectionCard className="xl:col-span-2" title="Income vs Expenses" description={`${granularity === 'day' ? 'Daily' : 'Monthly'} earned revenue and expenses`} actions={<TrendLegend />}>
              {trend.isLoading ? <Skeleton className="h-[280px] w-full rounded-lg" /> : !hasActivity ? <EmptyState title="No activity in this period" description="Charts fill in as work is completed and expenses are recorded." /> : <TrendChart points={points} granularity={granularity} />}
            </SectionCard>
            <SectionCard title="Upcoming reminders" description="Next 7 days" actions={<Button asChild size="sm" variant="ghost"><Link to="/calendar">Calendar <ArrowRight /></Link></Button>}>
              <UpcomingReminders limit={6} compact />
            </SectionCard>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-3">
            <SectionCard className="xl:col-span-2" title="Monthly profit trend" description="Net profit per period">
              {trend.isLoading ? <Skeleton className="h-[220px] w-full rounded-lg" /> : !hasActivity ? <p className="text-sm text-muted-foreground">No profit data yet for this period.</p> : <ProfitTrend points={points} granularity={granularity} />}
            </SectionCard>
            <SectionCard title="Business revenue comparison" description="Share of earned revenue">
              {loading ? <Skeleton className="h-44 w-full" /> : <DistributionBars slices={distribution(per, 'earned')} type="income" />}
            </SectionCard>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <SectionCard title="Overdue payments" actions={<Button asChild size="sm" variant="ghost"><Link to="/pending-payments?status=overdue">All <ArrowRight /></Link></Button>}>
              <OverduePayments />
            </SectionCard>
            <SectionCard title="Camera return alerts" description="Equipment currently out" actions={<Button asChild size="sm" variant="ghost"><Link to="/camera/rentals?status=rented_out">All <ArrowRight /></Link></Button>}>
              <RentalReturns />
            </SectionCard>
            <SectionCard className="lg:col-span-2 xl:col-span-1" title="Recent transactions" actions={<Button asChild size="sm" variant="ghost"><Link to="/transactions">All <ArrowRight /></Link></Button>} bodyClassName="px-0 pb-2 sm:px-0">
              <RecentTransactions businessId={filters.businessId} limit={7} />
            </SectionCard>
          </div>
          {!businesses.length && !loading && <EmptyState icon={Building2} title="No businesses found" description="Apply the database migrations to create the four businesses." />}
          <p className="text-center text-xs text-muted-foreground">
            {SOURCE_META.studio_booking.label}s, frame orders, rentals and gift orders are earned when completed. Deposits are held separately and never counted as income.
          </p>
        </div>
      )}
    </div>
  )
}
