import { z } from 'zod'
import { MAX_AMOUNT } from './constants'
import { businessToday, isValidIsoDate } from './dates'
import { toCents } from './money'

const AMOUNT_PATTERN = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/
const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/

/** Reports only the first problem with an amount, in order of relevance. */
export function amountError(value: string, { allowZero = false } = {}): string | null {
  const v = value.trim()
  if (!v) return 'Enter an amount'
  if (!AMOUNT_PATTERN.test(v)) return 'Enter a valid amount with up to 2 decimal places'
  const cents = toCents(v)
  if (allowZero ? cents < 0 : cents <= 0) return allowZero ? 'Amount cannot be negative' : 'Amount must be greater than zero'
  if (cents > Math.round(MAX_AMOUNT * 100)) return 'Amount is too large'
  return null
}

/** Required amount greater than zero. */
export const amountSchema = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    const message = amountError(v)
    if (message) ctx.addIssue({ code: 'custom', message })
  })

/** Amount that may be zero; blank counts as zero. */
export const moneyOrZeroSchema = z
  .string()
  .trim()
  .transform((v) => (v === '' ? '0' : v))
  .superRefine((v, ctx) => {
    const message = amountError(v, { allowZero: true })
    if (message) ctx.addIssue({ code: 'custom', message })
  })

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).optional().or(z.literal(''))

const requiredText = (max: number, label: string) =>
  z.string().trim().min(1, `Enter ${label.toLowerCase()}`).max(max, `${label} must be ${max} characters or fewer`)

const isoDate = (label: string) =>
  z.string().superRefine((d, ctx) => {
    const message = !d ? `Select ${label.toLowerCase()}` : !isValidIsoDate(d) ? 'Enter a valid date' : d < '2000-01-01' ? 'Date is too far in the past' : null
    if (message) ctx.addIssue({ code: 'custom', message })
  })

const pastOrToday = (label: string, today: string) =>
  isoDate(label).refine((d) => !d || d <= today, 'Date cannot be in the future')

const optionalIsoDate = z.string().refine((d) => !d || isValidIsoDate(d), 'Enter a valid date')

const timeOfDay = (label: string) => z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, `Enter ${label.toLowerCase()}`)

const localDateTime = (label: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, `Enter ${label.toLowerCase()}`)

const optionalPhone = z.string().trim().refine((v) => !v || PHONE_PATTERN.test(v), 'Enter a valid phone number').optional().or(z.literal(''))

export const PAYMENT_METHOD_VALUES = ['cash', 'card', 'bank_transfer'] as const
const paymentMethod = z.enum(PAYMENT_METHOD_VALUES, { message: 'Select a payment method' })

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const customerSchema = z.object({
  fullName: requiredText(120, 'Customer name'),
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: z.string().trim().refine((v) => !v || z.email().safeParse(v).success, 'Enter a valid email address').optional().or(z.literal('')),
  address: optionalText(300, 'Address'),
  notes: optionalText(1000, 'Notes'),
})
export type CustomerValues = z.infer<typeof customerSchema>

// ---------------------------------------------------------------------------
// Studio of RV
// ---------------------------------------------------------------------------
export const studioBookingSchema = z
  .object({
    customerId: z.string().min(1, 'Select or add a customer'),
    packageId: z.string().optional().or(z.literal('')),
    packageName: requiredText(120, 'Package'),
    packageDescription: optionalText(1000, 'Package description'),
    shootDate: isoDate('Shoot date'),
    startTime: timeOfDay('Start time'),
    endTime: timeOfDay('End time'),
    location: requiredText(200, 'Location'),
    resourceId: z.string().optional().or(z.literal('')),
    packagePrice: moneyOrZeroSchema,
    additionalCharges: moneyOrZeroSchema,
    additionalChargesNote: optionalText(300, 'Additional charges note'),
    requiredAdvance: moneyOrZeroSchema,
    notes: optionalText(2000, 'Notes'),
  })
  .refine((v) => v.endTime > v.startTime, { message: 'End time must be after the start time', path: ['endTime'] })
  .refine((v) => toCents(v.requiredAdvance) <= toCents(v.packagePrice) + toCents(v.additionalCharges), {
    message: 'Advance cannot exceed the total price',
    path: ['requiredAdvance'],
  })
export type StudioBookingValues = z.input<typeof studioBookingSchema>

// ---------------------------------------------------------------------------
// The Frame House
// ---------------------------------------------------------------------------
const quantity = z.coerce.number({ message: 'Enter a quantity' }).int('Whole numbers only').min(1, 'At least 1').max(10000, 'Too many')

export const frameOrderSchema = z
  .object({
    customerId: z.string().min(1, 'Select or add a customer'),
    orderDate: isoDate('Order date'),
    expectedCompletionDate: optionalIsoDate,
    specialInstructions: optionalText(2000, 'Special instructions'),
    items: z
      .array(
        z.object({
          frameType: requiredText(120, 'Frame type'),
          frameSize: requiredText(60, 'Frame size'),
          description: optionalText(500, 'Description'),
          quantity,
          unitPrice: moneyOrZeroSchema,
        }),
      )
      .min(1, 'Add at least one frame'),
  })
  .refine((v) => !v.expectedCompletionDate || v.expectedCompletionDate >= v.orderDate, {
    message: 'Completion date cannot be before the order date',
    path: ['expectedCompletionDate'],
  })
export type FrameOrderValues = z.input<typeof frameOrderSchema>

// ---------------------------------------------------------------------------
// RV Camera Rent
// ---------------------------------------------------------------------------
export const cameraRentalSchema = z
  .object({
    customerId: z.string().min(1, 'Select or add a customer'),
    pickupAt: localDateTime('Pickup date and time'),
    expectedReturnAt: localDateTime('Return date and time'),
    depositRequired: moneyOrZeroSchema,
    notes: optionalText(2000, 'Notes'),
    equipmentIds: z.array(z.string()).min(1, 'Select at least one piece of equipment'),
  })
  .refine((v) => v.expectedReturnAt > v.pickupAt, { message: 'Return must be after pickup', path: ['expectedReturnAt'] })
export type CameraRentalValues = z.input<typeof cameraRentalSchema>

export const pickupSchema = z.object({
  verified: z.literal(true, { message: 'Confirm that the customer’s identity was verified' }),
  idType: z.enum(['nic', 'passport', 'driving_licence', 'other']),
  idLast4: z.string().trim().refine((v) => !v || /^[A-Za-z0-9]{2,4}$/.test(v), 'Enter only the last 2–4 letters/digits').optional().or(z.literal('')),
  verificationNotes: optionalText(500, 'Notes'),
  originalHeld: z.boolean(),
  items: z.array(z.object({ equipmentId: z.string(), condition: z.enum(['excellent', 'good', 'fair', 'damaged']), accessories: optionalText(500, 'Accessories'), notes: optionalText(1000, 'Notes') })),
})
export type PickupValues = z.input<typeof pickupSchema>

export const returnSchema = z.object({
  returnedAt: localDateTime('Return date and time'),
  lateFee: z.string().trim().refine((v) => !v || amountError(v, { allowZero: true }) === null, 'Enter a valid amount').optional().or(z.literal('')),
  damageCharge: moneyOrZeroSchema,
  otherCharges: moneyOrZeroSchema,
  returnNotes: optionalText(2000, 'Notes'),
  items: z.array(z.object({ equipmentId: z.string(), condition: z.enum(['excellent', 'good', 'fair', 'damaged']), accessories: optionalText(500, 'Accessories'), notes: optionalText(1000, 'Notes') })),
})
export type ReturnValues = z.input<typeof returnSchema>

// ---------------------------------------------------------------------------
// Gift Park
// ---------------------------------------------------------------------------
export const giftOrderSchema = z
  .object({
    customerId: z.string().optional().or(z.literal('')),
    orderDate: isoDate('Order date'),
    expectedDeliveryDate: optionalIsoDate,
    deliveryCharge: moneyOrZeroSchema,
    notes: optionalText(2000, 'Notes'),
    items: z
      .array(z.object({ productId: z.string().optional().or(z.literal('')), productName: requiredText(120, 'Product'), quantity, unitPrice: moneyOrZeroSchema }))
      .min(1, 'Add at least one product'),
  })
  .refine((v) => !v.expectedDeliveryDate || v.expectedDeliveryDate >= v.orderDate, {
    message: 'Delivery date cannot be before the order date',
    path: ['expectedDeliveryDate'],
  })
export type GiftOrderValues = z.input<typeof giftOrderSchema>

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
export function paymentSchema(maxCents: number | null, today: string = businessToday()) {
  return z.object({
    purpose: z.enum(['charge', 'deposit']),
    method: z.enum(['cash', 'card', 'bank_transfer', 'deposit'], { message: 'Select a payment method' }),
    amount: amountSchema.refine((v) => maxCents === null || toCents(v) <= maxCents, 'Amount is more than the balance'),
    paidOn: pastOrToday('Payment date', today),
    reference: optionalText(200, 'Reference'),
    notes: optionalText(1000, 'Notes'),
  })
}
export type PaymentValues = z.input<ReturnType<typeof paymentSchema>>

export function directIncomeSchema(today: string = businessToday()) {
  return z.object({
    businessId: z.string().min(1, 'Select a business'),
    categoryId: z.string().min(1, 'Select an income category'),
    customerId: z.string().optional().or(z.literal('')),
    amount: amountSchema,
    method: paymentMethod,
    paidOn: pastOrToday('Date', today),
    reference: optionalText(200, 'Reference'),
    notes: optionalText(1000, 'Description'),
  })
}
export type DirectIncomeValues = z.input<ReturnType<typeof directIncomeSchema>>

export function refundSchema(maxCents: number) {
  return z.object({
    kind: z.enum(['charge_refund', 'deposit_return']),
    amount: amountSchema.refine((v) => toCents(v) <= maxCents, 'Amount is more than can be refunded'),
    method: paymentMethod,
    reason: z.string().trim().min(3, 'Enter a reason').max(500, 'Use 500 characters or fewer'),
    reduceAmountDue: z.boolean(),
  })
}
export type RefundValues = z.input<ReturnType<typeof refundSchema>>

export const adjustmentSchema = z.object({
  kind: z.enum(['discount', 'surcharge', 'write_off']),
  amount: amountSchema,
  reason: z.string().trim().min(3, 'Enter a reason').max(500, 'Use 500 characters or fewer'),
})
export type AdjustmentValues = z.input<typeof adjustmentSchema>

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Enter a reason (at least 3 characters)').max(500, 'Use 500 characters or fewer'),
})

export function cancelSchema(maxRefundCents: number, depositHeldCents: number) {
  return z
    .object({
      reason: z.string().trim().min(3, 'Enter a reason').max(500, 'Use 500 characters or fewer'),
      refundAmount: moneyOrZeroSchema.refine((v) => toCents(v) <= maxRefundCents, 'More than the amount paid'),
      refundMethod: z.enum(PAYMENT_METHOD_VALUES).optional().or(z.literal('')),
    })
    .refine((v) => (toCents(v.refundAmount) === 0 && depositHeldCents === 0) || !!v.refundMethod, {
      message: 'Select how the money is returned',
      path: ['refundMethod'],
    })
}
export type CancelValues = z.input<ReturnType<typeof cancelSchema>>

export function expenseSchema(today: string = businessToday()) {
  return z
    .object({
      mode: z.enum(['single', 'shared']),
      businessId: z.string().optional().or(z.literal('')),
      categoryId: z.string().min(1, 'Select an expense category'),
      amount: amountSchema,
      method: z.enum(['cash', 'card', 'bank_transfer'], { message: 'Select a payment method' }),
      paidOn: pastOrToday('Expense date', today),
      description: optionalText(500, 'Description'),
      receiptReference: optionalText(200, 'Receipt reference'),
      sourceKey: z.string().optional().or(z.literal('')),
      allocationMethod: z.enum(['equal', 'percentage', 'fixed']),
      allocations: z.array(z.object({ businessId: z.string(), selected: z.boolean(), percent: z.string(), amount: z.string() })),
    })
    .superRefine((v, ctx) => {
      if (v.mode === 'single') {
        if (!v.businessId && !v.sourceKey) ctx.addIssue({ code: 'custom', message: 'Select a business', path: ['businessId'] })
        return
      }
      const chosen = v.allocations.filter((a) => a.selected)
      if (chosen.length < 2) ctx.addIssue({ code: 'custom', message: 'Select at least two businesses', path: ['allocations'] })
      if (!v.description) ctx.addIssue({ code: 'custom', message: 'Describe the shared expense', path: ['description'] })
      if (v.allocationMethod === 'percentage') {
        const total = chosen.reduce((s, a) => s + (Number(a.percent) || 0), 0)
        if (Math.abs(total - 100) > 1e-9) ctx.addIssue({ code: 'custom', message: `Percentages add up to ${total}%, not 100%`, path: ['allocations'] })
      }
      if (v.allocationMethod === 'fixed') {
        const total = chosen.reduce((s, a) => s + toCents(a.amount), 0)
        if (total !== toCents(v.amount)) ctx.addIssue({ code: 'custom', message: 'Allocated amounts must equal the total', path: ['allocations'] })
      }
    })
}
export type ExpenseValues = z.input<ReturnType<typeof expenseSchema>>

// ---------------------------------------------------------------------------
// Catalogue & settings
// ---------------------------------------------------------------------------
export const equipmentSchema = z.object({
  name: requiredText(120, 'Name'),
  category: requiredText(60, 'Category'),
  brand: optionalText(60, 'Brand'),
  model: optionalText(60, 'Model'),
  serialNumber: requiredText(80, 'Serial number'),
  dailyRate: moneyOrZeroSchema,
  defaultDeposit: moneyOrZeroSchema,
  includedAccessories: optionalText(500, 'Accessories'),
  status: z.enum(['available', 'maintenance', 'retired']),
  conditionNotes: optionalText(1000, 'Condition notes'),
})
export type EquipmentValues = z.input<typeof equipmentSchema>

export const productSchema = z.object({
  sku: optionalText(40, 'SKU'),
  name: requiredText(120, 'Product name'),
  description: optionalText(1000, 'Description'),
  unitPrice: moneyOrZeroSchema,
  costPrice: z.string().trim().refine((v) => !v || amountError(v, { allowZero: true }) === null, 'Enter a valid amount').optional().or(z.literal('')),
  trackStock: z.boolean(),
  reorderLevel: z.coerce.number().int().min(0, 'Cannot be negative'),
  isActive: z.boolean(),
})
export type ProductValues = z.input<typeof productSchema>

export const stockMovementSchema = z.object({
  reason: z.enum(['purchase', 'adjustment', 'return', 'damage']),
  direction: z.enum(['in', 'out']),
  quantity: z.coerce.number({ message: 'Enter a quantity' }).int('Whole numbers only').min(1, 'At least 1').max(100000),
  unitCost: z.string().trim().refine((v) => !v || amountError(v, { allowZero: true }) === null, 'Enter a valid amount').optional().or(z.literal('')),
  note: optionalText(500, 'Note'),
})
export type StockMovementValues = z.input<typeof stockMovementSchema>

export const packageSchema = z.object({
  name: requiredText(120, 'Package name'),
  description: optionalText(1000, 'Description'),
  basePrice: moneyOrZeroSchema,
  durationHours: z.string().trim().refine((v) => !v || (Number(v) >= 0.5 && Number(v) <= 48), 'Between 0.5 and 48 hours').optional().or(z.literal('')),
  isActive: z.boolean(),
})
export type PackageValues = z.input<typeof packageSchema>

const offsetList = (max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d+(\s*,\s*\d+)*$/.test(v), 'Use whole numbers separated by commas, e.g. 7, 3, 1, 0')
    .refine((v) => v === '' || v.split(',').every((n) => Number(n) <= max), `Each value must be ${max} or less`)
    .refine((v) => v === '' || v.split(',').length <= 10, 'At most 10 reminders')

export const settingsSchema = z.object({
  studioReminderDays: offsetList(365),
  frameReminderDays: offsetList(365),
  giftReminderDays: offsetList(365),
  paymentDueReminderDays: offsetList(365),
  rentalPickupReminderHours: offsetList(365),
  rentalReturnReminderHours: offsetList(365),
  defaultAdvancePercent: z.coerce.number().min(0, 'Between 0 and 100').max(100, 'Between 0 and 100'),
  lateFeeMultiplier: z.coerce.number().min(0, 'Between 0 and 10').max(10, 'Between 0 and 10'),
  rentalGraceMinutes: z.coerce.number().int().min(0).max(1440, 'At most 1440 minutes'),
  giftRequireFullPayment: z.boolean(),
  giftStockDeduction: z.enum(['on_order', 'on_delivery']),
  receiptFooter: z.string().trim().max(300, 'Use 300 characters or fewer'),
})
export type SettingsValues = z.input<typeof settingsSchema>

export function parseOffsets(v: string): number[] {
  return v.trim() === '' ? [] : [...new Set(v.split(',').map((n) => Number(n.trim())))].sort((a, b) => b - a)
}

export const reminderSchema = z.object({
  title: requiredText(200, 'Title'),
  body: optionalText(1000, 'Details'),
  dueAt: localDateTime('Date and time'),
})
export type ReminderValues = z.input<typeof reminderSchema>

export const categorySchema = z.object({
  name: requiredText(80, 'Category name'),
  type: z.enum(['income', 'expense']),
  businessId: z.string().optional().or(z.literal('')),
})
export type CategoryValues = z.input<typeof categorySchema>

// ---------------------------------------------------------------------------
// Auth & profile
// ---------------------------------------------------------------------------
export const dateRangeSchema = z
  .object({ from: z.string().refine(isValidIsoDate, 'Invalid start date'), to: z.string().refine(isValidIsoDate, 'Invalid end date') })
  .refine((r) => r.from <= r.to, { message: 'Start date must be on or before end date', path: ['to'] })

export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
})
export type LoginValues = z.infer<typeof loginSchema>

export const forgotPasswordSchema = z.object({ email: z.email('Enter a valid email address') })
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(12, 'Use at least 12 characters')
      .max(72, 'Use 72 characters or fewer')
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), 'Include upper- and lower-case letters and a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a display name').max(80, 'Use 80 characters or fewer'),
})
export type ProfileValues = z.infer<typeof profileSchema>

export const businessProfileSchema = z.object({
  name: z.string().trim().min(1, 'Enter a business name').max(120, 'Use 120 characters or fewer'),
  category: z.string().trim().min(1, 'Enter a category').max(120, 'Use 120 characters or fewer'),
  description: z.string().trim().max(1000, 'Use 1000 characters or fewer').optional().or(z.literal('')),
})
export type BusinessProfileValues = z.infer<typeof businessProfileSchema>
