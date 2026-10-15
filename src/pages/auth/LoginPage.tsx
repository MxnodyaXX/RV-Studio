import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, Clock, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useAuth } from '@/app/auth-context'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, fieldAria } from '@/components/ui/form-controls'
import { loginSchema, type LoginValues } from '@/lib/validation'
import { toUserMessage } from '@/lib/errors'

function Notice({ tone, children }: { tone: 'warning' | 'error'; children: ReactNode }) {
  const Icon = tone === 'warning' ? Clock : AlertCircle
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'warning'
          ? 'mb-6 flex gap-3 rounded-xl border border-warning-ring bg-warning-soft p-3.5 text-sm text-warning-text'
          : 'mb-6 flex gap-3 rounded-xl border border-expense-ring bg-expense-soft p-3.5 text-sm text-expense-text'
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export default function LoginPage() {
  const { signIn, signedOutReason } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [formError, setFormError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const expired = params.get('reason') === 'expired' || signedOutReason === 'expired'
  const from = (location.state as { from?: string } | null)?.from

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await signIn(values.email.trim(), values.password)
      // Only follow internal paths.
      navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/', { replace: true })
    } catch (err) {
      setFormError(toUserMessage(err, 'Unable to sign in. Please try again.'))
    }
  })

  return (
    <AuthLayout title="Sign in" description="Administrator access to RV BUSINESS HUB.">
      {expired && !formError && (
        <Notice tone="warning">Your session has expired. Please sign in again to continue.</Notice>
      )}
      {formError && <Notice tone="error">{formError}</Notice>}

      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <Field id="email" label="Email address" error={errors.email?.message}>
          <Input
            {...fieldAria('email', errors.email?.message)}
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            {...register('email')}
          />
        </Field>

        <Field id="password" label="Password" error={errors.password?.message}>
          <div className="relative">
            <Input
              {...fieldAria('password', errors.password?.message)}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pr-11"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        There is no public registration. Access is limited to the designated administrator.
      </p>
    </AuthLayout>
  )
}
