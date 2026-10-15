import { useEffect, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form-controls'
import { cn } from '@/lib/utils'
import { describeRange } from '@/lib/dates'
import { dateRangeSchema } from '@/lib/validation'
import type { Business, DatePreset, DateRange } from '@/types/domain'

const PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'year', label: 'This Year' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
]

export function DateRangeFilter({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomApply,
}: {
  preset: DatePreset
  customFrom: string
  customTo: string
  onPresetChange: (p: DatePreset) => void
  onCustomApply: (from: string, to: string) => void
}) {
  const [from, setFrom] = useState(customFrom)
  const [to, setTo] = useState(customTo)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFrom(customFrom)
    setTo(customTo)
  }, [customFrom, customTo])

  const apply = () => {
    const parsed = dateRangeSchema.safeParse({ from, to })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid date range')
      return
    }
    setError(null)
    onCustomApply(from, to)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Segmented control on larger screens, native select on phones */}
      <div className="hidden rounded-lg border border-border bg-card p-1 shadow-xs md:inline-flex" role="group" aria-label="Date range">
        {PRESET_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onPresetChange(o.value)}
            aria-pressed={preset === o.value}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              preset === o.value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Select
        className="md:hidden"
        aria-label="Date range"
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as DatePreset)}
      >
        {PRESET_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {preset === 'custom' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={!!error} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            To
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-invalid={!!error} />
          </label>
          <Button onClick={apply} variant="accent" className="sm:h-10">
            Apply
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function BusinessSelect({
  businesses,
  value,
  onChange,
  className,
  allLabel = 'All Businesses',
}: {
  businesses: Business[]
  value: string | null
  onChange: (id: string | null) => void
  className?: string
  allLabel?: string
}) {
  return (
    <Select className={className} aria-label="Business" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{allLabel}</option>
      {businesses.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </Select>
  )
}

export function RangeCaption({ range }: { range: DateRange }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CalendarDays className="size-3.5" aria-hidden />
      {describeRange(range)} · Asia/Colombo
    </p>
  )
}
