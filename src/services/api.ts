import { supabase } from '@/integrations/supabase/client'
import type { Database } from '@/types/database'

type Fns = Database['public']['Functions']

/** Typed Supabase RPC call that throws on error. */
export async function callRpc<F extends keyof Fns>(fn: F, args: Fns[F]['Args']): Promise<Fns[F]['Returns']> {
  const { data, error } = await supabase.rpc(fn, args as never)
  if (error) throw error
  return data as Fns[F]['Returns']
}

/** Throws the PostgREST error or returns data. */
export function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

/** Strips characters that have meaning in PostgREST filter syntax. */
export function sanitizeSearch(term: string): string {
  return term.replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

/** Builds an `or=(...)` ilike filter across columns for a search term (or null if empty). */
export function searchFilter(term: string, columns: string[]): string | null {
  const t = sanitizeSearch(term)
  if (!t) return null
  return columns.map((c) => `${c}.ilike.%${t}%`).join(',')
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

export function nullIfBlank(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}
