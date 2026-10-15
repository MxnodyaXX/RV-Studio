import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { businessToday, isValidIsoDate, rangeForPreset } from '@/lib/dates'
import type { DatePreset, DateRange } from '@/types/domain'

const PRESETS: DatePreset[] = ['today', 'week', 'month', 'last_month', 'year', 'all', 'custom']

/**
 * Date-range + business filter state stored in the URL, so filtered views can be
 * bookmarked and survive reloads.
 */
export function useFinanceFilters(defaultPreset: Exclude<DatePreset, 'custom'> = 'month') {
  const [params, setParams] = useSearchParams()

  const rawPreset = params.get('range') as DatePreset | null
  const preset: DatePreset = rawPreset && PRESETS.includes(rawPreset) ? rawPreset : defaultPreset
  const customFrom = params.get('from') ?? ''
  const customTo = params.get('to') ?? ''
  const businessId = params.get('business') || null

  const range: DateRange = useMemo(() => {
    if (preset !== 'custom') return rangeForPreset(preset, businessToday())
    const from = isValidIsoDate(customFrom) ? customFrom : null
    const to = isValidIsoDate(customTo) ? customTo : null
    if (from && to && from > to) return { from: to, to: from }
    return { from, to }
  }, [preset, customFrom, customTo])

  const update = (patch: Record<string, string | null>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === '') next.delete(k)
          else next.set(k, v)
        }
        next.delete('page') // any filter change returns paginated views to page 1
        return next
      },
      { replace: true },
    )
  }

  return {
    preset,
    range,
    customFrom,
    customTo,
    businessId,
    setPreset: (p: DatePreset) =>
      update(p === 'custom' ? { range: p } : { range: p, from: null, to: null }),
    setCustomRange: (from: string, to: string) => update({ range: 'custom', from, to }),
    setBusinessId: (id: string | null) => update({ business: id }),
  }
}
