export const ROLES = ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR', 'DISTRIBUTOR'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  STAFF: 'Staff',
  OPERATING: 'Operating',
  MONITOR: 'Monitor',
  COLLECTOR: 'Collector',
  DISTRIBUTOR: 'Distributor',
};

export const WORKER_ROLES: Role[] = ['STAFF', 'OPERATING'];

/** Capability matrix from doc 02. "read" variants are view-only. */
const MATRIX = {
  'masters.write': ['ADMIN'],
  'masters.read': ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'customers.create': ['ADMIN', 'STAFF', 'OPERATING'],
  'invoices.create': ['ADMIN', 'STAFF', 'OPERATING'],
  'invoices.read': ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR', 'DISTRIBUTOR'],
  'invoices.cancel': ['ADMIN'],
  'invoices.editRate': ['ADMIN'],
  'payments.create': ['ADMIN', 'STAFF', 'OPERATING'],
  'dues.read': ['ADMIN', 'STAFF', 'OPERATING'],
  'funds.write': ['ADMIN'],
  'funds.read': ['ADMIN', 'MONITOR', 'COLLECTOR'],
  'loans.read': ['ADMIN'],
  'indents.create': ['ADMIN'],
  'indents.read': ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'approvals.inbox': ['ADMIN', 'MONITOR', 'COLLECTOR'],
  'purchaseBills.create': ['ADMIN', 'OPERATING'],
  'purchaseBills.read': ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'supplierPayments.create': ['ADMIN'],
  'inventory.write': ['ADMIN', 'OPERATING'],
  'inventory.read': ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'attendance.read': ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'attendance.edit': ['ADMIN'],
  'expenses.write': ['ADMIN', 'OPERATING'],
  'expenses.read': ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'payroll.manage': ['ADMIN'],
  'settlement.manage': ['ADMIN'],
  'my.pay': ['STAFF', 'OPERATING'],
  'ledgers.read': ['ADMIN', 'MONITOR', 'COLLECTOR'],
  'ledgers.own': ['DISTRIBUTOR'],
  'analytics.full': ['ADMIN'],
  'analytics.company': ['ADMIN', 'MONITOR', 'COLLECTOR'],
  'analytics.own': ['STAFF', 'OPERATING'],
  'explorer.read': ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR'],
  'company.write': ['ADMIN'],
  'system.admin': ['ADMIN'],
  'orderRequests.create': ['DISTRIBUTOR'],
  'orderRequests.manage': ['ADMIN'],
  'distributor.portal': ['DISTRIBUTOR'],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof MATRIX;

export function can(role: Role, action: Action): boolean {
  return (MATRIX[action] as readonly Role[]).includes(role);
}

export function rolesFor(action: Action): readonly Role[] {
  return MATRIX[action];
}

/** Report matrix from doc 09. Values: true, or 'own' for Distributor. */
export const REPORTS = [
  { key: 'sales', title: 'Sales report', roles: ['ADMIN', 'STAFF', 'MONITOR', 'COLLECTOR'] },
  { key: 'top', title: 'Top customers and top items', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] },
  { key: 'outstanding', title: 'Outstanding and overdue', roles: ['ADMIN', 'STAFF', 'DISTRIBUTOR'] },
  { key: 'funds', title: 'Fund received, utilised and balance', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] },
  { key: 'indents', title: 'Purchase indent status', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] },
  { key: 'purchases', title: 'Purchase register', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] },
  { key: 'stock', title: 'Raw material and finished stock', roles: ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'] },
  { key: 'production', title: 'Production batches with wastage', roles: ['ADMIN', 'OPERATING', 'MONITOR'] },
  { key: 'daybook', title: 'Day book and cash flow', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] },
  { key: 'payroll', title: 'Attendance, hours and salary statement', roles: ['ADMIN', 'OPERATING'] },
  { key: 'expenses', title: 'Expense report', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] },
  { key: 'profit', title: 'Profit summary', roles: ['ADMIN'] },
] as const satisfies readonly { key: string; title: string; roles: readonly Role[] }[];

export type ReportKey = (typeof REPORTS)[number]['key'];

export function canReport(role: Role, key: string): boolean {
  const r = REPORTS.find((x) => x.key === key);
  return !!r && (r.roles as readonly Role[]).includes(role);
}
