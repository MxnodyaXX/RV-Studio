import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowDownLeft, History, Loader2, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Skeleton } from '@/components/ui/misc'
import { EmptyState, PageHeader } from '@/components/common'
import { MoneyInput, PaymentBadge, SearchBox, Tabs } from '@/components/shared'
import { CustomerPicker } from '@/components/customers/CustomerPicker'
import { RecordPaymentDialog } from '@/components/documents/MoneyDialogs'
import { RecentTransactions } from '@/components/transactions/RecentTransactions'
import { useBusinesses, useCategories, useDocuments } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { recordPayment } from '@/services/documents'
import { categoriesFor } from '@/services/businesses'
import { newRequestId } from '@/services/api'
import { PAYMENT_METHODS, SOURCE_META } from '@/lib/constants'
import { businessToday, formatDisplayDate } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { formatLKR, toCents } from '@/lib/money'
import { directIncomeSchema, type DirectIncomeValues } from '@/lib/validation'
import type { Receivable, SourceType } from '@/types/domain'

function PayExistingRecord() {
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState<Receivable | null>(null)
  const docs = useDocuments({ search, outstandingOnly: true, sort: 'due_asc', dateField: 'due_date' }, 1, 10)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment for a booking, order or rental</CardTitle>
        <CardDescription>Advances, partial and balance payments. The balance updates automatically.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SearchBox value={search} onChange={setSearch} placeholder="Search customer, phone or ID (SB-, FO-, CR-, GO-)" />
        {docs.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !docs.data?.rows.length ? (
          <EmptyState icon={Receipt} title={search ? 'No unpaid records match' : 'Nothing is waiting for payment'} description="Only records with an outstanding balance are listed." className="py-8" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {docs.data.rows.map((r) => (
              <li key={r.source_id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.customer_name ?? 'Walk-in'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{r.ref}</span> · {SOURCE_META[r.source_type as SourceType].label} · due {formatDisplayDate(r.due_date)}
                  </p>
                </div>
                <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                <span className="tabular w-28 text-right text-sm font-semibold text-expense-text">{formatLKR(toCents(r.outstanding))}</span>
                <Button size="sm" variant="income" onClick={() => setPaying(r)}>
                  Record
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {paying && <RecordPaymentDialog doc={paying} open onOpenChange={(o) => !o && setPaying(null)} />}
    </Card>
  )
}

function DirectIncomeForm() {
  const [params] = useSearchParams()
  const businesses = useBusinesses()
  const categories = useCategories()
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const today = businessToday()
  const schema = useMemo(() => directIncomeSchema(today), [today])
  const defaults = (businessId = params.get('business') ?? ''): DirectIncomeValues => ({
    businessId, categoryId: '', customerId: '', amount: '', method: 'cash', paidOn: today, reference: '', notes: '',
  })
  const form = useForm<DirectIncomeValues>({ resolver: zodResolver(schema), defaultValues: defaults() })
  const { register, control, formState } = form
  const err = formState.errors
  const businessId = useWatch({ control, name: 'businessId' })
  const options = categoriesFor(categories.data ?? [], 'income', businessId || null)

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const res = await recordPayment({
        businessId: v.businessId, categoryId: v.categoryId, customerId: v.customerId, purpose: 'charge',
        amount: v.amount, method: v.method, paidOn: v.paidOn, reference: v.reference, notes: v.notes, requestId: requestId.current,
      })
      requestId.current = newRequestId()
      await invalidate()
      if (res.duplicate) toast.info('This income was already saved — no duplicate created.')
      else
        toast.success(`Income of ${formatLKR(toCents(v.amount))} saved`, {
          description: businesses.data?.find((b) => b.id === v.businessId)?.name,
          action: { label: 'Receipt', onClick: () => window.open(`/receipts/payment/${res.id}`, '_blank', 'noopener') },
        })
      form.reset({ ...defaults(v.businessId), method: v.method, paidOn: v.paidOn })
      form.setFocus('amount')
    } catch (e) {
      toast.error('Income not saved', { description: toUserMessage(e) })
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct sale / other income</CardTitle>
        <CardDescription>Walk-in sales and income not linked to a booking or order. Earned on the date received.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
            <Field id="businessId" label="Business" required error={err.businessId?.message}>
              <Select {...fieldAria('businessId', err.businessId?.message)} {...register('businessId')}>
                <option value="">Select a business</option>
                {(businesses.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="categoryId" label="Income category" required error={err.categoryId?.message}>
              <Select {...fieldAria('categoryId', err.categoryId?.message)} {...register('categoryId')}>
                <option value="">Select a category</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="amount" label="Amount (LKR)" required error={err.amount?.message}>
              <MoneyInput {...fieldAria('amount', err.amount?.message)} {...register('amount')} />
            </Field>
            <Field id="paidOn" label="Date received" required error={err.paidOn?.message}>
              <Input {...fieldAria('paidOn', err.paidOn?.message)} type="date" max={today} {...register('paidOn')} />
            </Field>
            <Field id="method" label="Payment method" required error={err.method?.message}>
              <Select {...fieldAria('method', err.method?.message)} {...register('method')}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="reference" label="Reference" error={err.reference?.message}>
              <Input {...fieldAria('reference', err.reference?.message)} placeholder="Invoice or slip number" {...register('reference')} />
            </Field>
          </div>
          <Field id="customer" label="Customer" hint="Optional">
            <Controller control={control} name="customerId" render={({ field }) => <CustomerPicker id="customer" optional value={field.value ?? ''} onChange={field.onChange} />} />
          </Field>
          <Field id="notes" label="Description" error={err.notes?.message}>
            <Textarea {...fieldAria('notes', err.notes?.message)} rows={2} {...register('notes')} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="income" size="lg" className="w-full sm:w-auto sm:min-w-40" disabled={formState.isSubmitting}>
              {formState.isSubmitting && <Loader2 className="animate-spin" />}
              Save income
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export default function AddIncomePage() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'direct' ? 'direct' : 'record'
  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-income-soft px-2.5 py-1 text-xs font-medium text-income-text">
            <ArrowDownLeft className="size-3.5" /> Money in
          </span>
        }
        title="Add Income"
        description="Record a customer payment or a direct sale."
        actions={
          <Button asChild variant="outline">
            <Link to="/transactions">
              <History /> Transaction history
            </Link>
          </Button>
        }
      />
      <Tabs
        className="mb-6 w-fit"
        value={mode}
        onChange={(m) => setParams(m === 'direct' ? { mode: 'direct' } : {}, { replace: true })}
        tabs={[
          { value: 'record', label: 'Payment for booking / order / rental' },
          { value: 'direct', label: 'Direct sale / other income' },
        ]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">{mode === 'direct' ? <DirectIncomeForm /> : <PayExistingRecord />}</div>
        <Card className="h-fit overflow-hidden">
          <CardHeader>
            <CardTitle>Recently recorded</CardTitle>
          </CardHeader>
          <RecentTransactions businessId={null} limit={6} />
        </Card>
      </div>
    </div>
  )
}
