// Reusable building blocks for module pages.
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/form-controls'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { PAYMENT_STATUS, statusInfo, type Tone } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { SourceType } from '@/types/domain'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  info: 'bg-accent-soft text-accent-text ring-accent/25',
  warning: 'bg-warning-soft text-warning-text ring-warning-ring',
  success: 'bg-income-soft text-income-text ring-income-ring',
  danger: 'bg-expense-soft text-expense-text ring-expense-ring',
  accent: 'bg-tile text-tile-foreground ring-tile-ring',
}

export function ToneBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONE_CLASSES[tone], className)}>
      {children}
    </span>
  )
}

export function StatusBadge({ type, status, className }: { type: SourceType; status: string; className?: string }) {
  const s = statusInfo(type, status)
  return <ToneBadge tone={s.tone} className={className}>{s.label}</ToneBadge>
}

export function PaymentBadge({ status, overdue, className }: { status: string | null; overdue?: boolean | null; className?: string }) {
  if (overdue) return <ToneBadge tone="danger" className={className}>Overdue</ToneBadge>
  const s = (status && PAYMENT_STATUS[status]) || { label: status ?? '—', tone: 'neutral' as Tone }
  return <ToneBadge tone={s.tone} className={className}>{s.label}</ToneBadge>
}

export function Pagination({ page, total, pageSize, onPage, busy }: { page: number; total: number; pageSize: number; onPage: (p: number) => void; busy?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
      <p className="text-xs text-muted-foreground sm:text-sm">
        Page {page} of {pages} · {total.toLocaleString()} records
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1 || busy} onClick={() => onPage(page - 1)}>
          <ChevronLeft /> <span className="hidden sm:inline">Previous</span>
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages || busy} onClick={() => onPage(page + 1)}>
          <span className="hidden sm:inline">Next</span> <ChevronRight />
        </Button>
      </div>
    </div>
  )
}

/** Search box that reports a debounced value. */
export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const [text, setText] = useState(value)
  const debounced = useDebouncedValue(text, 300)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (debounced !== value) onChange(debounced)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced])
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="pl-9" />
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 shadow-xs', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            value === t.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function SectionCard({ title, description, actions, children, className, bodyClassName }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <div className={cn('px-5 pb-5 sm:px-6 sm:pb-6', bodyClassName)}>{children}</div>
    </Card>
  )
}

export function DetailList({ items, className }: { items: { label: string; value: ReactNode; hidden?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>
      {items
        .filter((i) => !i.hidden)
        .map((i) => (
          <div key={i.label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i.label}</dt>
            <dd className="mt-1 break-words text-sm text-foreground">{i.value ?? '—'}</dd>
          </div>
        ))}
    </dl>
  )
}

/** Currency text input with an "Rs." prefix (keeps the value as a string for exact decimals). */
export function MoneyInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">Rs.</span>
      <Input inputMode="decimal" autoComplete="off" placeholder="0.00" className="tabular pl-11 text-right font-semibold" {...props} />
    </div>
  )
}

/** Horizontal workflow progress for a document. */
export function StatusStepper({ steps, current, cancelled }: { steps: { key: string; label: string }[]; current: string; cancelled?: boolean }) {
  const idx = steps.findIndex((s) => s.key === current)
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto pb-1" aria-label="Progress">
      {steps.map((s, i) => {
        const done = !cancelled && i < idx
        const active = !cancelled && i === idx
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-2',
                  done && 'bg-income text-white ring-income',
                  active && 'bg-primary text-primary-foreground ring-primary',
                  !done && !active && 'bg-card text-muted-foreground ring-border',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {i + 1}
              </span>
              <span className={cn('hidden text-[11px] leading-tight sm:block', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{s.label}</span>
            </div>
            {i < steps.length - 1 && <span className={cn('mb-5 h-0.5 min-w-3 flex-1 rounded sm:mb-6', done ? 'bg-income' : 'bg-border')} aria-hidden />}
          </li>
        )
      })}
    </ol>
  )
}

export function Stat({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: 'income' | 'expense' | 'warning' | 'muted'; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-subtle p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'tabular mt-1 truncate text-base font-semibold',
          tone === 'income' && 'text-income-text',
          tone === 'expense' && 'text-expense-text',
          tone === 'warning' && 'text-warning-text',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
