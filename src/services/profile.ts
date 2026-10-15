import { supabase } from '@/integrations/supabase/client'
import type { AdminProfile } from '@/types/domain'

export async function getProfile(userId: string): Promise<AdminProfile | null> {
  const { data, error } = await supabase.from('admin_profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveDisplayName(userId: string, displayName: string): Promise<AdminProfile> {
  const existing = await getProfile(userId)
  const name = displayName.trim()
  const { data, error } = existing
    ? await supabase.from('admin_profiles').update({ display_name: name }).eq('id', userId).select('*').single()
    : await supabase.from('admin_profiles').insert({ id: userId, display_name: name }).select('*').single()
  if (error) throw error
  return data
}
