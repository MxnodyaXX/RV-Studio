import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react'
import { EmptyState, ErrorState } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'
import { useBusinesses, useRecentLedger } from '@/hooks/queries'
import { formatDisplayDate } from '@/lib/dates'
import { formatLKR, toCents } from '@/lib/money'
import { cn } from '@/lib/utils'

const LABEL: Record<string, string> = {
  payment: 'Payment received',
  deposit_received: 'Deposit received',
  refund: 'Refund',
  deposit_returned: 'Deposit returned',
  expense: 'Expense',
}

export function RecentTransactions({ businessId, limit = 8, showBusiness = true }: { businessId: string | null; limit?: number; showBusiness?: boolean }) {
  const { data, isLoading, error, refetch } = useRecentLedger(limit, businessId)
  const businesses = useBusinesses()
  const bizName = (id: string | null) => businesses.data?.find((b) => b.id === id)?.name

  if (isLoading) {
    return (
      <div className="space-y-4 px-5 pb-5 sm:px-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    )
  }
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  if (!data?.length) {
    return (
      <EmptyState
        icon={Receipt}
        title="No transactions yet"
        description="Payments, refunds and expenses will appear here."
        action={
          <Button asChild size="sm">
            <Link to="/transactions/income/new">Add income</Link>
          </Button>
        }
      />
    )
  }

  return (
    <ul className="divide-y divide-border">
      {data.map((t) => {
        const isIn = t.direction === 'in'
        const Icon = isIn ? ArrowDownLeft : ArrowUpRight
        return (
          <li key={t.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', isIn ? 'bg-income-soft text-income-text' : 'bg-expense-soft text-expense-text')} aria-label={isIn ? 'Money in' : 'Money out'}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {t.category_name && t.entry_type === 'expense' ? t.category_name : LABEL[t.entry_type ?? ''] ?? t.entry_type}
                {t.source_ref && <span className="font-normal text-muted-foreground"> · {t.source_ref}</span>}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {formatDisplayDate(t.entry_date)}
                {showBusiness && bizName(t.business_id) ? ` · ${bizName(t.business_id)}` : ''}
                {t.description ? ` · ${t.description}` : ''}
              </p>
            </div>
            <span className={cn('tabular shrink-0 whitespace-nowrap text-sm font-semibold', isIn ? 'text-income-text' : 'text-expense-text')}>
              {isIn ? '+' : '−'}
              {formatLKR(toCents(t.amount))}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
