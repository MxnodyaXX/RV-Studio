import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download, FilterX, Loader2, MinusCircle, MoreHorizontal, PlusCircle, Receipt, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/form-controls'
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { Pagination, SearchBox, ToneBadge } from '@/components/shared'
import { BusinessSelect, DateRangeFilter, RangeCaption } from '@/components/dashboard/FilterBar'
import { VoidEntryDialog } from '@/components/documents/MoneyDialogs'
import { useBusinesses, useLedger } from '@/hooks/queries'
import { useFinanceFilters } from '@/hooks/useDateRangeFilter'
import { exportLedger, type LedgerFilters } from '@/services/finance'
import { ledgerKindOf, type LedgerKind } from '@/services/documents'
import { CSV_EXPORT_LIMIT, PAGE_SIZE, PAYMENT_METHOD_LABELS, documentPath } from '@/lib/constants'
import { businessToday, formatDisplayDate } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { formatLKR, toCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { downloadCsv, toCsv } from '@/utils/csv'
import type { LedgerEntry, MoneyMethod, SourceType } from '@/types/domain'

const TYPES: { value: string; label: string; tone: 'success' | 'danger' | 'warning' | 'info' }[] = [
  { value: 'payment', label: 'Payment', tone: 'success' },
  { value: 'deposit_received', label: 'Deposit received', tone: 'info' },
  { value: 'refund', label: 'Refund', tone: 'warning' },
  { value: 'deposit_returned', label: 'Deposit returned', tone: 'info' },
  { value: 'expense', label: 'Expense', tone: 'danger' },
]
const TYPE_META = Object.fromEntries(TYPES.map((t) => [t.value, t]))

export default function TransactionHistoryPage() {
  const [params, setParams] = useSearchParams()
  const range = useFinanceFilters('all')
  const businesses = useBusinesses()
  const [voiding, setVoiding] = useState<{ kind: LedgerKind; id: string; label: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  const search = params.get('q') ?? ''
  const entryType = params.get('type') || null
  const method = (params.get('method') as MoneyMethod | null) || null
  const includeVoided = params.get('voided') === '1'
  const sort = params.get('sort') === 'oldest' ? 'oldest' : 'newest'
  const page = Math.max(1, Number(params.get('page')) || 1)

  const set = (patch: Record<string, string | null>, resetPage = true) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k))
      if (resetPage) next.delete('page')
      return next
    }, { replace: true })

  const filters: LedgerFilters = useMemo(
    () => ({ search, businessId: range.businessId, entryType, method, from: range.range.from, to: range.range.to, includeVoided, sort }),
    [search, range.businessId, range.range, entryType, method, includeVoided, sort],
  )
  const q = useLedger(filters, page, PAGE_SIZE)
  const rows = q.data?.rows ?? []
  const filtered = !!(search || range.businessId || entryType || method || range.preset !== 'all' || includeVoided)
  const bizName = (id: string | null) => businesses.data?.find((b) => b.id === id)?.name ?? '—'

  const handleExport = async () => {
    setExporting(true)
    try {
      const { rows: all, truncated } = await exportLedger(filters)
      if (!all.length) {
        toast.info('There is nothing to export for these filters.')
        return
      }
      const csv = toCsv(
        ['Date', 'Transaction ID', 'Business', 'Type', 'Related record', 'Category', 'Description', 'Reference', 'Payment Method', 'Amount (LKR)', 'Signed Amount (LKR)', 'Voided'],
        all.map((e) => {
          const amount = (toCents(e.amount) / 100).toFixed(2)
          return [
            formatDisplayDate(e.entry_date), e.ref, bizName(e.business_id), TYPE_META[e.entry_type ?? '']?.label ?? e.entry_type,
            e.source_ref ?? '', e.category_name ?? '', e.description ?? '', e.reference ?? '', PAYMENT_METHOD_LABELS[e.method!] ?? e.method,
            amount, e.direction === 'in' ? amount : `-${amount}`, e.is_voided ? `Yes: ${e.void_reason}` : '',
          ]
        }),
      )
      downloadCsv(`rv-transactions-${businessToday()}.csv`, csv)
      toast.success(`Exported ${all.length} transactions`, { description: truncated ? `Limited to ${CSV_EXPORT_LIMIT.toLocaleString()} rows.` : undefined })
    } catch (err) {
      toast.error('Export failed', { description: toUserMessage(err) })
    } finally {
      setExporting(false)
    }
  }

  const Actions = ({ e }: { e: LedgerEntry }) => {
    const kind = ledgerKindOf(e.entry_type ?? '')
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${e.ref}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {kind !== 'expense' && (
            <DropdownMenuItem onSelect={() => window.open(`/receipts/${kind}/${e.id}`, '_blank', 'noopener')}>
              <Receipt /> View receipt
            </DropdownMenuItem>
          )}
          {e.source_id && (
            <DropdownMenuItem asChild>
              <Link to={documentPath(e.source_type as SourceType, e.source_id)}>Open {e.source_ref}</Link>
            </DropdownMenuItem>
          )}
          {!e.is_voided && (
            <DropdownMenuItem className="text-destructive [&_svg]:text-destructive" onSelect={() => setVoiding({ kind, id: e.id!, label: e.ref! })}>
              <RotateCcw /> Void entry
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div>
      <PageHeader
        title="Transaction History"
        description="Every payment, deposit, refund and expense across all businesses. Corrections are made by voiding — nothing is deleted."
        actions={
          <>
            <Button variant="outline" onClick={() => void handleExport()} disabled={exporting || q.isLoading}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />} Export CSV
            </Button>
            <Button asChild variant="outline" className="hidden sm:inline-flex">
              <Link to="/transactions/expense/new">
                <MinusCircle className="text-expense-text" /> Expense
              </Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link to="/transactions/income/new">
                <PlusCircle /> Income
              </Link>
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <SearchBox value={search} onChange={(v) => set({ q: v || null })} placeholder="Search ID, record, description, reference" className="md:col-span-2 xl:col-span-1" />
          <BusinessSelect businesses={businesses.data ?? []} value={range.businessId} onChange={range.setBusinessId} />
          <Select aria-label="Type" value={entryType ?? ''} onChange={(e) => set({ type: e.target.value || null })}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select aria-label="Payment method" value={method ?? ''} onChange={(e) => set({ method: e.target.value || null })}>
            <option value="">All methods</option>
            {(['cash', 'card', 'bank_transfer', 'deposit'] as const).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </Select>
          <Select aria-label="Sort order" value={sort} onChange={(e) => set({ sort: e.target.value === 'oldest' ? 'oldest' : null })}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </Select>
        </div>
        <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3 lg:flex-row lg:items-start lg:justify-between">
          <DateRangeFilter preset={range.preset} customFrom={range.customFrom} customTo={range.customTo} onPresetChange={range.setPreset} onCustomApply={range.setCustomRange} />
          <div className="flex flex-wrap items-center justify-between gap-3 lg:flex-col lg:items-end">
            <RangeCaption range={range.range} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={includeVoided} onChange={(e) => set({ voided: e.target.checked ? '1' : null })} />
              Show voided entries
            </label>
            {filtered && (
              <Button variant="ghost" size="sm" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                <FilterX /> Clear filters
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm sm:px-5">
          <p className="text-muted-foreground" aria-live="polite">
            {q.isLoading ? 'Loading…' : `${(q.data?.total ?? 0).toLocaleString()} entries`}
          </p>
          {q.isFetching && !q.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Refreshing" />}
        </div>
        {q.isLoading ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !rows.length ? (
          <EmptyState
            icon={filtered ? FilterX : Receipt}
            title={filtered ? 'No matching transactions' : 'No transactions recorded yet'}
            description={filtered ? 'Try a different search, business, type or date range.' : 'Payments, refunds and expenses will appear here.'}
          />
        ) : (
          <>
            <div className="hidden xl:block [&_td]:px-3 [&_td]:text-[13px] [&_th]:px-3">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Date</TableHead>
                    <TableHead>Transaction ID</TableHead>
                    <TableHead>Business</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Record / category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((e) => {
                    const t = TYPE_META[e.entry_type ?? '']
                    const isIn = e.direction === 'in'
                    return (
                      <TableRow key={e.id} className={cn('border-l-2', isIn ? 'border-l-income' : 'border-l-expense', e.is_voided && 'opacity-55')}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatDisplayDate(e.entry_date)}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{e.ref}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{bizName(e.business_id)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <ToneBadge tone={t?.tone ?? 'neutral'}>{t?.label ?? e.entry_type}</ToneBadge>
                            {e.is_voided && <ToneBadge tone="neutral">Void</ToneBadge>}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {e.source_ref ? (
                            <Link to={documentPath(e.source_type as SourceType, e.source_id!)} className="font-mono text-xs font-semibold text-accent hover:underline">
                              {e.source_ref}
                            </Link>
                          ) : (
                            e.category_name ?? '—'
                          )}
                          {e.source_ref && e.category_name && <span className="block text-xs text-muted-foreground">{e.category_name}</span>}
                        </TableCell>
                        <TableCell className="max-w-56">
                          <p className="truncate" title={e.description ?? undefined}>{e.description || '—'}</p>
                          {e.reference && <p className="truncate text-xs text-muted-foreground">Ref: {e.reference}</p>}
                          {e.is_voided && e.void_reason && <p className="truncate text-xs text-muted-foreground">Void: {e.void_reason}</p>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{PAYMENT_METHOD_LABELS[e.method!] ?? e.method}</TableCell>
                        <TableCell className={cn('tabular whitespace-nowrap text-right font-semibold', e.is_voided ? 'line-through' : isIn ? 'text-income-text' : 'text-expense-text')}>
                          {isIn ? '+' : '−'}
                          {formatLKR(toCents(e.amount))}
                        </TableCell>
                        <TableCell>
                          <Actions e={e} />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border xl:hidden">
              {rows.map((e) => {
                const t = TYPE_META[e.entry_type ?? '']
                const isIn = e.direction === 'in'
                return (
                  <li key={e.id} className={cn('flex gap-3 border-l-2 py-3.5 pl-4 pr-2', isIn ? 'border-l-income' : 'border-l-expense', e.is_voided && 'opacity-55')}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="truncate text-sm font-medium">{e.category_name ?? e.source_ref ?? t?.label}</p>
                        <span className={cn('tabular shrink-0 text-sm font-semibold', e.is_voided ? 'line-through' : isIn ? 'text-income-text' : 'text-expense-text')}>
                          {isIn ? '+' : '−'}
                          {formatLKR(toCents(e.amount))}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {bizName(e.business_id)} · {formatDisplayDate(e.entry_date)} · {PAYMENT_METHOD_LABELS[e.method!]}
                      </p>
                      {e.description && <p className="mt-1 truncate text-xs text-muted-foreground">{e.description}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <ToneBadge tone={t?.tone ?? 'neutral'}>{t?.label ?? e.entry_type}</ToneBadge>
                        {e.is_voided && <ToneBadge tone="neutral">Void</ToneBadge>}
                        <span className="font-mono text-[11px] text-muted-foreground">{e.ref}</span>
                      </div>
                    </div>
                    <Actions e={e} />
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <Pagination page={page} total={q.data?.total ?? 0} pageSize={PAGE_SIZE} onPage={(p) => set({ page: String(p) }, false)} busy={q.isFetching} />
      </Card>
      <VoidEntryDialog entry={voiding} onClose={() => setVoiding(null)} />
    </div>
  )
}
