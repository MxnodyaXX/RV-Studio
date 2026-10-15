import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Bell, Check, ChevronLeft, ChevronRight, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Skeleton } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { PageHeader } from '@/components/common'
import { SectionCard } from '@/components/shared'
import { useBusinesses, useCalendar, useUpcomingReminders } from '@/hooks/queries'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { createReminder, setReminderStatus } from '@/services/settings'
import { BUSINESS_SLUGS } from '@/lib/constants'
import { addDays, addMonths, businessToday, colomboDateOf, formatDateTime, formatLongDate, formatTime, monthBounds, monthName, toColomboInput, weekdayIndex } from '@/lib/dates'
import { toUserMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { reminderSchema, type ReminderValues } from '@/lib/validation'
import type { CalendarEvent } from '@/types/domain'

const EVENT_LABEL: Record<string, string> = {
  studio_shoot: 'Shoot',
  frame_completion: 'Frame due',
  rental_pickup: 'Pickup',
  rental_return: 'Return',
  gift_delivery: 'Delivery',
  payment_due: 'Payment due',
  reminder: 'Reminder',
}

const SLUG_STYLE: Record<string, { color: string; short: string }> = {
  [BUSINESS_SLUGS.studio]: { color: 'var(--color-biz-studio)', short: 'SR' },
  [BUSINESS_SLUGS.frame]: { color: 'var(--color-biz-frame)', short: 'FH' },
  [BUSINESS_SLUGS.camera]: { color: 'var(--color-biz-camera)', short: 'CR' },
  [BUSINESS_SLUGS.gift]: { color: 'var(--color-biz-gift)', short: 'GP' },
}

function eventDate(e: CalendarEvent) {
  return e.all_day ? e.starts_at.slice(0, 10) : colomboDateOf(e.starts_at)
}

function ReminderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateAll()
  const form = useForm<ReminderValues>({ resolver: zodResolver(reminderSchema), defaultValues: { title: '', body: '', dueAt: toColomboInput(new Date(Date.now() + 3600_000).toISOString()) } })
  const err = form.formState.errors
  const submit = form.handleSubmit(async (v) => {
    try {
      await createReminder(v)
      await invalidate()
      toast.success('Reminder added')
      form.reset()
      onOpenChange(false)
    } catch (e) {
      toast.error('Reminder not saved', { description: toUserMessage(e) })
    }
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New reminder</DialogTitle>
          <DialogDescription>Shown on the dashboard and as a notification when due.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field id="r-title" label="Title" required error={err.title?.message}>
            <Input {...fieldAria('r-title', err.title?.message)} {...form.register('title')} />
          </Field>
          <Field id="r-due" label="Remind me at" required error={err.dueAt?.message}>
            <Input {...fieldAria('r-due', err.dueAt?.message)} type="datetime-local" {...form.register('dueAt')} />
          </Field>
          <Field id="r-body" label="Details" error={err.body?.message}>
            <Textarea {...fieldAria('r-body', err.body?.message)} rows={2} {...form.register('body')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Add reminder
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function UpcomingReminders({ limit = 8, compact }: { limit?: number; compact?: boolean }) {
  const q = useUpcomingReminders(limit)
  const invalidate = useInvalidateAll()
  const act = async (id: string, status: 'done' | 'dismissed') => {
    try {
      await setReminderStatus(id, status)
      await invalidate()
    } catch (e) {
      toast.error(toUserMessage(e))
    }
  }
  if (q.isLoading) return <Skeleton className="h-32 w-full" />
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Nothing due in the next 7 days.</p>
  const now = Date.now()
  return (
    <ul className="space-y-1">
      {q.data.map((r) => {
        const overdue = new Date(r.due_at).getTime() < now
        return (
          <li key={r.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-subtle">
            <Bell className={cn('mt-0.5 size-4 shrink-0', r.kind === 'rental_overdue' || overdue ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug">{r.title}</p>
              {!compact && r.body && <p className="truncate text-xs text-muted-foreground">{r.body}</p>}
              <p className={cn('text-xs', overdue ? 'text-expense-text' : 'text-muted-foreground')}>{formatDateTime(r.due_at)}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Mark done" onClick={() => void act(r.id, 'done')}>
                <Check />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={() => void act(r.id, 'dismissed')}>
                <X />
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default function CalendarPage() {
  const today = businessToday()
  const [month, setMonth] = useState(monthBounds(today).from)
  const [selected, setSelected] = useState(today)
  const [adding, setAdding] = useState(false)
  const { from, to } = monthBounds(month)
  const gridStart = addDays(from, -weekdayIndex(from))
  const gridEnd = addDays(to, 6 - weekdayIndex(to))
  const events = useCalendar(gridStart, gridEnd)
  const businesses = useBusinesses()
  const slugOf = (id: string | null) => businesses.data?.find((b) => b.id === id)?.slug ?? ''

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>()
    for (const e of events.data ?? []) {
      const d = eventDate(e)
      m.set(d, [...(m.get(d) ?? []), e])
    }
    for (const list of m.values()) list.sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    return m
  }, [events.data])

  const days: string[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)
  const dayEvents = byDay.get(selected) ?? []

  const Chip = ({ e }: { e: CalendarEvent }) => {
    const s = SLUG_STYLE[slugOf(e.business_id)]
    return (
      <span className="flex min-w-0 items-center gap-1 rounded px-1 text-[11px] leading-5" style={{ background: s ? `color-mix(in oklab, ${s.color} 14%, transparent)` : undefined }}>
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: s?.color ?? 'var(--color-muted-foreground)' }} />
        <span className="truncate">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
      </span>
    )
  }

  return (
    <div>
      <PageHeader
        title="Calendar & Reminders"
        description="Shoots, frame completions, rental pickups and returns, gift deliveries and payment due dates."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> New reminder
          </Button>
        }
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-3">
        <Card className="min-w-0 overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Button variant="ghost" size="icon-sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
              <ChevronLeft />
            </Button>
            <div className="text-center">
              <h2 className="font-semibold">{monthName(month)}</h2>
              <button className="text-xs text-accent hover:underline" onClick={() => { setMonth(monthBounds(today).from); setSelected(today) }}>
                Today
              </button>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
              <ChevronRight />
            </Button>
          </div>
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] border-b border-border bg-subtle text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="py-2">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(7,minmax(0,1fr))]">
            {days.map((d) => {
              const list = byDay.get(d) ?? []
              const inMonth = d >= from && d <= to
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelected(d)}
                  aria-pressed={selected === d}
                  aria-label={`${formatLongDate(d)}: ${list.length} events`}
                  className={cn(
                    'flex min-h-16 flex-col gap-0.5 border-b border-r border-border p-1 text-left transition-colors sm:min-h-24 sm:p-1.5',
                    !inMonth && 'bg-subtle/60 text-muted-foreground',
                    selected === d ? 'bg-accent-soft' : 'hover:bg-muted',
                  )}
                >
                  <span className={cn('flex size-6 items-center justify-center rounded-full text-xs', d === today && 'bg-primary font-semibold text-primary-foreground')}>
                    {Number(d.slice(8))}
                  </span>
                  <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {list.slice(0, 3).map((e) => <Chip key={e.event_key} e={e} />)}
                    {list.length > 3 && <span className="px-1 text-[10px] text-muted-foreground">+{list.length - 3} more</span>}
                  </span>
                  {list.length > 0 && (
                    <span className="flex gap-0.5 sm:hidden">
                      {list.slice(0, 4).map((e) => (
                        <span key={e.event_key} className="size-1.5 rounded-full" style={{ background: SLUG_STYLE[slugOf(e.business_id)]?.color ?? 'var(--color-muted-foreground)' }} />
                      ))}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
            {(businesses.data ?? []).map((b) => (
              <span key={b.id} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: SLUG_STYLE[b.slug]?.color }} /> {b.name}
              </span>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          <SectionCard title={formatLongDate(selected)} description={`${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}`}>
            {events.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !dayEvents.length ? (
              <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {dayEvents.map((e) => {
                  const s = SLUG_STYLE[slugOf(e.business_id)]
                  return (
                    <li key={e.event_key}>
                      <Link to={e.link} className="flex items-start gap-3 rounded-lg border border-border p-2.5 hover:bg-subtle">
                        <span className="mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: s?.color ?? 'var(--color-secondary)' }}>
                          {s?.short ?? '—'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{EVENT_LABEL[e.event_type]}{e.ref ? ` · ${e.ref}` : ''}</p>
                          <p className="truncate text-xs text-muted-foreground">{e.title}</p>
                        </div>
                        {!e.all_day && <span className="shrink-0 text-xs text-muted-foreground">{formatTime(e.starts_at)}</span>}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Upcoming reminders" description="Next 7 days">
            <UpcomingReminders limit={12} />
          </SectionCard>
        </div>
      </div>
      <ReminderDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
