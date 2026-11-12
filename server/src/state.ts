import type {
  Attendance,
  AttendanceSession,
  BankAccount,
  CompanyHoliday,
  CompanyProfile,
  Customer,
  EmailOutbox,
  Expense,
  ExpenseHead,
  FinishedStockMovement,
  FundTranche,
  GoodsReceipt,
  Invoice,
  LoanRepayment,
  Notification,
  OrderRequest,
  Payment,
  Payslip,
  Product,
  ProductCategory,
  ProductionBatch,
  ProfitSettlement,
  PurchaseIndent,
  RawMaterial,
  RawStockMovement,
  Settings,
  Staff,
  StaffAdvance,
  StockCount,
  Supplier,
  SupplierPayment,
  Unit,
  User,
} from '@app/contract';

export interface AssetMeta {
  id: string;
  kind: 'LOGO' | 'FAVICON';
  mime: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: string;
}

/**
 * The transactional state document: everything that must change together.
 * Same collections as the production tables (doc 05).
 */
export interface State {
  meta: { schema: 1; seedVersion: number; seededAt: string; seedToday: string };
  counters: Record<string, number>;
  settings: Settings;
  openingCash: number;
  holidays: CompanyHoliday[];
  users: User[];
  staff: Staff[];
  customers: Customer[];
  suppliers: Supplier[];
  units: Unit[];
  categories: ProductCategory[];
  products: Product[];
  rawMaterials: RawMaterial[];
  expenseHeads: ExpenseHead[];
  bankAccounts: BankAccount[];
  invoices: Invoice[];
  payments: Payment[];
  orderRequests: OrderRequest[];
  tranches: FundTranche[];
  loanRepayments: LoanRepayment[];
  indents: PurchaseIndent[];
  goodsReceipts: GoodsReceipt[];
  supplierPayments: SupplierPayment[];
  rawMoves: RawStockMovement[];
  finishedMoves: FinishedStockMovement[];
  batches: ProductionBatch[];
  stockCounts: StockCount[];
  attendance: Attendance[];
  sessions: AttendanceSession[];
  advances: StaffAdvance[];
  payslips: Payslip[];
  expenses: Expense[];
  settlements: ProfitSettlement[];
  companyProfiles: CompanyProfile[];
  assets: AssetMeta[];
  notifications: Notification[];
  outbox: EmailOutbox[];
  /** Items currently below reorder level that have already raised an alert (fires once). */
  lowStockAlerted: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  maxWorkerLogins: 10,
  hoursRounding: 'NEAREST',
  creditDays: 15,
  halfDayRuleEnabled: false,
  halfDayMinHours: 4,
  reduceByAbsenceDefault: false,
  shareBasis: 'POOL',
  weeklyOffs: [0],
  idleTimeoutMinutes: 30,
  rateLimitLoginPerMinute: 5,
  rateLimitApiPerMinute: 120,
};

export function emptyState(today: string, now: string, seedVersion: number): State {
  return {
    meta: { schema: 1, seedVersion, seededAt: now, seedToday: today },
    counters: {},
    settings: { ...DEFAULT_SETTINGS },
    openingCash: 0,
    holidays: [],
    users: [],
    staff: [],
    customers: [],
    suppliers: [],
    units: [],
    categories: [],
    products: [],
    rawMaterials: [],
    expenseHeads: [],
    bankAccounts: [],
    invoices: [],
    payments: [],
    orderRequests: [],
    tranches: [],
    loanRepayments: [],
    indents: [],
    goodsReceipts: [],
    supplierPayments: [],
    rawMoves: [],
    finishedMoves: [],
    batches: [],
    stockCounts: [],
    attendance: [],
    sessions: [],
    advances: [],
    payslips: [],
    expenses: [],
    settlements: [],
    companyProfiles: [],
    assets: [],
    notifications: [],
    outbox: [],
    lowStockAlerted: [],
  };
}
