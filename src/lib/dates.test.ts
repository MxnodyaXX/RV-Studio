import { describe, expect, it } from 'vitest'
import { addDays, businessToday, daysBetween, enumeratePeriods, granularityForRange, isValidIsoDate, rangeForPreset } from './dates'

describe('business dates (Asia/Colombo)', () => {
  it('uses Colombo time for "today", not the browser timezone', () => {
    // 2026-10-15 19:00 UTC is already 2026-10-16 00:30 in Colombo (UTC+05:30).
    expect(businessToday(new Date('2026-10-15T19:00:00Z'))).toBe('2026-10-16')
    expect(businessToday(new Date('2026-10-15T18:29:00Z'))).toBe('2026-10-15')
  })

  it('resolves presets', () => {
    const today = '2026-10-15' // Thursday
    expect(rangeForPreset('today', today)).toEqual({ from: today, to: today })
    expect(rangeForPreset('week', today)).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(rangeForPreset('month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(rangeForPreset('month', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(rangeForPreset('year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(rangeForPreset('all', today)).toEqual({ from: null, to: null })
  })

  it('handles week boundaries on Sunday and Monday', () => {
    expect(rangeForPreset('week', '2026-10-18')).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(rangeForPreset('week', '2026-10-19')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
  })

  it('does date arithmetic and validation', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(31)
    expect(isValidIsoDate('2026-02-30')).toBe(false)
    expect(isValidIsoDate('2026-02-28')).toBe(true)
    expect(isValidIsoDate('15/10/2026')).toBe(false)
  })

  it('chooses chart granularity by range length', () => {
    expect(granularityForRange({ from: '2026-10-01', to: '2026-10-31' })).toBe('day')
    expect(granularityForRange({ from: '2026-01-01', to: '2026-12-31' })).toBe('month')
    expect(granularityForRange({ from: null, to: null })).toBe('month')
  })

  it('enumerates periods', () => {
    expect(enumeratePeriods('2026-11-15', '2027-02-01', 'month')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'])
    expect(enumeratePeriods('2026-10-30', '2026-11-01', 'day')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01'])
    expect(enumeratePeriods('2026-11-01', '2026-10-01', 'day')).toEqual([])
  })
})

describe('display formatting', () => {
  it('uses DD/MM/YYYY for business dates, identical on every locale', async () => {
    const { formatDisplayDate, formatLongDate, formatPeriodLabel } = await import('./dates')
    expect(formatDisplayDate('2026-09-07')).toBe('07/09/2026')
    expect(formatDisplayDate(null)).toBe('—')
    expect(formatLongDate('2026-09-07')).toBe('07 Sep 2026')
    expect(formatPeriodLabel('2026-09-01', 'month')).toBe('Sep')
    expect(formatPeriodLabel('2026-09-01', 'month', true)).toBe('Sep 2026')
    expect(formatPeriodLabel('2026-09-07', 'day')).toBe('07 Sep')
  })

  it('shows timestamps and datetime inputs in Colombo time, whatever the device timezone', async () => {
    const { formatDateTime, toColomboInput, fromColomboInput, colomboDateOf } = await import('./dates')
    const ts = '2026-10-15T19:00:00Z' // 00:30 on the 16th in Colombo
    expect(formatDateTime(ts)).toBe('16/10/2026 00:30')
    expect(toColomboInput(ts)).toBe('2026-10-16T00:30')
    expect(fromColomboInput('2026-10-16T00:30')).toBe('2026-10-15T19:00:00.000Z')
    expect(fromColomboInput('bad')).toBe('')
    expect(colomboDateOf(ts)).toBe('2026-10-16')
  })

  it('resolves last month across a year boundary', async () => {
    const { rangeForPreset } = await import('./dates')
    expect(rangeForPreset('last_month', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
})
