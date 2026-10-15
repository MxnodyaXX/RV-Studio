import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Globe, KeyRound, Loader2, LogOut, Monitor, Moon, Pencil, Plus, ShieldCheck, Sun, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-context'
import { useProfile, useSaveDisplayName } from '@/hooks/useProfile'
import { useBusinesses, useCategories, usePackages, useResources, useSettings } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { updateBusinessProfile } from '@/services/businesses'
import { requestPasswordReset } from '@/services/auth'
import { createCategory, saveSettings, setCategoryActive } from '@/services/settings'
import { savePackage, saveResource } from '@/services/operations'
import { BusinessAvatar, ErrorState, PageHeader } from '@/components/common'
import { MoneyInput, SectionCard, Tabs, ToneBadge } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Badge, Skeleton } from '@/components/ui/misc'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays'
import { BUSINESS_TIMEZONE, CURRENCY } from '@/lib/constants'
import { formatLKR, toCents } from '@/lib/money'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import {
  businessProfileSchema,
  categorySchema,
  packageSchema,
  profileSchema,
  settingsSchema,
  type BusinessProfileValues,
  type CategoryValues,
  type PackageValues,
  type ProfileValues,
  type SettingsValues,
} from '@/lib/validation'
import { toUserMessage } from '@/lib/errors'
import type { Business, StudioPackage, StudioResource, SystemSettings } from '@/types/domain'

function Dlg({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode }) {
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

function SaveRow({ busy, onCancel, label = 'Save', disabled }: { busy: boolean; onCancel?: () => void; label?: string; disabled?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {onCancel && <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>}
      <Button type="submit" disabled={busy || disabled}>{busy && <Loader2 className="animate-spin" />}{label}</Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------
function ProfileCard() {
  const { user } = useAuth()
  const profile = useProfile()
  const save = useSaveDisplayName()
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { displayName: '' } })
  useEffect(() => {
    if (profile.data !== undefined) form.reset({ displayName: profile.data?.display_name ?? '' })
  }, [profile.data, form])
  const submit = form.handleSubmit(async ({ displayName }) => {
    try {
      await save.mutateAsync(displayName)
      toast.success('Display name updated')
    } catch (e) {
      toast.error('Could not update display name', { description: toUserMessage(e) })
    }
  })
  return (
    <SectionCard title={<span className="flex items-center gap-2"><UserRound className="size-4 text-muted-foreground" /> Administrator</span>} description="How your name appears in the dashboard.">
      {profile.isLoading ? <Skeleton className="h-24 w-full" /> : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="displayName" label="Display name" required error={form.formState.errors.displayName?.message}>
            <Input {...fieldAria('displayName', form.formState.errors.displayName?.message)} maxLength={80} {...form.register('displayName')} />
          </Field>
          <div>
            <p className="text-sm font-medium">Sign-in email</p>
            <p className="mt-1.5 rounded-lg border border-dashed border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">{user?.email}</p>
          </div>
          <SaveRow busy={form.formState.isSubmitting} disabled={!form.formState.isDirty} />
        </form>
      )}
    </SectionCard>
  )
}

function AppearanceCard() {
  const { theme, setTheme } = useTheme()
  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ]
  return (
    <SectionCard title="Appearance" description="Saved on this device.">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={theme === o.value} onClick={() => setTheme(o.value)}
            className={cn('flex flex-col items-center gap-1.5 rounded-lg border p-3 text-sm transition-colors', theme === o.value ? 'border-accent bg-accent-soft font-medium text-accent-text' : 'border-border hover:bg-muted')}>
            <o.icon className="size-5" /> {o.label}
          </button>
        ))}
      </div>
    </SectionCard>
  )
}

function RegionalCard() {
  return (
    <SectionCard title={<span className="flex items-center gap-2"><Globe className="size-4 text-muted-foreground" /> Regional settings</span>} description="Fixed for all businesses.">
      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted-foreground">Currency</dt><dd className="font-medium">{CURRENCY} · Sri Lankan Rupee (Rs.)</dd></div>
        <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted-foreground">Timezone</dt><dd className="font-medium">{BUSINESS_TIMEZONE} (UTC+05:30)</dd></div>
        <div className="flex items-center justify-between gap-3 px-4 py-3"><dt className="text-muted-foreground">Date format</dt><dd className="font-medium">DD/MM/YYYY</dd></div>
      </dl>
    </SectionCard>
  )
}

function SecurityCard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState<null | 'reset' | 'out'>(null)
  const reset = async () => {
    if (!user?.email) return
    setBusy('reset')
    try {
      await requestPasswordReset(user.email)
      toast.success('Password reset link sent', { description: `Check ${user.email}.` })
    } catch (e) {
      toast.error(toUserMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const out = async () => {
    setBusy('out')
    await signOut()
    toast.success('You have been signed out securely.')
    navigate('/login', { replace: true })
  }
  return (
    <SectionCard title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /> Security</span>} description="Single-administrator access protected by row-level security.">
      <div className="space-y-3">
        <Button variant="outline" className="w-full justify-start" onClick={() => void reset()} disabled={!!busy}>
          {busy === 'reset' ? <Loader2 className="animate-spin" /> : <KeyRound />} Email me a password reset link
        </Button>
        <Button variant="outline" className="w-full justify-start text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
          <LogOut /> Sign out of this device
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogTitle>Sign out?</AlertDialogTitle>
          <AlertDialogDescription>Your session ends on this device and cached business data is cleared.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'out'}>Cancel</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void out()} disabled={busy === 'out'}>{busy === 'out' && <Loader2 className="animate-spin" />}Sign out</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Rules & reminders
// ---------------------------------------------------------------------------
const list = (a: number[] | null | undefined) => (a ?? []).join(', ')

function RulesForm({ settings }: { settings: SystemSettings }) {
  const invalidate = useInvalidateAll()
  const form = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      studioReminderDays: list(settings.studio_reminder_days),
      frameReminderDays: list(settings.frame_reminder_days),
      giftReminderDays: list(settings.gift_reminder_days),
      paymentDueReminderDays: list(settings.payment_due_reminder_days),
      rentalPickupReminderHours: list(settings.rental_pickup_reminder_hours),
      rentalReturnReminderHours: list(settings.rental_return_reminder_hours),
      defaultAdvancePercent: settings.default_advance_percent,
      lateFeeMultiplier: settings.late_fee_multiplier,
      rentalGraceMinutes: settings.rental_grace_minutes,
      giftRequireFullPayment: settings.gift_require_full_payment_before_delivery,
      giftStockDeduction: settings.gift_stock_deduction as 'on_order' | 'on_delivery',
      receiptFooter: settings.receipt_footer,
    },
  })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await saveSettings(settings.id, v)
      await invalidate()
      toast.success('Settings saved — reminders for open records were rebuilt')
      form.reset(v)
    } catch (e) {
      toast.error('Settings not saved', { description: toUserMessage(e) })
    }
  })
  const offsets = (id: keyof SettingsValues, label: string, hint: string) => (
    <Field id={id} label={label} error={err[id]?.message as string | undefined} hint={hint}>
      <Input {...fieldAria(id, err[id]?.message as string | undefined)} inputMode="numeric" {...form.register(id)} />
    </Field>
  )
  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <SectionCard title="Reminder intervals" description="Comma-separated. Changing them rebuilds reminders for every open booking, order and rental.">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          {offsets('studioReminderDays', 'Studio shoots (days before)', 'e.g. 7, 3, 1, 0 — 0 is the shoot day')}
          {offsets('frameReminderDays', 'Frame completion (days before)', 'e.g. 1, 0')}
          {offsets('giftReminderDays', 'Gift delivery (days before)', 'e.g. 1, 0')}
          {offsets('paymentDueReminderDays', 'Payment due (days before)', 'For records with a balance')}
          {offsets('rentalPickupReminderHours', 'Camera pickup (hours before)', 'e.g. 24, 2')}
          {offsets('rentalReturnReminderHours', 'Camera return (hours before)', 'An overdue alert is always added')}
        </div>
      </SectionCard>
      <SectionCard title="Business rules">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-3">
          <Field id="defaultAdvancePercent" label="Default studio advance (%)" error={err.defaultAdvancePercent?.message}>
            <Input {...fieldAria('defaultAdvancePercent', err.defaultAdvancePercent?.message)} inputMode="decimal" {...form.register('defaultAdvancePercent')} />
          </Field>
          <Field id="lateFeeMultiplier" label="Late fee × daily rate" error={err.lateFeeMultiplier?.message} hint="Per late day">
            <Input {...fieldAria('lateFeeMultiplier', err.lateFeeMultiplier?.message)} inputMode="decimal" {...form.register('lateFeeMultiplier')} />
          </Field>
          <Field id="rentalGraceMinutes" label="Return grace period (minutes)" error={err.rentalGraceMinutes?.message}>
            <Input {...fieldAria('rentalGraceMinutes', err.rentalGraceMinutes?.message)} inputMode="numeric" {...form.register('rentalGraceMinutes')} />
          </Field>
        </div>
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5 sm:grid-cols-2">
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-accent)]" {...form.register('giftRequireFullPayment')} />
            <span><span className="font-medium">Gift Park: require full payment before delivery</span><span className="block text-xs text-muted-foreground">Untick to allow delivery on credit (orders still complete only when paid).</span></span>
          </label>
          <Field id="giftStockDeduction" label="Gift Park: deduct stock">
            <Select id="giftStockDeduction" {...form.register('giftStockDeduction')}>
              <option value="on_order">When the order is saved</option>
              <option value="on_delivery">When the order is delivered</option>
            </Select>
          </Field>
        </div>
        <Field id="receiptFooter" label="Receipt footer" className="mt-5" error={err.receiptFooter?.message}>
          <Textarea {...fieldAria('receiptFooter', err.receiptFooter?.message)} rows={2} {...form.register('receiptFooter')} />
        </Field>
      </SectionCard>
      <SaveRow busy={form.formState.isSubmitting} disabled={!form.formState.isDirty} label="Save settings" />
    </form>
  )
}

function RulesTab() {
  const settings = useSettings()
  if (settings.isLoading) return <Skeleton className="h-96 w-full rounded-xl" />
  if (settings.error || !settings.data) return <ErrorState error={settings.error ?? new Error('Settings not found')} onRetry={() => void settings.refetch()} />
  return <RulesForm key={settings.data.updated_at} settings={settings.data} />
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
function CategoriesTab() {
  const categories = useCategories()
  const businesses = useBusinesses()
  const invalidate = useInvalidateAll()
  const [adding, setAdding] = useState(false)
  const form = useForm<CategoryValues>({ resolver: zodResolver(categorySchema), defaultValues: { name: '', type: 'expense', businessId: '' } })
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setCategoryActive(id, active),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(toUserMessage(e)),
  })
  const submit = form.handleSubmit(async (v) => {
    try {
      await createCategory(v)
      await invalidate()
      toast.success('Category added')
      setAdding(false)
      form.reset()
    } catch (e) {
      toast.error('Category not added', { description: toUserMessage(e) })
    }
  })
  const bizName = (id: string | null) => (id ? businesses.data?.find((b) => b.id === id)?.name : 'All businesses')
  const groups = (['income', 'expense'] as const).map((t) => ({ type: t, rows: (categories.data ?? []).filter((c) => c.type === t) }))
  return (
    <div className="space-y-6">
      <div className="flex justify-end"><Button onClick={() => setAdding(true)}><Plus /> Add category</Button></div>
      {categories.isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          {groups.map((g) => (
            <SectionCard key={g.type} title={g.type === 'income' ? 'Income categories' : 'Expense categories'} description="Inactive categories stay on past records but can't be chosen for new ones.">
              <ul className="divide-y divide-border">
                {g.rows.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className={cn('truncate text-sm font-medium', !c.is_active && 'text-muted-foreground line-through')}>{c.name}</p>
                      <p className="text-xs text-muted-foreground">{bizName(c.business_id)}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: c.id, active: !c.is_active })}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
        </div>
      )}
      <Dlg open={adding} onOpenChange={setAdding} title="Add category">
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="cat-name" label="Name" required error={form.formState.errors.name?.message}>
            <Input {...fieldAria('cat-name', form.formState.errors.name?.message)} {...form.register('name')} />
          </Field>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            <Field id="cat-type" label="Type">
              <Select id="cat-type" {...form.register('type')}><option value="expense">Expense</option><option value="income">Income</option></Select>
            </Field>
            <Field id="cat-biz" label="Business" hint="Shared categories can be used for shared expenses">
              <Select id="cat-biz" {...form.register('businessId')}>
                <option value="">All businesses (shared)</option>
                {(businesses.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </div>
          <SaveRow busy={form.formState.isSubmitting} onCancel={() => setAdding(false)} label="Add category" />
        </form>
      </Dlg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Studio setup
// ---------------------------------------------------------------------------
function PackageForm({ pkg, onDone }: { pkg: StudioPackage | null; onDone: () => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<PackageValues>({
    resolver: zodResolver(packageSchema),
    defaultValues: { name: pkg?.name ?? '', description: pkg?.description ?? '', basePrice: pkg ? Number(pkg.base_price).toFixed(2) : '', durationHours: pkg?.duration_hours ? String(pkg.duration_hours) : '', isActive: pkg?.is_active ?? true },
  })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await savePackage(v, pkg?.id)
      await invalidate()
      toast.success('Package saved')
      onDone()
    } catch (e) {
      toast.error('Package not saved', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field id="pk-name" label="Package name" required error={err.name?.message}><Input {...fieldAria('pk-name', err.name?.message)} {...form.register('name')} /></Field>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field id="pk-price" label="Price" required error={err.basePrice?.message}><MoneyInput {...fieldAria('pk-price', err.basePrice?.message)} {...form.register('basePrice')} /></Field>
        <Field id="pk-hours" label="Duration (hours)" error={err.durationHours?.message}><Input {...fieldAria('pk-hours', err.durationHours?.message)} inputMode="decimal" {...form.register('durationHours')} /></Field>
      </div>
      <Field id="pk-desc" label="What's included" error={err.description?.message}><Textarea {...fieldAria('pk-desc', err.description?.message)} rows={3} {...form.register('description')} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" {...form.register('isActive')} /> Offered for new bookings</label>
      <SaveRow busy={form.formState.isSubmitting} onCancel={onDone} />
    </form>
  )
}

function ResourceForm({ res, onDone }: { res: StudioResource | null; onDone: () => void }) {
  const invalidate = useInvalidateAll()
  const [name, setName] = useState(res?.name ?? '')
  const [kind, setKind] = useState(res?.kind ?? 'photographer')
  const [active, setActive] = useState(res?.is_active ?? true)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return toast.error('Enter a name')
    setBusy(true)
    try {
      await saveResource(name, kind, active, res?.id)
      await invalidate()
      toast.success('Saved')
      onDone()
    } catch (err) {
      toast.error('Not saved', { description: toUserMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="rs-name" label="Name" required><Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
      <Field id="rs-kind" label="Type">
        <Select id="rs-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="photographer">Photographer</option><option value="studio">Studio room</option><option value="equipment">Equipment</option><option value="other">Other</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
      <SaveRow busy={busy} onCancel={onDone} />
    </form>
  )
}

function StudioTab() {
  const packages = usePackages()
  const resources = useResources()
  const [pkg, setPkg] = useState<StudioPackage | 'new' | null>(null)
  const [res, setRes] = useState<StudioResource | 'new' | null>(null)
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <SectionCard title="Photography packages" description="Prefill new bookings" actions={<Button size="sm" onClick={() => setPkg('new')}><Plus /> Add</Button>}>
        {packages.isLoading ? <Skeleton className="h-32" /> : !packages.data?.length ? <p className="text-sm text-muted-foreground">No packages yet.</p> : (
          <ul className="divide-y divide-border">
            {packages.data.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name} {!p.is_active && <ToneBadge tone="neutral">Inactive</ToneBadge>}</p>
                  <p className="truncate text-xs text-muted-foreground">{formatLKR(toCents(p.base_price))}{p.duration_hours ? ` · ${p.duration_hours} h` : ''}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setPkg(p)}><Pencil /></Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Photographers & resources" description="Can't be double-booked for confirmed shoots" actions={<Button size="sm" onClick={() => setRes('new')}><Plus /> Add</Button>}>
        {resources.isLoading ? <Skeleton className="h-32" /> : !resources.data?.length ? <p className="text-sm text-muted-foreground">None yet.</p> : (
          <ul className="divide-y divide-border">
            {resources.data.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name} {!r.is_active && <ToneBadge tone="neutral">Inactive</ToneBadge>}</p>
                  <p className="text-xs capitalize text-muted-foreground">{r.kind}</p>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setRes(r)}><Pencil /></Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <Dlg open={!!pkg} onOpenChange={(o) => !o && setPkg(null)} title={pkg === 'new' ? 'Add package' : 'Edit package'}><PackageForm pkg={pkg === 'new' ? null : pkg} onDone={() => setPkg(null)} /></Dlg>
      <Dlg open={!!res} onOpenChange={(o) => !o && setRes(null)} title={res === 'new' ? 'Add resource' : 'Edit resource'}><ResourceForm res={res === 'new' ? null : res} onDone={() => setRes(null)} /></Dlg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------
function BusinessForm({ business, onDone }: { business: Business; onDone: () => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<BusinessProfileValues>({ resolver: zodResolver(businessProfileSchema), defaultValues: { name: business.name, category: business.category, description: business.description ?? '' } })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await updateBusinessProfile(business.id, v)
      await invalidate()
      toast.success('Business profile updated')
      onDone()
    } catch (e) {
      toast.error('Not saved', { description: toUserMessage(e) })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field id="bz-name" label="Business name" required error={err.name?.message}><Input {...fieldAria('bz-name', err.name?.message)} {...form.register('name')} /></Field>
      <Field id="bz-cat" label="Category" required error={err.category?.message}><Input {...fieldAria('bz-cat', err.category?.message)} {...form.register('category')} /></Field>
      <Field id="bz-desc" label="Description" error={err.description?.message}><Textarea {...fieldAria('bz-desc', err.description?.message)} rows={3} {...form.register('description')} /></Field>
      <SaveRow busy={form.formState.isSubmitting} onCancel={onDone} />
    </form>
  )
}

function BusinessesTab() {
  const { data, isLoading, error, refetch } = useBusinesses()
  const [editing, setEditing] = useState<Business | null>(null)
  if (isLoading) return <Skeleton className="h-64" />
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />
  return (
    <SectionCard title="Business profiles" description="Names appear on receipts and reports." bodyClassName="px-0 pb-0 sm:px-0 sm:pb-0">
      <ul className="divide-y divide-border border-t border-border">
        {(data ?? []).map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-5 py-4 sm:px-6">
            <BusinessAvatar slug={b.slug} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium"><span className="truncate">{b.name}</span><Badge variant="muted" className="font-mono">{b.code}</Badge></p>
              <p className="truncate text-sm text-muted-foreground">{b.category}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}><Pencil /> <span className="hidden sm:inline">Edit</span></Button>
          </li>
        ))}
      </ul>
      <Dlg open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title="Edit business profile" description={editing?.code}>
        {editing && <BusinessForm business={editing} onDone={() => setEditing(null)} />}
      </Dlg>
    </SectionCard>
  )
}

type Tab = 'general' | 'rules' | 'categories' | 'studio' | 'businesses'

export default function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'general'
  return (
    <div>
      <PageHeader title="Settings" description="Profile, business rules, reminders, categories and studio setup." />
      <Tabs
        className="mb-6"
        value={tab}
        onChange={(t) => setParams(t === 'general' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'rules', label: 'Rules & reminders' },
          { value: 'categories', label: 'Categories' },
          { value: 'studio', label: 'Studio setup' },
          { value: 'businesses', label: 'Businesses' },
        ]}
      />
      {tab === 'general' && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
          <ProfileCard />
          <div className="space-y-6"><AppearanceCard /><RegionalCard /><SecurityCard /></div>
        </div>
      )}
      {tab === 'rules' && <RulesTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'studio' && <StudioTab />}
      {tab === 'businesses' && <BusinessesTab />}
    </div>
  )
}
