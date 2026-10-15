import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui/button'
import { Field, Input, fieldAria } from '@/components/ui/form-controls'
import { forgotPasswordSchema, type ForgotPasswordValues } from '@/lib/validation'
import { requestPasswordReset } from '@/services/auth'
import { toUserMessage } from '@/lib/errors'

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } })

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      await requestPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  })

  return (
    <AuthLayout title="Reset password" description="We'll email a secure reset link to the administrator address.">
      {sent ? (
        <div className="rounded-xl border border-income-ring bg-income-soft p-5 text-sm text-income-text" role="status">
          <MailCheck className="mb-3 size-6" aria-hidden />
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1">
            If that address belongs to the administrator account, a password reset link is on its way. The link expires
            after a short time and can only be used once.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <Field id="email" label="Administrator email" error={errors.email?.message}>
            <Input
              {...fieldAria('email', errors.email?.message)}
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              {...register('email')}
            />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            Send reset link
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
    </AuthLayout>
  )
}
