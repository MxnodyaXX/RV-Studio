import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, FilterX, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/form-controls'
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { Pagination, PaymentBadge, SearchBox, StatusBadge } from '@/components/shared'
import { useDocuments } from '@/hooks/queries'
import { PAGE_SIZE, SOURCE_META } from '@/lib/constants'
import { formatDisplayDate } from '@/lib/dates'
import { formatLKR, toCents } from '@/lib/money'
import { PAYMENT_STATUS, STATUS } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { DocumentFilters } from '@/services/documents'
import type { Receivable, SourceType } from '@/types/domain'
import type { LucideIcon } from 'lucide-react'

export function DocumentList({
  type,
  title,
  description,
  icon,
  dateLabel,
  dateField = 'event_date',
  renderWhen,
  newLabel,
}: {
  type: SourceType
  title: string
  description: string
  icon: LucideIcon
  dateLabel: string
  dateField?: 'event_date' | 'due_date'
  renderWhen?: (r: Receivable) => ReactNode
  newLabel: string
}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const meta = SOURCE_META[type]
  const search = params.get('q') ?? ''
  const status = params.get('status') ?? 'open'
  const pay = params.get('pay') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)

  const set = (patch: Record<string, string | null>, resetPage = true) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k))
        if (resetPage) next.delete('page')
        return next
      },
      { replace: true },
    )

  const filters: DocumentFilters = useMemo(
    () => ({
      sourceType: type,
      search,
      status: status === 'open' || status === 'all' ? null : status,
      openOnly: status === 'open',
      paymentStatus: pay === 'overdue' ? null : pay || null,
      overdueOnly: pay === 'overdue',
      sort: status === 'open' ? (dateField === 'event_date' ? 'event_asc' : 'due_asc') : 'newest',
      dateField,
    }),
    [type, search, status, pay, dateField],
  )
  const q = useDocuments(filters, page, PAGE_SIZE)
  const rows = q.data?.rows ?? []
  const filtered = !!search || status !== 'open' || !!pay

  const when = (r: Receivable) =>
    renderWhen ? renderWhen(r) : <span>{formatDisplayDate(dateField === 'due_date' ? r.due_date : r.event_date)}</span>

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button asChild>
            <Link to={`${meta.path}/new`}>
              <Plus /> {newLabel}
            </Link>
          </Button>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <SearchBox value={search} onChange={(v) => set({ q: v || null })} placeholder={`Search ${meta.plural.toLowerCase()} by ID, customer, phone…`} />
          <Select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="open">Open (not closed)</option>
            <option value="all">All statuses</option>
            {Object.entries(STATUS[type]).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Payment status" value={pay} onChange={(e) => set({ pay: e.target.value || null })}>
            <option value="">Any payment status</option>
            <option value="overdue">Overdue</option>
            {Object.entries(PAYMENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
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
          filtered ? (
            <EmptyState
              icon={FilterX}
              title="Nothing matches these filters"
              action={
                <Button variant="outline" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={icon}
              title={`No ${meta.plural.toLowerCase()} yet`}
              description="Records you create will appear here."
              action={
                <Button asChild size="sm">
                  <Link to={`${meta.path}/new`}>{newLabel}</Link>
                </Button>
              }
            />
          )
        ) : (
          <>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>ID</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>{dateLabel}</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.source_id} className="cursor-pointer" onClick={() => navigate(`${meta.path}/${r.source_id}`)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        <Link to={`${meta.path}/${r.source_id}`} className="font-semibold text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                          {r.ref}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-48">
                        <p className="truncate font-medium">{r.customer_name ?? 'Walk-in'}</p>
                        {r.customer_phone && <p className="truncate text-xs text-muted-foreground">{r.customer_phone}</p>}
                      </TableCell>
                      <TableCell className="max-w-64">
                        <p className="truncate text-muted-foreground">{r.title}</p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{when(r)}</TableCell>
                      <TableCell>
                        <StatusBadge type={type} status={r.status!} />
                      </TableCell>
                      <TableCell>
                        <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap text-right">{formatLKR(toCents(r.amount_due))}</TableCell>
                      <TableCell className={cn('tabular whitespace-nowrap text-right font-semibold', toCents(r.outstanding) > 0 ? 'text-expense-text' : 'text-muted-foreground')}>
                        {formatLKR(Math.max(toCents(r.outstanding), 0))}
                      </TableCell>
                      <TableCell>
                        <ChevronRight className="size-4 text-muted-foreground/50" aria-hidden />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border lg:hidden">
              {rows.map((r) => (
                <li key={r.source_id}>
                  <Link to={`${meta.path}/${r.source_id}`} className="block px-4 py-3.5 active:bg-muted">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.customer_name ?? 'Walk-in'}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          <span className="font-mono">{r.ref}</span> · {r.title}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular text-sm font-semibold">{formatLKR(toCents(r.amount_due))}</p>
                        {toCents(r.outstanding) > 0 && <p className="tabular text-xs font-medium text-expense-text">Due {formatLKR(toCents(r.outstanding))}</p>}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge type={type} status={r.status!} />
                      <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                      <span>{when(r)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination page={page} total={q.data?.total ?? 0} pageSize={PAGE_SIZE} onPage={(p) => set({ page: String(p) }, false)} busy={q.isFetching} />
      </Card>
    </div>
  )
}
