import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Non-null when the app is missing its public Supabase configuration. */
export const supabaseConfigError: string | null =
  !url || !anonKey
    ? 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).'
    : null

// The anon/publishable key is designed to be public; every table is protected by RLS.
// The service-role key must never appear in frontend code or VITE_* variables.
export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Picks up password-recovery links (including ones sent from the Supabase Dashboard).
      detectSessionInUrl: true,
      storageKey: 'rv-hub-auth',
    },
  },
)
