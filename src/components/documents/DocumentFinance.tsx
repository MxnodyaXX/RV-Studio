import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Bell, CircleDollarSign, MinusCircle, MoreHorizontal, Percent, Receipt, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays'
import { EmptyState, ErrorState } from '@/components/common'
import { PaymentBadge, SectionCard, Stat, ToneBadge } from '@/components/shared'
import { useSourceLedger, useSourceReminders } from '@/hooks/queries'
import { ledgerKindOf, type LedgerKind } from '@/services/documents'
import { PAYMENT_METHOD_LABELS } from '@/lib/constants'
import { formatDateTime, formatDisplayDate } from '@/lib/dates'
import { formatLKR, toCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { AdjustmentDialog, LinkedExpenseDialog, RecordPaymentDialog, RefundDialog, VoidEntryDialog } from './MoneyDialogs'
import type { Receivable } from '@/types/domain'

const ENTRY_LABEL: Record<string, string> = {
  payment: 'Payment',
  deposit_received: 'Deposit received',
  refund: 'Refund',
  deposit_returned: 'Deposit returned',
  expense: 'Expense',
}

/** Balance, money actions and the full money history for one booking/order/rental. */
export function DocumentFinance({ doc, open }: { doc: Receivable; open: boolean }) {
  const [dialog, setDialog] = useState<null | 'payment' | 'deposit' | 'refund' | 'deposit_return' | 'adjust' | 'expense'>(null)
  const [voiding, setVoiding] = useState<{ kind: LedgerKind; id: string; label: string } | null>(null)
  const ledger = useSourceLedger(doc.source_id ?? undefined)
  const isRental = doc.source_type === 'camera_rental'
  const outstanding = toCents(doc.outstanding)
  const depositHeld = toCents(doc.deposit_held)
  const netPaid = toCents(doc.net_paid)
  const adjustments = (ledger.data?.adjustments ?? []).filter((a) => !a.voided_at)

  return (
    <>
      <SectionCard
        title="Payments & balance"
        description={<PaymentBadge status={doc.payment_status} overdue={doc.is_overdue} />}
        actions={
          open && (
            <>
              <Button size="sm" variant="income" onClick={() => setDialog('payment')} disabled={outstanding <= 0 && !isRental}>
                <CircleDollarSign /> Record payment
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="outline" aria-label="More money actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isRental && (
                    <DropdownMenuItem onSelect={() => setDialog('deposit')}>
                      <ArrowDownLeft /> Receive security deposit
                    </DropdownMenuItem>
                  )}
                  {isRental && depositHeld > 0 && (
                    <DropdownMenuItem onSelect={() => setDialog('deposit_return')}>
                      <RotateCcw /> Return deposit
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem disabled={netPaid <= 0} onSelect={() => setDialog('refund')}>
                    <ArrowUpRight /> Refund customer
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('adjust')}>
                    <Percent /> Discount / extra charge
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setDialog('expense')}>
                    <MinusCircle /> Record expense
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Amount due" value={formatLKR(toCents(doc.amount_due))} hint={toCents(doc.adjustments) ? `incl. adjustments ${formatLKR(toCents(doc.adjustments))}` : undefined} />
          <Stat label="Paid" value={formatLKR(netPaid)} tone="income" hint={toCents(doc.charge_refunded) ? `after refunds of ${formatLKR(toCents(doc.charge_refunded))}` : undefined} />
          <Stat label="Outstanding" value={formatLKR(Math.max(outstanding, 0))} tone={outstanding > 0 ? 'expense' : 'muted'} hint={outstanding < 0 ? `Overpaid by ${formatLKR(-outstanding)}` : doc.due_date ? `Due ${formatDisplayDate(doc.due_date)}` : undefined} />
          {isRental ? (
            <Stat label="Deposit held" value={formatLKR(depositHeld)} tone={depositHeld > 0 ? 'warning' : 'muted'} hint={`Required ${formatLKR(toCents(doc.deposit_required))} · not income`} />
          ) : (
            <Stat label="Balance status" value={<PaymentBadge status={doc.payment_status} overdue={doc.is_overdue} />} />
          )}
        </div>

        <div className="mt-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Money history</h4>
          {ledger.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : ledger.error ? (
            <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
          ) : !ledger.data?.entries.length && !adjustments.length ? (
            <EmptyState icon={Receipt} title="No payments yet" description="Record the advance or first payment to get started." className="py-6" />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {ledger.data!.entries.map((e) => {
                const isIn = e.direction === 'in'
                const kind = ledgerKindOf(e.entry_type ?? '')
                return (
                  <li key={e.id} className={cn('flex items-center gap-3 px-3 py-2.5', e.is_voided && 'opacity-55')}>
                    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', isIn ? 'bg-income-soft text-income-text' : 'bg-expense-soft text-expense-text')}>
                      {isIn ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                        {ENTRY_LABEL[e.entry_type ?? ''] ?? e.entry_type}
                        {e.category_name && e.entry_type === 'expense' && <span className="font-normal text-muted-foreground">· {e.category_name}</span>}
                        {e.is_voided && <ToneBadge tone="neutral">Void</ToneBadge>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {e.ref} · {formatDisplayDate(e.entry_date)} · {PAYMENT_METHOD_LABELS[e.method!] ?? e.method}
                        {e.reference ? ` · Ref ${e.reference}` : ''}
                        {e.is_voided && e.void_reason ? ` · Voided: ${e.void_reason}` : ''}
                      </p>
                    </div>
                    <span className={cn('tabular shrink-0 text-sm font-semibold', e.is_voided ? 'line-through' : isIn ? 'text-income-text' : 'text-expense-text')}>
                      {isIn ? '+' : '−'}
                      {formatLKR(toCents(e.amount))}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${e.ref}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {kind !== 'expense' && (
                          <DropdownMenuItem onSelect={() => window.open(`/receipts/${kind}/${e.id}`, '_blank', 'noopener')}>
                            <Receipt /> View receipt
                          </DropdownMenuItem>
                        )}
                        {!e.is_voided && open && (
                          <DropdownMenuItem className="text-destructive [&_svg]:text-destructive" onSelect={() => setVoiding({ kind, id: e.id!, label: e.ref! })}>
                            <RotateCcw /> Void entry
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                )
              })}
              {adjustments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 bg-subtle px-3 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tile text-tile-foreground">
                    <Percent className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium capitalize">{a.kind.replace('_', ' ')}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.ref} · {formatDisplayDate(a.effective_on)} · {a.reason}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-semibold">
                    {a.amount > 0 ? '+' : '−'}
                    {formatLKR(Math.abs(toCents(a.amount)))}
                  </span>
                  {open && (
                    <Button size="icon-sm" variant="ghost" aria-label={`Void ${a.ref}`} onClick={() => setVoiding({ kind: 'adjustment', id: a.id, label: a.ref })}>
                      <RotateCcw />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>

      <RecordPaymentDialog doc={doc} open={dialog === 'payment' || dialog === 'deposit'} initialPurpose={dialog === 'deposit' ? 'deposit' : 'charge'} onOpenChange={(o) => !o && setDialog(null)} key={`pay-${dialog}`} />
      <RefundDialog doc={doc} open={dialog === 'refund' || dialog === 'deposit_return'} initialKind={dialog === 'deposit_return' ? 'deposit_return' : 'charge_refund'} onOpenChange={(o) => !o && setDialog(null)} key={`ref-${dialog}`} />
      <AdjustmentDialog doc={doc} open={dialog === 'adjust'} onOpenChange={(o) => !o && setDialog(null)} />
      <LinkedExpenseDialog doc={doc} open={dialog === 'expense'} onOpenChange={(o) => !o && setDialog(null)} />
      <VoidEntryDialog entry={voiding} onClose={() => setVoiding(null)} />
    </>
  )
}

/** Profit for one job: earned amount due − linked expenses (excluding voided). */
export function JobProfit({ doc }: { doc: Receivable }) {
  const ledger = useSourceLedger(doc.source_id ?? undefined)
  const expenses = (ledger.data?.entries ?? []).filter((e) => e.entry_type === 'expense' && !e.is_voided).reduce((s, e) => s + toCents(e.amount), 0)
  const revenue = toCents(doc.amount_due)
  const profit = revenue - expenses
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
      <Stat label="Revenue" value={formatLKR(revenue)} hint={doc.recognized_on ? `Earned ${formatDisplayDate(doc.recognized_on)}` : 'Earned on completion'} />
      <Stat label="Expenses" value={formatLKR(expenses)} tone={expenses ? 'expense' : 'muted'} />
      <Stat label="Profit" value={formatLKR(profit)} tone={profit < 0 ? 'expense' : 'income'} />
    </div>
  )
}

export function DocumentReminders({ sourceId }: { sourceId: string }) {
  const reminders = useSourceReminders(sourceId)
  const items = (reminders.data ?? []).filter((r) => r.status === 'pending')
  return (
    <SectionCard title="Reminders" description="Created automatically from your reminder settings">
      {reminders.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : !items.length ? (
        <p className="text-sm text-muted-foreground">No upcoming reminders.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="flex items-start gap-3 text-sm">
              <Bell className={cn('mt-0.5 size-4 shrink-0', r.kind === 'rental_overdue' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
              <div className="min-w-0">
                <p className="font-medium">{r.title.split(' – ')[0]}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(r.due_at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
