// Money helpers. All arithmetic happens in integer cents so that floating-point
// rounding can never leak into financial totals.

const formatter = new Intl.NumberFormat('en-LK', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat('en-LK', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Converts a decimal amount (number or numeric string) to integer cents. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim()
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) return 0
    const negative = normalized.startsWith('-')
    const [whole, frac = ''] = normalized.replace('-', '').split('.')
    // Round half up on the third decimal.
    const padded = (frac + '000').slice(0, 3)
    let cents = Number(whole) * 100 + Number(padded.slice(0, 2))
    if (Number(padded[2]) >= 5) cents += 1
    return negative ? -cents : cents
  }
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

export function fromCents(cents: number): number {
  return cents / 100
}

/** "Rs. 1,234.50" — always two decimals, minus sign before the symbol. */
export function formatLKR(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}Rs. ${formatter.format(Math.abs(cents) / 100)}`
}

/** "Rs. 1.2M" style short form for chart axes. */
export function formatLKRCompact(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}Rs. ${compactFormatter.format(Math.abs(cents) / 100)}`
}

/** Normalises user input ("12,500.5") to the string sent to Postgres ("12500.50"). */
export function normalizeAmountInput(input: string): string {
  const cents = toCents(input)
  const whole = Math.trunc(cents / 100)
  const frac = Math.abs(cents % 100)
  return `${whole}.${String(frac).padStart(2, '0')}`
}
