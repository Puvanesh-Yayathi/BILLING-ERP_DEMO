import { addDays, formatINR, type ExpenseInput, type ISODate, type Expense, type PaymentMode } from '@app/contract';
import { audit, COMPANY_AUDIENCE, emit, newId, type Ctx } from '../ctx.js';
import { notFound } from '../errors.js';
import type { State } from '../state.js';
import { defaultBank } from './masters.js';
import { find, inRange, outstanding, requireRole } from './util.js';

export function createExpense(s: State, ctx: Ctx, i: ExpenseInput): Expense {
  requireRole(ctx, 'ADMIN', 'OPERATING');
  const head = find(s.expenseHeads, i.headId, 'Expense head');
  const e: Expense = { ...i, id: newId(s, 'exp'), createdById: ctx.actor.id, createdAt: ctx.now };
  s.expenses.push(e);
  audit(ctx, 'expense', e.id, 'create', `Added ${head.name} expense of ${formatINR(e.amount)}: ${e.description}`, undefined, e);
  emit(ctx, 'expense.create', 'expense', e.id, `${ctx.actor.name} added an expense of ${formatINR(e.amount)}`, COMPANY_AUDIENCE, e.amount);
  return e;
}

export interface LedgerRow {
  date: ISODate;
  at: string;
  ref: string;
  refType: string;
  refId: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface Ledger {
  title: string;
  opening: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
  /** debit-positive (customer owes, cash in hand) or credit-positive (we owe the supplier) */
  nature: 'DEBIT' | 'CREDIT';
}

type Raw = Omit<LedgerRow, 'balance'>;

function build(title: string, openingBase: number, raw: Raw[], nature: Ledger['nature'], from?: ISODate, to?: ISODate): Ledger {
  const sign = nature === 'DEBIT' ? 1 : -1;
  const sorted = raw.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  let opening = openingBase;
  for (const r of sorted) if (from && r.date < from) opening += sign * (r.debit - r.credit);
  let bal = opening;
  const rows: LedgerRow[] = [];
  for (const r of sorted) {
    if (!inRange(r.date, from, to)) continue;
    bal += sign * (r.debit - r.credit);
    rows.push({ ...r, balance: bal });
  }
  return {
    title,
    opening,
    rows,
    totalDebit: rows.reduce((a, r) => a + r.debit, 0),
    totalCredit: rows.reduce((a, r) => a + r.credit, 0),
    closing: bal,
    nature,
  };
}

export function customerLedger(s: State, customerId: string, from?: ISODate, to?: ISODate): Ledger {
  const c = find(s.customers, customerId, 'Customer');
  const raw: Raw[] = [];
  for (const inv of s.invoices) {
    if (inv.customerId !== c.id || inv.status === 'DRAFT' || inv.status === 'CANCELLED') continue;
    raw.push({ date: inv.date, at: inv.finalizedAt ?? inv.createdAt, ref: inv.number ?? '', refType: 'invoice', refId: inv.id, particulars: `${inv.type === 'CASH' ? 'Cash' : inv.type === 'CREDIT' ? 'Credit' : 'Distributor'} bill`, debit: inv.grandTotal, credit: 0 });
  }
  for (const p of s.payments) {
    if (p.customerId !== c.id) continue;
    raw.push({ date: p.date, at: p.createdAt, ref: p.receiptNo, refType: 'payment', refId: p.id, particulars: `Payment received (${p.mode.toLowerCase()})${p.reference ? `, ${p.reference}` : ''}`, debit: 0, credit: p.amount });
  }
  return build(c.name, c.openingBalance, raw, 'DEBIT', from, to);
}

export function supplierLedger(s: State, supplierId: string, from?: ISODate, to?: ISODate): Ledger {
  const v = find(s.suppliers, supplierId, 'Supplier');
  const raw: Raw[] = [];
  for (const g of s.goodsReceipts) {
    const ind = s.indents.find((i) => i.id === g.indentId);
    if (ind?.supplierId !== v.id) continue;
    raw.push({ date: g.date, at: g.createdAt, ref: g.supplierBillNo, refType: 'purchase-bill', refId: g.id, particulars: `Purchase bill against ${ind.number}`, debit: 0, credit: g.billAmount });
  }
  for (const p of s.supplierPayments) {
    if (p.supplierId !== v.id) continue;
    const ind = s.indents.find((i) => i.id === p.indentId);
    raw.push({ date: p.date, at: p.createdAt, ref: p.number, refType: 'supplier-payment', refId: p.id, particulars: `Payment on ${ind?.number ?? ''} (${p.mode.toLowerCase()})`, debit: p.amount, credit: 0 });
  }
  return build(v.name, v.openingBalance, raw, 'CREDIT', from, to);
}

export interface MoneyMove {
  date: ISODate;
  at: string;
  ref: string;
  refType: string;
  refId: string;
  particulars: string;
  mode: PaymentMode | 'BANK';
  inflow: number;
  outflow: number;
}

/** Every movement of money, used by the cash and bank ledgers, day book and cash flow book. */
export function moneyMoves(s: State): MoneyMove[] {
  const out: MoneyMove[] = [];
  const cust = (id?: string) => s.customers.find((c) => c.id === id)?.name ?? 'Walk-in customer';
  for (const p of s.payments)
    out.push({ date: p.date, at: p.createdAt, ref: p.receiptNo, refType: 'payment', refId: p.id, particulars: `Receipt from ${cust(p.customerId)}`, mode: p.mode, inflow: p.amount, outflow: 0 });
  for (const t of s.tranches)
    out.push({ date: t.date, at: t.createdAt, ref: t.isLoan ? 'Loan' : 'Fund', refType: 'fund-tranche', refId: t.id, particulars: `${t.isLoan ? `Loan from ${t.lender}` : `Fund from ${t.source}`}`, mode: 'BANK', inflow: t.amount, outflow: 0 });
  for (const p of s.supplierPayments) {
    const sup = s.suppliers.find((x) => x.id === p.supplierId)?.name ?? '';
    out.push({ date: p.date, at: p.createdAt, ref: p.number, refType: 'supplier-payment', refId: p.id, particulars: `Paid ${sup}`, mode: p.mode, inflow: 0, outflow: p.amount });
  }
  for (const e of s.expenses) {
    const head = s.expenseHeads.find((h) => h.id === e.headId)?.name ?? '';
    out.push({ date: e.date, at: e.createdAt, ref: head, refType: 'expense', refId: e.id, particulars: `${head}: ${e.description}`, mode: e.mode, inflow: 0, outflow: e.amount });
  }
  for (const p of s.payslips) {
    if (p.status !== 'PAID' || !p.paidOn || !p.mode || p.net <= 0) continue;
    const st = s.staff.find((x) => x.id === p.staffId)?.name ?? '';
    out.push({ date: p.paidOn, at: p.paidOn, ref: p.number ?? '', refType: 'payslip', refId: p.id, particulars: `Salary paid to ${st}`, mode: p.mode, inflow: 0, outflow: p.net });
  }
  for (const a of s.advances) {
    const st = s.staff.find((x) => x.id === a.staffId)?.name ?? '';
    if (a.settlementId) continue;
    out.push({ date: a.date, at: a.date, ref: 'Advance', refType: 'advance', refId: a.id, particulars: `Advance to ${st}`, mode: a.mode, inflow: 0, outflow: a.amount });
  }
  for (const r of s.loanRepayments) {
    const t = s.tranches.find((x) => x.id === r.trancheId);
    out.push({ date: r.date, at: r.date, ref: 'Loan repayment', refType: 'loan-repayment', refId: r.id, particulars: `Loan repayment to ${t?.lender ?? ''}`, mode: r.mode, inflow: 0, outflow: r.amount });
  }
  return out;
}

const isCash = (m: MoneyMove['mode']) => m === 'CASH';

export function cashLedger(s: State, from?: ISODate, to?: ISODate): Ledger {
  const raw = moneyMoves(s)
    .filter((m) => isCash(m.mode))
    .map((m) => ({ date: m.date, at: m.at, ref: m.ref, refType: m.refType, refId: m.refId, particulars: m.particulars, debit: m.inflow, credit: m.outflow }));
  return build('Cash', s.openingCash, raw, 'DEBIT', from, to);
}

export function bankLedger(s: State, bankId: string | undefined, from?: ISODate, to?: ISODate): Ledger {
  const bank = bankId ? find(s.bankAccounts, bankId, 'Bank account') : defaultBank(s);
  if (!bank) throw notFound('Bank account');
  const raw = moneyMoves(s)
    .filter((m) => !isCash(m.mode))
    .map((m) => ({ date: m.date, at: m.at, ref: m.ref, refType: m.refType, refId: m.refId, particulars: `${m.particulars} (${m.mode.toLowerCase()})`, debit: m.inflow, credit: m.outflow }));
  const isDefault = bank.id === defaultBank(s)?.id;
  return build(`${bank.bankName} ${bank.accountNo.slice(-4)}`, bank.openingBalance, isDefault ? raw : [], 'DEBIT', from, to);
}

export function expenseHeadLedger(s: State, headId: string, from?: ISODate, to?: ISODate): Ledger {
  const h = find(s.expenseHeads, headId, 'Expense head');
  const raw = s.expenses
    .filter((e) => e.headId === h.id)
    .map((e) => ({ date: e.date, at: e.createdAt, ref: e.mode, refType: 'expense', refId: e.id, particulars: e.description, debit: e.amount, credit: 0 }));
  return build(h.name, 0, raw, 'DEBIT', from, to);
}

/** Staff ledger: advances and salary paid are debits, salary earned is a credit. Balance = advance outstanding. */
export function staffLedger(s: State, staffId: string, from?: ISODate, to?: ISODate): Ledger {
  const st = find(s.staff, staffId, 'Worker');
  const raw: Raw[] = [];
  for (const a of s.advances.filter((x) => x.staffId === st.id))
    raw.push({ date: a.date, at: a.date, ref: 'Advance', refType: 'advance', refId: a.id, particulars: a.settlementId ? 'Carried forward as advance from settlement' : `Advance (${a.mode.toLowerCase()})${a.note ? `, ${a.note}` : ''}`, debit: a.amount, credit: 0 });
  for (const p of s.payslips.filter((x) => x.staffId === st.id && x.status === 'PAID')) {
    const date = p.paidOn ?? p.periodTo;
    const earned = p.net + p.advanceRecovery + p.alreadyPaid;
    raw.push({ date, at: `${date}T00:00:01`, ref: p.number ?? '', refType: 'payslip', refId: p.id, particulars: `Salary for ${p.periodFrom} to ${p.periodTo}`, debit: 0, credit: earned });
    if (p.alreadyPaid) raw.push({ date, at: `${date}T00:00:02`, ref: p.number ?? '', refType: 'payslip', refId: p.id, particulars: 'Already paid by earlier payslips this month', debit: p.alreadyPaid, credit: 0 });
    if (p.net > 0) raw.push({ date, at: `${date}T00:00:03`, ref: p.number ?? '', refType: 'payslip', refId: p.id, particulars: `Salary paid (${(p.mode ?? '').toLowerCase()})`, debit: p.net, credit: 0 });
  }
  return build(st.name, 0, raw, 'DEBIT', from, to);
}

export function customerBalance(s: State, customerId: string): number {
  return customerLedger(s, customerId).closing;
}

export interface DuesRow {
  customerId: string;
  code: string;
  name: string;
  type: string;
  phone: string;
  balance: number;
  b0_15: number;
  b16_30: number;
  b31: number;
  overdue: number;
  overdueCount: number;
  oldestDue?: ISODate;
}

/** Customer balances with ageing by bill date: 0 to 15, 16 to 30, 31+ days. Opening balance counts as 31+. */
export function dues(s: State, today: ISODate, customerIds?: Set<string>): DuesRow[] {
  return s.customers
    .filter((c) => !customerIds || customerIds.has(c.id))
    .map((c) => {
      const open = s.invoices.filter((i) => i.customerId === c.id && outstanding(i) > 0);
      const row: DuesRow = { customerId: c.id, code: c.code, name: c.name, type: c.type, phone: c.phone, balance: customerBalance(s, c.id), b0_15: 0, b16_30: 0, b31: Math.max(0, c.openingBalance), overdue: 0, overdueCount: 0 };
      for (const i of open) {
        const age = Math.round((Date.parse(today) - Date.parse(i.date)) / 86400000);
        const o = outstanding(i);
        if (age <= 15) row.b0_15 += o;
        else if (age <= 30) row.b16_30 += o;
        else row.b31 += o;
        if (i.dueDate && i.dueDate < today) {
          row.overdue += o;
          row.overdueCount++;
          if (!row.oldestDue || i.dueDate < row.oldestDue) row.oldestDue = i.dueDate;
        }
      }
      return row;
    })
    .filter((r) => r.balance !== 0 || r.b0_15 + r.b16_30 + r.b31 > 0);
}

export interface DayBookRow {
  date: ISODate;
  at: string;
  kind: string;
  ref: string;
  refType: string;
  refId: string;
  particulars: string;
  debit: number;
  credit: number;
}

export function dayBook(s: State, from: ISODate, to: ISODate): DayBookRow[] {
  const rows: DayBookRow[] = [];
  for (const inv of s.invoices) {
    if (!inv.number || inv.status === 'DRAFT' || !inRange(inv.date, from, to)) continue;
    const who = s.customers.find((c) => c.id === inv.customerId)?.name ?? inv.walkInName ?? 'Walk-in customer';
    rows.push({ date: inv.date, at: inv.finalizedAt ?? inv.createdAt, kind: inv.status === 'CANCELLED' ? 'Sale (cancelled)' : 'Sale', ref: inv.number, refType: 'invoice', refId: inv.id, particulars: who, debit: inv.status === 'CANCELLED' ? 0 : inv.grandTotal, credit: 0 });
  }
  for (const g of s.goodsReceipts) {
    if (!inRange(g.date, from, to)) continue;
    const ind = s.indents.find((i) => i.id === g.indentId);
    const sup = s.suppliers.find((x) => x.id === ind?.supplierId)?.name ?? '';
    rows.push({ date: g.date, at: g.createdAt, kind: 'Purchase', ref: g.supplierBillNo, refType: 'purchase-bill', refId: g.id, particulars: sup, debit: 0, credit: g.billAmount });
  }
  for (const m of moneyMoves(s)) {
    if (!inRange(m.date, from, to)) continue;
    rows.push({ date: m.date, at: m.at, kind: m.inflow ? 'Receipt' : 'Payment', ref: m.ref, refType: m.refType, refId: m.refId, particulars: `${m.particulars} (${m.mode.toLowerCase()})`, debit: m.inflow, credit: m.outflow });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}

export interface CashFlowDay {
  date: ISODate;
  cashIn: number;
  cashOut: number;
  cashClosing: number;
  bankIn: number;
  bankOut: number;
  bankClosing: number;
}

export function cashFlow(s: State, from: ISODate, to: ISODate) {
  const cash = cashLedger(s, from, to);
  const bank = bankLedger(s, undefined, from, to);
  const days: CashFlowDay[] = [];
  let cBal = cash.opening;
  let bBal = bank.opening;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const cr = cash.rows.filter((r) => r.date === d);
    const br = bank.rows.filter((r) => r.date === d);
    if (!cr.length && !br.length) continue;
    const day: CashFlowDay = {
      date: d,
      cashIn: cr.reduce((a, r) => a + r.debit, 0),
      cashOut: cr.reduce((a, r) => a + r.credit, 0),
      cashClosing: 0,
      bankIn: br.reduce((a, r) => a + r.debit, 0),
      bankOut: br.reduce((a, r) => a + r.credit, 0),
      bankClosing: 0,
    };
    cBal += day.cashIn - day.cashOut;
    bBal += day.bankIn - day.bankOut;
    day.cashClosing = cBal;
    day.bankClosing = bBal;
    days.push(day);
  }
  return { cashOpening: cash.opening, bankOpening: bank.opening, cashClosing: cash.closing, bankClosing: bank.closing, days };
}
