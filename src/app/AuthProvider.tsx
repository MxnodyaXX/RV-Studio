import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/integrations/supabase/client'
import { checkIsAdmin, signInWithPassword, signOut as signOutRequest } from '@/services/auth'
import { AppError } from '@/lib/errors'
import { AuthContext, type AuthContextValue, type AuthState } from './auth-context'
import { SESSION_EXPIRED_EVENT } from './queryClient'

const INITIAL: AuthState = {
  status: 'loading',
  session: null,
  user: null,
  signedOutReason: null,
  passwordRecovery: false,
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>(INITIAL)
  const manualSignOut = useRef(false)
  const verifiedUserId = useRef<string | null>(null)

  const clearSensitiveData = useCallback(() => {
    // Remove every cached financial record from memory.
    queryClient.clear()
    verifiedUserId.current = null
  }, [queryClient])

  const verifySession = useCallback(async (session: Session | null) => {
    if (!session) {
      setState((s) => ({ ...s, status: 'signed_out', session: null, user: null }))
      return
    }
    if (verifiedUserId.current === session.user.id) {
      setState((s) => ({ ...s, status: 'admin', session, user: session.user }))
      return
    }
    setState((s) => ({ ...s, status: 'loading', session, user: session.user }))
    try {
      const isAdmin = await checkIsAdmin()
      if (isAdmin) {
        verifiedUserId.current = session.user.id
        setState((s) => ({ ...s, status: 'admin', session, user: session.user, signedOutReason: null }))
      } else {
        // Authenticated but not allowlisted: end the session immediately.
        manualSignOut.current = true
        await signOutRequest()
        clearSensitiveData()
        setState({ ...INITIAL, status: 'unauthorized' })
      }
    } catch {
      setState((s) => ({ ...s, status: 'error', session, user: session.user }))
    }
  }, [clearSensitiveData])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) void verifySession(data.session)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Defer work out of the auth callback (supabase-js recommendation).
      setTimeout(() => {
        if (!active) return
        switch (event) {
          case 'SIGNED_OUT': {
            const reason = manualSignOut.current ? 'manual' : 'expired'
            manualSignOut.current = false
            clearSensitiveData()
            setState((s) => (s.status === 'unauthorized' ? s : { ...INITIAL, status: 'signed_out', signedOutReason: reason }))
            break
          }
          case 'PASSWORD_RECOVERY':
            setState((s) => ({ ...s, passwordRecovery: true }))
            void verifySession(session)
            break
          case 'SIGNED_IN':
          case 'TOKEN_REFRESHED':
          case 'USER_UPDATED':
            if (session && verifiedUserId.current && verifiedUserId.current !== session.user.id) {
              // A different account signed in on this device: never show the previous user's cache.
              clearSensitiveData()
            }
            void verifySession(session)
            break
        }
      }, 0)
    })

    const onExpired = () => {
      manualSignOut.current = false
      void supabase.auth.signOut({ scope: 'local' })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)

    return () => {
      active = false
      sub.subscription.unsubscribe()
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
    }
  }, [verifySession, clearSensitiveData])

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await signInWithPassword(email, password)
    if (!session) throw new AppError('Unable to sign in right now. Please try again.')
    const isAdmin = await checkIsAdmin()
    if (!isAdmin) {
      manualSignOut.current = true
      await signOutRequest()
      clearSensitiveData()
      throw new AppError('This account is not authorised to access RV BUSINESS HUB.')
    }
    verifiedUserId.current = session.user.id
    setState({ ...INITIAL, status: 'admin', session, user: session.user })
  }, [clearSensitiveData])

  const signOut = useCallback(async () => {
    manualSignOut.current = true
    clearSensitiveData()
    await signOutRequest()
    setState({ ...INITIAL, status: 'signed_out', signedOutReason: 'manual' })
  }, [clearSensitiveData])

  const retry = useCallback(() => {
    supabase.auth.getSession().then(({ data }) => void verifySession(data.session))
  }, [verifySession])

  const clearPasswordRecovery = useCallback(() => setState((s) => ({ ...s, passwordRecovery: false })), [])

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, retry, clearPasswordRecovery }),
    [state, signIn, signOut, retry, clearPasswordRecovery],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
