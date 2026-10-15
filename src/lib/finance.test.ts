import { describe, expect, it } from 'vitest'
import {
  allocateSharedExpense,
  buildTrend,
  consolidate,
  defaultAdvanceCents,
  distribution,
  filterByBusiness,
  highestEarningBusiness,
  itemsTotalCents,
  lateFee,
  netProfit,
  profitMargin,
  rentalChargeCents,
  rentalDays,
  summarizeByBusiness,
  toSummaryCents,
} from './finance'
import { formatLKR, normalizeAmountInput, toCents } from './money'
import type { Business, BusinessSummaryRow, TrendRow } from '@/types/domain'

const biz = (id: string, name: string, sort: number): Business => ({
  id, slug: name.toLowerCase().replace(/\s+/g, '-'), code: `B0${sort}`, name, category: 'Test', description: null,
  sort_order: sort, is_active: true, created_at: '', updated_at: '',
})
const BUSINESSES = [biz('b3', 'Gift Park', 4), biz('b1', 'Studio of RV', 1), biz('b2', 'The Frame House', 2), biz('b4', 'RV Camera Rent', 3)]

const row = (business_id: string, earned: number, expenses: number, extra: Partial<BusinessSummaryRow> = {}): BusinessSummaryRow => ({
  business_id, earned_revenue: earned, job_revenue: earned, direct_sales: 0, collected_total: 0, collected_cash: 0,
  collected_card: 0, collected_bank: 0, collected_other: 0, deposit_applied: 0, refunds_total: 0, advance_payments: 0,
  expenses_total: expenses, net_profit: earned - expenses, deposits_received: 0, deposits_returned: 0, deposits_held: 0,
  outstanding: 0, overdue: 0, documents_count: 0, completed_count: 0, ...extra,
})

// The illustrative consolidated report from the specification.
const SPEC_ROWS = [row('b1', 400000, 150000), row('b2', 200000, 80000), row('b4', 150000, 40000), row('b3', 100000, 40000)]

describe('money', () => {
  it('converts decimals to integer cents without float drift', () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(30)
    expect(toCents('1,234.56')).toBe(123456)
    expect(toCents('10.005')).toBe(1001)
    expect(toCents(999999999999.99)).toBe(99999999999999)
    expect(toCents('abc')).toBe(0)
  })

  it('formats LKR with two decimals', () => {
    expect(formatLKR(0)).toBe('Rs. 0.00')
    expect(formatLKR(85000000)).toBe('Rs. 850,000.00')
    expect(formatLKR(-4500050)).toBe('-Rs. 45,000.50')
  })

  it('normalises user input for Postgres NUMERIC', () => {
    expect(normalizeAmountInput('12,500.5')).toBe('12500.50')
  })
})

describe('report consolidation', () => {
  it('reproduces the consolidated example from the specification', () => {
    const per = summarizeByBusiness(SPEC_ROWS, BUSINESSES)
    expect(per.map((p) => p.name)).toEqual(['Studio of RV', 'The Frame House', 'RV Camera Rent', 'Gift Park'])
    expect(per.map((p) => p.net / 100)).toEqual([250000, 120000, 110000, 60000])
    const total = consolidate(per)
    expect(total.earned / 100).toBe(850000)
    expect(total.expenses / 100).toBe(310000)
    expect(total.net / 100).toBe(540000)
  })

  it('net profit = earned revenue − expenses', () => {
    expect(netProfit(50000, 80000)).toBe(-30000)
    expect(toSummaryCents(row('x', 0.3, 0.1)).net).toBe(20)
  })

  it('fills businesses with no activity with zeros', () => {
    const per = summarizeByBusiness([row('b1', 100, 0)], BUSINESSES)
    expect(per).toHaveLength(4)
    expect(per.find((p) => p.businessId === 'b3')!.earned).toBe(0)
    expect(formatLKR(consolidate([]).net)).toBe('Rs. 0.00')
  })

  it('keeps payment methods separate and sums them independently', () => {
    const s = consolidate([
      toSummaryCents(row('b1', 0, 0, { collected_cash: 100, collected_card: 50 })),
      toSummaryCents(row('b2', 0, 0, { collected_cash: 1.5, collected_bank: 20 })),
    ])
    expect([s.cash, s.card, s.bank]).toEqual([10150, 5000, 2000])
  })

  it('finds the highest earning business and distribution shares', () => {
    const per = summarizeByBusiness(SPEC_ROWS, BUSINESSES)
    expect(highestEarningBusiness(per)?.name).toBe('Studio of RV')
    expect(highestEarningBusiness(summarizeByBusiness([], BUSINESSES))).toBeNull()
    const d = distribution(per, 'earned')
    expect(d.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1)
    expect(profitMargin(consolidate(per))).toBeCloseTo(540000 / 850000)
  })

  it('filters rows by business', () => {
    expect(filterByBusiness(SPEC_ROWS, 'b2')).toHaveLength(1)
    expect(filterByBusiness(SPEC_ROWS, null)).toHaveLength(4)
  })
})

describe('trend series', () => {
  const rows: TrendRow[] = [
    { business_id: 'b1', period: '2026-09-01', earned_revenue: 1000, collected: 500, expenses: 200 },
    { business_id: 'b2', period: '2026-09-01', earned_revenue: 500, collected: 500, expenses: 0 },
    { business_id: 'b1', period: '2026-11-01', earned_revenue: 0, collected: 300, expenses: 50 },
  ]

  it('combines businesses per period and fills gaps', () => {
    const t = buildTrend(rows, { from: '2026-09-01', to: '2026-12-31' }, 'month', '2026-10-15')
    expect(t.map((p) => p.period)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'])
    expect(t[0]).toMatchObject({ earnedCents: 150000, collectedCents: 100000, expenseCents: 20000, netCents: 130000 })
    expect(t[1]!.earnedCents).toBe(0)
  })

  it('spans the data for unbounded ranges', () => {
    expect(buildTrend(rows, { from: null, to: null }, 'month', '2026-10-15')).toHaveLength(3)
    expect(buildTrend([], { from: null, to: null }, 'month', '2026-10-15')).toEqual([])
  })
})

describe('form previews mirror the database rules', () => {
  it('totals order items exactly', () => {
    expect(itemsTotalCents([{ quantity: 2, unitPrice: '4500' }, { quantity: 1, unitPrice: '3000.50' }])).toBe(1200050)
    expect(itemsTotalCents([{ quantity: 0, unitPrice: '100' }, { quantity: 'x', unitPrice: '1' }])).toBe(0)
  })

  it('counts rental days like the database (part days round up, min 1)', () => {
    expect(rentalDays('2026-10-01T10:00:00+05:30', '2026-10-04T10:00:00+05:30')).toBe(3)
    expect(rentalDays('2026-10-01T10:00:00+05:30', '2026-10-04T11:00:00+05:30')).toBe(4)
    expect(rentalDays('2026-10-01T10:00:00+05:30', '2026-10-01T15:00:00+05:30')).toBe(1)
    expect(rentalDays('2026-10-02T10:00:00Z', '2026-10-01T10:00:00Z')).toBe(0)
    expect(rentalChargeCents(['8000', '3000'], 3)).toBe(3300000)
  })

  it('computes late fees after the grace period', () => {
    const exp = '2026-10-04T10:00:00+05:30'
    expect(lateFee(800000, exp, '2026-10-04T10:45:00+05:30', 60, 1)).toEqual({ lateDays: 0, feeCents: 0 })
    expect(lateFee(800000, exp, '2026-10-05T09:00:00+05:30', 60, 1)).toEqual({ lateDays: 1, feeCents: 800000 })
    expect(lateFee(800000, exp, '2026-10-06T12:00:00+05:30', 60, 1.5)).toEqual({ lateDays: 3, feeCents: 3600000 })
  })

  it('suggests the advance from a percentage', () => {
    expect(defaultAdvanceCents(5000000, 25)).toBe(1250000)
    expect(defaultAdvanceCents(333, 50)).toBe(167)
  })

  it('splits shared expenses so allocations always sum to the total', () => {
    const equal = allocateSharedExpense(1000000, 'equal', [{ businessId: 'a' }, { businessId: 'b' }, { businessId: 'c' }])
    expect(equal.map((a) => a.cents)).toEqual([333333, 333333, 333334])
    const pct = allocateSharedExpense(1000001, 'percentage', [
      { businessId: 'a', percent: 33.33 },
      { businessId: 'b', percent: 33.33 },
      { businessId: 'c', percent: 33.34 },
    ])
    expect(pct.reduce((s, a) => s + a.cents, 0)).toBe(1000001)
  })
})
