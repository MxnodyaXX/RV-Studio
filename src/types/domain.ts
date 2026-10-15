import type { Enums, Tables, Views } from './database'

export type { TransactionType, PaymentMethod } from './database'

export type SourceType = Enums<'source_type'>
export type MoneyMethod = Enums<'money_method'>
export type StudioBookingStatus = Enums<'studio_booking_status'>
export type FrameOrderStatus = Enums<'frame_order_status'>
export type CameraRentalStatus = Enums<'camera_rental_status'>
export type GiftOrderStatus = Enums<'gift_order_status'>
export type EquipmentStatus = Enums<'equipment_status'>

export type Business = Tables<'businesses'>
export type TransactionCategory = Tables<'transaction_categories'>
export type AdminProfile = Tables<'admin_profiles'>
export type Customer = Tables<'customers'>
export type SystemSettings = Tables<'system_settings'>
export type StudioPackage = Tables<'studio_packages'>
export type StudioResource = Tables<'studio_resources'>
export type StudioBooking = Tables<'studio_bookings'>
export type FrameOrder = Tables<'frame_orders'>
export type FrameOrderItem = Tables<'frame_order_items'>
export type CameraEquipment = Tables<'camera_equipment'>
export type CameraRental = Tables<'camera_rentals'>
export type CameraRentalItem = Tables<'camera_rental_items'>
export type CameraConditionCheck = Tables<'camera_condition_checks'>
export type IdHandoverRecord = Tables<'camera_rental_id_handover_records'>
export type GiftProduct = Tables<'gift_products'>
export type GiftOrder = Tables<'gift_orders'>
export type GiftOrderItem = Tables<'gift_order_items'>
export type InventoryMovement = Tables<'inventory_movements'>
export type Payment = Tables<'payments'>
export type Refund = Tables<'refunds'>
export type Adjustment = Tables<'financial_adjustments'>
export type Expense = Tables<'expenses'>
export type SharedExpense = Tables<'shared_expenses'>
export type Reminder = Tables<'reminders'>
export type AppNotification = Tables<'notifications'>

/** A booking/order/rental with its live balance (receivables view). */
export type Receivable = Views<'receivables'>
export type LedgerEntry = Views<'ledger_entries'>

export type BusinessSummaryRow = {
  business_id: string
  earned_revenue: number
  job_revenue: number
  direct_sales: number
  collected_total: number
  collected_cash: number
  collected_card: number
  collected_bank: number
  collected_other: number
  deposit_applied: number
  refunds_total: number
  advance_payments: number
  expenses_total: number
  net_profit: number
  deposits_received: number
  deposits_returned: number
  deposits_held: number
  outstanding: number
  overdue: number
  documents_count: number
  completed_count: number
}

export type TrendRow = { business_id: string; period: string; earned_revenue: number; collected: number; expenses: number }

export type PaymentMethodRow = {
  business_id: string
  method: MoneyMethod
  charge_payments: number
  deposits_received: number
  refunds_paid: number
  deposits_returned: number
  expenses_paid: number
}

export type CalendarEvent = {
  event_key: string
  event_type: string
  business_id: string | null
  source_type: SourceType | null
  source_id: string | null
  ref: string | null
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  status: string
  link: string
}

export type DashboardOperations = {
  studio: { total_bookings: number; confirmed_shoots: number; pending_advance: number; upcoming_shoots: number }
  frame: { total_orders: number; processing: number; ready: number; pending_deliveries: number }
  camera: { active_rentals: number; available_equipment: number; total_equipment: number; upcoming_returns: number; overdue_rentals: number }
  gift: { total_orders: number; pending_orders: number; completed_orders: number; low_stock: number }
}

export type Granularity = 'day' | 'month'

export type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'year' | 'all' | 'custom'

/** Inclusive date range in business-local (Asia/Colombo) calendar dates. Null = unbounded. */
export type DateRange = { from: string | null; to: string | null }
