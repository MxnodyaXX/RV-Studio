import { useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Frame, Hammer, Lock, PackageCheck, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { DocumentList } from '@/components/documents/DocumentList'
import { DetailSkeleton, DocumentDetailFrame, StatusAction } from '@/components/documents/DocumentDetail'
import { FormPage, FormSection, SummaryCard } from '@/components/forms/FormPage'
import { LineItems } from '@/components/forms/LineItems'
import { CustomerPicker } from '@/components/customers/CustomerPicker'
import { Field, Input, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { DetailList, MoneyInput, SectionCard } from '@/components/shared'
import { useFrameOrder, useReceivable } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { saveFrameOrder, type FrameOrderDetail } from '@/services/operations'
import { newRequestId } from '@/services/api'
import { addDays, businessToday, formatDisplayDate } from '@/lib/dates'
import { itemsTotalCents } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { toUserMessage } from '@/lib/errors'
import { frameOrderSchema, type FrameOrderValues } from '@/lib/validation'

export function FrameOrdersPage() {
  return (
    <DocumentList
      type="frame_order"
      title="Frame Orders"
      description="The Frame House — custom frames from order to delivery."
      icon={Frame}
      dateLabel="Completion"
      dateField="due_date"
      newLabel="New frame order"
    />
  )
}

const blankItem = { frameType: '', frameSize: '', description: '', quantity: 1, unitPrice: '' }

export function FrameOrderFormPage() {
  const { id } = useParams()
  const existing = useFrameOrder(id)
  if (id && existing.isLoading) return <DetailSkeleton />
  return <FrameOrderForm key={existing.data?.id ?? 'new'} order={existing.data ?? null} />
}

function FrameOrderForm({ order }: { order: FrameOrderDetail | null }) {
  const navigate = useNavigate()
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const form = useForm<FrameOrderValues>({
    resolver: zodResolver(frameOrderSchema),
    defaultValues: {
      customerId: order?.customer_id ?? '',
      orderDate: order?.order_date ?? businessToday(),
      expectedCompletionDate: order?.expected_completion_date ?? addDays(businessToday(), 5),
      specialInstructions: order?.special_instructions ?? '',
      items: order?.items.length
        ? order.items.map((i) => ({ frameType: i.frame_type, frameSize: i.frame_size, description: i.description ?? '', quantity: i.quantity, unitPrice: Number(i.unit_price).toFixed(2) }))
        : [blankItem],
    },
  })
  const { register, control, formState } = form
  const err = formState.errors
  const items = useFieldArray({ control, name: 'items' })
  const watched = useWatch({ control, name: 'items' })
  const total = itemsTotalCents((watched ?? []).map((i) => ({ quantity: i.quantity as number, unitPrice: i.unitPrice || '0' })))

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const id = await saveFrameOrder(values, { id: order?.id, requestId: requestId.current })
      await invalidate()
      toast.success(order ? 'Order updated' : 'Frame order created')
      navigate(`/frames/orders/${id}`, { replace: true })
    } catch (e) {
      toast.error('Order not saved', { description: toUserMessage(e) })
    }
  })

  return (
    <FormPage
      title={order ? `Edit ${order.ref}` : 'New frame order'}
      description="Frames can only be marked delivered after full payment."
      backTo={order ? `/frames/orders/${order.id}` : '/frames/orders'}
      backLabel={order ? order.ref : 'Frame orders'}
      onSubmit={onSubmit}
      submitting={formState.isSubmitting}
      submitLabel={order ? 'Save changes' : 'Create order'}
      summary={
        <SummaryCard
          title="Order total"
          rows={(watched ?? []).map((i, idx) => ({ label: `${i.quantity || 0} × ${i.frameType || `Item ${idx + 1}`} ${i.frameSize}`, value: formatLKR(toCents(i.unitPrice || '0') * (Number(i.quantity) || 0)), muted: true }))}
          total={{ label: 'Total', value: formatLKR(total) }}
        />
      }
    >
      <FormSection title="Customer & dates">
        <Field id="customer" label="Customer" required error={err.customerId?.message}>
          <Controller control={control} name="customerId" render={({ field }) => <CustomerPicker id="customer" value={field.value} onChange={field.onChange} invalid={!!err.customerId} />} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <Field id="orderDate" label="Order date" required error={err.orderDate?.message}>
            <Input {...fieldAria('orderDate', err.orderDate?.message)} type="date" {...register('orderDate')} />
          </Field>
          <Field id="expectedCompletionDate" label="Expected completion" error={err.expectedCompletionDate?.message}>
            <Input {...fieldAria('expectedCompletionDate', err.expectedCompletionDate?.message)} type="date" {...register('expectedCompletionDate')} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Frames" description="Type, size, quantity and unit price for each frame">
        <LineItems
          items={items.fields}
          onAdd={() => items.append(blankItem)}
          onRemove={(i) => items.remove(i)}
          addLabel="Add another frame"
          error={err.items?.root?.message ?? err.items?.message}
          lineTotal={(i) => ({ quantity: watched?.[i]?.quantity as number, unitPrice: watched?.[i]?.unitPrice ?? '0' })}
          render={(i) => {
            const e = err.items?.[i]
            return (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field id={`ft-${i}`} label="Frame type" required error={e?.frameType?.message}>
                  <Input {...fieldAria(`ft-${i}`, e?.frameType?.message)} placeholder="e.g. Wooden, Glass, Collage" {...register(`items.${i}.frameType`)} />
                </Field>
                <Field id={`fs-${i}`} label="Frame size" required error={e?.frameSize?.message}>
                  <Input {...fieldAria(`fs-${i}`, e?.frameSize?.message)} placeholder="e.g. 12x18, A4" {...register(`items.${i}.frameSize`)} />
                </Field>
                <Field id={`fq-${i}`} label="Quantity" required error={e?.quantity?.message}>
                  <Input {...fieldAria(`fq-${i}`, e?.quantity?.message)} type="number" inputMode="numeric" min={1} {...register(`items.${i}.quantity`)} />
                </Field>
                <Field id={`fp-${i}`} label="Unit price" required error={e?.unitPrice?.message}>
                  <MoneyInput {...fieldAria(`fp-${i}`, e?.unitPrice?.message)} {...register(`items.${i}.unitPrice`)} />
                </Field>
                <Field id={`fd-${i}`} label="Description" className="sm:col-span-2" error={e?.description?.message}>
                  <Input {...fieldAria(`fd-${i}`, e?.description?.message)} placeholder="Optional (mount colour, glass type…)" {...register(`items.${i}.description`)} />
                </Field>
              </div>
            )
          }}
        />
      </FormSection>

      <FormSection title="Special instructions">
        <Field id="specialInstructions" label="Instructions" error={err.specialInstructions?.message}>
          <Textarea {...fieldAria('specialInstructions', err.specialInstructions?.message)} rows={3} {...register('specialInstructions')} />
        </Field>
      </FormSection>
    </FormPage>
  )
}

export function FrameOrderDetailPage() {
  const { id } = useParams()
  const order = useFrameOrder(id)
  const doc = useReceivable(id)
  const o = order.data
  const outstanding = toCents(doc.data?.outstanding)

  const actions = o && (
    <>
      {o.status === 'new' && <StatusAction type="frame_order" id={o.id} to="processing" icon={<Hammer />}>Start processing</StatusAction>}
      {(o.status === 'new' || o.status === 'processing') && (
        <StatusAction type="frame_order" id={o.id} to="ready" variant={o.status === 'processing' ? 'default' : 'outline'} icon={<PackageCheck />}>
          Frame ready for collection
        </StatusAction>
      )}
      {o.status === 'ready' &&
        (outstanding > 0 ? (
          <p className="flex items-center gap-2 text-sm text-warning-text">
            <Truck className="size-4" /> Collect the remaining {formatLKR(outstanding)} before delivery.
          </p>
        ) : (
          <StatusAction type="frame_order" id={o.id} to="delivered" variant="income" icon={<CheckCircle2 />}>Mark delivered</StatusAction>
        ))}
      {o.status === 'delivered' && <StatusAction type="frame_order" id={o.id} to="closed" icon={<Lock />}>Close order</StatusAction>}
    </>
  )

  return (
    <DocumentDetailFrame
      type="frame_order"
      doc={doc.data}
      loading={order.isLoading || doc.isLoading}
      error={order.error ?? doc.error}
      onRetry={() => void Promise.all([order.refetch(), doc.refetch()])}
      customer={o?.customer ?? null}
      subtitle={o ? `Ordered ${formatDisplayDate(o.order_date)}${o.expected_completion_date ? ` · Due ${formatDisplayDate(o.expected_completion_date)}` : ''}` : ''}
      editable={!!o && ['new', 'processing', 'ready'].includes(o.status)}
      actions={actions}
      details={
        o && (
          <SectionCard title="Frame specifications" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Frame</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">{i.frame_type}</p>
                      {i.description && <p className="text-xs text-muted-foreground">{i.description}</p>}
                    </TableCell>
                    <TableCell>{i.frame_size}</TableCell>
                    <TableCell className="tabular text-right">{i.quantity}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">{formatLKR(toCents(i.unit_price))}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right font-medium">{formatLKR(toCents(i.line_total))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-border p-5 sm:p-6">
              <DetailList
                items={[
                  { label: 'Order date', value: formatDisplayDate(o.order_date) },
                  { label: 'Expected completion', value: formatDisplayDate(o.expected_completion_date) },
                  { label: 'Delivered on', value: formatDisplayDate(o.delivered_on), hidden: !o.delivered_on },
                  { label: 'Special instructions', value: o.special_instructions, hidden: !o.special_instructions },
                  { label: 'Cancellation reason', value: o.cancel_reason, hidden: !o.cancel_reason },
                ]}
              />
            </div>
          </SectionCard>
        )
      }
    />
  )
}
