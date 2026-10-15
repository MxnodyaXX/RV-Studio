import type { ReactNode } from 'react'
import { BarChart3, Lock, ShieldCheck } from 'lucide-react'
import { BrandMark } from '@/components/common'

export function AuthLayout({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-blue-500/15 blur-3xl"
        />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-24 size-[420px] rounded-full bg-emerald-400/10 blur-3xl" />
        <BrandMark className="relative" />
        <div className="relative mt-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">
            One secure hub for all four RV businesses.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            RV Camera Rent, Studio Of RV, Gift Park and The Frame House — income, expenses and performance in a single
            private dashboard.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-200">
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-4 text-emerald-300" aria-hidden /> Single administrator access
            </li>
            <li className="flex items-center gap-3">
              <Lock className="size-4 text-emerald-300" aria-hidden /> Records protected by row-level security
            </li>
            <li className="flex items-center gap-3">
              <BarChart3 className="size-4 text-emerald-300" aria-hidden /> Live figures from your recorded transactions
            </li>
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-muted-foreground">Private system · Authorised use only</p>
      </aside>

      <main className="flex items-center justify-center bg-background px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <BrandMark className="mb-10 text-foreground lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  )
}
