import { lazy } from 'react'
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom'
import { RedirectIfAdmin, RequireAdmin } from './RequireAdmin'
import { AppLayout } from '@/layouts/AppLayout'
import LoginPage from '@/pages/auth/LoginPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import UnauthorizedPage from '@/pages/auth/UnauthorizedPage'

// Every page is split into its own chunk; the shell and auth load first.
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const TransactionHistoryPage = lazy(() => import('@/pages/transactions/TransactionHistoryPage'))
const AddIncomePage = lazy(() => import('@/pages/transactions/AddIncomePage'))
const AddExpensePage = lazy(() => import('@/pages/transactions/AddExpensePage'))
const BusinessesOverviewPage = lazy(() => import('@/pages/businesses/BusinessesOverviewPage'))
const BusinessDetailPage = lazy(() => import('@/pages/businesses/BusinessDetailPage'))
const CustomersPage = lazy(() => import('@/pages/customers/CustomerPages').then((m) => ({ default: m.CustomersPage })))
const CustomerDetailPage = lazy(() => import('@/pages/customers/CustomerPages').then((m) => ({ default: m.CustomerDetailPage })))
const StudioBookingsPage = lazy(() => import('@/pages/studio/StudioBookingPages').then((m) => ({ default: m.StudioBookingsPage })))
const StudioBookingDetailPage = lazy(() => import('@/pages/studio/StudioBookingPages').then((m) => ({ default: m.StudioBookingDetailPage })))
const StudioBookingFormPage = lazy(() => import('@/pages/studio/StudioBookingFormPage'))
const FrameOrdersPage = lazy(() => import('@/pages/frames/FramePages').then((m) => ({ default: m.FrameOrdersPage })))
const FrameOrderDetailPage = lazy(() => import('@/pages/frames/FramePages').then((m) => ({ default: m.FrameOrderDetailPage })))
const FrameOrderFormPage = lazy(() => import('@/pages/frames/FramePages').then((m) => ({ default: m.FrameOrderFormPage })))
const CameraRentalsPage = lazy(() => import('@/pages/camera/CameraRentalPages').then((m) => ({ default: m.CameraRentalsPage })))
const CameraRentalDetailPage = lazy(() => import('@/pages/camera/CameraRentalPages').then((m) => ({ default: m.CameraRentalDetailPage })))
const CameraRentalFormPage = lazy(() => import('@/pages/camera/CameraRentalFormPage'))
const GiftOrdersPage = lazy(() => import('@/pages/gifts/GiftPages').then((m) => ({ default: m.GiftOrdersPage })))
const GiftOrderDetailPage = lazy(() => import('@/pages/gifts/GiftPages').then((m) => ({ default: m.GiftOrderDetailPage })))
const GiftOrderFormPage = lazy(() => import('@/pages/gifts/GiftPages').then((m) => ({ default: m.GiftOrderFormPage })))
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage'))
const PendingPaymentsPage = lazy(() => import('@/pages/payments/PendingPaymentsPage'))
const CalendarPage = lazy(() => import('@/pages/calendar/CalendarPage'))
const MonthlyReportPage = lazy(() => import('@/pages/reports/ReportPages').then((m) => ({ default: m.MonthlyReportPage })))
const ProfitLossPage = lazy(() => import('@/pages/reports/ReportPages').then((m) => ({ default: m.ProfitLossPage })))
const BusinessComparisonPage = lazy(() => import('@/pages/reports/ReportPages').then((m) => ({ default: m.BusinessComparisonPage })))
const PaymentMethodReportPage = lazy(() => import('@/pages/reports/ReportPages').then((m) => ({ default: m.PaymentMethodReportPage })))
const AnnualReportPage = lazy(() => import('@/pages/reports/ReportPages').then((m) => ({ default: m.AnnualReportPage })))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const ReceiptPage = lazy(() => import('@/pages/receipts/ReceiptPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

/** create / view / edit routes for a document module. */
function documentRoutes(base: string, list: React.ReactNode, form: React.ReactNode, detail: React.ReactNode) {
  return [
    { path: base, element: list },
    { path: `${base}/new`, element: form },
    { path: `${base}/:id`, element: detail },
    { path: `${base}/:id/edit`, element: form },
  ]
}

export const router = createBrowserRouter([
  { path: '/login', element: <RedirectIfAdmin><LoginPage /></RedirectIfAdmin> },
  { path: '/forgot-password', element: <RedirectIfAdmin><ForgotPasswordPage /></RedirectIfAdmin> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/unauthorized', element: <UnauthorizedPage /> },
  {
    element: <RequireAdmin />,
    children: [
      // Printable receipts render without the app chrome.
      { path: 'receipts/:kind/:id', element: <ReceiptPage /> },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'transactions', element: <TransactionHistoryPage /> },
          { path: 'transactions/income/new', element: <AddIncomePage /> },
          { path: 'transactions/expense/new', element: <AddExpensePage /> },
          { path: 'businesses', element: <BusinessesOverviewPage /> },
          { path: 'businesses/:slug', element: <BusinessDetailPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerDetailPage /> },
          ...documentRoutes('studio/bookings', <StudioBookingsPage />, <StudioBookingFormPage />, <StudioBookingDetailPage />),
          ...documentRoutes('frames/orders', <FrameOrdersPage />, <FrameOrderFormPage />, <FrameOrderDetailPage />),
          ...documentRoutes('camera/rentals', <CameraRentalsPage />, <CameraRentalFormPage />, <CameraRentalDetailPage />),
          ...documentRoutes('gifts/orders', <GiftOrdersPage />, <GiftOrderFormPage />, <GiftOrderDetailPage />),
          { path: 'inventory', element: <InventoryPage /> },
          { path: 'pending-payments', element: <PendingPaymentsPage /> },
          { path: 'calendar', element: <CalendarPage /> },
          {
            path: 'reports',
            element: <Outlet />,
            children: [
              { index: true, element: <Navigate to="monthly" replace /> },
              { path: 'monthly', element: <MonthlyReportPage /> },
              { path: 'profit-loss', element: <ProfitLossPage /> },
              { path: 'comparison', element: <BusinessComparisonPage /> },
              { path: 'payment-methods', element: <PaymentMethodReportPage /> },
              { path: 'annual', element: <AnnualReportPage /> },
            ],
          },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
