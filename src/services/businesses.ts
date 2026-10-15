import { supabase } from '@/integrations/supabase/client'
import type { Business, TransactionCategory } from '@/types/domain'
import type { BusinessProfileValues } from '@/lib/validation'

export async function listBusinesses(): Promise<Business[]> {
  const { data, error } = await supabase.from('businesses').select('*').order('sort_order').order('name')
  if (error) throw error
  return data
}

export async function updateBusinessProfile(id: string, values: BusinessProfileValues): Promise<Business> {
  const { data, error } = await supabase
    .from('businesses')
    .update({ name: values.name.trim(), category: values.category.trim(), description: values.description?.trim() || null })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function listCategories(): Promise<TransactionCategory[]> {
  const { data, error } = await supabase
    .from('transaction_categories')
    .select('*')
    .order('type')
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data
}

/** Categories usable for a business and type: shared ones plus business-specific ones. */
export function categoriesFor(
  categories: TransactionCategory[],
  type: TransactionCategory['type'],
  businessId: string | null,
  includeId?: string,
): TransactionCategory[] {
  return categories.filter(
    (c) =>
      c.type === type &&
      (c.business_id === null || c.business_id === businessId) &&
      (c.is_active || c.id === includeId),
  )
}
