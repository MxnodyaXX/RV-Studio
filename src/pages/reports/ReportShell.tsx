import { useState, type ReactNode } from 'react'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/common'
import { toUserMessage } from '@/lib/errors'
import { exportExcel, exportPdf, type ExportDocument } from '@/lib/exporters'
import { cn } from '@/lib/utils'
import { Info } from 'lucide-react'

export function ReportShell({ title, description, filters, buildExport, children, ready }: {
  title: string
  description: string
  filters: ReactNode
  buildExport: () => Promise<ExportDocument> | ExportDocument
  children: ReactNode
  ready: boolean
}) {
  const [busy, setBusy] = useState<null | 'pdf' | 'xlsx'>(null)
  const run = async (kind: 'pdf' | 'xlsx') => {
    setBusy(kind)
    try {
      const doc = await buildExport()
      await (kind === 'pdf' ? exportPdf(doc) : exportExcel(doc))
      toast.success(`${kind === 'pdf' ? 'PDF' : 'Excel'} report downloaded`)
    } catch (e) {
      toast.error('Export failed', { description: toUserMessage(e) })
    } finally {
      setBusy(null)
    }
  }
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            <Button variant="outline" onClick={() => void run('xlsx')} disabled={!ready || !!busy}>
              {busy === 'xlsx' ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel
            </Button>
            <Button onClick={() => void run('pdf')} disabled={!ready || !!busy}>
              {busy === 'pdf' ? <Loader2 className="animate-spin" /> : <Download />} PDF
            </Button>
          </>
        }
      />
      <Card className="mb-6 p-4">{filters}</Card>
      <div className="space-y-6">{children}</div>
    </div>
  )
}

export function AccountingNote({ className }: { className?: string }) {
  return (
    <p className={cn('flex gap-2 text-xs text-muted-foreground', className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Revenue is <strong>earned</strong> when work is done (shoot completed, frame/gift delivered, camera returned); direct sales on the day received.
        Collections show money actually received. Refundable deposits are liabilities, never income. Net profit = earned revenue − expenses.
      </span>
    </p>
  )
}

/** A simple bordered table for statements (works in print and dark mode). */
export function StatementTable({ head, rows, total, className }: { head: string[]; rows: ReactNode[][]; total?: ReactNode[]; className?: string }) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead className="bg-subtle">
          <tr className="border-b border-border">
            {head.map((h, i) => (
              <th key={h + i} className={cn('h-10 whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground', i === 0 ? 'text-left' : 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-border last:border-0">
              {r.map((c, i) => (
                <td key={i} className={cn('px-4 py-2.5', i === 0 ? 'text-left' : 'tabular whitespace-nowrap text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot>
            <tr className="border-t-2 border-foreground/20 bg-subtle font-semibold">
              {total.map((c, i) => (
                <td key={i} className={cn('px-4 py-3', i === 0 ? 'text-left' : 'tabular whitespace-nowrap text-right')}>
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
