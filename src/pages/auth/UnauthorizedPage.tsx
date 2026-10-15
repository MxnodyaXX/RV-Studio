import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/button'

export default function UnauthorizedPage() {
  return (
    <AuthLayout title="Access denied">
      <div className="flex gap-3 rounded-xl border border-expense-ring bg-expense-soft p-4 text-sm text-expense-text" role="alert">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">This account is not authorised.</p>
          <p className="mt-1">
            RV BUSINESS HUB is restricted to its designated administrator. You have been signed out and no business data
            was loaded.
          </p>
        </div>
      </div>
      <Button asChild className="mt-6 w-full" size="lg" variant="outline">
        <Link to="/login">Sign in with a different account</Link>
      </Button>
    </AuthLayout>
  )
}
