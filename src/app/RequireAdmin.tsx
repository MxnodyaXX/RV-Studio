import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { WifiOff } from 'lucide-react'
import { useAuth } from './auth-context'
import { FullScreenLoader } from '@/components/FullScreenLoader'
import { Button } from '@/components/ui/button'

/**
 * Route guard for every dashboard route. This is a UX layer only — the database
 * enforces access with RLS regardless of what the client renders.
 */
export function RequireAdmin() {
  const auth = useAuth()
  const location = useLocation()

  switch (auth.status) {
    case 'loading':
      return <FullScreenLoader label="Verifying your session…" />
    case 'admin':
      return <Outlet />
    case 'unauthorized':
      return <Navigate to="/unauthorized" replace />
    case 'error':
      return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-6">
          <div className="max-w-sm text-center">
            <WifiOff className="mx-auto mb-4 size-10 text-muted-foreground" aria-hidden />
            <h1 className="text-lg font-semibold text-foreground">Unable to verify access</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We couldn't reach the server to confirm your session. Check your connection and try again.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button onClick={auth.retry}>Try again</Button>
              <Button variant="outline" onClick={() => void auth.signOut()}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      )
    case 'signed_out':
    default:
      return (
        <Navigate
          to={auth.signedOutReason === 'expired' ? '/login?reason=expired' : '/login'}
          replace
          state={{ from: location.pathname + location.search }}
        />
      )
  }
}

/** Keeps signed-in administrators away from the login pages. */
export function RedirectIfAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth()
  if (auth.status === 'admin' && !auth.passwordRecovery) return <Navigate to="/" replace />
  return <>{children}</>
}

