import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { FormPage, FormSection, SummaryCard } from '@/components/forms/FormPage'
import { CustomerPicker } from '@/components/customers/CustomerPicker'
import { DetailSkeleton } from '@/components/documents/DocumentDetail'
import { Field, Input, Textarea, fieldAria } from '@/components/ui/form-controls'
import { MoneyInput } from '@/components/shared'
import { EmptyState } from '@/components/common'
import { queryKeys } from '@/app/queryClient'
import { useCameraRental, useEquipment } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { checkAvailability, saveCameraRental, type CameraRentalDetail } from '@/services/operations'
import { newRequestId } from '@/services/api'
import { addDays, businessToday, formatDateTime, fromColomboInput, toColomboInput } from '@/lib/dates'
import { rentalChargeCents, rentalDays } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { cameraRentalSchema, type CameraRentalValues } from '@/lib/validation'
import { Camera } from 'lucide-react'

export default function CameraRentalFormPage() {
  const { id } = useParams()
  const existing = useCameraRental(id)
  if (id && existing.isLoading) return <DetailSkeleton />
  return <RentalForm key={existing.data?.id ?? 'new'} rental={existing.data ?? null} />
}

function RentalForm({ rental }: { rental: CameraRentalDetail | null }) {
  const navigate = useNavigate()
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const equipment = useEquipment()
  const depositTouched = useRef(!!rental)
  const extending = rental?.status === 'rented_out'
  const tomorrow = addDays(businessToday(), 1)

  const form = useForm<CameraRentalValues>({
    resolver: zodResolver(cameraRentalSchema),
    defaultValues: {
      customerId: rental?.customer_id ?? '',
      pickupAt: rental ? toColomboInput(rental.pickup_at) : `${tomorrow}T10:00`,
      expectedReturnAt: rental ? toColomboInput(rental.expected_return_at) : `${addDays(tomorrow, 1)}T10:00`,
      depositRequired: rental ? Number(rental.deposit_required).toFixed(2) : '',
      notes: rental?.notes ?? '',
      equipmentIds: rental?.items.map((i) => i.equipment_id) ?? [],
    },
  })
  const { register, control, setValue, formState } = form
  const err = formState.errors
  const [pickupAt, returnAt, selected] = useWatch({ control, name: ['pickupAt', 'expectedReturnAt', 'equipmentIds'] })
  const period = useDebouncedValue({ pickupAt, returnAt }, 300)

  const availability = useQuery({
    queryKey: queryKeys.availability({ ...period, rental: rental?.id }),
    queryFn: () => checkAvailability(period.pickupAt, period.returnAt, rental?.id),
    enabled: !!period.pickupAt && !!period.returnAt && period.returnAt > period.pickupAt,
  })
  const avail = useMemo(() => new Map((availability.data ?? []).map((a) => [a.equipment_id, a])), [availability.data])

  const items = (equipment.data ?? []).filter((e) => e.status !== 'retired' || selected?.includes(e.id))
  const chosen = items.filter((e) => selected?.includes(e.id))
  const days = rentalDays(fromColomboInput(pickupAt), fromColomboInput(returnAt))
  const charge = rentalChargeCents(chosen.map((e) => e.daily_rate), days)
  const suggestedDeposit = chosen.reduce((s, e) => s + toCents(e.default_deposit), 0)

  useEffect(() => {
    if (!depositTouched.current) setValue('depositRequired', suggestedDeposit ? (suggestedDeposit / 100).toFixed(2) : '')
  }, [suggestedDeposit, setValue])

  const toggle = (id: string) => {
    if (extending) return
    const next = selected?.includes(id) ? selected.filter((x) => x !== id) : [...(selected ?? []), id]
    setValue('equipmentIds', next, { shouldValidate: true })
  }

  const conflicts = chosen.filter((e) => avail.get(e.id) && !avail.get(e.id)!.is_available)

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const id = await saveCameraRental(values, { id: rental?.id, requestId: requestId.current })
      await invalidate()
      toast.success(rental ? 'Rental updated' : 'Rental booked — equipment reserved for these dates')
      navigate(`/camera/rentals/${id}`, { replace: true })
    } catch (e) {
      toast.error('Rental not saved', { description: toUserMessage(e) })
    }
  })

  return (
    <FormPage
      title={rental ? (extending ? `Extend ${rental.ref}` : `Edit ${rental.ref}`) : 'New camera rental'}
      description="Availability is checked live; the database also prevents double-booking."
      backTo={rental ? `/camera/rentals/${rental.id}` : '/camera/rentals'}
      backLabel={rental ? rental.ref : 'Camera rentals'}
      onSubmit={onSubmit}
      submitting={formState.isSubmitting}
      submitLabel={rental ? 'Save changes' : 'Book rental'}
      summary={
        <SummaryCard
          title="Rental charge"
          rows={[
            ...chosen.map((e) => ({ label: `${e.name} × ${days} day${days === 1 ? '' : 's'}`, value: formatLKR(toCents(e.daily_rate) * days), muted: true })),
            { label: 'Refundable deposit (not income)', value: formatLKR(toCents(form.getValues('depositRequired') || '0')) },
          ]}
          total={{ label: 'Rental total', value: formatLKR(charge) }}
        />
      }
    >
      <FormSection title="Customer">
        <Field id="customer" label="Customer" required error={err.customerId?.message}>
          <Controller control={control} name="customerId" render={({ field }) => <CustomerPicker id="customer" value={field.value} onChange={field.onChange} invalid={!!err.customerId} />} />
        </Field>
      </FormSection>

      <FormSection title="Rental period" description="Times are Sri Lanka time. Part days are charged as a full day.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <Field id="pickupAt" label="Pickup" required error={err.pickupAt?.message}>
            <Input {...fieldAria('pickupAt', err.pickupAt?.message)} type="datetime-local" disabled={extending} {...register('pickupAt')} />
          </Field>
          <Field id="expectedReturnAt" label="Expected return" required error={err.expectedReturnAt?.message}>
            <Input {...fieldAria('expectedReturnAt', err.expectedReturnAt?.message)} type="datetime-local" {...register('expectedReturnAt')} />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">
          Duration: <strong className="text-foreground">{days || '—'} day{days === 1 ? '' : 's'}</strong>
        </p>
      </FormSection>

      <FormSection title="Equipment" description={extending ? 'Equipment can’t be changed while it is rented out.' : 'Tap to select. Unavailable items show the clashing rental.'}>
        {equipment.isLoading ? (
          <Loader2 className="animate-spin text-muted-foreground" />
        ) : !items.length ? (
          <EmptyState icon={Camera} title="No equipment yet" description="Add cameras and lenses in Inventory → Camera equipment." className="py-6" />
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
            {items.map((e) => {
              const a = avail.get(e.id)
              const isSel = selected?.includes(e.id)
              const blocked = !!a && !a.is_available
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  aria-pressed={isSel}
                  disabled={extending || (blocked && !isSel)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
                    isSel ? 'border-accent bg-accent-soft ring-2 ring-accent/20' : 'border-border bg-card hover:bg-muted',
                    blocked && !isSel && 'opacity-60',
                  )}
                >
                  <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border', isSel ? 'border-accent bg-accent text-white' : 'border-input')}>
                    {isSel && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{e.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.category} · {e.serial_number} · {formatLKR(toCents(e.daily_rate))}/day
                    </span>
                    {e.status !== 'available' ? (
                      <span className="mt-1 block text-xs font-medium text-warning-text">In {e.status}</span>
                    ) : blocked ? (
                      <span className="mt-1 block text-xs font-medium text-expense-text">
                        Booked ({a.conflict_ref}) until {a.conflict_until ? formatDateTime(a.conflict_until) : '—'}
                      </span>
                    ) : a ? (
                      <span className="mt-1 block text-xs font-medium text-income-text">Available</span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {err.equipmentIds?.message && <p role="alert" className="text-xs font-medium text-destructive">{err.equipmentIds.message}</p>}
        {conflicts.length > 0 && (
          <p className="flex items-center gap-2 rounded-lg border border-expense-ring bg-expense-soft p-3 text-sm text-expense-text">
            <AlertTriangle className="size-4 shrink-0" /> {conflicts.map((c) => c.name).join(', ')} {conflicts.length === 1 ? 'is' : 'are'} already booked for these dates.
          </p>
        )}
      </FormSection>

      <FormSection title="Deposit & notes">
        <Field id="depositRequired" label="Refundable security deposit" error={err.depositRequired?.message} hint="Suggested from the equipment's default deposits. Held as a liability — never counted as income.">
          <MoneyInput {...fieldAria('depositRequired', err.depositRequired?.message)} {...register('depositRequired', { onChange: () => (depositTouched.current = true) })} />
        </Field>
        <Field id="notes" label="Notes" error={err.notes?.message}>
          <Textarea {...fieldAria('notes', err.notes?.message)} rows={3} {...register('notes')} />
        </Field>
      </FormSection>
    </FormPage>
  )
}
