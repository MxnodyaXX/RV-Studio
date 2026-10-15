import { useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, Building2, MinusCircle, Plus, PlusCircle, Scale, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { useBusinessBySlug, useDocuments, useSummary, useTrend } from '@/hooks/queries'
import { useFinanceFilters } from '@/hooks/useDateRangeFilter'
import { DateRangeFilter, RangeCaption } from '@/components/dashboard/FilterBar'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { TrendChart, TrendLegend } from '@/components/dashboard/TrendChart'
import { RecentTransactions } from '@/components/transactions/RecentTransactions'
import { BusinessAvatar, EmptyState, ErrorState, PageHeader } from '@/components/common'
import { PaymentBadge, SectionCard, StatusBadge } from '@/components/shared'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/form-controls'
import { Badge, Skeleton } from '@/components/ui/misc'
import { Button } from '@/components/ui/button'
import { BUSINESS_SLUGS, SOURCE_META, documentPath } from '@/lib/constants'
import { businessToday, formatDisplayDate, granularityForRange } from '@/lib/dates'
import { buildTrend, profitMargin, toSummaryCents, EMPTY_SUMMARY } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { formatPercent } from '@/lib/utils'
import type { SourceType } from '@/types/domain'

const MODULE: Record<string, SourceType> = {
  [BUSINESS_SLUGS.studio]: 'studio_booking',
  [BUSINESS_SLUGS.frame]: 'frame_order',
  [BUSINESS_SLUGS.camera]: 'camera_rental',
  [BUSINESS_SLUGS.gift]: 'gift_order',
}

export default function BusinessDetailPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { business, data: businesses, isLoading, error: bizError, refetch } = useBusinessBySlug(slug)
  const filters = useFinanceFilters('year')
  const granularity = granularityForRange(filters.range)
  const summary = useSummary(filters.range, business?.id ?? null)
  const trend = useTrend(filters.range, business?.id ?? null, granularity)
  const module = slug ? MODULE[slug] : undefined
  const open = useDocuments({ businessId: business?.id ?? null, openOnly: true, sort: 'due_asc', dateField: 'due_date' }, 1, 8)

  const s = useMemo(() => {
    const row = summary.data?.find((r) => r.business_id === business?.id)
    return row ? toSummaryCents(row) : EMPTY_SUMMARY
  }, [summary.data, business?.id])
  const points = useMemo(() => buildTrend(trend.data ?? [], filters.range, granularity, businessToday()), [trend.data, filters.range, granularity])
  const margin = profitMargin(s)

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />
  if (bizError) return <ErrorState error={bizError} onRetry={() => void refetch()} />
  if (!business) {
    return <EmptyState icon={Building2} title="Business not found" action={<Button asChild><Link to="/businesses">All businesses</Link></Button>} />
  }
  const loading = summary.isLoading
  const query = params.toString()

  return (
    <div>
      <PageHeader
        eyebrow={<Badge variant="muted" className="font-mono">{business.code}</Badge>}
        title={
          <span className="flex items-center gap-3">
            <BusinessAvatar slug={business.slug} className="size-11" />
            <span className="min-w-0">
              <span className="block truncate">{business.name}</span>
              <span className="block truncate text-sm font-normal text-muted-foreground">{business.category}</span>
            </span>
          </span>
        }
        actions={
          <>
            <Select aria-label="Switch business" className="w-full sm:w-56" value={business.slug} onChange={(e) => navigate(`/businesses/${e.target.value}${query ? `?${query}` : ''}`)}>
              {(businesses ?? []).map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
            </Select>
            {module && (
              <Button asChild>
                <Link to={`${SOURCE_META[module].path}/new`}><Plus /> New {SOURCE_META[module].noun}</Link>
              </Button>
            )}
          </>
        }
      />
      {business.description && <p className="-mt-3 mb-6 max-w-2xl text-sm text-muted-foreground">{business.description}</p>}

      <Card className="mb-6 p-4">
        <DateRangeFilter preset={filters.preset} customFrom={filters.customFrom} customTo={filters.customTo} onPresetChange={filters.setPreset} onCustomApply={filters.setCustomRange} />
        <div className="mt-3"><RangeCaption range={filters.range} /></div>
      </Card>

      {summary.error ? (
        <Card><ErrorState error={summary.error} onRetry={() => void summary.refetch()} /></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Earned revenue" icon={TrendingUp} tone="income" loading={loading} value={formatLKR(s.earned)} footer={`${s.completed} completed · direct sales ${formatLKR(s.directSales)}`} />
            <KpiCard label="Expenses" icon={TrendingDown} tone="expense" loading={loading} value={formatLKR(s.expenses)} />
            <KpiCard label="Net profit" icon={Scale} tone="primary" loading={loading} value={formatLKR(s.net)} valueClassName={s.net < 0 ? 'text-expense-text' : undefined} footer={margin !== null ? `${formatPercent(margin)} margin` : undefined} />
            <KpiCard label="Collected" icon={Wallet} tone="muted" loading={loading} value={formatLKR(s.collected - s.refunds)} footer={`Cash ${formatLKR(s.cash)} · Card ${formatLKR(s.card)} · Bank ${formatLKR(s.bank)}`} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-5">
            <SectionCard className="xl:col-span-3" title={`${granularity === 'day' ? 'Daily' : 'Monthly'} performance`} description="Earned revenue and expenses" actions={<TrendLegend />}>
              {trend.isLoading ? <Skeleton className="h-[280px] w-full" /> : points.some((p) => p.earnedCents || p.expenseCents) ? <TrendChart points={points} granularity={granularity} /> : <EmptyState title="No activity in this period" />}
            </SectionCard>
            <SectionCard className="xl:col-span-2" title="Recent transactions" actions={<Button asChild variant="ghost" size="sm"><Link to={`/transactions?business=${business.id}`}>All <ArrowRight /></Link></Button>} bodyClassName="px-0 pb-2 sm:px-0">
              <RecentTransactions businessId={business.id} showBusiness={false} />
            </SectionCard>
          </div>

          {module && (
            <SectionCard title={`Open ${SOURCE_META[module].plural.toLowerCase()}`} description={`Outstanding now: ${formatLKR(s.outstanding)}${s.depositsHeld ? ` · Deposits held ${formatLKR(s.depositsHeld)}` : ''}`} actions={<Button asChild variant="ghost" size="sm"><Link to={SOURCE_META[module].path}>View all <ArrowRight /></Link></Button>} bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
              {open.isLoading ? <Skeleton className="m-5 h-24" /> : !open.data?.rows.length ? <p className="px-6 pb-6 text-sm text-muted-foreground">Nothing open right now.</p> : (
                <ul className="divide-y divide-border border-t border-border">
                  {open.data.rows.map((r) => (
                    <li key={r.source_id}>
                      <Link to={documentPath(module, r.source_id!)} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle sm:px-6">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium"><span className="font-mono">{r.ref}</span> · {r.customer_name ?? 'Walk-in'}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <StatusBadge type={module} status={r.status!} />
                            <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                            <span>Due {formatDisplayDate(r.due_date)}</span>
                          </div>
                        </div>
                        <span className="tabular shrink-0 text-sm font-semibold">{formatLKR(toCents(r.outstanding))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><Link to={`/transactions/income/new?mode=direct&business=${business.id}`}><PlusCircle /> Direct income</Link></Button>
            <Button asChild variant="outline"><Link to={`/transactions/expense/new?business=${business.id}`}><MinusCircle className="text-expense-text" /> Expense</Link></Button>
          </div>
        </div>
      )}
    </div>
  )
}
