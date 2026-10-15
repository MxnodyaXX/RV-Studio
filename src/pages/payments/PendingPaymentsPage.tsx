import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CircleDollarSign, Clock, FilterX, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/form-controls'
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { Pagination, PaymentBadge, SearchBox, Stat } from '@/components/shared'
import { BusinessSelect } from '@/components/dashboard/FilterBar'
import { RecordPaymentDialog } from '@/components/documents/MoneyDialogs'
import { whatsappLink } from '@/components/documents/DocumentDetail'
import { useBusinesses, useDocuments, useSummary } from '@/hooks/queries'
import { PAGE_SIZE, SOURCE_META, documentPath } from '@/lib/constants'
import { formatDisplayDate } from '@/lib/dates'
import { consolidate, toSummaryCents } from '@/lib/finance'
import { formatLKR, toCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { DocumentFilters } from '@/services/documents'
import type { Receivable, SourceType } from '@/types/domain'

export default function PendingPaymentsPage() {
  const [params, setParams] = useSearchParams()
  const businesses = useBusinesses()
  const [paying, setPaying] = useState<Receivable | null>(null)
  const search = params.get('q') ?? ''
  const businessId = params.get('business') || null
  const dueBy = params.get('due') ?? ''
  const status = params.get('status') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const set = (patch: Record<string, string | null>, resetPage = true) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k))
      if (resetPage) next.delete('page')
      return next
    }, { replace: true })

  const filters: DocumentFilters = useMemo(
    () => ({
      search,
      businessId,
      outstandingOnly: true,
      overdueOnly: status === 'overdue',
      paymentStatus: status && status !== 'overdue' ? status : null,
      to: dueBy || null,
      dateField: 'due_date',
      sort: 'due_asc',
    }),
    [search, businessId, status, dueBy],
  )
  const q = useDocuments(filters, page, PAGE_SIZE)
  const totals = useSummary({ from: null, to: null })
  const all = consolidate((totals.data ?? []).filter((r) => !businessId || r.business_id === businessId).map(toSummaryCents))
  const bizName = (id: string | null) => businesses.data?.find((b) => b.id === id)?.name ?? '—'
  const rows = q.data?.rows ?? []

  return (
    <div>
      <PageHeader title="Pending Payments" description="Every unpaid balance across the four businesses, oldest due first." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total outstanding" value={formatLKR(all.outstanding)} tone="expense" />
        <Stat label="Overdue" value={formatLKR(all.overdue)} tone={all.overdue ? 'expense' : 'muted'} />
        <Stat label="Deposits held (liability)" value={formatLKR(all.depositsHeld)} tone="warning" />
        <Stat label="Records with balance" value={q.data?.total ?? '—'} />
      </div>
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <SearchBox value={search} onChange={(v) => set({ q: v || null })} placeholder="Search customer, phone or ID" className="md:col-span-2 xl:col-span-1" />
          <BusinessSelect businesses={businesses.data ?? []} value={businessId} onChange={(v) => set({ business: v })} />
          <Select aria-label="Payment status" value={status} onChange={(e) => set({ status: e.target.value || null })}>
            <option value="">All unpaid</option>
            <option value="overdue">Overdue only</option>
            <option value="unpaid">Nothing paid yet</option>
            <option value="partially_paid">Partly paid</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="shrink-0">Due by</span>
            <Input type="date" value={dueBy} onChange={(e) => set({ due: e.target.value || null })} aria-label="Due by date" />
          </label>
        </div>
      </Card>
      <Card className="overflow-hidden">
        {q.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !rows.length ? (
          search || businessId || status || dueBy ? (
            <EmptyState icon={FilterX} title="Nothing matches these filters" action={<Button variant="outline" size="sm" onClick={() => setParams(new URLSearchParams())}>Clear filters</Button>} />
          ) : (
            <EmptyState icon={CircleDollarSign} title="No pending payments" description="Every booking, order and rental is fully paid." />
          )
        ) : (
          <>
            <div className="hidden xl:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const wa = whatsappLink(r.customer_whatsapp || r.customer_phone)
                    return (
                      <TableRow key={r.source_id}>
                        <TableCell className="font-medium">{r.customer_name ?? 'Walk-in'}</TableCell>
                        <TableCell className="whitespace-nowrap">{bizName(r.business_id)}</TableCell>
                        <TableCell>
                          <Link to={documentPath(r.source_type as SourceType, r.source_id!)} className="font-mono text-xs font-semibold text-accent hover:underline">
                            {r.ref}
                          </Link>
                          <p className="text-xs text-muted-foreground">{SOURCE_META[r.source_type as SourceType].label}</p>
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap text-right">{formatLKR(toCents(r.amount_due))}</TableCell>
                        <TableCell className="tabular whitespace-nowrap text-right text-income-text">{formatLKR(toCents(r.net_paid))}</TableCell>
                        <TableCell className="tabular whitespace-nowrap text-right font-semibold text-expense-text">{formatLKR(toCents(r.outstanding))}</TableCell>
                        <TableCell className={cn('whitespace-nowrap', r.is_overdue && 'font-medium text-expense-text')}>{formatDisplayDate(r.due_date)}</TableCell>
                        <TableCell>
                          <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.customer_phone ? <a href={`tel:${r.customer_phone.replace(/\s/g, '')}`} className="hover:underline">{r.customer_phone}</a> : '—'}
                          {wa && (
                            <a href={wa} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex text-income-text" aria-label="WhatsApp">
                              <MessageCircle className="size-4" />
                            </a>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="income" onClick={() => setPaying(r)}>
                            Record payment
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border xl:hidden">
              {rows.map((r) => (
                <li key={r.source_id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={documentPath(r.source_type as SourceType, r.source_id!)} className="min-w-0">
                      <p className="truncate text-sm font-semibold">{r.customer_name ?? 'Walk-in'}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{r.ref}</span> · {bizName(r.business_id)}
                      </p>
                    </Link>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm font-semibold text-expense-text">{formatLKR(toCents(r.outstanding))}</p>
                      <p className="tabular text-xs text-muted-foreground">of {formatLKR(toCents(r.amount_due))}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {formatDisplayDate(r.due_date)}
                      </span>
                    </div>
                    <Button size="sm" variant="income" onClick={() => setPaying(r)}>
                      Record payment
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination page={page} total={q.data?.total ?? 0} pageSize={PAGE_SIZE} onPage={(p) => set({ page: String(p) }, false)} busy={q.isFetching} />
      </Card>
      {paying && <RecordPaymentDialog doc={paying} open onOpenChange={(o) => !o && setPaying(null)} />}
    </div>
  )
}
