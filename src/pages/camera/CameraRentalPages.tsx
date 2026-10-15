import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Camera, CheckCircle2, CircleDot, Handshake, IdCard, Loader2, Lock, PackageOpen, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { DocumentList } from '@/components/documents/DocumentList'
import { DocumentDetailFrame, StatusAction } from '@/components/documents/DocumentDetail'
import { RefundDialog } from '@/components/documents/MoneyDialogs'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { DetailList, MoneyInput, SectionCard, ToneBadge } from '@/components/shared'
import { useCameraRental, useReceivable, useSettings } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { cameraPickup, cameraReturn, cameraReturnId, type CameraRentalDetail } from '@/services/operations'
import { formatDateTime, fromColomboInput, toColomboInput } from '@/lib/dates'
import { lateFee } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { pickupSchema, returnSchema, type PickupValues, type ReturnValues } from '@/lib/validation'

const CONDITIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'damaged', label: 'Damaged' },
] as const

const ID_TYPES = [
  { value: 'nic', label: 'National Identity Card (NIC)' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_licence', label: 'Driving licence' },
  { value: 'other', label: 'Other' },
] as const

export function CameraRentalsPage() {
  return (
    <DocumentList
      type="camera_rental"
      title="Camera Rentals"
      description="RV Camera Rent — bookings, pickups, returns and deposits."
      icon={Camera}
      dateLabel="Pickup → Return"
      newLabel="New rental"
      renderWhen={(r) => (
        <span>
          {r.event_at ? formatDateTime(r.event_at) : '—'}
          <span className="text-muted-foreground"> → {r.end_at ? formatDateTime(r.end_at) : '—'}</span>
        </span>
      )}
    />
  )
}

function Dlg({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && children}
      </DialogContent>
    </Dialog>
  )
}

function PickupDialog({ rental, onOpenChange }: { rental: CameraRentalDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<PickupValues>({
    resolver: zodResolver(pickupSchema),
    defaultValues: {
      verified: false as unknown as true,
      idType: 'nic',
      idLast4: '',
      verificationNotes: '',
      originalHeld: false,
      items: rental.items.map((i) => ({ equipmentId: i.equipment_id, condition: 'good', accessories: i.accessories_out ?? i.equipment?.included_accessories ?? '', notes: '' })),
    },
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const held = useWatch({ control: form.control, name: 'originalHeld' })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await cameraPickup(rental.id, v)
      await invalidate()
      toast.success('Equipment handed over — rental is now active')
      onOpenChange(false)
    } catch (e) {
      toast.error('Handover not recorded', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset className="space-y-4 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">1 · Verify identity</legend>
        <p className="text-xs text-muted-foreground">
          Check the customer’s ID in person. Only the ID type and its last 4 characters are stored — never the full number or a photo.
        </p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id="idType" label="ID type">
            <Select id="idType" {...form.register('idType')}>
              {ID_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="idLast4" label="Last 4 characters" error={err.idLast4?.message} hint="Optional, e.g. 123V">
            <Input {...fieldAria('idLast4', err.idLast4?.message)} maxLength={4} autoComplete="off" {...form.register('idLast4')} />
          </Field>
        </div>
        <Field id="verificationNotes" label="Verification notes" error={err.verificationNotes?.message}>
          <Input {...fieldAria('verificationNotes', err.verificationNotes?.message)} {...form.register('verificationNotes')} />
        </Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...form.register('originalHeld')} />
          <span>
            <span className="font-medium">Original ID document kept by the shop until return</span>
            <span className="block text-xs text-muted-foreground">Only if this is part of your rental procedure. You’ll need to confirm it is returned before closing.</span>
          </span>
        </label>
        {held && (
          <p className="flex items-center gap-2 rounded-lg bg-warning-soft p-2.5 text-xs text-warning-text">
            <AlertTriangle className="size-4 shrink-0" /> Store the document securely and return it when the equipment comes back.
          </p>
        )}
        <label className="flex items-start gap-3 rounded-lg border border-border bg-subtle p-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...form.register('verified')} />
          <span className="font-medium">I have verified the customer’s identity</span>
        </label>
        {err.verified?.message && <p role="alert" className="text-xs font-medium text-destructive">{err.verified.message}</p>}
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">2 · Condition & accessories at handover</legend>
        {items.fields.map((f, i) => {
          const eq = rental.items.find((x) => x.equipment_id === f.equipmentId)?.equipment
          return (
            <div key={f.id} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg bg-subtle p-3 sm:grid-cols-[1fr_140px]">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium">{eq?.name}</p>
                <p className="text-xs text-muted-foreground">Serial {eq?.serial_number}</p>
              </div>
              <Field id={`acc-${i}`} label="Accessories included">
                <Input id={`acc-${i}`} {...form.register(`items.${i}.accessories`)} placeholder="Battery ×2, charger, strap…" />
              </Field>
              <Field id={`cond-${i}`} label="Condition">
                <Select id={`cond-${i}`} {...form.register(`items.${i}.condition`)}>
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`note-${i}`} label="Condition notes" className="sm:col-span-2">
                <Input id={`note-${i}`} {...form.register(`items.${i}.notes`)} placeholder="Existing scratches, etc." />
              </Field>
            </div>
          )
        })}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
          Confirm handover
        </Button>
      </div>
    </form>
  )
}

function ReturnDialog({ rental, onOpenChange }: { rental: CameraRentalDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateAll()
  const settings = useSettings()
  const form = useForm<ReturnValues>({
    resolver: zodResolver(returnSchema),
    defaultValues: {
      returnedAt: toColomboInput(new Date().toISOString()),
      lateFee: '',
      damageCharge: '',
      otherCharges: Number(rental.other_charges) ? Number(rental.other_charges).toFixed(2) : '',
      returnNotes: '',
      items: rental.items.map((i) => ({ equipmentId: i.equipment_id, condition: 'good', accessories: i.accessories_out ?? '', notes: '' })),
    },
  })
  const items = useFieldArray({ control: form.control, name: 'items' })
  const returnedAt = useWatch({ control: form.control, name: 'returnedAt' })
  const rates = rental.items.reduce((s, i) => s + toCents(i.daily_rate), 0)
  const preview = useMemo(
    () => lateFee(rates, rental.expected_return_at, fromColomboInput(returnedAt) || new Date().toISOString(), settings.data?.rental_grace_minutes ?? 60, Number(settings.data?.late_fee_multiplier ?? 1)),
    [rates, rental.expected_return_at, returnedAt, settings.data],
  )
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      const res = await cameraReturn(rental.id, v)
      await invalidate()
      toast.success('Return recorded', { description: res.late_days ? `${res.late_days} late day(s) · late fee ${formatLKR(toCents(res.late_fee))}` : 'Returned on time' })
      onOpenChange(false)
    } catch (e) {
      toast.error('Return not recorded', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <Field id="returnedAt" label="Returned at" required error={err.returnedAt?.message} hint={`Expected ${formatDateTime(rental.expected_return_at)}`}>
        <Input {...fieldAria('returnedAt', err.returnedAt?.message)} type="datetime-local" {...form.register('returnedAt')} />
      </Field>

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-semibold">Inspection</legend>
        {items.fields.map((f, i) => {
          const it = rental.items.find((x) => x.equipment_id === f.equipmentId)
          return (
            <div key={f.id} className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg bg-subtle p-3 sm:grid-cols-[1fr_140px]">
              <div className="sm:col-span-2">
                <p className="text-sm font-medium">{it?.equipment?.name}</p>
                <p className="text-xs text-muted-foreground">Sent out with: {it?.accessories_out || '—'}</p>
              </div>
              <Field id={`racc-${i}`} label="Accessories returned">
                <Input id={`racc-${i}`} {...form.register(`items.${i}.accessories`)} />
              </Field>
              <Field id={`rcond-${i}`} label="Condition">
                <Select id={`rcond-${i}`} {...form.register(`items.${i}.condition`)}>
                  {CONDITIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`rnote-${i}`} label="Inspection notes" className="sm:col-span-2">
                <Input id={`rnote-${i}`} {...form.register(`items.${i}.notes`)} />
              </Field>
            </div>
          )
        })}
      </fieldset>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <Field id="lateFee" label="Late fee" error={err.lateFee?.message} hint={preview.lateDays ? `${preview.lateDays} late day(s): ${formatLKR(preview.feeCents)} (leave blank to use)` : 'On time — leave blank'}>
          <MoneyInput {...fieldAria('lateFee', err.lateFee?.message)} placeholder={(preview.feeCents / 100).toFixed(2)} {...form.register('lateFee')} />
        </Field>
        <Field id="damageCharge" label="Damage charge" error={err.damageCharge?.message}>
          <MoneyInput {...fieldAria('damageCharge', err.damageCharge?.message)} {...form.register('damageCharge')} />
        </Field>
        <Field id="otherCharges" label="Other charges" error={err.otherCharges?.message}>
          <MoneyInput {...fieldAria('otherCharges', err.otherCharges?.message)} {...form.register('otherCharges')} />
        </Field>
      </div>
      <Field id="returnNotes" label="Return notes" error={err.returnNotes?.message}>
        <Textarea {...fieldAria('returnNotes', err.returnNotes?.message)} rows={2} {...form.register('returnNotes')} />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" variant="income" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
          Record return
        </Button>
      </div>
    </form>
  )
}

function Obligation({ done, label, detail }: { done: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3">
      {done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-income" /> : <CircleDot className="mt-0.5 size-5 shrink-0 text-warning" />}
      <div>
        <p className={cn('text-sm font-medium', !done && 'text-warning-text')}>{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </li>
  )
}

export function CameraRentalDetailPage() {
  const { id } = useParams()
  const rental = useCameraRental(id)
  const doc = useReceivable(id)
  const invalidate = useInvalidateAll()
  const [dialog, setDialog] = useState<null | 'pickup' | 'return' | 'deposit'>(null)
  const [returningId, setReturningId] = useState(false)
  const r = rental.data
  const d = doc.data
  const outstanding = toCents(d?.outstanding)
  const depositHeld = toCents(d?.deposit_held)
  const overdue = r?.status === 'rented_out' && new Date(r.expected_return_at) < new Date()

  const returnId = async () => {
    if (!r) return
    setReturningId(true)
    try {
      await cameraReturnId(r.id, 'ID returned to customer')
      await invalidate()
      toast.success('ID return recorded')
    } catch (e) {
      toast.error('Could not record ID return', { description: toUserMessage(e) })
    } finally {
      setReturningId(false)
    }
  }

  const settled = r && r.equipment_returned && outstanding <= 0 && depositHeld === 0 && r.id_status !== 'held'

  const actions = r && (
    <>
      {r.status === 'booked' && <StatusAction type="camera_rental" id={r.id} to="ready_for_pickup" variant="outline" icon={<PackageOpen />}>Mark ready for pickup</StatusAction>}
      {(r.status === 'booked' || r.status === 'ready_for_pickup') && (
        <Button size="sm" onClick={() => setDialog('pickup')}>
          <Handshake /> Customer pickup & handover
        </Button>
      )}
      {r.status === 'rented_out' && (
        <Button size="sm" variant="income" onClick={() => setDialog('return')}>
          <Undo2 /> Record equipment return
        </Button>
      )}
      {r.status === 'returned' && (
        <>
          {depositHeld > 0 && (
            <Button size="sm" variant="outline" onClick={() => setDialog('deposit')}>
              <RotateCcw /> Return deposit
            </Button>
          )}
          {r.id_status === 'held' && (
            <Button size="sm" variant="outline" onClick={() => void returnId()} disabled={returningId}>
              {returningId ? <Loader2 className="animate-spin" /> : <IdCard />} ID returned to customer
            </Button>
          )}
          {settled && <StatusAction type="camera_rental" id={r.id} to="closed" icon={<Lock />}>Close rental</StatusAction>}
        </>
      )}
    </>
  )

  return (
    <>
      <DocumentDetailFrame
        type="camera_rental"
        doc={d}
        loading={rental.isLoading || doc.isLoading}
        error={rental.error ?? doc.error}
        onRetry={() => void Promise.all([rental.refetch(), doc.refetch()])}
        customer={r?.customer ?? null}
        subtitle={r ? `${formatDateTime(r.pickup_at)} → ${formatDateTime(r.expected_return_at)} · ${r.rental_days} day${r.rental_days === 1 ? '' : 's'}` : ''}
        editable={!!r && ['booked', 'ready_for_pickup', 'rented_out'].includes(r.status)}
        actions={actions}
        notice={
          overdue && (
            <div className="mb-6 flex items-center gap-2 rounded-xl border border-expense-ring bg-expense-soft p-4 text-sm font-medium text-expense-text" role="alert">
              <AlertTriangle className="size-5" /> Overdue — equipment was due back {formatDateTime(r!.expected_return_at)}.
            </div>
          )
        }
        details={
          r && (
            <>
              {['rented_out', 'returned', 'closed'].includes(r.status) && (
                <SectionCard title="Settlement checklist" description="All four must be complete before the rental can be closed">
                  <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                    <Obligation done={r.equipment_returned} label="Equipment returned" detail={r.actual_return_at ? `Returned ${formatDateTime(r.actual_return_at)}` : `Due ${formatDateTime(r.expected_return_at)}`} />
                    <Obligation done={outstanding <= 0} label="Balance paid" detail={outstanding > 0 ? `${formatLKR(outstanding)} outstanding` : 'Fully paid'} />
                    <Obligation done={depositHeld === 0} label="Deposit settled" detail={depositHeld > 0 ? `${formatLKR(depositHeld)} still held` : 'Nothing held'} />
                    <Obligation done={r.id_status !== 'held'} label="ID returned" detail={r.id_status === 'held' ? 'Original ID still held by the shop' : r.id_status === 'returned' ? 'Returned to customer' : 'No original ID was held'} />
                  </ul>
                </SectionCard>
              )}
              <SectionCard title="Equipment" bodyClassName="space-y-3">
                {r.items.map((i) => {
                  const out = r.checks.find((c) => c.equipment_id === i.equipment_id && c.stage === 'pickup')
                  const back = r.checks.find((c) => c.equipment_id === i.equipment_id && c.stage === 'return')
                  return (
                    <div key={i.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{i.equipment?.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {i.equipment?.ref} · Serial {i.equipment?.serial_number} · {formatLKR(toCents(i.daily_rate))}/day
                          </p>
                        </div>
                        {i.returned_at ? <ToneBadge tone="success">Returned</ToneBadge> : r.status === 'rented_out' ? <ToneBadge tone="accent">Out</ToneBadge> : null}
                      </div>
                      {(out || back) && (
                        <dl className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 text-xs sm:grid-cols-2">
                          {out && (
                            <div>
                              <dt className="font-medium">At pickup: {out.condition}</dt>
                              <dd className="text-muted-foreground">{[i.accessories_out, out.notes].filter(Boolean).join(' · ') || '—'}</dd>
                            </div>
                          )}
                          {back && (
                            <div>
                              <dt className={cn('font-medium', back.condition === 'damaged' && 'text-expense-text')}>At return: {back.condition}</dt>
                              <dd className="text-muted-foreground">{[i.accessories_in, back.notes].filter(Boolean).join(' · ') || '—'}</dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </div>
                  )
                })}
              </SectionCard>
              <SectionCard title="Rental details">
                <DetailList
                  items={[
                    { label: 'Booked on', value: formatDateTime(r.created_at) },
                    { label: 'Pickup', value: formatDateTime(r.actual_pickup_at ?? r.pickup_at) + (r.actual_pickup_at ? '' : ' (planned)') },
                    { label: 'Expected return', value: formatDateTime(r.expected_return_at) },
                    { label: 'Actual return', value: formatDateTime(r.actual_return_at), hidden: !r.actual_return_at },
                    { label: 'Rental charge', value: `${formatLKR(toCents(r.rental_charge))} (${r.rental_days} day${r.rental_days === 1 ? '' : 's'})` },
                    { label: 'Late fee', value: formatLKR(toCents(r.late_fee)), hidden: !Number(r.late_fee) },
                    { label: 'Damage charge', value: formatLKR(toCents(r.damage_charge)), hidden: !Number(r.damage_charge) },
                    { label: 'Other charges', value: formatLKR(toCents(r.other_charges)), hidden: !Number(r.other_charges) },
                    { label: 'Security deposit required', value: formatLKR(toCents(r.deposit_required)) },
                    {
                      label: 'Identity',
                      value: r.handover
                        ? `${ID_TYPES.find((t) => t.value === r.handover!.id_type)?.label}${r.handover.id_last4 ? ` ending ${r.handover.id_last4}` : ''} · verified`
                        : 'Not yet verified',
                    },
                    { label: 'Notes', value: r.notes, hidden: !r.notes },
                    { label: 'Return notes', value: r.return_notes, hidden: !r.return_notes },
                    { label: 'Cancellation reason', value: r.cancel_reason, hidden: !r.cancel_reason },
                  ]}
                />
              </SectionCard>
            </>
          )
        }
      />
      {r && (
        <>
          <Dlg open={dialog === 'pickup'} onOpenChange={(o) => !o && setDialog(null)} title={`Pickup — ${r.ref}`} description="Verify identity, inspect the equipment and confirm handover. Record any advance with Record payment.">
            <PickupDialog rental={r} open onOpenChange={(o) => !o && setDialog(null)} />
          </Dlg>
          <Dlg open={dialog === 'return'} onOpenChange={(o) => !o && setDialog(null)} title={`Return — ${r.ref}`} description="Inspect the equipment and record late fees or damage. Collect the balance and settle the deposit next.">
            <ReturnDialog rental={r} open onOpenChange={(o) => !o && setDialog(null)} />
          </Dlg>
        </>
      )}
      {d && <RefundDialog doc={d} open={dialog === 'deposit'} initialKind="deposit_return" onOpenChange={(o) => !o && setDialog(null)} key={`dep-${dialog}`} />}
    </>
  )
}
