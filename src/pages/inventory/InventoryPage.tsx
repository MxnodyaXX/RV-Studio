import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { AlertTriangle, Boxes, Camera, History, Loader2, PackagePlus, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { EmptyState, ErrorState, PageHeader } from '@/components/common'
import { MoneyInput, Tabs, ToneBadge } from '@/components/shared'
import { useEquipment, useMovements, useProducts } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { recordStockMovement, saveEquipment, saveProduct } from '@/services/operations'
import { formatDateTime } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { formatLKR, toCents } from '@/lib/money'
import {
  equipmentSchema,
  productSchema,
  stockMovementSchema,
  type EquipmentValues,
  type ProductValues,
  type StockMovementValues,
} from '@/lib/validation'
import type { CameraEquipment, GiftProduct } from '@/types/domain'

function FormDialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && children}
      </DialogContent>
    </Dialog>
  )
}

function Actions({ busy, onCancel, label }: { busy: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />} {label}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gift products
// ---------------------------------------------------------------------------
function ProductForm({ product, onDone }: { product: GiftProduct | null; onDone: () => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<ProductValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: product?.sku ?? '', name: product?.name ?? '', description: product?.description ?? '',
      unitPrice: product ? Number(product.unit_price).toFixed(2) : '', costPrice: product?.cost_price != null ? Number(product.cost_price).toFixed(2) : '',
      trackStock: product?.track_stock ?? true, reorderLevel: product?.reorder_level ?? 0, isActive: product?.is_active ?? true,
    },
  })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await saveProduct(v, product?.id)
      await invalidate()
      toast.success(product ? 'Product updated' : 'Product added')
      onDone()
    } catch (e) {
      toast.error('Product not saved', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[1fr_140px]">
        <Field id="p-name" label="Product name" required error={err.name?.message}>
          <Input {...fieldAria('p-name', err.name?.message)} {...form.register('name')} />
        </Field>
        <Field id="p-sku" label="SKU" error={err.sku?.message}>
          <Input {...fieldAria('p-sku', err.sku?.message)} {...form.register('sku')} />
        </Field>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field id="p-price" label="Selling price" required error={err.unitPrice?.message}>
          <MoneyInput {...fieldAria('p-price', err.unitPrice?.message)} {...form.register('unitPrice')} />
        </Field>
        <Field id="p-cost" label="Cost price" error={err.costPrice?.message} hint="For margin tracking">
          <MoneyInput {...fieldAria('p-cost', err.costPrice?.message)} {...form.register('costPrice')} />
        </Field>
      </div>
      <Field id="p-desc" label="Description" error={err.description?.message}>
        <Textarea {...fieldAria('p-desc', err.description?.message)} rows={2} {...form.register('description')} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field id="p-reorder" label="Low-stock alert at" error={err.reorderLevel?.message}>
          <Input {...fieldAria('p-reorder', err.reorderLevel?.message)} type="number" min={0} inputMode="numeric" {...form.register('reorderLevel')} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" {...form.register('trackStock')} /> Track stock</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" {...form.register('isActive')} /> Available for sale</label>
        </div>
      </div>
      <Actions busy={form.formState.isSubmitting} onCancel={onDone} label={product ? 'Save product' : 'Add product'} />
    </form>
  )
}

function StockForm({ product, onDone }: { product: GiftProduct; onDone: () => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<StockMovementValues>({ resolver: zodResolver(stockMovementSchema), defaultValues: { reason: 'purchase', direction: 'in', quantity: 1, unitCost: '', note: '' } })
  const err = form.formState.errors
  const reason = form.watch('reason')
  const submit = form.handleSubmit(async (v) => {
    try {
      await recordStockMovement(product.id, { ...v, direction: v.reason === 'purchase' || v.reason === 'return' ? 'in' : v.reason === 'damage' ? 'out' : v.direction })
      await invalidate()
      toast.success('Stock updated')
      onDone()
    } catch (e) {
      toast.error('Stock not updated', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="rounded-lg bg-subtle p-3 text-sm">Current stock: <strong>{product.stock_quantity}</strong></p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field id="s-reason" label="Reason">
          <Select id="s-reason" {...form.register('reason')}>
            <option value="purchase">Purchase / restock (+)</option>
            <option value="return">Customer return (+)</option>
            <option value="damage">Damaged / lost (−)</option>
            <option value="adjustment">Stock count adjustment (±)</option>
          </Select>
        </Field>
        {reason === 'adjustment' && (
          <Field id="s-dir" label="Direction">
            <Select id="s-dir" {...form.register('direction')}>
              <option value="in">Add (+)</option>
              <option value="out">Remove (−)</option>
            </Select>
          </Field>
        )}
        <Field id="s-qty" label="Quantity" required error={err.quantity?.message}>
          <Input {...fieldAria('s-qty', err.quantity?.message)} type="number" min={1} inputMode="numeric" {...form.register('quantity')} />
        </Field>
        {reason === 'purchase' && (
          <Field id="s-cost" label="Unit cost" error={err.unitCost?.message} hint="Record the purchase itself under Add Expense">
            <MoneyInput {...fieldAria('s-cost', err.unitCost?.message)} {...form.register('unitCost')} />
          </Field>
        )}
      </div>
      <Field id="s-note" label="Note" error={err.note?.message}>
        <Input {...fieldAria('s-note', err.note?.message)} {...form.register('note')} />
      </Field>
      <Actions busy={form.formState.isSubmitting} onCancel={onDone} label="Update stock" />
    </form>
  )
}

const REASON_LABEL: Record<string, string> = { purchase: 'Purchase', sale: 'Sale', sale_reversal: 'Sale reversed', adjustment: 'Adjustment', return: 'Return', damage: 'Damage' }

function ProductsTab() {
  const products = useProducts()
  const [editing, setEditing] = useState<GiftProduct | 'new' | null>(null)
  const [stocking, setStocking] = useState<GiftProduct | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const movements = useMovements(historyFor)

  if (products.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />
  if (products.error) return <ErrorState error={products.error} onRetry={() => void products.refetch()} />
  const rows = products.data ?? []
  const low = rows.filter((p) => p.is_active && p.track_stock && p.stock_quantity <= p.reorder_level)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {low.length > 0 ? (
          <p className="flex items-center gap-2 text-sm text-warning-text"><AlertTriangle className="size-4" /> {low.length} product{low.length === 1 ? '' : 's'} at or below the low-stock level</p>
        ) : <span />}
        <Button onClick={() => setEditing('new')}><Plus /> Add product</Button>
      </div>
      <Card className="overflow-hidden">
        {!rows.length ? (
          <EmptyState icon={Boxes} title="No products yet" description="Add the gifts Gift Park sells to pick them in orders and track stock." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Cost</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const isLow = p.track_stock && p.stock_quantity <= p.reorder_level
                return (
                  <TableRow key={p.id} className={!p.is_active ? 'opacity-60' : undefined}>
                    <TableCell>
                      <p className="font-medium">{p.name} {!p.is_active && <ToneBadge tone="neutral">Inactive</ToneBadge>}</p>
                      <p className="text-xs text-muted-foreground">{p.sku ?? 'No SKU'}</p>
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right">{formatLKR(toCents(p.unit_price))}</TableCell>
                    <TableCell className="tabular hidden whitespace-nowrap text-right text-muted-foreground sm:table-cell">{p.cost_price != null ? formatLKR(toCents(p.cost_price)) : '—'}</TableCell>
                    <TableCell className="text-right">
                      {p.track_stock ? <ToneBadge tone={p.stock_quantity <= 0 ? 'danger' : isLow ? 'warning' : 'success'}>{p.stock_quantity}</ToneBadge> : <span className="text-xs text-muted-foreground">Not tracked</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {p.track_stock && <Button size="icon-sm" variant="ghost" aria-label={`Adjust stock of ${p.name}`} onClick={() => setStocking(p)}><PackagePlus /></Button>}
                        <Button size="icon-sm" variant="ghost" aria-label={`Stock history of ${p.name}`} onClick={() => setHistoryFor(p.id)}><History /></Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
      <FormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Add product' : 'Edit product'}>
        <ProductForm product={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      </FormDialog>
      <FormDialog open={!!stocking} onOpenChange={(o) => !o && setStocking(null)} title={`Stock — ${stocking?.name ?? ''}`} description="Every change is kept in the stock history.">
        {stocking && <StockForm product={stocking} onDone={() => setStocking(null)} />}
      </FormDialog>
      <FormDialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)} title="Stock history">
        {movements.isLoading ? <Skeleton className="h-32" /> : !movements.data?.length ? <p className="text-sm text-muted-foreground">No movements yet.</p> : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {movements.data.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{REASON_LABEL[m.reason] ?? m.reason}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(m.moved_at)}{m.note ? ` · ${m.note}` : ''}</p>
                </div>
                <span className={m.quantity > 0 ? 'font-semibold text-income-text' : 'font-semibold text-expense-text'}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </FormDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Camera equipment
// ---------------------------------------------------------------------------
function EquipmentForm({ item, onDone }: { item: CameraEquipment | null; onDone: () => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<EquipmentValues>({
    resolver: zodResolver(equipmentSchema),
    defaultValues: {
      name: item?.name ?? '', category: item?.category ?? 'Camera', brand: item?.brand ?? '', model: item?.model ?? '',
      serialNumber: item?.serial_number ?? '', dailyRate: item ? Number(item.daily_rate).toFixed(2) : '',
      defaultDeposit: item ? Number(item.default_deposit).toFixed(2) : '', includedAccessories: item?.included_accessories ?? '',
      status: item?.status ?? 'available', conditionNotes: item?.condition_notes ?? '',
    },
  })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await saveEquipment(v, item?.id)
      await invalidate()
      toast.success(item ? 'Equipment updated' : 'Equipment added')
      onDone()
    } catch (e) {
      toast.error('Equipment not saved', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field id="e-name" label="Name" required error={err.name?.message}>
          <Input {...fieldAria('e-name', err.name?.message)} placeholder="e.g. Sony A7 IV" {...form.register('name')} />
        </Field>
        <Field id="e-cat" label="Category" required error={err.category?.message}>
          <Input {...fieldAria('e-cat', err.category?.message)} list="eq-cats" {...form.register('category')} />
          <datalist id="eq-cats">{['Camera', 'Lens', 'Lighting', 'Drone', 'Tripod', 'Audio', 'Accessory'].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field id="e-brand" label="Brand" error={err.brand?.message}><Input id="e-brand" {...form.register('brand')} /></Field>
        <Field id="e-model" label="Model" error={err.model?.message}><Input id="e-model" {...form.register('model')} /></Field>
        <Field id="e-serial" label="Serial number" required error={err.serialNumber?.message}>
          <Input {...fieldAria('e-serial', err.serialNumber?.message)} {...form.register('serialNumber')} />
        </Field>
        <Field id="e-status" label="Status">
          <Select id="e-status" {...form.register('status')}>
            <option value="available">Available for rent</option>
            <option value="maintenance">In maintenance</option>
            <option value="retired">Retired</option>
          </Select>
        </Field>
        <Field id="e-rate" label="Daily rate" required error={err.dailyRate?.message}>
          <MoneyInput {...fieldAria('e-rate', err.dailyRate?.message)} {...form.register('dailyRate')} />
        </Field>
        <Field id="e-dep" label="Default security deposit" error={err.defaultDeposit?.message}>
          <MoneyInput {...fieldAria('e-dep', err.defaultDeposit?.message)} {...form.register('defaultDeposit')} />
        </Field>
      </div>
      <Field id="e-acc" label="Included accessories" error={err.includedAccessories?.message}>
        <Input id="e-acc" placeholder="Battery ×2, charger, strap, cap" {...form.register('includedAccessories')} />
      </Field>
      <Field id="e-cond" label="Condition notes" error={err.conditionNotes?.message}>
        <Textarea id="e-cond" rows={2} {...form.register('conditionNotes')} />
      </Field>
      <Actions busy={form.formState.isSubmitting} onCancel={onDone} label={item ? 'Save' : 'Add equipment'} />
    </form>
  )
}

function EquipmentTab() {
  const equipment = useEquipment()
  const [editing, setEditing] = useState<CameraEquipment | 'new' | null>(null)
  if (equipment.isLoading) return <Skeleton className="h-64 w-full rounded-xl" />
  if (equipment.error) return <ErrorState error={equipment.error} onRetry={() => void equipment.refetch()} />
  const rows = equipment.data ?? []
  const tone = { available: 'success', maintenance: 'warning', retired: 'neutral' } as const
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setEditing('new')}><Plus /> Add equipment</Button>
      </div>
      <Card className="overflow-hidden">
        {!rows.length ? (
          <EmptyState icon={Camera} title="No equipment yet" description="Add cameras, lenses and accessories available for rent." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Equipment</TableHead>
                <TableHead className="hidden md:table-cell">Serial</TableHead>
                <TableHead className="text-right">Daily rate</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Deposit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <p className="font-medium">{e.name}</p>
                    <p className="text-xs text-muted-foreground">{e.ref} · {e.category}{e.brand ? ` · ${e.brand}` : ''}</p>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{e.serial_number}</TableCell>
                  <TableCell className="tabular whitespace-nowrap text-right">{formatLKR(toCents(e.daily_rate))}</TableCell>
                  <TableCell className="tabular hidden whitespace-nowrap text-right text-muted-foreground sm:table-cell">{formatLKR(toCents(e.default_deposit))}</TableCell>
                  <TableCell><ToneBadge tone={tone[e.status]}>{e.status === 'available' ? 'Available' : e.status === 'maintenance' ? 'Maintenance' : 'Retired'}</ToneBadge></TableCell>
                  <TableCell>
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e)}><Pencil /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      <FormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Add equipment' : 'Edit equipment'} description="Availability for specific dates is checked when booking a rental.">
        <EquipmentForm item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
      </FormDialog>
    </div>
  )
}

export default function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'equipment' ? 'equipment' : 'products'
  return (
    <div>
      <PageHeader title="Inventory" description="Gift Park stock and RV Camera Rent equipment." />
      <Tabs
        className="mb-6 w-fit"
        value={tab}
        onChange={(t) => setParams(t === 'equipment' ? { tab: t } : {}, { replace: true })}
        tabs={[
          { value: 'products', label: 'Gift Park products' },
          { value: 'equipment', label: 'Camera equipment' },
        ]}
      />
      {tab === 'equipment' ? <EquipmentTab /> : <ProductsTab />}
    </div>
  )
}
