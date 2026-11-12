import {
  BarChart3,
  BookOpen,
  Boxes,
  CalendarCheck,
  ClipboardCheck,
  FileText,
  Factory,
  Gauge,
  HandCoins,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@app/contract';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

const A: Role[] = ['ADMIN'];
const W: Role[] = ['STAFF', 'OPERATING'];
const SELL: Role[] = ['ADMIN', 'STAFF', 'OPERATING'];
const MC: Role[] = ['MONITOR', 'COLLECTOR'];

export const NAV: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', ...MC, ...W] },
      { to: '/portal', label: 'Home', icon: LayoutDashboard, roles: ['DISTRIBUTOR'] },
      { to: '/explorer', label: 'Bills explorer', icon: BarChart3, roles: ['ADMIN', ...MC, ...W] },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/bills/new', label: 'New bill', icon: ShoppingCart, roles: SELL },
      { to: '/bills', label: 'Bills', icon: FileText, roles: [...SELL, 'DISTRIBUTOR'] },
      { to: '/payments/new', label: 'Receive payment', icon: HandCoins, roles: SELL },
      { to: '/payments', label: 'Receipts', icon: Receipt, roles: [...SELL, 'DISTRIBUTOR'] },
      { to: '/dues', label: 'Dues', icon: Wallet, roles: SELL },
      { to: '/customers', label: 'Customers', icon: Users, roles: [...SELL] },
      { to: '/order-requests', label: 'Order requests', icon: ListChecks, roles: ['ADMIN', 'DISTRIBUTOR'] },
      { to: '/ledger', label: 'My ledger', icon: BookOpen, roles: ['DISTRIBUTOR'] },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { to: '/funds', label: 'Funds and loans', icon: Landmark, roles: ['ADMIN', ...MC] },
      { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, roles: A },
      { to: '/indents', label: 'Purchase indents', icon: ScrollText, roles: ['ADMIN', 'OPERATING'] },
      { to: '/purchase-bills', label: 'Purchase bills', icon: Truck, roles: ['ADMIN', 'OPERATING'] },
    ],
  },
  {
    label: 'Stock',
    items: [
      { to: '/inventory', label: 'Inventory tracker', icon: Boxes, roles: ['ADMIN', 'OPERATING', ...MC] },
      { to: '/production', label: 'Production', icon: Factory, roles: ['ADMIN', 'OPERATING'] },
      { to: '/stock-take', label: 'Stock take', icon: ListChecks, roles: ['ADMIN', 'OPERATING'] },
    ],
  },
  {
    label: 'Accounts',
    items: [
      { to: '/ledgers', label: 'Ledgers', icon: BookOpen, roles: ['ADMIN'] },
      { to: '/daybook', label: 'Day book and cash flow', icon: ScrollText, roles: ['ADMIN'] },
      { to: '/expenses', label: 'Other expenses', icon: Wallet, roles: ['ADMIN', 'OPERATING'] },
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['ADMIN', 'STAFF', 'OPERATING', ...MC] },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/my/pay', label: 'My pay', icon: Wallet, roles: W },
      { to: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['ADMIN'] },
      { to: '/payroll', label: 'Payroll', icon: HandCoins, roles: A },
      { to: '/settlements', label: 'Profit settlement', icon: Gauge, roles: A },
      { to: '/workers', label: 'Workers and logins', icon: Users, roles: A },
    ],
  },
  {
    label: 'Setup',
    items: [
      { to: '/masters', label: 'Masters', icon: Package, roles: A },
      { to: '/settings', label: 'Settings', icon: Settings, roles: A },
      { to: '/audit', label: 'Audit and logins', icon: ShieldCheck, roles: A },
      { to: '/system', label: 'System', icon: Gauge, roles: A },
    ],
  },
];

export function navFor(role: Role): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length);
}
