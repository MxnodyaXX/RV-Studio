import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/misc'
import { cn } from '@/lib/utils'

const TONES = {
  income: 'bg-income-soft text-income-text ring-income-ring',
  expense: 'bg-expense-soft text-expense-text ring-expense-ring',
  primary: 'bg-tile text-tile-foreground ring-tile-ring',
  muted: 'bg-muted text-muted-foreground ring-border',
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  footer,
  loading,
  valueClassName,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone: keyof typeof TONES
  footer?: ReactNode
  loading?: boolean
  valueClassName?: string
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONES[tone])}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-8 w-40" />
          <Skeleton className="mt-3 h-4 w-24" />
        </>
      ) : (
        <>
          <p className={cn('tabular mt-2 truncate text-[1.55rem] font-semibold leading-tight tracking-tight text-foreground', valueClassName)}>
            {value}
          </p>
          {footer && <div className="mt-2 text-xs text-muted-foreground">{footer}</div>}
        </>
      )}
    </Card>
  )
}
