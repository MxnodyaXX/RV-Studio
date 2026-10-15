import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { AuthProvider } from './AuthProvider'
import { createQueryClient } from './queryClient'
import { router } from './router'
import { Toaster } from '@/components/ui/misc'
import { supabaseConfigError } from '@/integrations/supabase/client'

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <Settings2 className="mx-auto mb-4 size-10 text-muted-foreground" aria-hidden />
        <h1 className="text-lg font-semibold">Configuration required</h1>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

export function App() {
  const [queryClient] = useState(createQueryClient)

  if (supabaseConfigError) return <ConfigErrorScreen message={supabaseConfigError} />

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  )
}
