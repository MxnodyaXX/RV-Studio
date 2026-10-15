import { useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowUpRight, History, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, fieldAria } from '@/components/ui/form-controls'
import { PageHeader } from '@/components/common'
import { MoneyInput, Tabs } from '@/components/shared'
import { RecentTransactions } from '@/components/transactions/RecentTransactions'
import { useBusinesses, useCategories, useDocuments } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { previewAllocation, recordExpense } from '@/services/finance'
import { categoriesFor } from '@/services/businesses'
import { newRequestId } from '@/services/api'
import { PAYMENT_METHODS, SOURCE_META } from '@/lib/constants'
import { businessToday } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { formatLKR, toCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { expenseSchema, type ExpenseValues } from '@/lib/validation'
import type { SourceType } from '@/types/domain'

export default function AddExpensePage() {
  const [params] = useSearchParams()
  const businesses = useBusinesses()
  const categories = useCategories()
  const invalidate = useInvalidateAll()
  const requestId = useRef(newRequestId())
  const today = businessToday()
  const schema = useMemo(() => expenseSchema(today), [today])

  const blank = (mode: 'single' | 'shared' = 'single', businessId = params.get('business') ?? ''): ExpenseValues => ({
    mode,
    businessId,
    categoryId: '',
    amount: '',
    method: 'cash',
    paidOn: today,
    description: '',
    receiptReference: '',
    sourceKey: '',
    allocationMethod: 'equal',
    allocations: (businesses.data ?? []).map((b) => ({ businessId: b.id, selected: true, percent: '25', amount: '' })),
  })
  const form = useForm<ExpenseValues>({ resolver: zodResolver(schema), defaultValues: blank() })
  const { register, control, setValue, formState } = form
  const err = formState.errors
  const allocations = useFieldArray({ control, name: 'allocations' })
  const values = useWatch({ control }) as ExpenseValues
  const mode = values.mode

  // Populate the allocation rows once businesses load.
  useEffect(() => {
    if (businesses.data && !form.getValues('allocations').length) {
      setValue('allocations', businesses.data.map((b) => ({ businessId: b.id, selected: true, percent: '25', amount: '' })))
    }
  }, [businesses.data, form, setValue])

  const openDocs = useDocuments({ businessId: values.businessId || null, openOnly: true, sort: 'newest' }, 1, 50)
  const categoryOptions = categoriesFor(categories.data ?? [], 'expense', mode === 'shared' ? null : values.businessId || null).filter(
    (c) => mode === 'single' || c.business_id === null,
  )
  const preview = mode === 'shared' && values.allocations ? previewAllocation(values) : []
  const bizName = (id: string) => businesses.data?.find((b) => b.id === id)?.name ?? ''

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const [type, id] = (v.sourceKey ?? '').split(':')
      await recordExpense(v, type && id ? { type: type as SourceType, id } : null, businesses.data ?? [], requestId.current)
      requestId.current = newRequestId()
      await invalidate()
      toast.success(v.mode === 'shared' ? `Shared expense of ${formatLKR(toCents(v.amount))} split across ${v.allocations.filter((a) => a.selected).length} businesses` : `Expense of ${formatLKR(toCents(v.amount))} saved`)
      form.reset({ ...blank(v.mode, v.businessId ?? ''), method: v.method, paidOn: v.paidOn, allocationMethod: v.allocationMethod, allocations: v.allocations })
    } catch (e) {
      toast.error('Expense not saved', { description: toUserMessage(e) })
    }
  })

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-expense-soft px-2.5 py-1 text-xs font-medium text-expense-text">
            <ArrowUpRight className="size-3.5" /> Money out
          </span>
        }
        title="Add Expense"
        description="Every expense belongs to a business. Shared bills are split by an explicit rule so totals are never double-counted."
        actions={
          <Button asChild variant="outline">
            <Link to="/transactions">
              <History /> Transaction history
            </Link>
          </Button>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Expense details</CardTitle>
            <CardDescription>Fields marked * are required.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} noValidate className="space-y-5">
              <Tabs
                className="w-fit"
                value={mode}
                onChange={(m) => {
                  setValue('mode', m)
                  setValue('categoryId', '')
                  setValue('sourceKey', '')
                }}
                tabs={[
                  { value: 'single', label: 'One business' },
                  { value: 'shared', label: 'Shared across businesses' },
                ]}
              />

              {mode === 'single' && (
                <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
                  <Field id="businessId" label="Business" required error={err.businessId?.message}>
                    <Select {...fieldAria('businessId', err.businessId?.message)} {...register('businessId', { onChange: () => { setValue('categoryId', ''); setValue('sourceKey', '') } })}>
                      <option value="">Select a business</option>
                      {(businesses.data ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field id="sourceKey" label="Related booking / order / rental" hint="Optional — links the cost to that job's profit">
                    <Select id="sourceKey" disabled={!values.businessId} {...register('sourceKey')}>
                      <option value="">Not linked</option>
                      {(openDocs.data?.rows ?? []).map((d) => (
                        <option key={d.source_id} value={`${d.source_type}:${d.source_id}`}>
                          {d.ref} · {d.customer_name ?? 'Walk-in'} · {SOURCE_META[d.source_type as SourceType].label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}

              <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
                <Field id="categoryId" label="Expense category" required error={err.categoryId?.message} hint={mode === 'shared' ? 'Only categories shared by all businesses' : undefined}>
                  <Select {...fieldAria('categoryId', err.categoryId?.message)} {...register('categoryId')}>
                    <option value="">Select a category</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id="amount" label={mode === 'shared' ? 'Total amount (LKR)' : 'Amount (LKR)'} required error={err.amount?.message}>
                  <MoneyInput {...fieldAria('amount', err.amount?.message)} {...register('amount')} />
                </Field>
                <Field id="paidOn" label="Expense date" required error={err.paidOn?.message}>
                  <Input {...fieldAria('paidOn', err.paidOn?.message)} type="date" max={today} {...register('paidOn')} />
                </Field>
                <Field id="method" label="Paid by" required error={err.method?.message}>
                  <Select {...fieldAria('method', err.method?.message)} {...register('method')}>
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {mode === 'shared' && (
                <fieldset className="space-y-3 rounded-lg border border-border p-4">
                  <legend className="px-1 text-sm font-semibold">Allocation rule</legend>
                  <Tabs
                    value={values.allocationMethod}
                    onChange={(m) => setValue('allocationMethod', m)}
                    tabs={[
                      { value: 'equal', label: 'Equal split' },
                      { value: 'percentage', label: 'By percentage' },
                      { value: 'fixed', label: 'Fixed amounts' },
                    ]}
                  />
                  <ul className="space-y-2">
                    {allocations.fields.map((f, i) => {
                      const row = values.allocations?.[i]
                      const share = preview.find((p) => p.businessId === f.businessId)
                      return (
                        <li key={f.id} className={cn('flex flex-wrap items-center gap-3 rounded-lg bg-subtle p-3', !row?.selected && 'opacity-60')}>
                          <label className="flex min-w-40 flex-1 items-center gap-2 text-sm font-medium">
                            <input type="checkbox" className="size-4 accent-[var(--color-accent)]" {...register(`allocations.${i}.selected`)} />
                            {bizName(f.businessId)}
                          </label>
                          {values.allocationMethod === 'percentage' && row?.selected && (
                            <div className="relative w-28">
                              <Input inputMode="decimal" className="pr-7 text-right" aria-label={`${bizName(f.businessId)} percent`} {...register(`allocations.${i}.percent`)} />
                              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                            </div>
                          )}
                          {values.allocationMethod === 'fixed' && row?.selected && (
                            <MoneyInput className="w-40" aria-label={`${bizName(f.businessId)} amount`} {...register(`allocations.${i}.amount`)} />
                          )}
                          <span className="tabular w-32 text-right text-sm font-semibold">{row?.selected && share ? formatLKR(share.cents) : '—'}</span>
                        </li>
                      )
                    })}
                  </ul>
                  {err.allocations?.message && <p role="alert" className="text-xs font-medium text-destructive">{err.allocations.message}</p>}
                  {err.allocations?.root?.message && <p role="alert" className="text-xs font-medium text-destructive">{err.allocations.root.message}</p>}
                  <p className="text-xs text-muted-foreground">Each business’s share is recorded as its own expense; rounding goes to the last business so the shares add up exactly.</p>
                </fieldset>
              )}

              <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
                <Field id="description" label="Description" required={mode === 'shared'} error={err.description?.message}>
                  <Input {...fieldAria('description', err.description?.message)} {...register('description')} />
                </Field>
                <Field id="receiptReference" label="Supplier / receipt reference" error={err.receiptReference?.message}>
                  <Input {...fieldAria('receiptReference', err.receiptReference?.message)} {...register('receiptReference')} />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button type="submit" variant="expense" size="lg" className="w-full sm:w-auto sm:min-w-40" disabled={formState.isSubmitting}>
                  {formState.isSubmitting && <Loader2 className="animate-spin" />}
                  Save expense
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
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
