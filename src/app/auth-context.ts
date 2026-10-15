import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthStatus =
  | 'loading' // resolving the stored session / admin check
  | 'signed_out'
  | 'unauthorized' // valid login, but not the allowlisted administrator
  | 'error' // could not verify access (e.g. offline)
  | 'admin'

export type SignedOutReason = 'manual' | 'expired' | null

export type AuthState = {
  status: AuthStatus
  session: Session | null
  user: User | null
  signedOutReason: SignedOutReason
  /** True after the user arrives from a password-recovery link. */
  passwordRecovery: boolean
}

export type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  retry: () => void
  clearPasswordRecovery: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
