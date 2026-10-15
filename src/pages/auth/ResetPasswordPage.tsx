import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-context'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, fieldAria } from '@/components/ui/form-controls'
import { FullScreenLoader } from '@/components/common'
import { resetPasswordSchema, type ResetPasswordValues } from '@/lib/validation'
import { updatePassword } from '@/services/auth'
import { toUserMessage } from '@/lib/errors'

export default function ResetPasswordPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { password: '', confirm: '' } })

  if (auth.status === 'loading') return <FullScreenLoader label="Verifying reset link…" />

  // Only the verified administrator (arriving from a valid recovery link, or already signed in) may set a password.
  if (auth.status !== 'admin') {
    return (
      <AuthLayout title="Link invalid or expired">
        <div className="flex gap-3 rounded-xl border border-expense-ring bg-expense-soft p-4 text-sm text-expense-text" role="alert">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>This password reset link is invalid, has expired, or has already been used. Request a new link to continue.</p>
        </div>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </AuthLayout>
    )
  }

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await updatePassword(password)
      auth.clearPasswordRecovery()
      toast.success('Password updated. You are signed in.')
      navigate('/', { replace: true })
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  })

  return (
    <AuthLayout title="Choose a new password" description="Use at least 12 characters with upper- and lower-case letters and a number.">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <Field id="password" label="New password" error={errors.password?.message}>
          <Input {...fieldAria('password', errors.password?.message)} type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field id="confirm" label="Confirm new password" error={errors.confirm?.message}>
          <Input {...fieldAria('confirm', errors.confirm?.message)} type="password" autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
