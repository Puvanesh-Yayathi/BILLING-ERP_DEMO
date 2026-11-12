import type { HoursRounding, ISODate } from './dates.js';
import type { Paise } from './money.js';
import type { PayType } from './payslip.js';
import type { Role } from './roles.js';
import type { ShareBasis } from './settlement.js';

/** Entity shapes (doc 05). Money in paise, quantities with 3 decimals, timestamps ISO. */

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  role: Role;
  customerId?: string;
  staffId?: string;
  active: boolean;
  tokenVersion: number;
  createdAt: string;
}
export type PublicUser = Omit<User, 'passwordHash' | 'tokenVersion'>;

export interface Settings {
  maxWorkerLogins: number;
  hoursRounding: HoursRounding;
  creditDays: number;
  halfDayRuleEnabled: boolean;
  halfDayMinHours: number;
  reduceByAbsenceDefault: boolean;
  shareBasis: ShareBasis;
  weeklyOffs: number[];
  idleTimeoutMinutes: number;
  rateLimitLoginPerMinute: number;
  rateLimitApiPerMinute: number;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  at: string;
}

export interface EmailOutbox {
  id: string;
  to: string;
  subject: string;
  body: string;
  at: string;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  type: 'RETAIL' | 'DISTRIBUTOR';
  phone: string;
  email?: string;
  address: string;
  gstin?: string;
  state: string;
  stateCode: string;
  openingBalance: Paise;
  active: boolean;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  address: string;
  gstin?: string;
  state: string;
  openingBalance: Paise;
  active: boolean;
}

export interface Unit {
  id: string;
  name: string;
}

export interface ProductCategory {
  id: string;
  name: string;
}

/** Sales Inventory item. */
export interface Product {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  unitId: string;
  hsn?: string;
  gstRate: number;
  taxInclusive: boolean;
  mrp: Paise;
  retailPrice: Paise;
  distributorPrice: Paise;
  reorderLevel: number;
  active: boolean;
}

export type PurchaseItemCategory = 'RAW_MATERIAL' | 'PACKAGING' | 'CONSUMABLE' | 'OTHER';

/** Purchase List item. */
export interface RawMaterial {
  id: string;
  name: string;
  category: PurchaseItemCategory;
  unitId: string;
  preferredSupplierId?: string;
  lastRate: Paise;
  reorderLevel: number;
  active: boolean;
}

export interface Staff {
  id: string;
  code: string;
  name: string;
  phone: string;
  userId?: string;
  payType: PayType;
  basePay?: Paise;
  hourlyRate?: Paise;
  sharePercent?: number;
  reduceByAbsence: boolean;
  joinDate: ISODate;
  active: boolean;
}

export interface CompanyHoliday {
  id: string;
  date: ISODate;
  name: string;
}

export interface ExpenseHead {
  id: string;
  name: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNo: string;
  ifsc: string;
  upiId: string;
  isInvoiceDefault: boolean;
  openingBalance: Paise;
}

export type InvoiceType = 'CASH' | 'CREDIT' | 'DISTRIBUTOR';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'CANCELLED';

export interface InvoiceItem {
  productId: string;
  code: string;
  name: string;
  hsn?: string;
  unit: string;
  qty: number;
  rate: Paise;
  discountPct: number;
  gstRate: number;
  taxInclusive: boolean;
  gross: Paise;
  discount: Paise;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  lineTotal: Paise;
}

export interface Invoice {
  id: string;
  number?: string;
  date: ISODate;
  type: InvoiceType;
  customerId?: string;
  walkInName?: string;
  placeOfSupply: string;
  placeOfSupplyCode: string;
  intraState: boolean;
  status: InvoiceStatus;
  dueDate?: ISODate;
  items: InvoiceItem[];
  subtotal: Paise;
  discountTotal: Paise;
  taxableTotal: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  roundOff: Paise;
  grandTotal: Paise;
  paidAmount: Paise;
  notes?: string;
  orderRequestId?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  companyProfileVersionId?: string;
  rev: number;
}

export type PaymentMode = 'CASH' | 'UPI' | 'BANK' | 'CARD';

export interface Payment {
  id: string;
  receiptNo: string;
  date: ISODate;
  customerId?: string;
  invoiceId?: string;
  mode: PaymentMode;
  amount: Paise;
  reference?: string;
  allocations: { invoiceId: string; amount: Paise }[];
  auto: boolean;
  createdById: string;
  createdAt: string;
  companyProfileVersionId: string;
}

export interface OrderRequest {
  id: string;
  number: string;
  distributorId: string;
  items: { productId: string; qty: number }[];
  note: string;
  status: 'NEW' | 'CONVERTED' | 'REJECTED';
  invoiceId?: string;
  remark?: string;
  createdById: string;
  createdAt: string;
}

export interface FundTranche {
  id: string;
  date: ISODate;
  source: string;
  amount: Paise;
  note: string;
  isLoan: boolean;
  lender?: string;
  createdAt: string;
}

export interface LoanRepayment {
  id: string;
  trancheId: string;
  settlementId?: string;
  date: ISODate;
  amount: Paise;
  mode: PaymentMode;
  note: string;
}

export type IndentStatus =
  | 'DRAFT'
  | 'PENDING_S1'
  | 'PENDING_S2'
  | 'PENDING_S3'
  | 'APPROVED'
  | 'REJECTED'
  | 'RECEIVED'
  | 'PAID';

export interface IndentItem {
  rawMaterialId: string;
  qty: number;
  rate: Paise;
  amount: Paise;
}

export interface IndentApproval {
  stage: 1 | 2 | 3 | 0;
  decision: 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  remarks: string;
  userId: string;
  at: string;
}

export interface PurchaseIndent {
  id: string;
  number: string;
  poNumber?: string;
  date: ISODate;
  supplierId: string;
  status: IndentStatus;
  items: IndentItem[];
  total: Paise;
  note: string;
  raisedById: string;
  approvals: IndentApproval[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  companyProfileVersionId?: string;
  rev: number;
}

export interface GoodsReceiptItem {
  rawMaterialId: string;
  qty: number;
  rate: Paise;
  amount: Paise;
  indentRate: Paise;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  indentId: string;
  date: ISODate;
  items: GoodsReceiptItem[];
  supplierBillNo: string;
  supplierBillDate: ISODate;
  billAmount: Paise;
  note: string;
  createdById: string;
  createdAt: string;
  companyProfileVersionId: string;
}

export interface SupplierPayment {
  id: string;
  number: string;
  indentId: string;
  supplierId: string;
  date: ISODate;
  mode: PaymentMode;
  amount: Paise;
  reference?: string;
  createdById: string;
  createdAt: string;
  companyProfileVersionId: string;
}

export interface RawStockMovement {
  id: string;
  rawMaterialId: string;
  qty: number;
  reason: 'OPENING' | 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT';
  refType: string;
  refId: string;
  rate?: Paise;
  date: ISODate;
  note: string;
  createdById: string;
  at: string;
}

export interface FinishedStockMovement {
  id: string;
  productId: string;
  qty: number;
  reason: 'OPENING' | 'PRODUCTION' | 'SALE' | 'CANCEL' | 'ADJUSTMENT';
  refType: string;
  refId: string;
  date: ISODate;
  note: string;
  createdById: string;
  at: string;
}

export interface ProductionBatch {
  id: string;
  batchNo: string;
  date: ISODate;
  inputs: { rawMaterialId: string; qty: number }[];
  outputs: { productId: string; qty: number }[];
  wastageQty: number;
  wastageNote: string;
  createdById: string;
  createdAt: string;
}

export interface StockCount {
  id: string;
  number: string;
  date: ISODate;
  kind: 'PURCHASE' | 'SALES';
  status: 'DRAFT' | 'CONFIRMED';
  lines: { itemId: string; systemQty: number; countedQty: number; variance: number; reason: string }[];
  createdById: string;
  createdAt: string;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF' | 'LEAVE';

export interface Attendance {
  id: string;
  staffId: string;
  date: ISODate;
  status: AttendanceStatus;
  firstIn?: string;
  lastOut?: string;
  rawMinutes: number;
  paidHours: number;
  source: 'AUTO' | 'MANUAL' | 'EDITED';
  editReason?: string;
  payslipId?: string;
}

export interface AttendanceSession {
  id: string;
  staffId: string;
  date: ISODate;
  loginAt: string;
  lastSeenAt: string;
  logoutAt?: string;
  endReason?: 'LOGOUT' | 'IDLE_TIMEOUT' | 'AUTO_CLOSE' | 'MANUAL';
}

export interface StaffAdvance {
  id: string;
  staffId: string;
  date: ISODate;
  amount: Paise;
  mode: PaymentMode;
  recoveredAmount: Paise;
  note: string;
  settlementId?: string;
}

export interface PayslipLine {
  kind: 'ALLOWANCE' | 'DEDUCTION';
  label: string;
  amount: Paise;
}

export interface Payslip {
  id: string;
  number?: string;
  staffId: string;
  periodFrom: ISODate;
  periodTo: ISODate;
  status: 'DRAFT' | 'PAID' | 'CANCELLED';
  source: 'PAYROLL' | 'SETTLEMENT';
  settlementId?: string;
  payType: PayType;
  rateSnapshot: { basePay?: Paise; hourlyRate?: Paise; sharePercent?: number; reduceByAbsence?: boolean; effectivePercent?: number };
  workingDaysInMonth: number;
  perDayRate: Paise | null;
  daysPresent: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  paidHours: number;
  basePayEarned: Paise;
  allowancesTotal: Paise;
  deductionsTotal: Paise;
  advanceRecovery: Paise;
  alreadyPaid: Paise;
  gross: Paise;
  net: Paise;
  roundOff: Paise;
  lines: PayslipLine[];
  attendanceIds: string[];
  advanceAllocations: { advanceId: string; amount: Paise }[];
  paidOn?: ISODate;
  mode?: PaymentMode;
  reference?: string;
  cancelReason?: string;
  createdById: string;
  createdAt: string;
  companyProfileVersionId?: string;
}

export interface Expense {
  id: string;
  date: ISODate;
  headId: string;
  amount: Paise;
  mode: PaymentMode;
  description: string;
  createdById: string;
  createdAt: string;
}

export interface SettlementLine {
  staffId: string;
  payType: PayType;
  rate: Paise | null;
  sharePercent: number | null;
  effectivePercent: number | null;
  reduceByAbsence: boolean;
  workingDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  paidHours: number;
  earned: Paise;
  scaled: Paise;
  adjustment: Paise;
  adjustmentReason?: string;
  payable: Paise;
  advanceRecovery: Paise;
  alreadyPaid: Paise;
  balancePayable: Paise;
  carryAdvance: Paise;
  payslipId?: string;
}

export interface ProfitSettlement {
  id: string;
  month: string;
  status: 'DRAFT' | 'FINALIZED' | 'CANCELLED';
  sales: Paise;
  purchases: Paise;
  grossProfit: Paise;
  loanTrancheId?: string;
  loanRepaymentRequested: Paise;
  loanRepayment: Paise;
  loanRepaymentUnpaid: Paise;
  poolAfterLoan: Paise;
  shareBase: Paise;
  shareBasis: ShareBasis;
  fixedHourlyTotal: Paise;
  shareTotal: Paise;
  workerTotal: Paise;
  scaleFactor: number;
  payableTotal: Paise;
  otherExpenses: Paise;
  ownerAmount: Paise;
  lines: SettlementLine[];
  loanRepaymentId?: string;
  finalizedAt?: string;
  cancelReason?: string;
  createdById: string;
  createdAt: string;
  companyProfileVersionId?: string;
}

export interface CompanyProfile {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  brandName: string;
  legalName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  phone: string;
  email: string;
  website?: string;
  gstin?: string;
  logoAssetId?: string;
  faviconAssetId?: string;
  invoiceTerms: string;
  footerNote: string;
  signatoryLabel: string;
  createdById: string;
}

export interface Asset {
  id: string;
  kind: 'LOGO' | 'FAVICON';
  mime: string;
  dataUrl: string;
  sha256: string;
  width: number;
  height: number;
  createdAt: string;
}

export interface OpeningBalance {
  id: string;
  kind: 'CASH' | 'BANK';
  refId?: string;
  amount: Paise;
  date: ISODate;
}

export interface LoginEvent {
  id: string;
  userId?: string;
  username: string;
  outcome: 'SUCCESS' | 'FAILED' | 'LOCKED' | 'LOGOUT' | 'TIMEOUT';
  ip: string;
  userAgent: string;
  at: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  userName: string;
  entity: string;
  entityId: string;
  action: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  ip: string;
  requestId: string;
  at: string;
}

export interface DomainEvent {
  seq: number;
  type: string;
  entity: string;
  entityId: string;
  summary: string;
  actorId: string;
  actorName: string;
  /** Users who may receive this event; empty means admin-only. "*" means everyone except restricted. */
  audience: string[];
  amount?: Paise;
  at: string;
}

export interface CompanyBranding {
  brandName: string;
  logoDataUrl?: string;
  faviconDataUrl?: string;
  versionNo: number;
}
