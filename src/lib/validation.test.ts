import { describe, expect, it } from 'vitest'
import {
  amountError,
  cameraRentalSchema,
  cancelSchema,
  customerSchema,
  dateRangeSchema,
  directIncomeSchema,
  expenseSchema,
  frameOrderSchema,
  giftOrderSchema,
  loginSchema,
  parseOffsets,
  paymentSchema,
  refundSchema,
  resetPasswordSchema,
  settingsSchema,
  studioBookingSchema,
  type ExpenseValues,
} from './validation'

const firstError = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, path: string) =>
  r.success ? undefined : r.error!.issues.find((i) => i.path.join('.') === path)?.message

describe('amounts', () => {
  it.each([
    ['', 'Enter an amount'],
    ['0', 'Amount must be greater than zero'],
    ['-5', 'Enter a valid amount with up to 2 decimal places'],
    ['12.345', 'Enter a valid amount with up to 2 decimal places'],
    ['1e5', 'Enter a valid amount with up to 2 decimal places'],
    ['1000000000000', 'Amount is too large'],
  ])('rejects %s', (v, msg) => expect(amountError(v)).toBe(msg))

  it('accepts valid amounts', () => {
    expect(amountError('1,250.50')).toBeNull()
    expect(amountError('999999999999.99')).toBeNull()
    expect(amountError('0', { allowZero: true })).toBeNull()
  })
})

describe('customers', () => {
  it('requires a name and validates contact details', () => {
    expect(firstError(customerSchema.safeParse({ fullName: '' }), 'fullName')).toBe('Enter customer name')
    expect(firstError(customerSchema.safeParse({ fullName: 'A', phone: 'abc' }), 'phone')).toBe('Enter a valid phone number')
    expect(firstError(customerSchema.safeParse({ fullName: 'A', email: 'nope' }), 'email')).toBe('Enter a valid email address')
    expect(customerSchema.safeParse({ fullName: 'Nimal', phone: '077 123 4567', email: 'n@x.lk' }).success).toBe(true)
  })
})

describe('studio bookings', () => {
  const valid = {
    customerId: 'c1', packageId: '', packageName: 'Wedding', packageDescription: '', shootDate: '2026-11-01', startTime: '09:00',
    endTime: '13:00', location: 'Galle', resourceId: '', packagePrice: '50000', additionalCharges: '', additionalChargesNote: '',
    requiredAdvance: '20000', notes: '',
  }
  it('accepts a valid booking', () => expect(studioBookingSchema.safeParse(valid).success).toBe(true))
  it('requires a customer, and end after start', () => {
    expect(firstError(studioBookingSchema.safeParse({ ...valid, customerId: '' }), 'customerId')).toBe('Select or add a customer')
    expect(firstError(studioBookingSchema.safeParse({ ...valid, endTime: '08:00' }), 'endTime')).toBe('End time must be after the start time')
  })
  it('keeps the advance within the total', () => {
    expect(firstError(studioBookingSchema.safeParse({ ...valid, requiredAdvance: '50000.01' }), 'requiredAdvance')).toBe('Advance cannot exceed the total price')
    expect(studioBookingSchema.safeParse({ ...valid, additionalCharges: '1000', requiredAdvance: '51000' }).success).toBe(true)
  })
})

describe('frame and gift orders', () => {
  it('needs at least one valid frame', () => {
    const base = { customerId: 'c', orderDate: '2026-10-15', expectedCompletionDate: '', specialInstructions: '' }
    expect(frameOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false)
    expect(firstError(frameOrderSchema.safeParse({ ...base, items: [{ frameType: 'Oak', frameSize: 'A4', quantity: 0, unitPrice: '10' }] }), 'items.0.quantity')).toBe('At least 1')
    expect(firstError(frameOrderSchema.safeParse({ ...base, expectedCompletionDate: '2026-10-01', items: [{ frameType: 'Oak', frameSize: 'A4', quantity: 1, unitPrice: '10' }] }), 'expectedCompletionDate')).toBe('Completion date cannot be before the order date')
  })
  it('allows walk-in gift orders', () => {
    const r = giftOrderSchema.safeParse({ customerId: '', orderDate: '2026-10-15', expectedDeliveryDate: '', deliveryCharge: '', notes: '', items: [{ productId: '', productName: 'Mug', quantity: 2, unitPrice: '1500' }] })
    expect(r.success).toBe(true)
  })
})

describe('camera rentals', () => {
  const base = { customerId: 'c', pickupAt: '2026-10-16T10:00', expectedReturnAt: '2026-10-18T10:00', depositRequired: '50000', notes: '', equipmentIds: ['e1'] }
  it('requires equipment and a return after pickup', () => {
    expect(cameraRentalSchema.safeParse(base).success).toBe(true)
    expect(firstError(cameraRentalSchema.safeParse({ ...base, equipmentIds: [] }), 'equipmentIds')).toBe('Select at least one piece of equipment')
    expect(firstError(cameraRentalSchema.safeParse({ ...base, expectedReturnAt: '2026-10-16T09:00' }), 'expectedReturnAt')).toBe('Return must be after pickup')
  })
})

describe('money forms', () => {
  it('caps payments at the outstanding balance and blocks future dates', () => {
    const s = paymentSchema(500000, '2026-10-15')
    const ok = { purpose: 'charge', method: 'cash', amount: '5000', paidOn: '2026-10-15', reference: '', notes: '' }
    expect(s.safeParse(ok).success).toBe(true)
    expect(firstError(s.safeParse({ ...ok, amount: '5000.01' }), 'amount')).toBe('Amount is more than the balance')
    expect(firstError(s.safeParse({ ...ok, paidOn: '2026-10-16' }), 'paidOn')).toBe('Date cannot be in the future')
  })

  it('direct income needs a business and category', () => {
    const r = directIncomeSchema('2026-10-15').safeParse({ businessId: '', categoryId: '', amount: '100', method: 'cash', paidOn: '2026-10-15' })
    expect(firstError(r, 'businessId')).toBe('Select a business')
    expect(firstError(r, 'categoryId')).toBe('Select an income category')
  })

  it('refunds are capped and need a reason', () => {
    const s = refundSchema(10000)
    expect(firstError(s.safeParse({ kind: 'charge_refund', amount: '100.01', method: 'cash', reason: 'x', reduceAmountDue: true }), 'amount')).toBe('Amount is more than can be refunded')
    expect(firstError(s.safeParse({ kind: 'charge_refund', amount: '50', method: 'cash', reason: 'x', reduceAmountDue: true }), 'reason')).toBe('Enter a reason')
  })

  it('cancellation needs a refund method when money goes back', () => {
    const s = cancelSchema(2000000, 0)
    expect(s.safeParse({ reason: 'Customer cancelled', refundAmount: '', refundMethod: '' }).success).toBe(true)
    expect(firstError(s.safeParse({ reason: 'Customer cancelled', refundAmount: '1000', refundMethod: '' }), 'refundMethod')).toBe('Select how the money is returned')
    expect(firstError(cancelSchema(0, 500000).safeParse({ reason: 'Customer cancelled', refundAmount: '', refundMethod: '' }), 'refundMethod')).toBe('Select how the money is returned')
  })
})

describe('expenses', () => {
  const base: ExpenseValues = {
    mode: 'single', businessId: 'b1', categoryId: 'c1', amount: '1000', method: 'cash', paidOn: '2026-10-15', description: '', receiptReference: '',
    sourceKey: '', allocationMethod: 'equal', allocations: [
      { businessId: 'b1', selected: true, percent: '60', amount: '600' },
      { businessId: 'b2', selected: true, percent: '40', amount: '400' },
      { businessId: 'b3', selected: false, percent: '0', amount: '' },
    ],
  }
  const s = expenseSchema('2026-10-15')
  it('single expenses need a business', () => {
    expect(s.safeParse(base).success).toBe(true)
    expect(firstError(s.safeParse({ ...base, businessId: '' }), 'businessId')).toBe('Select a business')
  })
  it('shared expenses need two businesses, a description and a valid split', () => {
    const shared = { ...base, mode: 'shared' as const, description: 'Electricity' }
    expect(s.safeParse(shared).success).toBe(true)
    expect(firstError(s.safeParse({ ...shared, description: '' }), 'description')).toBe('Describe the shared expense')
    expect(firstError(s.safeParse({ ...shared, allocationMethod: 'percentage', allocations: [{ ...base.allocations[0]!, percent: '50' }, base.allocations[1]!] }), 'allocations')).toMatch(/90%/)
    expect(s.safeParse({ ...shared, allocationMethod: 'fixed' }).success).toBe(true)
    expect(firstError(s.safeParse({ ...shared, allocationMethod: 'fixed', amount: '999' }), 'allocations')).toBe('Allocated amounts must equal the total')
    expect(firstError(s.safeParse({ ...shared, allocations: [base.allocations[0]!] }), 'allocations')).toBe('Select at least two businesses')
  })
})

describe('settings', () => {
  it('parses reminder offsets', () => {
    expect(parseOffsets('7, 3,1, 0, 3')).toEqual([7, 3, 1, 0])
    expect(parseOffsets('')).toEqual([])
  })
  it('validates offsets and rule ranges', () => {
    const ok = { studioReminderDays: '7,3,1,0', frameReminderDays: '1', giftReminderDays: '', paymentDueReminderDays: '1,0', rentalPickupReminderHours: '24', rentalReturnReminderHours: '24,3', defaultAdvancePercent: 25, lateFeeMultiplier: 1, rentalGraceMinutes: 60, giftRequireFullPayment: true, giftStockDeduction: 'on_order', receiptFooter: '' }
    expect(settingsSchema.safeParse(ok).success).toBe(true)
    expect(settingsSchema.safeParse({ ...ok, studioReminderDays: '7; 3' }).success).toBe(false)
    expect(settingsSchema.safeParse({ ...ok, defaultAdvancePercent: 120 }).success).toBe(false)
  })
})

describe('auth and ranges', () => {
  it('validates date ranges, login and reset passwords', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false)
    expect(loginSchema.safeParse({ email: 'admin@example.com', password: 'x' }).success).toBe(true)
    expect(resetPasswordSchema.safeParse({ password: 'GoodPassword123', confirm: 'GoodPassword123' }).success).toBe(true)
    expect(resetPasswordSchema.safeParse({ password: 'short', confirm: 'short' }).success).toBe(false)
  })
})
