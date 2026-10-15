import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea, fieldAria } from '@/components/ui/form-controls'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays'
import { useInvalidateAll } from '@/hooks/useInvalidateAll'
import { saveCustomer } from '@/services/customers'
import { customerSchema, type CustomerValues } from '@/lib/validation'
import { toUserMessage } from '@/lib/errors'
import type { Customer } from '@/types/domain'

export function CustomerForm({ customer, initialName, onSaved, onCancel }: { customer?: Customer | null; initialName?: string; onSaved: (c: Customer) => void; onCancel?: () => void }) {
  const invalidate = useInvalidateAll()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      fullName: customer?.full_name ?? initialName ?? '',
      phone: customer?.phone ?? '',
      whatsapp: customer?.whatsapp ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await saveCustomer(values, customer?.id)
      toast.success(customer ? 'Customer updated' : `Customer ${saved.ref} added`)
      void invalidate()
      onSaved(saved)
    } catch (err) {
      toast.error('Could not save the customer', { description: toUserMessage(err) })
    }
  })

  return (
    <form onSubmit={(e) => { e.stopPropagation(); void onSubmit(e) }} noValidate className="space-y-4">
      <Field id="c-name" label="Full name" required error={errors.fullName?.message}>
        <Input {...fieldAria('c-name', errors.fullName?.message)} autoComplete="off" {...register('fullName')} />
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Field id="c-phone" label="Phone" error={errors.phone?.message}>
          <Input {...fieldAria('c-phone', errors.phone?.message)} type="tel" inputMode="tel" placeholder="077 123 4567" {...register('phone')} />
        </Field>
        <Field id="c-whatsapp" label="WhatsApp" error={errors.whatsapp?.message} hint="Leave blank if same as phone">
          <Input {...fieldAria('c-whatsapp', errors.whatsapp?.message)} type="tel" inputMode="tel" {...register('whatsapp')} />
        </Field>
      </div>
      <Field id="c-email" label="Email" error={errors.email?.message}>
        <Input {...fieldAria('c-email', errors.email?.message)} type="email" inputMode="email" {...register('email')} />
      </Field>
      <Field id="c-address" label="Address" error={errors.address?.message}>
        <Input {...fieldAria('c-address', errors.address?.message)} {...register('address')} />
      </Field>
      <Field id="c-notes" label="Notes" error={errors.notes?.message}>
        <Textarea {...fieldAria('c-notes', errors.notes?.message)} rows={2} {...register('notes')} />
      </Field>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="animate-spin" />}
          {customer ? 'Save changes' : 'Add customer'}
        </Button>
      </div>
    </form>
  )
}

export function CustomerDialog({ open, onOpenChange, customer, initialName, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer | null; initialName?: string; onSaved: (c: Customer) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? 'Edit customer' : 'New customer'}</DialogTitle>
          <DialogDescription>Customer profiles are shared across all four businesses.</DialogDescription>
        </DialogHeader>
        {open && (
          <CustomerForm
            customer={customer}
            initialName={initialName}
            onCancel={() => onOpenChange(false)}
            onSaved={(c) => {
              onSaved(c)
              onOpenChange(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
