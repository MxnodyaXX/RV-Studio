import { supabase } from '@/integrations/supabase/client'
import { AppError } from '@/lib/errors'

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    // Never reveal whether the email exists.
    if (error.status === 400 || /invalid/i.test(error.message)) {
      throw new AppError('Incorrect email or password.')
    }
    if (error.status === 429) throw new AppError('Too many attempts. Please wait a few minutes and try again.')
    throw new AppError('Unable to sign in right now. Please try again.')
  }
  return data.session
}

/** Server-side check against the admin allowlist (enforced again by RLS on every query). */
export async function checkIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('current_user_is_admin')
  if (error) throw error
  return data === true
}

export async function signOut() {
  // 'local' clears this device's session even when the network call fails.
  await supabase.auth.signOut({ scope: 'local' })
}

export async function requestPasswordReset(email: string) {
  const redirectTo = `${window.location.origin}/reset-password`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  // Rate-limit errors are surfaced; everything else is hidden to avoid account enumeration.
  if (error?.status === 429) throw new AppError('Too many requests. Please wait before trying again.')
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    if (/same/i.test(error.message)) throw new AppError('Choose a password different from your current one.')
    if (/weak|pwned|leaked/i.test(error.message)) throw new AppError('This password is too weak. Choose a stronger one.')
    throw new AppError('Could not update the password. The reset link may have expired — request a new one.')
  }
}
