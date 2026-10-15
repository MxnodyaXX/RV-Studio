import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatLKR, formatLKRCompact, fromCents } from '@/lib/money'
import { formatLongDate, formatPeriodLabel, monthName } from '@/lib/dates'
import type { TrendPoint } from '@/lib/finance'
import type { Granularity } from '@/types/domain'

// Fills use the brand finance pair (validated: CVD ΔE 8.1 with legend + tooltip relief).
const REVENUE = '#10B981'
const EXPENSE = '#EF4444'

type Datum = { period: string; label: string; revenue: number; expense: number; point: TrendPoint }

type TooltipProps = { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }>; granularity: Granularity }

function ChartTooltip({ active, payload, granularity }: TooltipProps) {
  if (!active || !payload?.length) return null
  const d = payload[0]!.payload as Datum
  const p = d.point
  return (
    <div className="min-w-52 rounded-lg border border-border bg-card px-3 py-2.5 text-xs shadow-elevated">
      <p className="mb-2 font-semibold text-foreground">{granularity === 'day' ? formatLongDate(d.period) : monthName(d.period)}</p>
      <div className="space-y-1">
        <Row color={REVENUE} label="Earned revenue" value={formatLKR(p.earnedCents)} />
        <Row color={EXPENSE} label="Expenses" value={formatLKR(p.expenseCents)} />
        <div className="my-1.5 h-px bg-border" />
        <Row label="Net profit" value={formatLKR(p.netCents)} strong />
        <Row label="Collected" value={formatLKR(p.collectedCents)} />
      </div>
    </div>
  )
}

function Row({ color, label, value, strong }: { color?: string; label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-2.5 rounded-sm" style={{ background: color ?? 'transparent' }} />
        {label}
      </span>
      <span className={strong ? 'tabular font-semibold text-foreground' : 'tabular text-foreground'}>{value}</span>
    </div>
  )
}

export function TrendLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: REVENUE }} /> Earned revenue
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: EXPENSE }} /> Expenses
      </span>
    </div>
  )
}

export function TrendChart({ points, granularity, height = 280 }: { points: TrendPoint[]; granularity: Granularity; height?: number }) {
  const spansYears = points.length > 0 && points[0]!.period.slice(0, 4) !== points[points.length - 1]!.period.slice(0, 4)
  const data: Datum[] = points.map((p) => ({
    period: p.period,
    label: formatPeriodLabel(p.period, granularity, spansYears),
    revenue: fromCents(p.earnedCents),
    expense: fromCents(p.expenseCents),
    point: p,
  }))

  return (
    <div role="img" aria-label={`Earned revenue and expenses by ${granularity}, ${points.length} periods. Exact figures are in the tables.`} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap={points.length > 20 ? '15%' : '28%'}>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-input)' }} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} width={72} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} tickFormatter={(v: number) => formatLKRCompact(Math.round(v * 100))} />
          <Tooltip cursor={{ fill: 'color-mix(in oklab, var(--color-muted-foreground) 10%, transparent)' }} content={(props) => <ChartTooltip active={props.active} payload={props.payload} granularity={granularity} />} />
          <Bar dataKey="revenue" name="Earned revenue" fill={REVENUE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="expense" name="Expenses" fill={EXPENSE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
