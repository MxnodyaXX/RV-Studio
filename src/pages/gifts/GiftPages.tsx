import { useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, Gift, Hammer, Lock, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { DocumentList } from '@/components/documents/DocumentList'
import { DetailSkeleton, DocumentDetailFrame, StatusAction } from '@/components/documents/DocumentDetail'
import { FormPage, FormSection, SummaryCard } from '@/components/forms/FormPage'
import { LineItems } from '@/components/forms/LineItems'
import { CustomerPicker } from '@/components/customers/CustomerPicker'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { DetailList, MoneyInput, SectionCard } from '@/components/shared'
import { useGiftOrder, useProducts, useReceivable, useSettings } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { saveGiftOrder, type GiftOrderDetail } from '@/services/operations'
import { newRequestId } from '@/services/api'
import { businessToday, formatDisplayDate } from '@/lib/dates'
import { itemsTotalCents } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { toUserMessage } from '@/lib/errors'
import { giftOrderSchema, type GiftOrderValues } from '@/lib/validation'

export function GiftOrdersPage() {
  return (
    <DocumentList
      type="gift_order"
      title="Gift Park Orders"
      description="Gift Park — orders, payments, delivery and stock."
      icon={Gift}
      dateLabel="Delivery"
      dateField="due_date"
      newLabel="New gift order"
    />
  )
}

const blankItem = { productId: '', productName: '', quantity: 1, unitPrice: '' }

export function GiftOrderFormPage() {
  const { id } = useParams()
  const existing = useGiftOrder(id)
  if (id && existing.isLoading) return <DetailSkeleton />
  return <GiftOrderForm key={existing.data?.id ?? 'new'} order={existing.data ?? null} />
}

function GiftOrderForm({ order }: { order: GiftOrderDetail | null }) {
  const navigate = useNavigate()
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const products = useProducts()
  const settings = useSettings()

  const form = useForm<GiftOrderValues>({
    resolver: zodResolver(giftOrderSchema),
    defaultValues: {
      customerId: order?.customer_id ?? '',
      orderDate: order?.order_date ?? businessToday(),
      expectedDeliveryDate: order?.expected_delivery_date ?? '',
      deliveryCharge: Number(order?.delivery_charge) ? Number(order!.delivery_charge).toFixed(2) : '',
      notes: order?.notes ?? '',
      items: order?.items.length
        ? order.items.map((i) => ({ productId: i.product_id ?? '', productName: i.product_name, quantity: i.quantity, unitPrice: Number(i.unit_price).toFixed(2) }))
        : [blankItem],
    },
  })
  const { register, control, setValue, formState } = form
  const err = formState.errors
  const items = useFieldArray({ control, name: 'items' })
  const watched = useWatch({ control, name: 'items' })
  const delivery = useWatch({ control, name: 'deliveryCharge' })
  const subtotal = itemsTotalCents((watched ?? []).map((i) => ({ quantity: i.quantity as number, unitPrice: i.unitPrice || '0' })))
  const total = subtotal + toCents(delivery || '0')
  const active = (products.data ?? []).filter((p) => p.is_active)

  const pick = (i: number, productId: string) => {
    setValue(`items.${i}.productId`, productId)
    const p = products.data?.find((x) => x.id === productId)
    if (p) {
      setValue(`items.${i}.productName`, p.name, { shouldValidate: true })
      setValue(`items.${i}.unitPrice`, Number(p.unit_price).toFixed(2), { shouldValidate: true })
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const id = await saveGiftOrder(values, { id: order?.id, requestId: requestId.current })
      await invalidate()
      toast.success(order ? 'Order updated' : 'Gift order created')
      navigate(`/gifts/orders/${id}`, { replace: true })
    } catch (e) {
      toast.error('Order not saved', { description: toUserMessage(e) })
    }
  })

  return (
    <FormPage
      title={order ? `Edit ${order.ref}` : 'New gift order'}
      description={
        settings.data?.gift_stock_deduction === 'on_delivery' ? 'Stock is deducted when the order is delivered.' : 'Stock is deducted when the order is saved.'
      }
      backTo={order ? `/gifts/orders/${order.id}` : '/gifts/orders'}
      backLabel={order ? order.ref : 'Gift orders'}
      onSubmit={onSubmit}
      submitting={formState.isSubmitting}
      submitLabel={order ? 'Save changes' : 'Create order'}
      summary={
        <SummaryCard
          title="Order total"
          rows={[
            { label: 'Products', value: formatLKR(subtotal) },
            { label: 'Delivery', value: formatLKR(toCents(delivery || '0')) },
          ]}
          total={{ label: 'Total', value: formatLKR(total) }}
        />
      }
    >
      <FormSection title="Customer & dates">
        <Field id="customer" label="Customer" error={err.customerId?.message} hint="Optional for walk-in sales">
          <Controller control={control} name="customerId" render={({ field }) => <CustomerPicker id="customer" optional value={field.value ?? ''} onChange={field.onChange} />} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <Field id="orderDate" label="Order date" required error={err.orderDate?.message}>
            <Input {...fieldAria('orderDate', err.orderDate?.message)} type="date" {...register('orderDate')} />
          </Field>
          <Field id="expectedDeliveryDate" label="Expected delivery" error={err.expectedDeliveryDate?.message}>
            <Input {...fieldAria('expectedDeliveryDate', err.expectedDeliveryDate?.message)} type="date" {...register('expectedDeliveryDate')} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Products">
        <LineItems
          items={items.fields}
          onAdd={() => items.append(blankItem)}
          onRemove={(i) => items.remove(i)}
          addLabel="Add product"
          error={err.items?.root?.message ?? err.items?.message}
          lineTotal={(i) => ({ quantity: watched?.[i]?.quantity as number, unitPrice: watched?.[i]?.unitPrice ?? '0' })}
          render={(i) => {
            const e = err.items?.[i]
            const productId = watched?.[i]?.productId
            const product = products.data?.find((p) => p.id === productId)
            return (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <Field id={`gp-${i}`} label="Catalogue product" className="sm:col-span-2" hint={product?.track_stock ? `${product.stock_quantity} in stock` : undefined}>
                  <Select id={`gp-${i}`} value={productId ?? ''} onChange={(ev) => pick(i, ev.target.value)}>
                    <option value="">Custom item (not in catalogue)</option>
                    {active.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.track_stock && p.stock_quantity <= 0 && p.id !== productId}>
                        {p.name} — {formatLKR(toCents(p.unit_price))}
                        {p.track_stock ? ` (${p.stock_quantity} in stock)` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`gn-${i}`} label="Item name" required error={e?.productName?.message} className="sm:col-span-2">
                  <Input {...fieldAria(`gn-${i}`, e?.productName?.message)} {...register(`items.${i}.productName`)} />
                </Field>
                <Field id={`gq-${i}`} label="Quantity" required error={e?.quantity?.message}>
                  <Input {...fieldAria(`gq-${i}`, e?.quantity?.message)} type="number" inputMode="numeric" min={1} {...register(`items.${i}.quantity`)} />
                </Field>
                <Field id={`gu-${i}`} label="Unit price" required error={e?.unitPrice?.message}>
                  <MoneyInput {...fieldAria(`gu-${i}`, e?.unitPrice?.message)} {...register(`items.${i}.unitPrice`)} />
                </Field>
              </div>
            )
          }}
        />
      </FormSection>

      <FormSection title="Delivery & notes">
        <Field id="deliveryCharge" label="Delivery charge" error={err.deliveryCharge?.message}>
          <MoneyInput {...fieldAria('deliveryCharge', err.deliveryCharge?.message)} {...register('deliveryCharge')} />
        </Field>
        <Field id="notes" label="Notes" error={err.notes?.message}>
          <Textarea {...fieldAria('notes', err.notes?.message)} rows={3} {...register('notes')} />
        </Field>
      </FormSection>
    </FormPage>
  )
}

export function GiftOrderDetailPage() {
  const { id } = useParams()
  const order = useGiftOrder(id)
  const doc = useReceivable(id)
  const settings = useSettings()
  const o = order.data
  const outstanding = toCents(doc.data?.outstanding)
  const requireFull = settings.data?.gift_require_full_payment_before_delivery ?? true

  const actions = o && (
    <>
      {o.status === 'new' && <StatusAction type="gift_order" id={o.id} to="processing" icon={<Hammer />}>Start processing</StatusAction>}
      {(o.status === 'new' || o.status === 'processing') && (
        <StatusAction type="gift_order" id={o.id} to="ready" variant="outline" icon={<PackageCheck />}>Mark ready</StatusAction>
      )}
      {['new', 'processing', 'ready'].includes(o.status) &&
        (requireFull && outstanding > 0 ? (
          <p className="text-sm text-warning-text">Collect the remaining {formatLKR(outstanding)} before delivery.</p>
        ) : (
          <StatusAction type="gift_order" id={o.id} to="delivered" variant="income" icon={<CheckCircle2 />}>Mark delivered</StatusAction>
        ))}
      {o.status === 'delivered' &&
        (outstanding > 0 ? (
          <p className="text-sm text-warning-text">Delivered — {formatLKR(outstanding)} still to collect before completing.</p>
        ) : (
          <StatusAction type="gift_order" id={o.id} to="completed" icon={<Lock />}>Complete order</StatusAction>
        ))}
    </>
  )

  return (
    <DocumentDetailFrame
      type="gift_order"
      doc={doc.data}
      loading={order.isLoading || doc.isLoading}
      error={order.error ?? doc.error}
      onRetry={() => void Promise.all([order.refetch(), doc.refetch()])}
      customer={o?.customer ?? null}
      subtitle={o ? `Ordered ${formatDisplayDate(o.order_date)}${o.expected_delivery_date ? ` · Delivery ${formatDisplayDate(o.expected_delivery_date)}` : ''}` : ''}
      editable={!!o && ['new', 'processing', 'ready'].includes(o.status)}
      actions={actions}
      details={
        o && (
          <SectionCard title="Products" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">
                      {i.product_name}
                      {!i.product_id && <span className="ml-2 text-xs font-normal text-muted-foreground">(custom)</span>}
                    </TableCell>
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
                  { label: 'Products subtotal', value: formatLKR(toCents(o.subtotal)) },
                  { label: 'Delivery charge', value: formatLKR(toCents(o.delivery_charge)) },
                  { label: 'Stock', value: o.stock_deducted ? 'Deducted from inventory' : 'Not yet deducted' },
                  { label: 'Delivered on', value: formatDisplayDate(o.delivered_on), hidden: !o.delivered_on },
                  { label: 'Notes', value: o.notes, hidden: !o.notes },
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
