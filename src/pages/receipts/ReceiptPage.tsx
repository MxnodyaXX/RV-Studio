import { useParams } from 'react-router-dom'
import { Printer, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'
import { EmptyState, ErrorState } from '@/components/common'
import { useReceipt } from '@/hooks/queries'
import { PAYMENT_METHOD_LABELS, SOURCE_META } from '@/lib/constants'
import { formatDateTime, formatDisplayDate } from '@/lib/dates'
import { exportPdf } from '@/lib/exporters'
import { formatLKR, toCents } from '@/lib/money'
import type { Payment, Refund, SourceType } from '@/types/domain'
import { ReceiptText } from 'lucide-react'

export default function ReceiptPage() {
  const { kind, id } = useParams()
  const k = kind === 'refund' ? 'refund' : 'payment'
  const q = useReceipt(k, id)
  const [busy, setBusy] = useState(false)

  if (q.isLoading) return <div className="mx-auto max-w-xl p-6"><Skeleton className="h-[480px] w-full rounded-xl" /></div>
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data) return <EmptyState icon={ReceiptText} title="Receipt not found" />

  const { entry, business, customer, document, categoryName, footer } = q.data
  const isRefund = k === 'refund'
  const payment = entry as Payment
  const refund = entry as Refund
  const date = isRefund ? refund.refunded_on : payment.paid_on
  const purpose = isRefund
    ? refund.kind === 'deposit_return' ? 'Security deposit returned' : 'Refund'
    : payment.purpose === 'deposit' ? 'Refundable security deposit' : payment.method === 'deposit' ? 'Payment from held deposit' : 'Payment received'
  const voided = !!entry.voided_at
  const title = isRefund ? 'Refund Voucher' : 'Payment Receipt'

  const download = async () => {
    setBusy(true)
    try {
      await exportPdf({
        fileName: `${entry.ref}`,
        title: `${title} ${entry.ref}`,
        subtitle: business?.name ?? '',
        summary: [
          { label: isRefund ? 'Amount refunded' : 'Amount received', value: formatLKR(toCents(entry.amount)) },
          { label: 'Date', value: formatDisplayDate(date) },
          { label: 'Method', value: PAYMENT_METHOD_LABELS[entry.method] },
          { label: 'Customer', value: customer?.full_name ?? 'Walk-in' },
        ],
        tables: [
          {
            title: 'Details',
            columns: [{ header: 'Item' }, { header: 'Value', align: 'right' }],
            rows: [
              ['Receipt no.', entry.ref],
              ['Type', purpose],
              ...(document ? [['For', `${document.ref} — ${document.title}`]] : categoryName ? [['For', categoryName]] : []),
              ...(isRefund ? [['Reason', refund.reason]] : payment.reference ? [['Reference', payment.reference]] : []),
              ...(document ? [['Total amount due', formatLKR(toCents(document.amount_due))], ['Paid to date', formatLKR(toCents(document.net_paid))], ['Balance outstanding', formatLKR(Math.max(toCents(document.outstanding), 0))]] : []),
              ...(voided ? [['Status', `VOID — ${entry.void_reason}`]] : []),
            ] as string[][],
          },
        ],
        footer: footer || undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-background px-4 py-8 print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-xl justify-end gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
        <Button onClick={() => void download()} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />} PDF
        </Button>
      </div>
      <article className="print-area relative mx-auto max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {voided && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="-rotate-12 rounded-lg border-4 border-destructive px-6 py-2 text-5xl font-black tracking-widest text-destructive opacity-30">VOID</span>
          </div>
        )}
        <header className="bg-sidebar px-6 py-5 text-white">
          <p className="text-[11px] font-semibold tracking-[0.2em] opacity-70">RV BUSINESS HUB</p>
          <div className="mt-1 flex items-end justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold">{business?.name}</h1>
              <p className="text-xs opacity-70">{business?.category}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider opacity-70">{title}</p>
              <p className="font-mono text-lg font-semibold">{entry.ref}</p>
            </div>
          </div>
        </header>
        <div className="space-y-5 p-6">
          <div className="flex items-end justify-between gap-4 border-b border-dashed border-border pb-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{purpose}</p>
              <p className="tabular mt-1 text-3xl font-bold">{formatLKR(toCents(entry.amount))}</p>
            </div>
            <div className="text-right text-sm">
              <p className="text-muted-foreground">Date</p>
              <p className="font-medium">{formatDisplayDate(date)}</p>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{isRefund ? 'Paid to' : 'Received from'}</dt>
              <dd className="font-medium">{customer?.full_name ?? 'Walk-in customer'}</dd>
              {customer?.phone && <dd className="text-xs text-muted-foreground">{customer.phone}</dd>}
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Payment method</dt>
              <dd className="font-medium">{PAYMENT_METHOD_LABELS[entry.method]}</dd>
              {!isRefund && payment.reference && <dd className="text-xs text-muted-foreground">Ref {payment.reference}</dd>}
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">For</dt>
              <dd className="font-medium">
                {document ? `${SOURCE_META[document.source_type as SourceType].label} ${document.ref} — ${document.title}` : categoryName ?? '—'}
              </dd>
            </div>
            {isRefund && (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Reason</dt>
                <dd>{refund.reason}</dd>
              </div>
            )}
          </dl>
          {document && (
            <div className="rounded-lg bg-subtle p-4 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Total amount due</span><span className="tabular">{formatLKR(toCents(document.amount_due))}</span></div>
              <div className="mt-1 flex justify-between"><span className="text-muted-foreground">Paid to date</span><span className="tabular">{formatLKR(toCents(document.net_paid))}</span></div>
              <div className="mt-2 flex justify-between border-t border-border pt-2 font-semibold"><span>Balance outstanding</span><span className="tabular">{formatLKR(Math.max(toCents(document.outstanding), 0))}</span></div>
              {toCents(document.deposit_held) > 0 && (
                <div className="mt-1 flex justify-between text-xs text-muted-foreground"><span>Refundable deposit held</span><span className="tabular">{formatLKR(toCents(document.deposit_held))}</span></div>
              )}
            </div>
          )}
          {voided && <p className="rounded-lg bg-expense-soft p-3 text-sm text-expense-text">This entry was voided: {entry.void_reason}</p>}
          <footer className="border-t border-border pt-4 text-center text-xs text-muted-foreground">
            {footer && <p className="mb-1">{footer}</p>}
            <p>Issued {formatDateTime(entry.created_at)} · Amounts in Sri Lankan Rupees</p>
          </footer>
        </div>
      </article>
    </div>
  )
}
