// Status labels, colours and workflow steps for each document type.
// The database enforces the actual transitions; this file only describes them for the UI.
import type { SourceType } from '@/types/domain'

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'accent'

export type StatusInfo = { label: string; tone: Tone }

export const STATUS: Record<SourceType, Record<string, StatusInfo>> = {
  studio_booking: {
    pending_advance: { label: 'Pending Advance', tone: 'warning' },
    confirmed: { label: 'Confirmed', tone: 'info' },
    in_progress: { label: 'In Progress', tone: 'accent' },
    shoot_completed: { label: 'Shoot Completed', tone: 'success' },
    closed: { label: 'Closed', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
  },
  frame_order: {
    new: { label: 'New Order', tone: 'warning' },
    processing: { label: 'Processing', tone: 'accent' },
    ready: { label: 'Ready for Collection', tone: 'info' },
    delivered: { label: 'Delivered', tone: 'success' },
    closed: { label: 'Closed', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
  },
  camera_rental: {
    booked: { label: 'Booked', tone: 'warning' },
    ready_for_pickup: { label: 'Ready for Pickup', tone: 'info' },
    rented_out: { label: 'Rented Out', tone: 'accent' },
    returned: { label: 'Returned', tone: 'success' },
    closed: { label: 'Closed', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
  },
  gift_order: {
    new: { label: 'New Order', tone: 'warning' },
    processing: { label: 'Processing', tone: 'accent' },
    ready: { label: 'Ready', tone: 'info' },
    delivered: { label: 'Delivered', tone: 'success' },
    completed: { label: 'Completed', tone: 'neutral' },
    cancelled: { label: 'Cancelled', tone: 'danger' },
  },
}

/** Main path through each workflow (for the progress stepper). */
export const WORKFLOW: Record<SourceType, string[]> = {
  studio_booking: ['pending_advance', 'confirmed', 'in_progress', 'shoot_completed', 'closed'],
  frame_order: ['new', 'processing', 'ready', 'delivered', 'closed'],
  camera_rental: ['booked', 'ready_for_pickup', 'rented_out', 'returned', 'closed'],
  gift_order: ['new', 'processing', 'ready', 'delivered', 'completed'],
}

export const PAYMENT_STATUS: Record<string, StatusInfo> = {
  unpaid: { label: 'Unpaid', tone: 'danger' },
  partially_paid: { label: 'Payment Pending', tone: 'warning' },
  paid: { label: 'Fully Paid', tone: 'success' },
  overpaid: { label: 'Overpaid', tone: 'accent' },
  no_charge: { label: 'No Charge', tone: 'neutral' },
}

export function statusInfo(type: SourceType, status: string | null | undefined): StatusInfo {
  return (status && STATUS[type][status]) || { label: status ?? '—', tone: 'neutral' }
}

/** Statuses at which a document can still be cancelled (mirrors cancel_document). */
export function canCancel(type: SourceType, status: string): boolean {
  const open: Record<SourceType, string[]> = {
    studio_booking: ['pending_advance', 'confirmed', 'in_progress'],
    frame_order: ['new', 'processing', 'ready'],
    camera_rental: ['booked', 'ready_for_pickup'],
    gift_order: ['new', 'processing', 'ready'],
  }
  return open[type].includes(status)
}

export function isOpen(type: SourceType, status: string): boolean {
  return !['closed', 'cancelled', ...(type === 'gift_order' ? ['completed'] : [])].includes(status)
}
