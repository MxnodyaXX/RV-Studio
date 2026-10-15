import { formatLKR } from '@/lib/money'
import { formatPercent } from '@/lib/utils'
import type { DistributionSlice } from '@/lib/finance'
import { EmptyState } from '@/components/common'
import { PieChart } from 'lucide-react'

/**
 * Business share of income or expenses as direct-labelled horizontal bars.
 * One hue per chart (the businesses are identified by their labels, not colour),
 * which stays readable for colour-vision deficiencies and in print.
 */
export function DistributionBars({ slices, type }: { slices: DistributionSlice[]; type: 'income' | 'expense' }) {
  const total = slices.reduce((a, s) => a + s.cents, 0)
  if (total === 0) {
    return (
      <EmptyState
        icon={PieChart}
        title={type === 'income' ? 'No income in this period' : 'No expenses in this period'}
        description="The breakdown by business appears once transactions are recorded."
        className="py-8"
      />
    )
  }
  const max = Math.max(...slices.map((s) => s.cents))
  const fill = type === 'income' ? 'bg-income' : 'bg-expense'

  return (
    <ul className="space-y-4" aria-label={type === 'income' ? 'Income by business' : 'Expenses by business'}>
      {slices.map((s) => (
        <li key={s.businessId} title={`${s.name}: ${formatLKR(s.cents)} (${formatPercent(s.share)})`}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-foreground">{s.name}</span>
            <span className="tabular shrink-0 text-muted-foreground">
              <span className="font-medium text-foreground">{formatLKR(s.cents)}</span> · {formatPercent(s.share)}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${fill}`}
              style={{ width: `${max > 0 ? Math.max((s.cents / max) * 100, s.cents > 0 ? 2 : 0) : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
