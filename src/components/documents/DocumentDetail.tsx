import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Ban, Loader2, MessageCircle, Pencil, Phone } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/misc'
import { EmptyState, ErrorState } from '@/components/common'
import { PaymentBadge, SectionCard, StatusBadge, StatusStepper } from '@/components/shared'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { setDocumentStatus } from '@/services/documents'
import { SOURCE_META } from '@/lib/constants'
import { toUserMessage } from '@/lib/errors'
import { canCancel, isOpen, STATUS, WORKFLOW } from '@/lib/status'
import { CancelDocumentDialog } from './MoneyDialogs'
import { DocumentFinance, DocumentReminders, JobProfit } from './DocumentFinance'
import type { Customer, Receivable, SourceType } from '@/types/domain'
import { FileQuestion } from 'lucide-react'

/** wa.me link for a Sri Lankan number ("077…" → "9477…"). */
export function whatsappLink(phone: string | null | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (digits.startsWith('0')) digits = `94${digits.slice(1)}`
  return digits.length >= 9 ? `https://wa.me/${digits}` : null
}

export function CustomerCard({ customer }: { customer: Customer | null }) {
  if (!customer) {
    return (
      <SectionCard title="Customer">
        <p className="text-sm text-muted-foreground">Walk-in customer (no profile).</p>
      </SectionCard>
    )
  }
  const wa = whatsappLink(customer.whatsapp || customer.phone)
  return (
    <SectionCard title="Customer" actions={<Button asChild size="sm" variant="ghost"><Link to={`/customers/${customer.id}`}>Profile</Link></Button>}>
      <p className="font-semibold">{customer.full_name}</p>
      <p className="text-xs text-muted-foreground">{customer.ref}</p>
      {customer.address && <p className="mt-2 text-sm text-muted-foreground">{customer.address}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {customer.phone && (
          <Button asChild size="sm" variant="outline">
            <a href={`tel:${customer.phone.replace(/\s/g, '')}`}>
              <Phone /> {customer.phone}
            </a>
          </Button>
        )}
        {wa && (
          <Button asChild size="sm" variant="outline">
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> WhatsApp
            </a>
          </Button>
        )}
      </div>
    </SectionCard>
  )
}

/** Button that moves a document to a new status; the database enforces the rules. */
export function StatusAction({ type, id, to, children, variant = 'default', icon }: { type: SourceType; id: string; to: string; children: ReactNode; variant?: 'default' | 'outline' | 'income' | 'accent'; icon?: ReactNode }) {
  const invalidate = useInvalidateAll()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      await setDocumentStatus(type, id, to)
      await invalidate()
      toast.success(`Status changed to ${STATUS[type][to]?.label ?? to}`)
    } catch (err) {
      toast.error('Status not changed', { description: toUserMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant={variant} size="sm" onClick={() => void run()} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : icon}
      {children}
    </Button>
  )
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl lg:col-span-2" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    </div>
  )
}

/**
 * Page frame shared by studio bookings, frame orders, camera rentals and gift orders.
 * The module supplies its own details, workflow actions and extra sections.
 */
export function DocumentDetailFrame({
  type,
  doc,
  loading,
  error,
  onRetry,
  customer,
  subtitle,
  actions,
  details,
  sections,
  editable,
  notice,
}: {
  type: SourceType
  doc: Receivable | null | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  customer: Customer | null
  subtitle: ReactNode
  actions?: ReactNode
  details: ReactNode
  sections?: ReactNode
  editable: boolean
  notice?: ReactNode
}) {
  const [cancelling, setCancelling] = useState(false)
  const meta = SOURCE_META[type]
  if (loading) return <DetailSkeleton />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  if (!doc) {
    return (
      <EmptyState
        icon={FileQuestion}
        title={`${meta.label} not found`}
        description="It may have been removed, or the link is incorrect."
        action={
          <Button asChild>
            <Link to={meta.path}>Back to {meta.plural.toLowerCase()}</Link>
          </Button>
        }
      />
    )
  }
  const status = doc.status!
  const open = isOpen(type, status)
  const steps = WORKFLOW[type].map((k) => ({ key: k, label: STATUS[type][k]!.label }))

  return (
    <div>
      <div className="mb-4">
        <Link to={meta.path} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {meta.plural}
        </Link>
      </div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{doc.ref}</h1>
            <StatusBadge type={type} status={status} />
            <PaymentBadge status={doc.payment_status} overdue={doc.is_overdue} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button asChild variant="outline" size="sm">
              <Link to={`${meta.path}/${doc.source_id}/edit`}>
                <Pencil /> Edit
              </Link>
            </Button>
          )}
          {canCancel(type, status) && (
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={() => setCancelling(true)}>
              <Ban /> Cancel
            </Button>
          )}
        </div>
      </div>

      {status !== 'cancelled' ? (
        <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-card">
          <StatusStepper steps={steps} current={status} />
          {actions && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">{actions}</div>}
        </div>
      ) : (
        <div className="mb-6 rounded-xl border border-expense-ring bg-expense-soft p-4 text-sm text-expense-text">
          This {meta.noun} was cancelled. Any amount kept is recorded as cancellation revenue.
        </div>
      )}
      {notice}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {details}
          <DocumentFinance doc={doc} open={open} />
          {sections}
        </div>
        <div className="space-y-6">
          <CustomerCard customer={customer} />
          <SectionCard title="Job profit" description="Revenue minus expenses linked to this record">
            <JobProfit doc={doc} />
          </SectionCard>
          {open && <DocumentReminders sourceId={doc.source_id!} />}
        </div>
      </div>

      <CancelDocumentDialog doc={doc} open={cancelling} onOpenChange={setCancelling} />
    </div>
  )
}
