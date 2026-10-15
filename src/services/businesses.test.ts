import { describe, expect, it, vi } from 'vitest'
import type { TransactionCategory } from '@/types/domain'

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }))
const { categoriesFor } = await import('./businesses')

const cat = (id: string, type: 'income' | 'expense', business_id: string | null = null, is_active = true): TransactionCategory => ({
  id,
  name: id,
  type,
  business_id,
  is_active,
  sort_order: 0,
  created_at: '',
})

const CATS = [
  cat('shared-income', 'income'),
  cat('shared-expense', 'expense'),
  cat('camera-only', 'income', 'b1'),
  cat('retired', 'income', null, false),
]

describe('categoriesFor', () => {
  it('only offers categories of the matching type', () => {
    expect(categoriesFor(CATS, 'expense', 'b1').map((c) => c.id)).toEqual(['shared-expense'])
  })

  it('includes business-specific categories only for that business', () => {
    expect(categoriesFor(CATS, 'income', 'b1').map((c) => c.id)).toEqual(['shared-income', 'camera-only'])
    expect(categoriesFor(CATS, 'income', 'b2').map((c) => c.id)).toEqual(['shared-income'])
  })

  it('hides inactive categories unless already selected (editing)', () => {
    expect(categoriesFor(CATS, 'income', null).map((c) => c.id)).toEqual(['shared-income'])
    expect(categoriesFor(CATS, 'income', null, 'retired').map((c) => c.id)).toContain('retired')
  })
})
