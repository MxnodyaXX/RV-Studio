import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/common'

/** Consistent layout for create/edit forms: header, sections, sticky summary and actions. */
export function FormPage({ title, description, backTo, backLabel, children, summary, onSubmit, submitting, submitLabel, eyebrow }: {
  title: string
  description?: string
  backTo: string
  backLabel: string
  children: ReactNode
  summary?: ReactNode
  onSubmit: (e: React.FormEvent) => void
  submitting: boolean
  submitLabel: string
  eyebrow?: ReactNode
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <Link to={backTo} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {backLabel}
      </Link>
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">{children}</div>
        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          {summary}
          <div className="flex flex-col-reverse gap-2 sm:flex-row xl:flex-col">
            <Button asChild variant="outline" className="sm:flex-1 xl:w-full">
              <Link to={backTo}>Cancel</Link>
            </Button>
            <Button type="submit" size="lg" className="sm:flex-1 xl:w-full" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" />}
              {submitting ? 'Saving…' : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-5">{children}</CardContent>
    </Card>
  )
}

export function SummaryCard({ title, rows, total }: { title: string; rows: { label: string; value: string; muted?: boolean }[]; total: { label: string; value: string } }) {
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold">{title}</p>
      <dl className="mt-3 space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3">
            <dt className={r.muted ? 'text-muted-foreground' : ''}>{r.label}</dt>
            <dd className="tabular whitespace-nowrap">{r.value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-semibold">
          <dt>{total.label}</dt>
          <dd className="tabular whitespace-nowrap">{total.value}</dd>
        </div>
      </dl>
    </Card>
  )
}
