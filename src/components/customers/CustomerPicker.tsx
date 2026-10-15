import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Phone, Search, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-controls'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getCustomer, searchCustomers } from '@/services/customers'
import { cn } from '@/lib/utils'
import { CustomerDialog } from './CustomerForm'
import type { Customer } from '@/types/domain'

/** Searchable customer selector with "add new" — usable one-handed on a phone. */
export function CustomerPicker({
  value,
  onChange,
  invalid,
  optional,
  id,
}: {
  value: string
  onChange: (id: string) => void
  invalid?: boolean
  optional?: boolean
  id?: string
}) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const debounced = useDebouncedValue(query, 250)
  const boxRef = useRef<HTMLDivElement>(null)

  const selected = useQuery({ queryKey: ['customer', value], queryFn: () => getCustomer(value), enabled: !!value })
  const results = useQuery({ queryKey: ['customer-search', debounced], queryFn: () => searchCustomers(debounced), enabled: open })

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const choose = (c: Customer) => {
    onChange(c.id)
    setQuery('')
    setOpen(false)
  }

  if (value && selected.data) {
    const c = selected.data
    return (
      <div className="flex items-center gap-3 rounded-lg border border-input bg-card px-3 py-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tile text-xs font-semibold text-tile-foreground">
          {c.full_name.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{c.full_name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {c.ref}
            {c.phone ? ` · ${c.phone}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => onChange('')} aria-label="Change customer">
          <X />
        </Button>
      </div>
    )
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id={inputId}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={optional ? 'Search customer (optional — leave blank for walk-in)' : 'Search by name, phone or CUS-ID'}
          aria-invalid={invalid || undefined}
          aria-autocomplete="list"
          aria-expanded={open}
          autoComplete="off"
          className="pl-9"
        />
        {value && selected.isLoading && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-card shadow-elevated" role="listbox">
          <div className="max-h-64 overflow-y-auto py-1">
            {results.isLoading ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
            ) : results.data?.length ? (
              results.data.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => choose(c)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.full_name}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      {c.ref}
                      {c.phone && (
                        <>
                          {' '}· <Phone className="size-3" aria-hidden /> {c.phone}
                        </>
                      )}
                    </span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">{debounced ? 'No matching customers.' : 'Start typing to search.'}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setAdding(true)
            }}
            className={cn('flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-sm font-medium text-accent hover:bg-muted')}
          >
            <UserPlus className="size-4" /> Add new customer{query.trim() ? ` “${query.trim()}”` : ''}
          </button>
        </div>
      )}
      <CustomerDialog open={adding} onOpenChange={setAdding} initialName={query.trim()} onSaved={choose} />
    </div>
  )
}
