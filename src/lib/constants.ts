import type { MoneyMethod, SourceType } from '@/types/domain'

export const APP_NAME = 'RV BUSINESS HUB'
export const CURRENCY = 'LKR'
export const BUSINESS_TIMEZONE = 'Asia/Colombo'

/** Largest value that fits NUMERIC(14,2). */
export const MAX_AMOUNT = 999_999_999_999.99

/** Methods a customer can pay with (spec: cash, card, bank transfer). */
export const PAYMENT_METHODS: { value: Extract<MoneyMethod, 'cash' | 'card' | 'bank_transfer'>; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
]

export const PAYMENT_METHOD_LABELS: Record<MoneyMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  deposit: 'Deposit applied',
  other: 'Other',
}

/** Business slugs are fixed identifiers; names can be edited in Settings. */
export const BUSINESS_SLUGS = {
  studio: 'studio-of-rv',
  frame: 'the-frame-house',
  camera: 'rv-camera-rent',
  gift: 'gift-park',
} as const

export const SOURCE_META: Record<SourceType, { label: string; plural: string; slug: string; path: string; noun: string }> = {
  studio_booking: { label: 'Studio booking', plural: 'Studio bookings', slug: BUSINESS_SLUGS.studio, path: '/studio/bookings', noun: 'booking' },
  frame_order: { label: 'Frame order', plural: 'Frame orders', slug: BUSINESS_SLUGS.frame, path: '/frames/orders', noun: 'order' },
  camera_rental: { label: 'Camera rental', plural: 'Camera rentals', slug: BUSINESS_SLUGS.camera, path: '/camera/rentals', noun: 'rental' },
  gift_order: { label: 'Gift order', plural: 'Gift orders', slug: BUSINESS_SLUGS.gift, path: '/gifts/orders', noun: 'order' },
}

export function documentPath(type: SourceType, id: string): string {
  return `${SOURCE_META[type].path}/${id}`
}

export const PAGE_SIZE = 20

/** Hard cap for CSV export to keep the browser responsive. */
export const CSV_EXPORT_LIMIT = 10_000

/** Ranges up to this many days are charted per day, longer ones per month. */
export const DAILY_GRANULARITY_MAX_DAYS = 62
