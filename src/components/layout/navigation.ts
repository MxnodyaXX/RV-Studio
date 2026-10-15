import {
  BarChart3,
  Boxes,
  Building2,
  CalendarDays,
  CalendarRange,
  Camera,
  Clock,
  CreditCard,
  FileBarChart,
  Frame,
  Gift,
  History,
  LayoutDashboard,
  MinusCircle,
  PlusCircle,
  Scale,
  Settings,
  TrendingUp,
  Users,
  Aperture,
  type LucideIcon,
} from 'lucide-react'

export type NavLeaf = { label: string; to: string; icon: LucideIcon; end?: boolean }
export type NavGroup = { label: string; icon: LucideIcon; children: NavLeaf[]; dynamic?: 'businesses' }
export type NavItem = NavLeaf | NavGroup

export function isGroup(item: NavItem): item is NavGroup {
  return 'children' in item
}

export const NAVIGATION: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, end: true },
  {
    label: 'Transactions',
    icon: History,
    children: [
      { label: 'Add Income', to: '/transactions/income/new', icon: PlusCircle },
      { label: 'Add Expense', to: '/transactions/expense/new', icon: MinusCircle },
      { label: 'Transaction History', to: '/transactions', icon: History, end: true },
    ],
  },
  // Children are filled from the database so names stay in sync with Settings.
  { label: 'Businesses', icon: Building2, children: [], dynamic: 'businesses' },
  { label: 'Customers', to: '/customers', icon: Users },
  { label: 'Studio Bookings', to: '/studio/bookings', icon: Aperture },
  { label: 'Frame Orders', to: '/frames/orders', icon: Frame },
  { label: 'Camera Rentals', to: '/camera/rentals', icon: Camera },
  { label: 'Gift Park Orders', to: '/gifts/orders', icon: Gift },
  { label: 'Inventory', to: '/inventory', icon: Boxes },
  { label: 'Pending Payments', to: '/pending-payments', icon: Clock },
  { label: 'Calendar & Reminders', to: '/calendar', icon: CalendarDays },
  {
    label: 'Reports',
    icon: BarChart3,
    children: [
      { label: 'Monthly Report', to: '/reports/monthly', icon: CalendarRange },
      { label: 'Profit & Loss', to: '/reports/profit-loss', icon: Scale },
      { label: 'Business Comparison', to: '/reports/comparison', icon: TrendingUp },
      { label: 'Payment Method Report', to: '/reports/payment-methods', icon: CreditCard },
      { label: 'Annual Report', to: '/reports/annual', icon: FileBarChart },
    ],
  },
  { label: 'Settings', to: '/settings', icon: Settings },
]
