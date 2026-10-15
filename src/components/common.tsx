import type { ReactNode } from 'react'
import { AlertTriangle, Aperture, Building2, Camera, Frame, Gift, Inbox, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatLKR } from '@/lib/money'
import { toUserMessage } from '@/lib/errors'

export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-navy-700 text-sm font-bold tracking-tight text-white shadow-sm ring-1 ring-white/15">
        RV
      </div>
      <div className="leading-tight">
        <p className="text-[13px] font-bold tracking-[0.08em]">RV BUSINESS HUB</p>
        <p className="text-[11px] opacity-60">Business management</p>
      </div>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.65rem]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-6" aria-hidden />
      </div>
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-expense-soft text-destructive">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="font-medium text-foreground">Couldn't load this data</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{toUserMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background" role="status" aria-live="polite">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-elevated">
        RV
      </div>
      <div className="h-1 w-32 overflow-hidden rounded-full bg-skeleton">
        <div className="h-full w-1/2 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

/** Signed money amount: income in green with "+", expense in red with "−". */
export function Money({
  cents,
  type,
  className,
}: {
  cents: number
  type?: 'income' | 'expense'
  className?: string
}) {
  if (!type) return <span className={cn('tabular whitespace-nowrap', className)}>{formatLKR(cents)}</span>
  return (
    <span className={cn('tabular whitespace-nowrap font-semibold', type === 'income' ? 'text-income-text' : 'text-expense-text', className)}>
      {type === 'income' ? '+' : '−'}
      {formatLKR(cents)}
    </span>
  )
}

const BUSINESS_ICONS: Record<string, LucideIcon> = {
  'rv-camera-rent': Camera,
  'studio-of-rv': Aperture,
  'gift-park': Gift,
  'the-frame-house': Frame,
}

export function businessIcon(slug: string | undefined): LucideIcon {
  return (slug && BUSINESS_ICONS[slug]) || Building2
}

export function BusinessAvatar({ slug, className }: { slug: string; className?: string }) {
  const Icon = businessIcon(slug)
  return (
    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl bg-tile text-tile-foreground ring-1 ring-inset ring-tile-ring', className)}>
      <Icon className="size-5" aria-hidden />
    </div>
  )
}
