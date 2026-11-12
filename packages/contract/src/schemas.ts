import { z } from 'zod';

/** Request schemas shared by the server (validation, OpenAPI) and the web app (forms). */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Choose a month');
const paise = z.number({ invalid_type_error: 'Enter an amount' }).int('Amount must be in paise').min(0, 'Amount cannot be negative');
const signedPaise = z.number().int();
const qty = z
  .number({ invalid_type_error: 'Enter a quantity' })
  .positive('Enter a quantity greater than zero')
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Use at most 3 decimals');
const text = (label: string, max = 200) => z.string().trim().min(1, `Enter ${label}`).max(max, `${label} is too long`);
const optText = (max = 200) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));
const mode = z.enum(['CASH', 'UPI', 'BANK', 'CARD']);
const reason = z.string().trim().min(3, 'Enter a reason of at least 3 characters').max(300);
const gstinRe = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(gstinRe, 'Enter a 15-character GSTIN, for example 33AAAAA0000A1Z5')
  .optional()
  .or(z.literal('').transform(() => undefined));
const phone = z.string().trim().regex(/^\+?[0-9 ]{10,15}$/, 'Enter a phone number of 10 digits');
const pct = z.number().min(0, 'Enter 0 or more').max(100, 'Enter 100 or less');

export const LoginBody = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(40),
  password: z.string().min(1, 'Enter your password').max(100),
});

export const loginIdRule = z
  .string()
  .trim()
  .min(4, 'Login ID needs 4 to 20 characters')
  .max(20, 'Login ID needs 4 to 20 characters')
  .regex(/^[a-z0-9._-]+$/i, 'Use letters, numbers, dot, dash or underscore');
export const passwordRule = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(64)
  .regex(/[A-Za-z]/, 'Include a letter')
  .regex(/[0-9]/, 'Include a number');

export const PayFields = z.object({
  payType: z.enum(['FIXED', 'HOURLY', 'SHARE']),
  basePay: paise.optional(),
  hourlyRate: paise.optional(),
  sharePercent: pct.optional(),
  reduceByAbsence: z.boolean().default(false),
});

function payRefine<T extends z.infer<typeof PayFields>>(v: T, ctx: z.RefinementCtx) {
  if (v.payType === 'FIXED' && !v.basePay) ctx.addIssue({ code: 'custom', path: ['basePay'], message: 'Enter the monthly base pay' });
  if (v.payType === 'HOURLY' && !v.hourlyRate) ctx.addIssue({ code: 'custom', path: ['hourlyRate'], message: 'Enter the rate per hour' });
  if (v.payType === 'SHARE' && !v.sharePercent) ctx.addIssue({ code: 'custom', path: ['sharePercent'], message: 'Enter the share percentage' });
}

export const WorkerCreateBody = PayFields.extend({
  name: text('a name', 80),
  phone,
  role: z.enum(['STAFF', 'OPERATING']).optional(),
  withLogin: z.boolean(),
  loginId: loginIdRule.optional(),
  password: passwordRule.optional(),
  joinDate: date,
}).superRefine((v, ctx) => {
  payRefine(v, ctx);
  if (v.withLogin) {
    if (!v.loginId) ctx.addIssue({ code: 'custom', path: ['loginId'], message: 'Enter a login ID' });
    if (!v.password) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Enter a password' });
    if (!v.role) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Choose Staff or Operating' });
  }
});

export const WorkerUpdateBody = PayFields.extend({
  name: text('a name', 80),
  phone,
  role: z.enum(['STAFF', 'OPERATING']).optional(),
  active: z.boolean(),
}).superRefine(payRefine);

export const ResetPasswordBody = z.object({ password: passwordRule });

export const UserCreateBody = z.object({
  name: text('a name', 80),
  username: loginIdRule,
  password: passwordRule,
  role: z.enum(['ADMIN', 'MONITOR', 'COLLECTOR', 'DISTRIBUTOR']),
  customerId: z.string().optional(),
});
export const UserUpdateBody = z.object({
  name: text('a name', 80),
  active: z.boolean(),
  password: passwordRule.optional().or(z.literal('').transform(() => undefined)),
});

export const SettingsBody = z.object({
  maxWorkerLogins: z.number().int().min(1).max(100),
  hoursRounding: z.enum(['NEAREST', 'UP', 'EXACT']),
  creditDays: z.number().int().min(0).max(180),
  halfDayRuleEnabled: z.boolean(),
  halfDayMinHours: z.number().int().min(1).max(12),
  reduceByAbsenceDefault: z.boolean(),
  shareBasis: z.enum(['POOL', 'NET']),
  idleTimeoutMinutes: z.number().int().min(5).max(120),
  rateLimitLoginPerMinute: z.number().int().min(3).max(50),
  rateLimitApiPerMinute: z.number().int().min(30).max(2000),
});

export const CalendarBody = z.object({ weeklyOffs: z.array(z.number().int().min(0).max(6)).max(3) });
export const HolidayBody = z.object({ date, name: text('a name', 60) });

export const CompanyProfileBody = z
  .object({
    brandName: text('a brand name', 80),
    legalName: optText(120),
    addressLine1: text('an address', 120),
    addressLine2: optText(120),
    city: text('a city', 60),
    state: text('a state', 60),
    stateCode: z.string().regex(/^\d{2}$/, 'Enter the 2-digit state code'),
    pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
    phone,
    email: z.string().trim().email('Enter an email address'),
    website: optText(120),
    gstin,
    logoAssetId: z.string().optional(),
    faviconAssetId: z.string().optional(),
    invoiceTerms: text('invoice terms', 500),
    footerNote: z.string().trim().max(200),
    signatoryLabel: text('a signatory label', 60),
  })
  .superRefine((v, ctx) => {
    if (v.gstin && v.gstin.slice(0, 2) !== v.stateCode)
      ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'The first two digits of the GSTIN must match the state code' });
  });

export const LogoBody = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpeg|svg\+xml);base64,/, 'Upload a PNG, JPG or SVG image'),
  faviconDataUrl: z.string().regex(/^data:image\/png;base64,/),
  width: z.number().int().max(512),
  height: z.number().int().max(512),
});

export const CustomerBody = z.object({
  name: text('a name', 80),
  type: z.enum(['RETAIL', 'DISTRIBUTOR']),
  phone,
  email: z.string().trim().email('Enter an email address').optional().or(z.literal('').transform(() => undefined)),
  address: text('an address', 200),
  gstin,
  state: text('a state', 60),
  stateCode: z.string().regex(/^\d{2}$/, 'Enter the 2-digit state code'),
  openingBalance: signedPaise.default(0),
  active: z.boolean().default(true),
});

export const SupplierBody = z.object({
  name: text('a name', 80),
  phone,
  address: text('an address', 200),
  gstin,
  state: text('a state', 60),
  openingBalance: signedPaise.default(0),
  active: z.boolean().default(true),
});

export const ProductBody = z.object({
  code: z.string().trim().toUpperCase().min(2, 'Enter a product code').max(20).regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and dashes'),
  name: text('a name', 80),
  categoryId: z.string().min(1, 'Choose a category'),
  unitId: z.string().min(1, 'Choose a unit'),
  hsn: optText(10),
  gstRate: z.number().refine((v) => [0, 5, 12, 18, 28].includes(v), 'Choose a GST rate'),
  taxInclusive: z.boolean(),
  mrp: paise,
  retailPrice: paise.positive('Enter the retail price'),
  distributorPrice: paise.positive('Enter the distributor price'),
  reorderLevel: z.number().min(0),
  active: z.boolean().default(true),
});

export const PurchaseItemBody = z.object({
  name: text('a name', 80),
  category: z.enum(['RAW_MATERIAL', 'PACKAGING', 'CONSUMABLE', 'OTHER']),
  unitId: z.string().min(1, 'Choose a unit'),
  preferredSupplierId: z.string().optional(),
  lastRate: paise,
  reorderLevel: z.number().min(0),
  active: z.boolean().default(true),
});

export const NameBody = z.object({ name: text('a name', 60) });

export const BankAccountBody = z.object({
  bankName: text('a bank name', 80),
  accountName: text('an account name', 80),
  accountNo: z.string().regex(/^\d{6,18}$/, 'Enter 6 to 18 digits'),
  ifsc: z.string().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter an 11-character IFSC'),
  upiId: z.string().regex(/^[\w.-]+@[\w.-]+$/, 'Enter a UPI ID like name@bank'),
  isInvoiceDefault: z.boolean(),
  openingBalance: signedPaise.default(0),
});

export const OpeningBalanceBody = z.object({
  cash: signedPaise,
  customers: z.array(z.object({ id: z.string(), amount: signedPaise })).default([]),
  suppliers: z.array(z.object({ id: z.string(), amount: signedPaise })).default([]),
  banks: z.array(z.object({ id: z.string(), amount: signedPaise })).default([]),
});

export const ImportCommitBody = z.object({ rows: z.array(z.record(z.unknown())).max(500) });

export const InvoiceLineBody = z.object({
  productId: z.string().min(1, 'Choose a product'),
  qty,
  rate: paise.optional(),
  discountPct: pct.default(0),
});

export const InvoiceBody = z
  .object({
    type: z.enum(['CASH', 'CREDIT', 'DISTRIBUTOR']),
    customerId: z.string().optional(),
    walkInName: optText(80),
    date: date.optional(),
    items: z.array(InvoiceLineBody).min(1, 'Add at least one product').max(200),
    notes: optText(300),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'CASH' && !v.customerId) ctx.addIssue({ code: 'custom', path: ['customerId'], message: 'Choose a customer' });
  });

export const CancelBody = z.object({ reason });

export const PaymentBody = z.object({
  customerId: z.string().min(1, 'Choose a customer'),
  invoiceId: z.string().optional(),
  mode,
  amount: paise.positive('Enter an amount greater than zero'),
  reference: optText(60),
  date: date.optional(),
});

export const OrderRequestBody = z.object({
  items: z.array(z.object({ productId: z.string(), qty })).min(1, 'Add at least one product'),
  note: z.string().trim().max(300).default(''),
});
export const RemarkBody = z.object({ remark: text('a remark', 300) });

export const TrancheBody = z
  .object({
    date,
    source: text('a source', 80),
    amount: paise.positive('Enter an amount greater than zero'),
    note: z.string().trim().max(200).default(''),
    isLoan: z.boolean(),
    lender: optText(80),
  })
  .superRefine((v, ctx) => {
    if (v.isLoan && !v.lender) ctx.addIssue({ code: 'custom', path: ['lender'], message: 'Enter the lender name' });
  });

export const IndentBody = z.object({
  supplierId: z.string().min(1, 'Choose a supplier'),
  date: date.optional(),
  note: z.string().trim().max(300).default(''),
  items: z
    .array(z.object({ rawMaterialId: z.string().min(1, 'Choose an item'), qty, rate: paise.positive('Enter a rate') }))
    .min(1, 'Add at least one item')
    .max(50),
});

export const RemarksBody = z.object({ remarks: z.string().trim().max(300).default('') });
export const RejectBody = z.object({ remarks: text('remarks', 300) });

export const PurchaseBillBody = z.object({
  indentId: z.string().min(1, 'Choose an approved indent'),
  date: date.optional(),
  supplierBillNo: text('the supplier bill number', 40),
  supplierBillDate: date,
  billAmount: paise.positive('Enter the bill amount'),
  note: z.string().trim().max(300).default(''),
  items: z.array(z.object({ rawMaterialId: z.string(), qty: z.number().min(0), rate: paise })).min(1),
});

export const SupplierPaymentBody = z.object({
  indentId: z.string().min(1, 'Choose an indent'),
  date: date.optional(),
  mode,
  amount: paise.positive('Enter an amount greater than zero'),
  reference: optText(60),
});

export const StockAdjustmentBody = z.object({
  kind: z.enum(['PURCHASE', 'SALES']),
  itemId: z.string().min(1, 'Choose an item'),
  qty: z.number().refine((v) => v !== 0, 'Enter a quantity other than zero'),
  reason,
});

export const StockCountBody = z.object({
  kind: z.enum(['PURCHASE', 'SALES']),
  lines: z
    .array(z.object({ itemId: z.string(), countedQty: z.number().min(0, 'Count cannot be negative'), reason: z.string().trim().max(200).default('') }))
    .min(1, 'Count at least one item'),
});

export const ProductionBody = z.object({
  date: date.optional(),
  inputs: z.array(z.object({ rawMaterialId: z.string().min(1), qty })).min(1, 'Add at least one input'),
  outputs: z.array(z.object({ productId: z.string().min(1), qty })).min(1, 'Add at least one output'),
  wastageQty: z.number().min(0),
  wastageNote: z.string().trim().max(200).default(''),
});

export const ExpenseBody = z.object({
  date,
  headId: z.string().min(1, 'Choose a head'),
  amount: paise.positive('Enter an amount greater than zero'),
  mode: mode.default('CASH'),
  description: text('a description', 200),
});

export const AttendanceEditBody = z.object({
  status: z.enum(['PRESENT', 'ABSENT', 'HALF', 'LEAVE']),
  paidHours: z.number().min(0).max(24),
  reason,
});

export const AttendanceManualBody = z.object({
  staffId: z.string().min(1),
  date,
  status: z.enum(['PRESENT', 'ABSENT', 'HALF', 'LEAVE']),
  paidHours: z.number().min(0).max(24),
  reason: z.string().trim().max(300).default('Manual entry'),
});

export const AdvanceBody = z.object({
  staffId: z.string().min(1, 'Choose a worker'),
  date,
  amount: paise.positive('Enter an amount greater than zero'),
  mode,
  note: z.string().trim().max(200).default(''),
});

const lineItem = z.object({ label: text('a label', 60), amount: paise.positive('Enter an amount') });

export const PayslipPreviewBody = z
  .object({
    staffId: z.string().min(1, 'Choose a worker'),
    periodFrom: date,
    periodTo: date,
    allowances: z.array(lineItem).default([]),
    deductions: z.array(lineItem).default([]),
    advanceRecovery: paise.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.periodFrom.slice(0, 7) !== v.periodTo.slice(0, 7))
      ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'The period must stay inside one calendar month' });
    if (v.periodTo < v.periodFrom) ctx.addIssue({ code: 'custom', path: ['periodTo'], message: 'End date is before the start date' });
  });

export const PayBody = z.object({ date, mode, reference: optText(60) });
export const PayAllBody = PayBody.extend({ ids: z.array(z.string()).min(1, 'Select at least one payslip') });
export const BulkDraftsBody = z.object({ month });

export const SettlementBody = z.object({
  month,
  loanTrancheId: z.string().optional(),
  loanRepayment: paise.default(0),
  adjustments: z
    .array(z.object({ staffId: z.string(), amount: signedPaise, reason: text('a reason', 200) }))
    .default([]),
  advanceRecoveries: z.array(z.object({ staffId: z.string(), amount: paise })).default([]),
});

export type LoginInput = z.infer<typeof LoginBody>;
export type WorkerCreateInput = z.infer<typeof WorkerCreateBody>;
export type WorkerUpdateInput = z.infer<typeof WorkerUpdateBody>;
export type UserCreateInput = z.infer<typeof UserCreateBody>;
export type UserUpdateInput = z.infer<typeof UserUpdateBody>;
export type SettingsInput = z.infer<typeof SettingsBody>;
export type CompanyProfileInput = z.infer<typeof CompanyProfileBody>;
export type CustomerInput = z.infer<typeof CustomerBody>;
export type SupplierInput = z.infer<typeof SupplierBody>;
export type ProductInput = z.infer<typeof ProductBody>;
export type PurchaseItemInput = z.infer<typeof PurchaseItemBody>;
export type BankAccountInput = z.infer<typeof BankAccountBody>;
export type InvoiceInput = z.infer<typeof InvoiceBody>;
export type PaymentInput = z.infer<typeof PaymentBody>;
export type OrderRequestInput = z.infer<typeof OrderRequestBody>;
export type TrancheInput = z.infer<typeof TrancheBody>;
export type IndentInput = z.infer<typeof IndentBody>;
export type PurchaseBillInput = z.infer<typeof PurchaseBillBody>;
export type SupplierPaymentInput = z.infer<typeof SupplierPaymentBody>;
export type StockAdjustmentInput = z.infer<typeof StockAdjustmentBody>;
export type StockCountInput = z.infer<typeof StockCountBody>;
export type ProductionInput = z.infer<typeof ProductionBody>;
export type ExpenseInput = z.infer<typeof ExpenseBody>;
export type AttendanceEditInput = z.infer<typeof AttendanceEditBody>;
export type AttendanceManualInput = z.infer<typeof AttendanceManualBody>;
export type AdvanceInput = z.infer<typeof AdvanceBody>;
export type PayslipPreviewInput = z.infer<typeof PayslipPreviewBody>;
export type PayInput = z.infer<typeof PayBody>;
export type SettlementInputBody = z.infer<typeof SettlementBody>;
