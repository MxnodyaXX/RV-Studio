import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, MessageCircle, Pencil, Phone, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { DetailList, Pagination, PaymentBadge, SearchBox, SectionCard, Stat, StatusBadge } from '@/components/shared'
import { CustomerDialog } from '@/components/customers/CustomerForm'
import { whatsappLink } from '@/components/documents/DocumentDetail'
import { useCustomer, useCustomers, useDocuments } from '@/hooks/queries'
import { PAGE_SIZE, SOURCE_META, documentPath } from '@/lib/constants'
import { formatDateTime, formatDisplayDate } from '@/lib/dates'
import { formatLKR, toCents } from '@/lib/money'
import type { SourceType } from '@/types/domain'

export function CustomersPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(params.get('new') === '1')
  const search = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const q = useCustomers(search, page)
  const set = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k))
      return next
    }, { replace: true })

  return (
    <div>
      <PageHeader
        title="Customers"
        description="One customer profile, reused across all four businesses."
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus /> New customer
          </Button>
        }
      />
      <Card className="mb-4 p-4">
        <SearchBox value={search} onChange={(v) => set({ q: v || null, page: null })} placeholder="Search by name, phone, WhatsApp, email or CUS-ID" />
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
        ) : !q.data?.rows.length ? (
          <EmptyState
            icon={Users}
            title={search ? 'No matching customers' : 'No customers yet'}
            description={search ? 'Try a different name or phone number.' : 'Customers are added here or while creating a booking or order.'}
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Add customer
              </Button>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>WhatsApp</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data.rows.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/customers/${c.id}`)}>
                      <TableCell>
                        <p className="font-medium">{c.full_name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{c.ref}</p>
                      </TableCell>
                      <TableCell>{c.phone ?? '—'}</TableCell>
                      <TableCell>{c.whatsapp ?? '—'}</TableCell>
                      <TableCell className="max-w-48 truncate">{c.email ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDisplayDate(c.created_at)}</TableCell>
                      <TableCell>
                        <ChevronRight className="size-4 text-muted-foreground/50" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="divide-y divide-border md:hidden">
              {q.data.rows.map((c) => (
                <li key={c.id}>
                  <Link to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-muted">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tile text-xs font-semibold text-tile-foreground">
                      {c.full_name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.full_name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {c.ref}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground/50" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Pagination page={page} total={q.data?.total ?? 0} pageSize={PAGE_SIZE} onPage={(p) => set({ page: String(p) })} busy={q.isFetching} />
      </Card>
      <CustomerDialog open={adding} onOpenChange={setAdding} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </div>
  )
}

export function CustomerDetailPage() {
  const { id } = useParams()
  const customer = useCustomer(id)
  const docs = useDocuments({ customerId: id, sort: 'newest' }, 1, 100)
  const [editing, setEditing] = useState(false)
  const c = customer.data

  if (customer.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />
  if (customer.error) return <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
  if (!c) return <EmptyState icon={Users} title="Customer not found" action={<Button asChild><Link to="/customers">All customers</Link></Button>} />

  const rows = docs.data?.rows ?? []
  const open = rows.filter((r) => !r.is_closed)
  const totalSpent = rows.reduce((s, r) => s + toCents(r.net_paid), 0)
  const owed = rows.filter((r) => !r.is_cancelled).reduce((s, r) => s + Math.max(toCents(r.outstanding), 0), 0)
  const wa = whatsappLink(c.whatsapp || c.phone)

  return (
    <div>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader
        title={c.full_name}
        description={`${c.ref} · Customer since ${formatDisplayDate(c.created_at)}`}
        actions={
          <>
            {c.phone && (
              <Button asChild variant="outline" size="sm">
                <a href={`tel:${c.phone.replace(/\s/g, '')}`}>
                  <Phone /> Call
                </a>
              </Button>
            )}
            {wa && (
              <Button asChild variant="outline" size="sm">
                <a href={wa} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Button>
            )}
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Total paid" value={formatLKR(totalSpent)} tone="income" />
            <Stat label="Outstanding" value={formatLKR(owed)} tone={owed ? 'expense' : 'muted'} />
            <Stat label="Open records" value={open.length} />
          </div>
          <SectionCard title="Bookings, orders & rentals" description="Across all four businesses" bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
            {docs.isLoading ? (
              <Skeleton className="m-5 h-24" />
            ) : !rows.length ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No bookings, orders or rentals yet.</p>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {rows.map((r) => (
                  <li key={r.source_id}>
                    <Link to={documentPath(r.source_type as SourceType, r.source_id!)} className="flex items-center gap-3 px-5 py-3 hover:bg-subtle sm:px-6">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          <span className="font-mono">{r.ref}</span> · {SOURCE_META[r.source_type as SourceType].label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.title} · {formatDateTime(r.created_at)}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <StatusBadge type={r.source_type as SourceType} status={r.status!} />
                          <PaymentBadge status={r.payment_status} overdue={r.is_overdue} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <p className="tabular font-semibold">{formatLKR(toCents(r.amount_due))}</p>
                        {toCents(r.outstanding) > 0 && <p className="tabular text-xs text-expense-text">Due {formatLKR(toCents(r.outstanding))}</p>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
        <SectionCard title="Contact details">
          <DetailList
            className="sm:grid-cols-1"
            items={[
              { label: 'Phone', value: c.phone },
              { label: 'WhatsApp', value: c.whatsapp },
              { label: 'Email', value: c.email },
              { label: 'Address', value: c.address },
              { label: 'Notes', value: c.notes },
            ]}
          />
        </SectionCard>
      </div>
      <CustomerDialog open={editing} onOpenChange={setEditing} customer={c} onSaved={() => void customer.refetch()} />
    </div>
  )
}
