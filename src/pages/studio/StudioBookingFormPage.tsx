import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { FormPage, FormSection, SummaryCard } from '@/components/forms/FormPage'
import { CustomerPicker } from '@/components/customers/CustomerPicker'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { MoneyInput } from '@/components/shared'
import { DetailSkeleton } from '@/components/documents/DocumentDetail'
import { usePackages, useResources, useSettings, useStudioBooking } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { saveStudioBooking } from '@/services/operations'
import { newRequestId } from '@/services/api'
import { addDays, businessToday } from '@/lib/dates'
import { defaultAdvanceCents } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { toUserMessage } from '@/lib/errors'
import { studioBookingSchema, type StudioBookingValues } from '@/lib/validation'
import type { StudioBooking } from '@/types/domain'

const money = (n: number | null | undefined) => ((n ?? 0) === 0 ? '' : Number(n).toFixed(2))

function toValues(b?: StudioBooking | null): StudioBookingValues {
  return {
    customerId: b?.customer_id ?? '',
    packageId: b?.package_id ?? '',
    packageName: b?.package_name ?? '',
    packageDescription: b?.package_description ?? '',
    shootDate: b?.shoot_date ?? addDays(businessToday(), 7),
    startTime: b?.start_time?.slice(0, 5) ?? '09:00',
    endTime: b?.end_time?.slice(0, 5) ?? '12:00',
    location: b?.location ?? '',
    resourceId: b?.resource_id ?? '',
    packagePrice: money(b?.package_price),
    additionalCharges: money(b?.additional_charges),
    additionalChargesNote: b?.additional_charges_note ?? '',
    requiredAdvance: money(b?.required_advance),
    notes: b?.notes ?? '',
  }
}

export default function StudioBookingFormPage() {
  const { id } = useParams()
  const existing = useStudioBooking(id)
  if (id && existing.isLoading) return <DetailSkeleton />
  return <BookingForm key={existing.data?.id ?? 'new'} booking={existing.data ?? null} />
}

function BookingForm({ booking }: { booking: StudioBooking | null }) {
  const navigate = useNavigate()
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const packages = usePackages()
  const resources = useResources()
  const settings = useSettings()
  const advanceTouched = useRef(!!booking)

  const form = useForm<StudioBookingValues>({ resolver: zodResolver(studioBookingSchema), defaultValues: toValues(booking) })
  const { register, control, setValue, formState } = form
  const err = formState.errors
  const [price, extra, advance, packageId] = useWatch({ control, name: ['packagePrice', 'additionalCharges', 'requiredAdvance', 'packageId'] })
  const totalCents = toCents(price || '0') + toCents(extra || '0')
  const pct = Number(settings.data?.default_advance_percent ?? 25)

  // Suggest the advance from settings until the admin types their own amount.
  useEffect(() => {
    if (advanceTouched.current) return
    const c = defaultAdvanceCents(totalCents, pct)
    setValue('requiredAdvance', c ? (c / 100).toFixed(2) : '')
  }, [totalCents, pct, setValue])

  const activePackages = useMemo(() => (packages.data ?? []).filter((p) => p.is_active || p.id === booking?.package_id), [packages.data, booking])

  const applyPackage = (pid: string) => {
    setValue('packageId', pid)
    const p = packages.data?.find((x) => x.id === pid)
    if (!p) return
    setValue('packageName', p.name, { shouldValidate: true })
    setValue('packageDescription', p.description ?? '')
    setValue('packagePrice', Number(p.base_price).toFixed(2), { shouldValidate: true })
    if (p.duration_hours) {
      const [h, m] = form.getValues('startTime').split(':').map(Number)
      const end = Math.min(h! * 60 + m! + Math.round(Number(p.duration_hours) * 60), 23 * 60 + 59)
      setValue('endTime', `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`)
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const id = await saveStudioBooking(values, { id: booking?.id, requestId: requestId.current })
      await invalidate()
      toast.success(booking ? 'Booking updated' : 'Booking created — record the advance to confirm it')
      navigate(`/studio/bookings/${id}`, { replace: true })
    } catch (e) {
      toast.error('Booking not saved', { description: toUserMessage(e) })
    }
  })

  return (
    <FormPage
      title={booking ? `Edit ${booking.ref}` : 'New studio booking'}
      description="Bookings start as Pending Advance and are confirmed once the advance is recorded."
      backTo={booking ? `/studio/bookings/${booking.id}` : '/studio/bookings'}
      backLabel={booking ? booking.ref : 'Studio bookings'}
      onSubmit={onSubmit}
      submitting={formState.isSubmitting}
      submitLabel={booking ? 'Save changes' : 'Create booking'}
      summary={
        <SummaryCard
          title="Booking total"
          rows={[
            { label: 'Package', value: formatLKR(toCents(price || '0')) },
            { label: 'Additional charges', value: formatLKR(toCents(extra || '0')) },
            { label: 'Required advance', value: formatLKR(toCents(advance || '0')), muted: true },
          ]}
          total={{ label: 'Total', value: formatLKR(totalCents) }}
        />
      }
    >
      <FormSection title="Customer">
        <Field id="customer" label="Customer" required error={err.customerId?.message}>
          <Controller control={control} name="customerId" render={({ field }) => <CustomerPicker id="customer" value={field.value} onChange={field.onChange} invalid={!!err.customerId} />} />
        </Field>
      </FormSection>

      <FormSection title="Package">
        <Field id="package" label="Photography package" hint="Choose a saved package to prefill, or type a custom one below">
          <Select id="package" value={packageId ?? ''} onChange={(e) => applyPackage(e.target.value)}>
            <option value="">Custom package</option>
            {activePackages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {formatLKR(toCents(p.base_price))}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="packageName" label="Package name" required error={err.packageName?.message}>
          <Input {...fieldAria('packageName', err.packageName?.message)} {...register('packageName')} />
        </Field>
        <Field id="packageDescription" label="Package description" error={err.packageDescription?.message}>
          <Textarea {...fieldAria('packageDescription', err.packageDescription?.message)} rows={2} {...register('packageDescription')} />
        </Field>
      </FormSection>

      <FormSection title="Shoot schedule">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-3">
          <Field id="shootDate" label="Shoot date" required error={err.shootDate?.message}>
            <Input {...fieldAria('shootDate', err.shootDate?.message)} type="date" {...register('shootDate')} />
          </Field>
          <Field id="startTime" label="Start time" required error={err.startTime?.message}>
            <Input {...fieldAria('startTime', err.startTime?.message)} type="time" {...register('startTime')} />
          </Field>
          <Field id="endTime" label="End time" required error={err.endTime?.message}>
            <Input {...fieldAria('endTime', err.endTime?.message)} type="time" {...register('endTime')} />
          </Field>
        </div>
        <Field id="location" label="Shoot location" required error={err.location?.message}>
          <Input {...fieldAria('location', err.location?.message)} placeholder="e.g. Studio, Galle Face Hotel" {...register('location')} />
        </Field>
        <Field id="resourceId" label="Photographer / studio resource" hint="Assigned resources can't be double-booked once confirmed">
          <Select id="resourceId" {...register('resourceId')}>
            <option value="">Not assigned</option>
            {(resources.data ?? []).filter((r) => r.is_active || r.id === booking?.resource_id).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>

      <FormSection title="Pricing" description="Amounts in LKR">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <Field id="packagePrice" label="Package price" required error={err.packagePrice?.message}>
            <MoneyInput {...fieldAria('packagePrice', err.packagePrice?.message)} {...register('packagePrice')} />
          </Field>
          <Field id="additionalCharges" label="Additional charges" error={err.additionalCharges?.message}>
            <MoneyInput {...fieldAria('additionalCharges', err.additionalCharges?.message)} {...register('additionalCharges')} />
          </Field>
        </div>
        <Field id="additionalChargesNote" label="Additional charges note" error={err.additionalChargesNote?.message}>
          <Input {...fieldAria('additionalChargesNote', err.additionalChargesNote?.message)} placeholder="e.g. Extra album, travel" {...register('additionalChargesNote')} />
        </Field>
        <Field id="requiredAdvance" label="Required advance" error={err.requiredAdvance?.message} hint={`Suggested at ${pct}% (Settings). The booking is confirmed once at least this much is paid.`}>
          <MoneyInput
            {...fieldAria('requiredAdvance', err.requiredAdvance?.message)}
            {...register('requiredAdvance', { onChange: () => (advanceTouched.current = true) })}
          />
        </Field>
        <Field id="notes" label="Booking notes" error={err.notes?.message}>
          <Textarea {...fieldAria('notes', err.notes?.message)} rows={3} {...register('notes')} />
        </Field>
      </FormSection>
    </FormPage>
  )
}
