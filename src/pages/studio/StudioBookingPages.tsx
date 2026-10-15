import { useParams } from 'react-router-dom'
import { Camera, CheckCircle2, CircleDollarSign, Flag, Lock, Play } from 'lucide-react'
import { DocumentList } from '@/components/documents/DocumentList'
import { DocumentDetailFrame, StatusAction } from '@/components/documents/DocumentDetail'
import { DetailList, SectionCard } from '@/components/shared'
import { useReceivable, useStudioBooking } from '@/hooks/queries'
import { formatClock, formatDisplayDate, formatTime } from '@/lib/dates'
import { formatLKR, toCents } from '@/lib/money'

export function StudioBookingsPage() {
  return (
    <DocumentList
      type="studio_booking"
      title="Studio Bookings"
      description="Studio of RV — photography shoots from booking to final payment."
      icon={Camera}
      dateLabel="Shoot"
      newLabel="New booking"
      renderWhen={(r) => (
        <span>
          {formatDisplayDate(r.event_date)}
          {r.event_at && <span className="text-muted-foreground"> · {formatTime(r.event_at)}</span>}
        </span>
      )}
    />
  )
}

export function StudioBookingDetailPage() {
  const { id } = useParams()
  const booking = useStudioBooking(id)
  const doc = useReceivable(id)
  const b = booking.data
  const r = doc.data
  const outstanding = toCents(r?.outstanding)
  const netPaid = toCents(r?.net_paid)
  const advance = toCents(b?.required_advance)

  const actions = b && r && (
    <>
      {b.status === 'pending_advance' && (
        <p className="flex items-center gap-2 text-sm text-warning-text">
          <CircleDollarSign className="size-4" />
          Waiting for the advance: {formatLKR(Math.max(advance - netPaid, 0))} more needed. Use <strong>Record payment</strong> — the booking confirms automatically.
        </p>
      )}
      {b.status === 'confirmed' && (
        <>
          <StatusAction type="studio_booking" id={b.id} to="in_progress" icon={<Play />}>Start shoot</StatusAction>
          <StatusAction type="studio_booking" id={b.id} to="shoot_completed" variant="outline" icon={<Flag />}>Mark shoot completed</StatusAction>
        </>
      )}
      {b.status === 'in_progress' && <StatusAction type="studio_booking" id={b.id} to="shoot_completed" variant="income" icon={<CheckCircle2 />}>Shoot completed</StatusAction>}
      {b.status === 'shoot_completed' &&
        (outstanding > 0 ? (
          <p className="text-sm text-warning-text">Payment pending: collect the balance of {formatLKR(outstanding)} to close the booking.</p>
        ) : (
          <StatusAction type="studio_booking" id={b.id} to="closed" icon={<Lock />}>Close booking</StatusAction>
        ))}
    </>
  )

  return (
    <DocumentDetailFrame
      type="studio_booking"
      doc={r}
      loading={booking.isLoading || doc.isLoading}
      error={booking.error ?? doc.error}
      onRetry={() => void Promise.all([booking.refetch(), doc.refetch()])}
      customer={b?.customer ?? null}
      subtitle={b ? `${b.package_name} · ${formatDisplayDate(b.shoot_date)} ${formatClock(b.start_time)}–${formatClock(b.end_time)} · ${b.location}` : ''}
      editable={!!b && ['pending_advance', 'confirmed'].includes(b.status)}
      actions={actions}
      details={
        b && (
          <SectionCard title="Booking details">
            <DetailList
              items={[
                { label: 'Package', value: b.package_name },
                { label: 'Shoot date', value: `${formatDisplayDate(b.shoot_date)}, ${formatClock(b.start_time)} – ${formatClock(b.end_time)}` },
                { label: 'Location', value: b.location },
                { label: 'Photographer / resource', value: b.resource?.name ?? 'Not assigned' },
                { label: 'Package price', value: formatLKR(toCents(b.package_price)) },
                { label: 'Additional charges', value: `${formatLKR(toCents(b.additional_charges))}${b.additional_charges_note ? ` (${b.additional_charges_note})` : ''}` },
                { label: 'Required advance', value: formatLKR(advance) },
                { label: 'Completed on', value: formatDisplayDate(b.completed_on), hidden: !b.completed_on },
                { label: 'Package description', value: b.package_description, hidden: !b.package_description },
                { label: 'Notes', value: b.notes, hidden: !b.notes },
                { label: 'Cancellation reason', value: b.cancel_reason, hidden: !b.cancel_reason },
              ]}
            />
          </SectionCard>
        )
      }
    />
  )
}
