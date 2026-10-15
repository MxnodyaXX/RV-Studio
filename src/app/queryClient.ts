import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isAuthError } from '@/lib/errors'

export const SESSION_EXPIRED_EVENT = 'rv-hub:session-expired'

function notifyIfSessionExpired(error: unknown) {
  if (isAuthError(error)) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

export function createQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: notifyIfSessionExpired }),
    mutationCache: new MutationCache({ onError: notifyIfSessionExpired }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !isAuthError(error) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  })
}

/**
 * Query keys. Business data is all derived from one ledger, so after any write
 * the app invalidates every query (see useInvalidateAll) instead of tracking
 * fine-grained dependencies — balances, lists, dashboards and reports can never
 * disagree.
 */
export const queryKeys = {
  businesses: ['businesses'] as const,
  categories: ['categories'] as const,
  settings: ['settings'] as const,
  profile: (userId: string) => ['profile', userId] as const,
  customers: (params: object) => ['customers', params] as const,
  customer: (id: string) => ['customer', id] as const,
  documents: (params: object) => ['documents', params] as const,
  document: (type: string, id: string) => ['document', type, id] as const,
  receivable: (id: string) => ['receivable', id] as const,
  sourceLedger: (id: string) => ['source-ledger', id] as const,
  sourceReminders: (id: string) => ['source-reminders', id] as const,
  ledger: (params: object) => ['ledger', params] as const,
  recentLedger: (params: object) => ['recent-ledger', params] as const,
  summary: (params: object) => ['summary', params] as const,
  trend: (params: object) => ['trend', params] as const,
  paymentMethods: (params: object) => ['payment-methods', params] as const,
  operations: (params: object) => ['operations', params] as const,
  calendar: (params: object) => ['calendar', params] as const,
  reminders: ['reminders'] as const,
  notifications: ['notifications'] as const,
  packages: ['packages'] as const,
  resources: ['resources'] as const,
  equipment: ['equipment'] as const,
  availability: (params: object) => ['availability', params] as const,
  products: ['products'] as const,
  movements: (productId: string | null) => ['movements', productId] as const,
  receipt: (kind: string, id: string) => ['receipt', kind, id] as const,
}
