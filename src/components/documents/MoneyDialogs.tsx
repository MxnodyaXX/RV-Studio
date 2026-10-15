import { useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { MoneyInput } from '@/components/shared'
import { useCategories } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { cancelDocument, recordAdjustment, recordPayment, recordRefund, voidEntry, type LedgerKind } from '@/services/documents'
import { recordExpense } from '@/services/finance'
import { newRequestId } from '@/services/api'
import { categoriesFor } from '@/services/businesses'
import { PAYMENT_METHODS, SOURCE_META } from '@/lib/constants'
import { businessToday } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { formatLKR, toCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  adjustmentSchema,
  cancelSchema,
  expenseSchema,
  paymentSchema,
  reasonSchema,
  refundSchema,
  type AdjustmentValues,
  type CancelValues,
  type ExpenseValues,
  type PaymentValues,
  type RefundValues,
} from '@/lib/validation'
import type { Receivable, SourceType } from '@/types/domain'

type DialogProps = { doc: Receivable; open: boolean; onOpenChange: (open: boolean) => void }

function cents(v: number | null | undefined) {
  return toCents(v ?? 0)
}

function Shell({ open, onOpenChange, title, description, busy, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; busy?: boolean; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && children}
      </DialogContent>
    </Dialog>
  )
}

function Footer({ busy, onCancel, label, variant = 'default' }: { busy: boolean; onCancel: () => void; label: string; variant?: 'default' | 'income' | 'destructive' }) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button type="submit" variant={variant} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        {label}
      </Button>
    </div>
  )
}

function ChoiceGroup<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint?: string; disabled?: boolean }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2', options.length > 2 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            value === o.value ? 'border-accent bg-accent-soft font-medium text-accent-text ring-2 ring-accent/20' : 'border-border bg-card hover:bg-muted',
          )}
        >
          {o.label}
          {o.hint && <span className="block text-[11px] font-normal text-muted-foreground">{o.hint}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------
export function RecordPaymentDialog({ doc, open, onOpenChange, initialPurpose = 'charge' }: DialogProps & { initialPurpose?: 'charge' | 'deposit' }) {
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const isRental = doc.source_type === 'camera_rental'
  const outstanding = Math.max(cents(doc.outstanding), 0)
  const depositHeld = cents(doc.deposit_held)
  const depositDue = Math.max(cents(doc.deposit_required) - cents(doc.deposit_received) + cents(doc.deposit_returned), 0)

  const defaults = (purpose: 'charge' | 'deposit'): PaymentValues => ({
    purpose,
    method: 'cash',
    amount: purpose === 'deposit' ? (depositDue ? (depositDue / 100).toFixed(2) : '') : outstanding ? (outstanding / 100).toFixed(2) : '',
    paidOn: businessToday(),
    reference: '',
    notes: '',
  })

  const form = useForm<PaymentValues>({ defaultValues: defaults(initialPurpose) })
  const purpose = useWatch({ control: form.control, name: 'purpose' })
  const method = useWatch({ control: form.control, name: 'method' })
  const max = purpose === 'charge' ? (method === 'deposit' ? Math.min(outstanding, depositHeld) : outstanding) : null
  const schema = useMemo(() => paymentSchema(max), [max])

  const submit = form.handleSubmit(async (values) => {
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) form.setError(issue.path[0] as keyof PaymentValues, { message: issue.message })
      return
    }
    try {
      const res = await recordPayment({
        sourceType: doc.source_type as SourceType,
        sourceId: doc.source_id!,
        purpose: values.purpose,
        amount: values.amount,
        method: values.method,
        paidOn: values.paidOn,
        reference: values.reference,
        notes: values.notes,
        requestId: requestId.current,
      })
      requestId.current = newRequestId()
      await invalidate()
      if (res.duplicate) toast.info('This payment was already recorded — no duplicate was created.')
      else
        toast.success(`${values.purpose === 'deposit' ? 'Deposit' : 'Payment'} of ${formatLKR(toCents(values.amount))} recorded`, {
          description: res.confirmed ? 'The advance was received — booking confirmed and shoot date reserved.' : res.ref,
          action: { label: 'Receipt', onClick: () => window.open(`/receipts/payment/${res.id}`, '_blank', 'noopener') },
        })
      onOpenChange(false)
      form.reset(defaults('charge'))
    } catch (err) {
      toast.error('Payment not recorded', { description: toUserMessage(err) })
    }
  })

  const busy = form.formState.isSubmitting
  const err = form.formState.errors

  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title="Record payment" description={`${doc.ref} · ${doc.customer_name ?? 'Walk-in customer'} · Outstanding ${formatLKR(outstanding)}`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {isRental && (
          <ChoiceGroup
            label="Payment purpose"
            value={purpose}
            onChange={(p) => form.reset({ ...defaults(p), method: p === 'deposit' && method === 'deposit' ? 'cash' : method })}
            options={[
              { value: 'charge', label: 'Rental charges', hint: 'Advance or balance' },
              { value: 'deposit', label: 'Security deposit', hint: 'Refundable — not income' },
            ]}
          />
        )}
        <Field id="pay-method" label="Payment method" required error={err.method?.message}>
          <ChoiceGroup
            label="Payment method"
            value={method}
            onChange={(m) => form.setValue('method', m, { shouldDirty: true })}
            options={[
              ...PAYMENT_METHODS.map((m) => ({ value: m.value as PaymentValues['method'], label: m.label })),
              ...(isRental && purpose === 'charge'
                ? [{ value: 'deposit' as const, label: 'From deposit', hint: `${formatLKR(depositHeld)} held`, disabled: depositHeld <= 0 }]
                : []),
            ]}
          />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id="pay-amount" label="Amount (LKR)" required error={err.amount?.message} hint={max !== null ? `Maximum ${formatLKR(max)}` : undefined}>
            <MoneyInput {...fieldAria('pay-amount', err.amount?.message)} {...form.register('amount')} />
          </Field>
          <Field id="pay-date" label="Payment date" required error={err.paidOn?.message}>
            <Input {...fieldAria('pay-date', err.paidOn?.message)} type="date" max={businessToday()} {...form.register('paidOn')} />
          </Field>
        </div>
        <Field id="pay-ref" label="Reference" error={err.reference?.message} hint="Bank reference, card slip or cheque number">
          <Input {...fieldAria('pay-ref', err.reference?.message)} {...form.register('reference')} />
        </Field>
        <Field id="pay-notes" label="Notes" error={err.notes?.message}>
          <Input {...fieldAria('pay-notes', err.notes?.message)} {...form.register('notes')} />
        </Field>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} label="Record payment" variant="income" />
      </form>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Refund / deposit return
// ---------------------------------------------------------------------------
export function RefundDialog({ doc, open, onOpenChange, initialKind = 'charge_refund' }: DialogProps & { initialKind?: 'charge_refund' | 'deposit_return' }) {
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const netPaid = Math.max(cents(doc.net_paid), 0)
  const depositHeld = cents(doc.deposit_held)
  const overpaid = Math.max(-cents(doc.outstanding), 0)

  const form = useForm<RefundValues>({
    defaultValues: {
      kind: initialKind,
      amount: initialKind === 'deposit_return' && depositHeld ? (depositHeld / 100).toFixed(2) : overpaid ? (overpaid / 100).toFixed(2) : '',
      method: 'cash',
      reason: initialKind === 'deposit_return' ? 'Security deposit returned' : '',
      reduceAmountDue: overpaid === 0,
    },
  })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const max = kind === 'deposit_return' ? depositHeld : netPaid
  const schema = useMemo(() => refundSchema(max), [max])
  const method = useWatch({ control: form.control, name: 'method' })

  const submit = form.handleSubmit(async (values) => {
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) form.setError(issue.path[0] as keyof RefundValues, { message: issue.message })
      return
    }
    try {
      await recordRefund({ sourceType: doc.source_type as SourceType, sourceId: doc.source_id!, ...values, requestId: requestId.current })
      requestId.current = newRequestId()
      await invalidate()
      toast.success(values.kind === 'deposit_return' ? 'Deposit return recorded' : 'Refund recorded')
      onOpenChange(false)
    } catch (err) {
      toast.error('Refund not recorded', { description: toUserMessage(err) })
    }
  })

  const busy = form.formState.isSubmitting
  const err = form.formState.errors
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title={kind === 'deposit_return' ? 'Return deposit' : 'Refund customer'} description={`${doc.ref} · Paid ${formatLKR(netPaid)}${depositHeld ? ` · Deposit held ${formatLKR(depositHeld)}` : ''}`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {doc.source_type === 'camera_rental' && (
          <ChoiceGroup
            label="Refund type"
            value={kind}
            onChange={(k) => form.setValue('kind', k)}
            options={[
              { value: 'charge_refund', label: 'Refund charges', disabled: netPaid <= 0 },
              { value: 'deposit_return', label: 'Return deposit', disabled: depositHeld <= 0 },
            ]}
          />
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id="rf-amount" label="Amount (LKR)" required error={err.amount?.message} hint={`Maximum ${formatLKR(max)}`}>
            <MoneyInput {...fieldAria('rf-amount', err.amount?.message)} {...form.register('amount')} />
          </Field>
          <Field id="rf-method" label="Paid back by" required error={err.method?.message}>
            <Select id="rf-method" value={method} onChange={(e) => form.setValue('method', e.target.value as RefundValues['method'])}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field id="rf-reason" label="Reason" required error={err.reason?.message}>
          <Textarea {...fieldAria('rf-reason', err.reason?.message)} rows={2} {...form.register('reason')} />
        </Field>
        {kind === 'charge_refund' && (
          <label className="flex items-start gap-3 rounded-lg border border-border bg-subtle p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...form.register('reduceAmountDue')} />
            <span>
              <span className="font-medium">Reduce the amount due by this refund</span>
              <span className="block text-xs text-muted-foreground">
                Tick for discounts or service issues. {overpaid > 0 ? `Refunding the ${formatLKR(overpaid)} overpayment never changes the amount due.` : 'Untick only if the customer must pay this amount again later.'}
              </span>
            </span>
          </label>
        )}
        <Footer busy={busy} onCancel={() => onOpenChange(false)} label={kind === 'deposit_return' ? 'Record deposit return' : 'Record refund'} />
      </form>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Adjustment (discount / surcharge / write-off)
// ---------------------------------------------------------------------------
export function AdjustmentDialog({ doc, open, onOpenChange }: DialogProps) {
  const invalidate = useInvalidateAll()
  const form = useForm<AdjustmentValues>({ resolver: zodResolver(adjustmentSchema), defaultValues: { kind: 'discount', amount: '', reason: '' } })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const submit = form.handleSubmit(async (v) => {
    try {
      await recordAdjustment(doc.source_type as SourceType, doc.source_id!, v.kind, v.amount, v.reason)
      await invalidate()
      toast.success('Adjustment recorded')
      onOpenChange(false)
    } catch (err) {
      toast.error('Adjustment not recorded', { description: toUserMessage(err) })
    }
  })
  const busy = form.formState.isSubmitting
  const err = form.formState.errors
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title="Adjust amount due" description={`${doc.ref} · Amount due ${formatLKR(cents(doc.amount_due))}. Adjustments are kept in the audit trail.`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ChoiceGroup
          label="Adjustment type"
          value={kind}
          onChange={(k) => form.setValue('kind', k)}
          options={[
            { value: 'discount', label: 'Discount', hint: 'Reduces amount due' },
            { value: 'surcharge', label: 'Extra charge', hint: 'Increases amount due' },
            { value: 'write_off', label: 'Write off', hint: 'Uncollectable balance' },
          ]}
        />
        <Field id="adj-amount" label="Amount (LKR)" required error={err.amount?.message}>
          <MoneyInput {...fieldAria('adj-amount', err.amount?.message)} {...form.register('amount')} />
        </Field>
        <Field id="adj-reason" label="Reason" required error={err.reason?.message}>
          <Textarea {...fieldAria('adj-reason', err.reason?.message)} rows={2} {...form.register('reason')} />
        </Field>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} label="Save adjustment" />
      </form>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Cancel document
// ---------------------------------------------------------------------------
export function CancelDocumentDialog({ doc, open, onOpenChange }: DialogProps) {
  const invalidate = useInvalidateAll()
  const netPaid = Math.max(cents(doc.net_paid), 0)
  const depositHeld = cents(doc.deposit_held)
  const schema = useMemo(() => cancelSchema(netPaid, depositHeld), [netPaid, depositHeld])
  const form = useForm<CancelValues>({ resolver: zodResolver(schema), defaultValues: { reason: '', refundAmount: '', refundMethod: depositHeld ? 'cash' : '' } })
  const refund = useWatch({ control: form.control, name: 'refundAmount' })
  const retained = netPaid - toCents(refund || '0')
  const noun = SOURCE_META[doc.source_type as SourceType].noun

  const submit = form.handleSubmit(async (v) => {
    try {
      await cancelDocument(doc.source_type as SourceType, doc.source_id!, v.reason, v.refundAmount || '0', v.refundMethod || null)
      await invalidate()
      toast.success(`${doc.ref} cancelled`)
      onOpenChange(false)
    } catch (err) {
      toast.error(`Could not cancel the ${noun}`, { description: toUserMessage(err) })
    }
  })
  const busy = form.formState.isSubmitting
  const err = form.formState.errors
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title={`Cancel ${noun}`} description={`${doc.ref} · ${doc.customer_name ?? 'Walk-in'} · Paid ${formatLKR(netPaid)}`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="cx-reason" label="Cancellation reason" required error={err.reason?.message}>
          <Textarea {...fieldAria('cx-reason', err.reason?.message)} rows={2} {...form.register('reason')} />
        </Field>
        {netPaid > 0 && (
          <Field id="cx-refund" label="Refund to customer (LKR)" error={err.refundAmount?.message} hint={`Up to ${formatLKR(netPaid)}. Anything kept (${formatLKR(Math.max(retained, 0))}) is recorded as cancellation revenue.`}>
            <MoneyInput {...fieldAria('cx-refund', err.refundAmount?.message)} {...form.register('refundAmount')} />
          </Field>
        )}
        {depositHeld > 0 && (
          <p className="rounded-lg border border-warning-ring bg-warning-soft p-3 text-sm text-warning-text">
            The held security deposit of {formatLKR(depositHeld)} will be returned in full.
          </p>
        )}
        {(netPaid > 0 || depositHeld > 0) && (
          <Field id="cx-method" label="Money returned by" error={err.refundMethod?.message}>
            <Select id="cx-method" {...form.register('refundMethod')}>
              <option value="">Select…</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Footer busy={busy} onCancel={() => onOpenChange(false)} label={`Cancel ${noun}`} variant="destructive" />
      </form>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Void a ledger entry
// ---------------------------------------------------------------------------
export function VoidEntryDialog({ entry, onClose }: { entry: { kind: LedgerKind; id: string; label: string } | null; onClose: () => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<{ reason: string }>({ resolver: zodResolver(reasonSchema), defaultValues: { reason: '' } })
  const submit = form.handleSubmit(async (v) => {
    if (!entry) return
    try {
      await voidEntry(entry.kind, entry.id, v.reason)
      await invalidate()
      toast.success(`${entry.label} voided`)
      form.reset()
      onClose()
    } catch (err) {
      toast.error('Could not void the entry', { description: toUserMessage(err) })
    }
  })
  const busy = form.formState.isSubmitting
  return (
    <Shell open={!!entry} onOpenChange={(o) => !o && onClose()} busy={busy} title={`Void ${entry?.label ?? ''}`} description="Voided entries stay in the history (marked void) and stop counting in balances and reports. This cannot be undone.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="void-reason" label="Reason" required error={form.formState.errors.reason?.message}>
          <Textarea {...fieldAria('void-reason', form.formState.errors.reason?.message)} rows={2} placeholder="e.g. Entered twice by mistake" {...form.register('reason')} />
        </Field>
        <Footer busy={busy} onCancel={onClose} label="Void entry" variant="destructive" />
      </form>
    </Shell>
  )
}

// ---------------------------------------------------------------------------
// Expense linked to a booking/order/rental
// ---------------------------------------------------------------------------
export function LinkedExpenseDialog({ doc, open, onOpenChange }: DialogProps) {
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const categories = useCategories()
  const options = categoriesFor(categories.data ?? [], 'expense', doc.business_id)
  const today = businessToday()
  const schema = useMemo(() => expenseSchema(today), [today])
  const form = useForm<ExpenseValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mode: 'single', businessId: doc.business_id ?? '', categoryId: '', amount: '', method: 'cash', paidOn: today,
      description: '', receiptReference: '', sourceKey: `${doc.source_type}:${doc.source_id}`, allocationMethod: 'equal', allocations: [],
    },
  })
  const submit = form.handleSubmit(async (v) => {
    try {
      await recordExpense(v, { type: doc.source_type as SourceType, id: doc.source_id! }, [], requestId.current)
      requestId.current = newRequestId()
      await invalidate()
      toast.success(`Expense of ${formatLKR(toCents(v.amount))} recorded for ${doc.ref}`)
      onOpenChange(false)
      form.reset({ ...form.getValues(), amount: '', description: '', receiptReference: '' })
    } catch (err) {
      toast.error('Expense not recorded', { description: toUserMessage(err) })
    }
  })
  const busy = form.formState.isSubmitting
  const err = form.formState.errors
  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title="Record expense" description={`Linked to ${doc.ref} — counted in this ${SOURCE_META[doc.source_type as SourceType].noun}'s profit.`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="ex-cat" label="Expense category" required error={err.categoryId?.message}>
          <Select {...fieldAria('ex-cat', err.categoryId?.message)} {...form.register('categoryId')}>
            <option value="">Select a category</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field id="ex-amount" label="Amount (LKR)" required error={err.amount?.message}>
            <MoneyInput {...fieldAria('ex-amount', err.amount?.message)} {...form.register('amount')} />
          </Field>
          <Field id="ex-date" label="Date paid" required error={err.paidOn?.message}>
            <Input {...fieldAria('ex-date', err.paidOn?.message)} type="date" max={today} {...form.register('paidOn')} />
          </Field>
        </div>
        <Field id="ex-method" label="Paid by" required error={err.method?.message}>
          <Select {...fieldAria('ex-method', err.method?.message)} {...form.register('method')}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="ex-desc" label="Description" error={err.description?.message}>
          <Input {...fieldAria('ex-desc', err.description?.message)} {...form.register('description')} />
        </Field>
        <Field id="ex-receipt" label="Receipt reference" error={err.receiptReference?.message}>
          <Input {...fieldAria('ex-receipt', err.receiptReference?.message)} {...form.register('receiptReference')} />
        </Field>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} label="Record expense" variant="destructive" />
      </form>
    </Shell>
  )
}

/** Small link to a printable receipt. */
export function ReceiptLink({ kind, id, children }: { kind: 'payment' | 'refund'; id: string; children?: ReactNode }) {
  return (
    <Link to={`/receipts/${kind}/${id}`} target="_blank" rel="noopener" className="text-xs font-medium text-accent hover:underline">
      {children ?? 'Receipt'}
    </Link>
  )
}
