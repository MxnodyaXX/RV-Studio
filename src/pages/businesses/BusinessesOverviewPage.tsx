import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useBusinesses, useSummary } from '@/hooks/queries'
import { useFinanceFilters } from '@/hooks/useDateRangeFilter'
import { DateRangeFilter, RangeCaption } from '@/components/dashboard/FilterBar'
import { BusinessAvatar, ErrorState, PageHeader } from '@/components/common'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { consolidate, summarizeByBusiness } from '@/lib/finance'
import { formatLKR } from '@/lib/money'
import { cn } from '@/lib/utils'

export default function BusinessesOverviewPage() {
  const filters = useFinanceFilters('year')
  const businesses = useBusinesses()
  const summary = useSummary(filters.range)
  const per = useMemo(() => summarizeByBusiness(summary.data ?? [], businesses.data ?? []), [summary.data, businesses.data])
  const total = consolidate(per)
  const loading = businesses.isLoading || summary.isLoading
  const error = businesses.error ?? summary.error
  const qs = filters.preset === 'year' ? '' : `?range=${filters.preset}${filters.preset === 'custom' ? `&from=${filters.customFrom}&to=${filters.customTo}` : ''}`

  return (
    <div>
      <PageHeader title="Businesses" description="Each business keeps its own records; RV Business Hub totals combine all four." />
      <Card className="mb-6 p-4">
        <DateRangeFilter preset={filters.preset} customFrom={filters.customFrom} customTo={filters.customTo} onPresetChange={filters.setPreset} onCustomApply={filters.setCustomRange} />
        <div className="mt-3"><RangeCaption range={filters.range} /></div>
      </Card>
      {error ? (
        <Card><ErrorState error={error} onRetry={() => void summary.refetch()} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)
              : per.map((s) => (
                  <Link key={s.businessId} to={`/businesses/${s.slug}${qs}`} className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-accent/30">
                    <Card className="h-full p-5 transition-shadow group-hover:shadow-elevated sm:p-6">
                      <div className="flex items-start gap-3">
                        <BusinessAvatar slug={s.slug} className="size-11" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{s.name}</p>
                          <p className="truncate text-sm text-muted-foreground">{s.category}</p>
                        </div>
                        <ArrowRight className="size-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
                      </div>
                      <dl className="mt-6 grid grid-cols-3 gap-3">
                        <div><dt className="text-xs text-muted-foreground">Revenue</dt><dd className="tabular mt-1 truncate text-sm font-semibold sm:text-base">{formatLKR(s.earned)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Expenses</dt><dd className="tabular mt-1 truncate text-sm font-semibold sm:text-base">{formatLKR(s.expenses)}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Net profit</dt><dd className={cn('tabular mt-1 truncate text-sm font-semibold sm:text-base', s.net < 0 ? 'text-expense-text' : 'text-income-text')}>{formatLKR(s.net)}</dd></div>
                      </dl>
                      <p className="mt-4 text-xs text-muted-foreground">
                        Collected {formatLKR(s.collected - s.refunds)} · Outstanding {formatLKR(s.outstanding)} · {s.documents} record{s.documents === 1 ? '' : 's'}
                      </p>
                    </Card>
                  </Link>
                ))}
          </div>
          {!loading && (
            <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-5">
              <p className="font-semibold">RV Business Hub total</p>
              <div className="tabular flex flex-wrap gap-6 text-sm">
                <span>Revenue <strong>{formatLKR(total.earned)}</strong></span>
                <span>Expenses <strong>{formatLKR(total.expenses)}</strong></span>
                <span>Net profit <strong className={total.net < 0 ? 'text-expense-text' : 'text-income-text'}>{formatLKR(total.net)}</strong></span>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
