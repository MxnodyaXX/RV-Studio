import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatLKR, formatLKRCompact, fromCents } from '@/lib/money'
import { formatLongDate, formatPeriodLabel, monthName } from '@/lib/dates'
import type { TrendPoint } from '@/lib/finance'
import type { Granularity } from '@/types/domain'

/** Single-series net profit trend (no legend needed; the title names it). */
export function ProfitTrend({ points, granularity, height = 220 }: { points: TrendPoint[]; granularity: Granularity; height?: number }) {
  const spansYears = points.length > 0 && points[0]!.period.slice(0, 4) !== points[points.length - 1]!.period.slice(0, 4)
  const data = points.map((p) => ({ label: formatPeriodLabel(p.period, granularity, spansYears), net: fromCents(p.netCents), p }))
  return (
    <div role="img" aria-label="Net profit trend" style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: 'var(--color-input)' }} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tickLine={false} axisLine={false} width={72} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }} tickFormatter={(v: number) => formatLKRCompact(Math.round(v * 100))} />
          <ReferenceLine y={0} stroke="var(--color-input)" />
          <Tooltip
            cursor={{ stroke: 'var(--color-muted-foreground)', strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = (payload[0]!.payload as { p: TrendPoint }).p
              return (
                <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-elevated">
                  <p className="mb-1 font-semibold">{granularity === 'day' ? formatLongDate(p.period) : monthName(p.period)}</p>
                  <p className="tabular">Net profit: <strong>{formatLKR(p.netCents)}</strong></p>
                </div>
              )
            }}
          />
          <Area type="linear" dataKey="net" stroke="var(--color-accent)" strokeWidth={2} fill="url(#profitFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-card)' }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
