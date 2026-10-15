import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useBusinesses } from '@/hooks/useReferenceData'
import { BrandMark, businessIcon } from '@/components/common'
import { NAVIGATION, isGroup, type NavGroup, type NavLeaf } from './navigation'

function useResolvedNavigation() {
  const { data: businesses } = useBusinesses()
  return NAVIGATION.map((item) => {
    if (!isGroup(item) || item.dynamic !== 'businesses') return item
    const children: NavLeaf[] = [
      { label: 'All Businesses', to: '/businesses', icon: LayoutGrid, end: true },
      ...(businesses ?? []).map((b) => ({ label: b.name, to: `/businesses/${b.slug}`, icon: businessIcon(b.slug) })),
    ]
    return { ...item, children }
  })
}

function LeafLink({ item, collapsed, nested, onNavigate }: { item: NavLeaf; collapsed: boolean; nested?: boolean; onNavigate?: () => void }) {
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors',
          nested && !collapsed && 'min-h-9 pl-10 text-[13px]',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-white/12 text-white shadow-[inset_2px_0_0_0_#60a5fa]'
            : 'text-slate-300 hover:bg-white/6 hover:text-white',
        )
      }
    >
      {(!nested || collapsed) && <Icon className="size-[18px] shrink-0 opacity-90" aria-hidden />}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {collapsed && <span className="sr-only">{item.label}</span>}
    </NavLink>
  )
}

function Group({ item, collapsed, onNavigate }: { item: NavGroup; collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation()
  const containsActive = item.children.some((c) => location.pathname === c.to || location.pathname.startsWith(c.to + '/'))
  const [open, setOpen] = useState(containsActive || item.label === 'Transactions')
  const Icon = item.icon

  if (collapsed) {
    return (
      <div className="flex flex-col gap-0.5 border-t border-white/5 pt-1">
        {item.children.map((child) => (
          <LeafLink key={child.to} item={child} collapsed onNavigate={onNavigate} />
        ))}
      </div>
    )
  }

  const id = `nav-group-${item.label.toLowerCase()}`
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors hover:bg-white/6 hover:text-white',
          containsActive ? 'text-white' : 'text-slate-300',
        )}
      >
        <Icon className="size-[18px] shrink-0 opacity-90" aria-hidden />
        <span className="truncate">{item.label}</span>
        <ChevronDown className={cn('ml-auto size-4 opacity-60 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={id} className="mt-0.5 flex flex-col gap-0.5">
          {item.children.map((child) => (
            <LeafLink key={child.to} item={child} collapsed={false} nested onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

export function SidebarContent({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const items = useResolvedNavigation()
  return (
    <div className="flex h-full flex-col bg-sidebar text-white">
      <div className={cn('flex h-16 shrink-0 items-center border-b border-white/8', collapsed ? 'justify-center px-2' : 'px-5')}>
        {collapsed ? (
          <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-navy-700 text-sm font-bold">RV</div>
        ) : (
          <BrandMark />
        )}
      </div>
      <nav aria-label="Main" className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        <div className="flex flex-col gap-0.5">
          {items.map((item) =>
            isGroup(item) ? (
              <Group key={item.label} item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ) : (
              <LeafLink key={item.to} item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ),
          )}
        </div>
      </nav>
      {!collapsed && (
        <div className="border-t border-white/8 px-5 py-4 text-[11px] leading-relaxed text-slate-400">
          Currency LKR · Asia/Colombo
        </div>
      )}
    </div>
  )
}
