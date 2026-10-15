// Business-date helpers. Transaction dates are calendar dates in Asia/Colombo.
// We represent them as ISO "YYYY-MM-DD" strings and do arithmetic in UTC so the
// browser's own timezone can never shift a date.

import { BUSINESS_TIMEZONE, DAILY_GRANULARITY_MAX_DAYS } from './constants'
import type { DatePreset, DateRange, Granularity } from '@/types/domain'

const isoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Today's date in Asia/Colombo as YYYY-MM-DD. */
export function businessToday(now: Date = new Date()): string {
  return isoFormatter.format(now)
}

function parse(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  const d = parse(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return format(d)
}

export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  return format(parse(iso)) === iso
}

/** Inclusive number of days in a range. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1
}

/** Resolves a preset to an inclusive date range anchored on the Colombo "today". */
export function rangeForPreset(preset: Exclude<DatePreset, 'custom'>, today: string = businessToday()): DateRange {
  const d = parse(today)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'week': {
      // ISO week: Monday – Sunday.
      const dow = (d.getUTCDay() + 6) % 7
      const monday = addDays(today, -dow)
      return { from: monday, to: addDays(monday, 6) }
    }
    case 'month':
      return { from: format(new Date(Date.UTC(y, m, 1))), to: format(new Date(Date.UTC(y, m + 1, 0))) }
    case 'last_month':
      return { from: format(new Date(Date.UTC(y, m - 1, 1))), to: format(new Date(Date.UTC(y, m, 0))) }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'all':
      return { from: null, to: null }
  }
}

/** Chart bucket size for a range: per day for short ranges, otherwise per month. */
export function granularityForRange(range: DateRange): Granularity {
  if (!range.from || !range.to) return 'month'
  return daysBetween(range.from, range.to) <= DAILY_GRANULARITY_MAX_DAYS ? 'day' : 'month'
}

/** Every bucket start date between from and to (inclusive) for the granularity. */
export function enumeratePeriods(from: string, to: string, granularity: Granularity): string[] {
  const out: string[] = []
  if (from > to) return out
  if (granularity === 'day') {
    for (let cur = from; cur <= to; cur = addDays(cur, 1)) out.push(cur)
    return out
  }
  const start = parse(from)
  const end = parse(to)
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth()
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth())) {
    out.push(format(new Date(Date.UTC(y, m, 1))))
    m += 1
    if (m === 12) {
      m = 0
      y += 1
    }
  }
  return out
}

// Fixed English month abbreviations so output is identical on every device/locale.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(iso: string) {
  const [y, m, d] = iso.split('-')
  return { y: y!, m: MONTHS[Number(m) - 1]!, d: d! }
}

/** Business date format: "15/10/2026" (DD/MM/YYYY). */
export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** "15 Oct 2026" — used where a written month reads better (headings, receipts). */
export function formatLongDate(iso: string): string {
  const { y, m, d } = parts(iso.slice(0, 10))
  return `${d} ${m} ${y}`
}

const colomboParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function colomboFields(ts: string | Date) {
  const p = Object.fromEntries(colomboParts.formatToParts(typeof ts === 'string' ? new Date(ts) : ts).map((x) => [x.type, x.value]))
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, min: p.minute! }
}

/** Timestamp in Colombo time: "15/10/2026 14:30". */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—'
  const { y, m, d, h, min } = colomboFields(ts)
  return `${d}/${m}/${y} ${h}:${min}`
}

/** Clock time in Colombo: "14:30". */
export function formatTime(ts: string): string {
  const { h, min } = colomboFields(ts)
  return `${h}:${min}`
}

/** Colombo date of a timestamp as YYYY-MM-DD. */
export function colomboDateOf(ts: string): string {
  const { y, m, d } = colomboFields(ts)
  return `${y}-${m}-${d}`
}

/** Value for <input type="datetime-local"> showing a timestamp in Colombo time. */
export function toColomboInput(ts: string | null | undefined): string {
  if (!ts) return ''
  const { y, m, d, h, min } = colomboFields(ts)
  return `${y}-${m}-${d}T${h}:${min}`
}

/** Converts a datetime-local value entered in Colombo time to an ISO timestamp (UTC+05:30, no DST). */
export function fromColomboInput(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return ''
  return new Date(`${local}:00+05:30`).toISOString()
}

/** "HH:MM:SS" or "HH:MM" from Postgres time → "HH:MM". */
export function formatClock(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '—'
}

/** First and last day of the month containing `iso`. */
export function monthBounds(iso: string): { from: string; to: string } {
  const d = parse(iso)
  return {
    from: format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))),
    to: format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))),
  }
}

export function monthName(iso: string, long = true): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const d = parse(iso)
  return `${long ? names[d.getUTCMonth()] : MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function addMonths(iso: string, months: number): string {
  const d = parse(iso)
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1)))
}

/** 0 = Monday … 6 = Sunday */
export function weekdayIndex(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7
}

/** Axis label for a bucket: "15 Oct", "Oct" or "Oct 2026". */
export function formatPeriodLabel(iso: string, granularity: Granularity, spansYears = false): string {
  const { y, m, d } = parts(iso)
  if (granularity === 'day') return `${d} ${m}`
  return spansYears ? `${m} ${y}` : m
}

export function describeRange(range: DateRange): string {
  if (!range.from && !range.to) return 'All time'
  if (range.from && range.to && range.from === range.to) return formatDisplayDate(range.from)
  return `${range.from ? formatDisplayDate(range.from) : 'Beginning'} – ${range.to ? formatDisplayDate(range.to) : 'Today'}`
}

/** Formats a UTC timestamp for display in business local time. */
export const formatTimestamp = formatDateTime
