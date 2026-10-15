import type { ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatLKR } from '@/lib/money'
import { lineTotalCents } from '@/lib/finance'

/** Card-style editable rows that work on phones (no wide tables). */
export function LineItems<T>({
  items,
  onAdd,
  onRemove,
  render,
  lineTotal,
  addLabel,
  error,
}: {
  items: T[]
  onAdd: () => void
  onRemove: (index: number) => void
  render: (index: number) => ReactNode
  lineTotal: (index: number) => { quantity: number | string; unitPrice: string }
  addLabel: string
  error?: string
}) {
  return (
    <div className="space-y-3">
      {items.map((_, i) => {
        const lt = lineTotal(i)
        return (
          <div key={i} className="rounded-lg border border-border bg-subtle p-3 sm:p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Item {i + 1}</span>
              <div className="flex items-center gap-3">
                <span className="tabular text-sm font-semibold">{formatLKR(lineTotalCents(lt.quantity, lt.unitPrice || '0'))}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => onRemove(i)} disabled={items.length === 1} aria-label={`Remove item ${i + 1}`}>
                  <Trash2 />
                </Button>
              </div>
            </div>
            {render(i)}
          </div>
        )
      })}
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      <Button variant="outline" onClick={onAdd} className="w-full">
        <Plus /> {addLabel}
      </Button>
    </div>
  )
}
