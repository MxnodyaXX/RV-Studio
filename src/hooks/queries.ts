// TanStack Query hooks for every read in the app.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/app/queryClient'
import { listBusinesses, listCategories } from '@/services/businesses'
import { getCustomer, listCustomers } from '@/services/customers'
import { getReceivable, ledgerForSource, listDocuments, remindersForSource, type DocumentFilters } from '@/services/documents'
import {
  getBusinessSummary,
  getCalendarEvents,
  getDashboardOperations,
  getPaymentMethods,
  getReceipt,
  getTrend,
  listLedger,
  recentLedger,
  type LedgerFilters,
} from '@/services/finance'
import {
  getCameraRental,
  getFrameOrder,
  getGiftOrder,
  getStudioBooking,
  listEquipment,
  listMovements,
  listPackages,
  listProducts,
  listResources,
} from '@/services/operations'
import { getSettings, listNotifications, upcomingReminders } from '@/services/settings'
import { BUSINESS_SLUGS } from '@/lib/constants'
import type { DateRange, Granularity } from '@/types/domain'

const REFERENCE = 10 * 60_000

export const useBusinesses = () => useQuery({ queryKey: queryKeys.businesses, queryFn: listBusinesses, staleTime: REFERENCE })
export const useCategories = () => useQuery({ queryKey: queryKeys.categories, queryFn: listCategories, staleTime: REFERENCE })
export const useSettings = () => useQuery({ queryKey: queryKeys.settings, queryFn: getSettings, staleTime: REFERENCE })
export const usePackages = () => useQuery({ queryKey: queryKeys.packages, queryFn: listPackages, staleTime: REFERENCE })
export const useResources = () => useQuery({ queryKey: queryKeys.resources, queryFn: listResources, staleTime: REFERENCE })
export const useEquipment = () => useQuery({ queryKey: queryKeys.equipment, queryFn: listEquipment })
export const useProducts = () => useQuery({ queryKey: queryKeys.products, queryFn: listProducts })
export const useMovements = (productId: string | null) =>
  useQuery({ queryKey: queryKeys.movements(productId), queryFn: () => listMovements(productId) })

export function useBusinessBySlug(slug: string | undefined) {
  const query = useBusinesses()
  return { ...query, business: query.data?.find((b) => b.slug === slug) ?? null }
}

/** The business that owns a module (by its fixed slug). */
export function useModuleBusiness(module: keyof typeof BUSINESS_SLUGS) {
  return useBusinessBySlug(BUSINESS_SLUGS[module]).business
}

export const useCustomers = (search: string, page: number) =>
  useQuery({ queryKey: queryKeys.customers({ search, page }), queryFn: () => listCustomers(search, page), placeholderData: keepPreviousData })
export const useCustomer = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.customer(id ?? ''), queryFn: () => getCustomer(id!), enabled: !!id })

export const useDocuments = (filters: DocumentFilters, page: number, pageSize = 20) =>
  useQuery({ queryKey: queryKeys.documents({ filters, page, pageSize }), queryFn: () => listDocuments(filters, page, pageSize), placeholderData: keepPreviousData })
export const useReceivable = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.receivable(id ?? ''), queryFn: () => getReceivable(id!), enabled: !!id })
export const useSourceLedger = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.sourceLedger(id ?? ''), queryFn: () => ledgerForSource(id!), enabled: !!id })
export const useSourceReminders = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.sourceReminders(id ?? ''), queryFn: () => remindersForSource(id!), enabled: !!id })

export const useStudioBooking = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.document('studio_booking', id ?? ''), queryFn: () => getStudioBooking(id!), enabled: !!id })
export const useFrameOrder = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.document('frame_order', id ?? ''), queryFn: () => getFrameOrder(id!), enabled: !!id })
export const useCameraRental = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.document('camera_rental', id ?? ''), queryFn: () => getCameraRental(id!), enabled: !!id })
export const useGiftOrder = (id: string | undefined) =>
  useQuery({ queryKey: queryKeys.document('gift_order', id ?? ''), queryFn: () => getGiftOrder(id!), enabled: !!id })

export const useLedger = (filters: LedgerFilters, page: number, pageSize: number) =>
  useQuery({ queryKey: queryKeys.ledger({ filters, page, pageSize }), queryFn: () => listLedger(filters, page, pageSize), placeholderData: keepPreviousData })
export const useRecentLedger = (limit: number, businessId: string | null) =>
  useQuery({ queryKey: queryKeys.recentLedger({ limit, businessId }), queryFn: () => recentLedger(limit, businessId) })

export const useSummary = (range: DateRange, businessId: string | null = null) =>
  useQuery({
    queryKey: queryKeys.summary({ range, businessId }),
    queryFn: () => getBusinessSummary(range.from, range.to, businessId),
    placeholderData: keepPreviousData,
  })
export const useTrend = (range: DateRange, businessId: string | null, granularity: Granularity) =>
  useQuery({
    queryKey: queryKeys.trend({ range, businessId, granularity }),
    queryFn: () => getTrend(range.from, range.to, businessId, granularity),
    placeholderData: keepPreviousData,
  })
export const usePaymentMethods = (range: DateRange, businessId: string | null) =>
  useQuery({ queryKey: queryKeys.paymentMethods({ range, businessId }), queryFn: () => getPaymentMethods(range.from, range.to, businessId) })
export const useOperations = (range: DateRange) =>
  useQuery({ queryKey: queryKeys.operations({ range }), queryFn: () => getDashboardOperations(range.from, range.to) })

export const useCalendar = (from: string, to: string) =>
  useQuery({ queryKey: queryKeys.calendar({ from, to }), queryFn: () => getCalendarEvents(from, to), placeholderData: keepPreviousData })
export const useUpcomingReminders = (limit = 8) =>
  useQuery({ queryKey: [...queryKeys.reminders, limit], queryFn: () => upcomingReminders(limit) })
export const useNotifications = () =>
  useQuery({ queryKey: queryKeys.notifications, queryFn: () => listNotifications(), refetchInterval: 5 * 60_000 })

export const useReceipt = (kind: 'payment' | 'refund', id: string | undefined) =>
  useQuery({ queryKey: queryKeys.receipt(kind, id ?? ''), queryFn: () => getReceipt(kind, id!), enabled: !!id })
