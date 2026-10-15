// Studio of RV, The Frame House, RV Camera Rent and Gift Park.
import { supabase } from '@/integrations/supabase/client'
import { normalizeAmountInput } from '@/lib/money'
import { fromColomboInput } from '@/lib/dates'
import { callRpc, nullIfBlank, unwrap } from './api'
import type {
  CameraRentalValues,
  EquipmentValues,
  FrameOrderValues,
  GiftOrderValues,
  PackageValues,
  PickupValues,
  ProductValues,
  ReturnValues,
  StockMovementValues,
  StudioBookingValues,
} from '@/lib/validation'
import type {
  CameraConditionCheck,
  CameraEquipment,
  CameraRental,
  CameraRentalItem,
  Customer,
  FrameOrder,
  FrameOrderItem,
  GiftOrder,
  GiftOrderItem,
  GiftProduct,
  IdHandoverRecord,
  InventoryMovement,
  StudioBooking,
  StudioPackage,
  StudioResource,
} from '@/types/domain'

const money = (v: string | number | undefined) => normalizeAmountInput(String(v ?? '0') || '0')

// ---------------------------------------------------------------------------
// Studio of RV
// ---------------------------------------------------------------------------
export type StudioBookingDetail = StudioBooking & { customer: Customer | null; resource: StudioResource | null }

export async function getStudioBooking(id: string): Promise<StudioBookingDetail | null> {
  return unwrap(
    await supabase.from('studio_bookings').select('*, customer:customers(*), resource:studio_resources(*)').eq('id', id).maybeSingle(),
  ) as StudioBookingDetail | null
}

export async function saveStudioBooking(v: StudioBookingValues, opts: { id?: string; requestId: string }): Promise<string> {
  return callRpc('save_studio_booking', {
    p: {
      id: opts.id ?? null,
      client_request_id: opts.requestId,
      customer_id: v.customerId,
      package_id: nullIfBlank(v.packageId),
      package_name: v.packageName,
      package_description: nullIfBlank(v.packageDescription),
      shoot_date: v.shootDate,
      start_time: v.startTime,
      end_time: v.endTime,
      location: v.location,
      resource_id: nullIfBlank(v.resourceId),
      package_price: money(v.packagePrice),
      additional_charges: money(v.additionalCharges),
      additional_charges_note: nullIfBlank(v.additionalChargesNote),
      required_advance: money(v.requiredAdvance),
      notes: nullIfBlank(v.notes),
    },
  }) as Promise<string>
}

export async function listPackages(): Promise<StudioPackage[]> {
  return unwrap(await supabase.from('studio_packages').select('*').order('sort_order').order('name')) ?? []
}

export async function savePackage(v: PackageValues, id?: string) {
  const row = {
    name: v.name.trim(),
    description: nullIfBlank(v.description),
    base_price: Number(money(v.basePrice)),
    duration_hours: v.durationHours ? Number(v.durationHours) : null,
    is_active: v.isActive,
  }
  return unwrap(await (id ? supabase.from('studio_packages').update(row).eq('id', id) : supabase.from('studio_packages').insert(row)).select('*').single())
}

export async function listResources(): Promise<StudioResource[]> {
  return unwrap(await supabase.from('studio_resources').select('*').order('name')) ?? []
}

export async function saveResource(name: string, kind: string, isActive: boolean, id?: string) {
  const row = { name: name.trim(), kind, is_active: isActive }
  return unwrap(await (id ? supabase.from('studio_resources').update(row).eq('id', id) : supabase.from('studio_resources').insert(row)).select('*').single())
}

// ---------------------------------------------------------------------------
// The Frame House
// ---------------------------------------------------------------------------
export type FrameOrderDetail = FrameOrder & { customer: Customer | null; items: FrameOrderItem[] }

export async function getFrameOrder(id: string): Promise<FrameOrderDetail | null> {
  const order = unwrap(
    await supabase.from('frame_orders').select('*, customer:customers(*), items:frame_order_items(*)').eq('id', id).maybeSingle(),
  ) as FrameOrderDetail | null
  order?.items.sort((a, b) => a.sort_order - b.sort_order)
  return order
}

export async function saveFrameOrder(v: FrameOrderValues, opts: { id?: string; requestId: string }): Promise<string> {
  return callRpc('save_frame_order', {
    p: {
      id: opts.id ?? null,
      client_request_id: opts.requestId,
      customer_id: v.customerId,
      order_date: v.orderDate,
      expected_completion_date: nullIfBlank(v.expectedCompletionDate),
      special_instructions: nullIfBlank(v.specialInstructions),
      items: v.items.map((i) => ({
        frame_type: i.frameType,
        frame_size: i.frameSize,
        description: nullIfBlank(i.description),
        quantity: Number(i.quantity),
        unit_price: money(i.unitPrice),
      })),
    },
  }) as Promise<string>
}

// ---------------------------------------------------------------------------
// RV Camera Rent
// ---------------------------------------------------------------------------
export type CameraRentalDetail = CameraRental & {
  customer: Customer | null
  items: (CameraRentalItem & { equipment: CameraEquipment | null })[]
  handover: IdHandoverRecord | null
  checks: CameraConditionCheck[]
}

export async function getCameraRental(id: string): Promise<CameraRentalDetail | null> {
  const [rental, handover, checks] = await Promise.all([
    supabase.from('camera_rentals').select('*, customer:customers(*), items:camera_rental_items(*, equipment:camera_equipment(*))').eq('id', id).maybeSingle(),
    supabase.from('camera_rental_id_handover_records').select('*').eq('rental_id', id).maybeSingle(),
    supabase.from('camera_condition_checks').select('*').eq('rental_id', id).order('checked_at'),
  ])
  const r = unwrap(rental) as Omit<CameraRentalDetail, 'handover' | 'checks'> | null
  if (!r) return null
  return { ...r, handover: unwrap(handover), checks: unwrap(checks) ?? [] }
}

export async function saveCameraRental(v: CameraRentalValues, opts: { id?: string; requestId: string }): Promise<string> {
  return callRpc('save_camera_rental', {
    p: {
      id: opts.id ?? null,
      client_request_id: opts.requestId,
      customer_id: v.customerId,
      pickup_at: fromColomboInput(v.pickupAt),
      expected_return_at: fromColomboInput(v.expectedReturnAt),
      deposit_required: money(v.depositRequired),
      notes: nullIfBlank(v.notes),
      items: v.equipmentIds.map((equipment_id) => ({ equipment_id })),
    },
  }) as Promise<string>
}

export type Availability = { equipment_id: string; is_available: boolean; conflict_ref: string | null; conflict_until: string | null }

export async function checkAvailability(pickupLocal: string, returnLocal: string, excludeRentalId?: string): Promise<Availability[]> {
  const from = fromColomboInput(pickupLocal)
  const to = fromColomboInput(returnLocal)
  if (!from || !to || to <= from) return []
  return (await callRpc('check_equipment_availability', { p_from: from, p_to: to, p_exclude_rental: excludeRentalId ?? null })) as Availability[]
}

export async function cameraPickup(id: string, v: PickupValues) {
  await callRpc('camera_pickup', {
    p_id: id,
    p: {
      verified: v.verified,
      id_type: v.idType,
      id_last4: nullIfBlank(v.idLast4),
      verification_notes: nullIfBlank(v.verificationNotes),
      original_held: v.originalHeld,
      items: v.items.map((i) => ({ equipment_id: i.equipmentId, condition: i.condition, accessories: nullIfBlank(i.accessories), notes: nullIfBlank(i.notes) })),
    },
  })
}

export async function cameraReturn(id: string, v: ReturnValues): Promise<{ late_days: number; late_fee: number }> {
  return (await callRpc('camera_return', {
    p_id: id,
    p: {
      returned_at: fromColomboInput(v.returnedAt),
      late_fee: v.lateFee ? money(v.lateFee) : null,
      damage_charge: money(v.damageCharge),
      other_charges: money(v.otherCharges),
      return_notes: nullIfBlank(v.returnNotes),
      items: v.items.map((i) => ({ equipment_id: i.equipmentId, condition: i.condition, accessories: nullIfBlank(i.accessories), notes: nullIfBlank(i.notes) })),
    },
  })) as { late_days: number; late_fee: number }
}

export async function cameraReturnId(id: string, note: string) {
  await callRpc('camera_return_id', { p_id: id, p_note: nullIfBlank(note) })
}

export async function listEquipment(): Promise<CameraEquipment[]> {
  return unwrap(await supabase.from('camera_equipment').select('*').order('category').order('name')) ?? []
}

export async function saveEquipment(v: EquipmentValues, id?: string) {
  const row = {
    name: v.name.trim(),
    category: v.category.trim(),
    brand: nullIfBlank(v.brand),
    model: nullIfBlank(v.model),
    serial_number: v.serialNumber.trim(),
    daily_rate: Number(money(v.dailyRate)),
    default_deposit: Number(money(v.defaultDeposit)),
    included_accessories: nullIfBlank(v.includedAccessories),
    status: v.status,
    condition_notes: nullIfBlank(v.conditionNotes),
  }
  return unwrap(await (id ? supabase.from('camera_equipment').update(row).eq('id', id) : supabase.from('camera_equipment').insert(row)).select('*').single())
}

// ---------------------------------------------------------------------------
// Gift Park
// ---------------------------------------------------------------------------
export type GiftOrderDetail = GiftOrder & { customer: Customer | null; items: GiftOrderItem[] }

export async function getGiftOrder(id: string): Promise<GiftOrderDetail | null> {
  const order = unwrap(
    await supabase.from('gift_orders').select('*, customer:customers(*), items:gift_order_items(*)').eq('id', id).maybeSingle(),
  ) as GiftOrderDetail | null
  order?.items.sort((a, b) => a.sort_order - b.sort_order)
  return order
}

export async function saveGiftOrder(v: GiftOrderValues, opts: { id?: string; requestId: string }): Promise<string> {
  return callRpc('save_gift_order', {
    p: {
      id: opts.id ?? null,
      client_request_id: opts.requestId,
      customer_id: nullIfBlank(v.customerId),
      order_date: v.orderDate,
      expected_delivery_date: nullIfBlank(v.expectedDeliveryDate),
      delivery_charge: money(v.deliveryCharge),
      notes: nullIfBlank(v.notes),
      items: v.items.map((i) => ({
        product_id: nullIfBlank(i.productId),
        product_name: i.productName,
        quantity: Number(i.quantity),
        unit_price: money(i.unitPrice),
      })),
    },
  }) as Promise<string>
}

export async function listProducts(): Promise<GiftProduct[]> {
  return unwrap(await supabase.from('gift_products').select('*').order('name')) ?? []
}

export async function saveProduct(v: ProductValues, id?: string) {
  const row = {
    sku: nullIfBlank(v.sku),
    name: v.name.trim(),
    description: nullIfBlank(v.description),
    unit_price: Number(money(v.unitPrice)),
    cost_price: v.costPrice ? Number(money(v.costPrice)) : null,
    track_stock: v.trackStock,
    reorder_level: Number(v.reorderLevel),
    is_active: v.isActive,
  }
  return unwrap(await (id ? supabase.from('gift_products').update(row).eq('id', id) : supabase.from('gift_products').insert(row)).select('*').single())
}

export async function recordStockMovement(productId: string, v: StockMovementValues) {
  const qty = Number(v.quantity) * (v.direction === 'out' ? -1 : 1)
  unwrap(
    await supabase.from('inventory_movements').insert({
      product_id: productId,
      quantity: qty,
      reason: v.reason,
      unit_cost: v.unitCost ? Number(money(v.unitCost)) : null,
      note: nullIfBlank(v.note),
    }),
  )
}

export async function listMovements(productId: string | null, limit = 50): Promise<(InventoryMovement & { product: { name: string } | null })[]> {
  let q = supabase.from('inventory_movements').select('*, product:gift_products(name)')
  if (productId) q = q.eq('product_id', productId)
  return (unwrap(await q.order('moved_at', { ascending: false }).limit(limit)) ?? []) as never
}
