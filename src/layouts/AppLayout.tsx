import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Aperture,
  Bell,
  Camera,
  CheckCheck,
  ChevronsLeft,
  ChevronsRight,
  Frame,
  Gift,
  Loader2,
  LogOut,
  Menu,
  MinusCircle,
  Moon,
  Plus,
  PlusCircle,
  Search,
  Settings,
  Sun,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-context'
import { queryKeys } from '@/app/queryClient'
import { useProfile } from '@/hooks/useProfile'
import { useNotifications } from '@/hooks/queries'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { SidebarContent } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
} from '@/components/ui/overlays'
import { Skeleton } from '@/components/ui/misc'
import { searchCustomers } from '@/services/customers'
import { listDocuments } from '@/services/documents'
import { generateNotifications, markNotificationsRead } from '@/services/settings'
import { SOURCE_META, documentPath } from '@/lib/constants'
import { formatDateTime } from '@/lib/dates'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import type { SourceType } from '@/types/domain'

const COLLAPSE_KEY = 'rv-hub:sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

/** Live search across customers and every booking/order/rental. */
function GlobalSearch({ className }: { className?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const term = useDebouncedValue(q.trim(), 250)
  const box = useRef<HTMLDivElement>(null)
  const results = useQuery({
    queryKey: ['global-search', term],
    queryFn: async () => {
      const [customers, docs] = await Promise.all([searchCustomers(term, 4), listDocuments({ search: term, sort: 'newest' }, 1, 6)])
      return { customers, docs: docs.rows }
    },
    enabled: term.length >= 2,
  })
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const go = (to: string) => {
    navigate(to)
    setQ('')
    setOpen(false)
  }
  const isLedgerRef = /^(rcp|rfd|exp|adj|shx)-?\d+$/i.test(q.trim())

  return (
    <div ref={box} className={cn('relative', className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          if (isLedgerRef) go(`/transactions?q=${encodeURIComponent(q.trim())}`)
          else if (results.data?.docs[0]) go(documentPath(results.data.docs[0].source_type as SourceType, results.data.docs[0].source_id!))
          else if (results.data?.customers[0]) go(`/customers/${results.data.customers[0].id}`)
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search customers, bookings, orders, rentals, receipts…"
          aria-label="Search"
          className="h-10 w-full rounded-lg border border-border bg-subtle pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-placeholder focus:border-accent focus:bg-card focus:ring-3 focus:ring-accent/15"
        />
      </form>
      {open && term.length >= 2 && (
        <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-elevated">
          {results.isLoading ? (
            <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching…</p>
          ) : (
            <>
              {isLedgerRef && (
                <button type="button" onClick={() => go(`/transactions?q=${encodeURIComponent(q.trim())}`)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                  Find transaction <span className="font-mono font-semibold">{q.trim().toUpperCase()}</span>
                </button>
              )}
              {!!results.data?.docs.length && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bookings, orders & rentals</p>}
              {results.data?.docs.map((d) => (
                <button key={d.source_id} type="button" onClick={() => go(documentPath(d.source_type as SourceType, d.source_id!))} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted">
                  <span className="font-mono text-xs font-semibold">{d.ref}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{d.customer_name ?? 'Walk-in'} · <span className="text-muted-foreground">{d.title}</span></span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{SOURCE_META[d.source_type as SourceType].label}</span>
                </button>
              ))}
              {!!results.data?.customers.length && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Customers</p>}
              {results.data?.customers.map((c) => (
                <button key={c.id} type="button" onClick={() => go(`/customers/${c.id}`)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.full_name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{c.phone ?? c.ref}</span>
                </button>
              ))}
              {!results.data?.docs.length && !results.data?.customers.length && !isLedgerRef && <p className="px-3 py-2 text-sm text-muted-foreground">No matches for “{term}”.</p>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** In-app notifications: due reminders are converted server-side and stored, so they follow the admin across devices. */
function NotificationBell() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const notifications = useNotifications()
  const unread = (notifications.data ?? []).filter((n) => !n.read_at)

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const created = await generateNotifications()
        if (!cancelled && created > 0) {
          await qc.invalidateQueries({ queryKey: queryKeys.notifications })
          void qc.invalidateQueries({ queryKey: queryKeys.reminders })
          toast.info(`${created} new reminder${created === 1 ? '' : 's'}`, { action: { label: 'View', onClick: () => navigate('/calendar') } })
        }
      } catch {
        /* offline or signed out — try again next tick */
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [qc, navigate])

  const markAll = async () => {
    await markNotificationsRead('all')
    await qc.invalidateQueries({ queryKey: queryKeys.notifications })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ''}`}>
          <Bell className="size-5!" />
          {unread.length > 0 && (
            <span className="absolute right-1.5 top-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-white">
              {unread.length > 9 ? '9+' : unread.length}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,360px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread.length > 0 && (
            <button className="flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => void markAll()}>
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto p-1">
          {!notifications.data?.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">You’re all caught up.</p>
          ) : (
            notifications.data.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="items-start"
                onSelect={() => {
                  void markNotificationsRead([n.id]).then(() => qc.invalidateQueries({ queryKey: queryKeys.notifications }))
                  if (n.link) navigate(n.link)
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent')} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm leading-snug', !n.read_at && 'font-medium')}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
                </span>
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NewMenu({ trigger }: { trigger: React.ReactNode }) {
  const navigate = useNavigate()
  const items = [
    { label: 'Studio booking', to: '/studio/bookings/new', icon: Aperture },
    { label: 'Frame order', to: '/frames/orders/new', icon: Frame },
    { label: 'Camera rental', to: '/camera/rentals/new', icon: Camera },
    { label: 'Gift order', to: '/gifts/orders/new', icon: Gift },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((i) => (
          <DropdownMenuItem key={i.to} onSelect={() => navigate(i.to)}>
            <i.icon /> {i.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/transactions/income/new')}><PlusCircle /> Income / payment</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/transactions/expense/new')}><MinusCircle /> Expense</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/customers?new=1')}><UserPlus /> Customer</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProfileMenu() {
  const { user, signOut } = useAuth()
  const { data: profile } = useProfile()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const name = profile?.display_name ?? 'Administrator'
  const dark = document.documentElement.classList.contains('dark')

  const handleSignOut = async () => {
    await signOut()
    toast.success('You have been signed out securely.')
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-xl p-1 pr-2 transition-colors hover:bg-muted" aria-label="Open profile menu">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(name) || 'A'}</span>
          <span className="hidden text-left leading-tight md:block">
            <span className="block max-w-36 truncate text-sm font-medium">{name}</span>
            <span className="block text-[11px] text-muted-foreground">Administrator</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <p className="font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(dark ? 'light' : 'dark')}>
          {dark ? <Sun /> : <Moon />} {dark ? 'Light mode' : 'Dark mode'}
          {theme === 'system' && <span className="ml-auto text-[10px] text-muted-foreground">auto</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()} className="text-destructive [&_svg]:text-destructive">
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PageFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* storage unavailable — non-essential */
    }
  }, [collapsed])

  useEffect(() => {
    setMobileOpen(false)
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  return (
    <div className="min-h-dvh bg-background">
      <aside className={cn('fixed inset-y-0 left-0 z-30 hidden border-r border-sidebar-border transition-[width] duration-200 lg:block', collapsed ? 'w-[72px]' : 'w-64')}>
        <SidebarContent collapsed={collapsed} />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 border-b border-border bg-card/85 backdrop-blur-md supports-[backdrop-filter]:bg-card/75">
          <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu className="size-5!" />
            </Button>
            <Button variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            </Button>
            <Link to="/" className="text-sm font-bold tracking-[0.08em] text-foreground lg:hidden">RV HUB</Link>
            <GlobalSearch className="hidden max-w-md flex-1 md:block" />
            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <NewMenu trigger={<Button size="sm" className="hidden sm:inline-flex"><Plus /> New</Button>} />
              <NotificationBell />
              <ProfileMenu />
            </div>
          </div>
          <div className="px-4 pb-3 md:hidden">
            <GlobalSearch />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>

        <nav aria-label="Quick actions" className="safe-bottom sticky bottom-0 z-20 grid grid-cols-3 gap-2 border-t border-border bg-card/95 px-4 pt-3 backdrop-blur sm:hidden">
          <Button asChild variant="outline" size="lg" className="px-2">
            <Link to="/transactions/expense/new"><MinusCircle className="text-expense-text" /> Expense</Link>
          </Button>
          <Button asChild variant="income" size="lg" className="px-2">
            <Link to="/transactions/income/new"><PlusCircle /> Payment</Link>
          </Button>
          <NewMenu trigger={<Button size="lg" className="px-2"><Plus /> New</Button>} />
        </nav>
      </div>
    </div>
  )
}
