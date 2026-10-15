import { supabase } from '@/integrations/supabase/client'
import { nullIfBlank, searchFilter, unwrap } from './api'
import type { CustomerValues } from '@/lib/validation'
import type { Customer } from '@/types/domain'

export async function listCustomers(search: string, page = 1, pageSize = 20): Promise<{ rows: Customer[]; total: number }> {
  let q = supabase.from('customers').select('*', { count: 'exact' })
  const s = searchFilter(search, ['full_name', 'phone', 'whatsapp', 'email', 'ref'])
  if (s) q = q.or(s)
  const from = (page - 1) * pageSize
  const { data, error, count } = await q.order('full_name').range(from, from + pageSize - 1)
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}

/** Quick lookup for pickers (top matches). */
export async function searchCustomers(search: string, limit = 8): Promise<Customer[]> {
  let q = supabase.from('customers').select('*').eq('is_active', true)
  const s = searchFilter(search, ['full_name', 'phone', 'whatsapp', 'ref'])
  if (s) q = q.or(s)
  return unwrap(await q.order('updated_at', { ascending: false }).limit(limit)) ?? []
}

export async function getCustomer(id: string): Promise<Customer | null> {
  return unwrap(await supabase.from('customers').select('*').eq('id', id).maybeSingle())
}

function toRow(v: CustomerValues) {
  return {
    full_name: v.fullName.trim(),
    phone: nullIfBlank(v.phone),
    whatsapp: nullIfBlank(v.whatsapp),
    email: nullIfBlank(v.email),
    address: nullIfBlank(v.address),
    notes: nullIfBlank(v.notes),
  }
}

export async function saveCustomer(values: CustomerValues, id?: string): Promise<Customer> {
  const q = id
    ? supabase.from('customers').update(toRow(values)).eq('id', id).select('*').single()
    : supabase.from('customers').insert(toRow(values)).select('*').single()
  return unwrap(await q)
}

export async function setCustomerActive(id: string, isActive: boolean) {
  unwrap(await supabase.from('customers').update({ is_active: isActive }).eq('id', id).select('id').single())
}
