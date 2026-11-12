import {
  addDays,
  diffDays,
  istMinuteOfDay,
  parseDate,
  roundQty,
  weekday,
  type Invoice,
  type ISODate,
} from '@app/contract';
import type { Ctx } from '../ctx.js';
import type { State } from '../state.js';
import { summarize } from './attendance.js';
import { purchaseTracker, salesTracker } from './inventory.js';
import { dues } from './ledgers.js';
import { fundFigures, loansWithOutstanding } from './purchasing.js';
import { displayStatus, inRange, outstanding, userName } from './util.js';

export type Period = 'day' | 'week' | 'month' | 'year';

export interface Range {
  from: ISODate;
  to: ISODate;
  label: string;
}

/** Week = Monday to Sunday. Year = financial year (April to March). */
export function periodRange(period: Period, date: ISODate): Range {
  const { y, m } = parseDate(date);
  if (period === 'day') return { from: date, to: date, label: date };
  if (period === 'week') {
    const from = addDays(date, -((weekday(date) + 6) % 7));
    return { from, to: addDays(from, 6), label: `Week of ${from}` };
  }
  if (period === 'month') {
    const from = `${date.slice(0, 7)}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { from, to: addDays(next, -1), label: date.slice(0, 7) };
  }
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String((start + 1) % 100).padStart(2, '0')}` };
}

export function previousRange(period: Period, r: Range): Range {
  if (period === 'day') return periodRange('day', addDays(r.from, -1));
  if (period === 'week') return periodRange('week', addDays(r.from, -7));
  if (period === 'month') return periodRange('month', addDays(r.from, -1));
  return periodRange('year', addDays(r.from, -1));
}

const live = (i: Invoice) => i.status === 'SENT' || i.status === 'PAID';

function bucketKeys(period: Period, r: Range): { key: string; label: string }[] {
  if (period === 'day') return Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${h}:00` }));
  if (period === 'year') {
    const out: { key: string; label: string }[] = [];
    let d = r.from;
    for (let i = 0; i < 12; i++) {
      out.push({ key: d.slice(0, 7), label: d.slice(0, 7) });
      d = periodRange('month', addDays(periodRange('month', d).to, 1)).from;
    }
    return out;
  }
  const n = diffDays(r.to, r.from) + 1;
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(r.from, i);
    return { key: d, label: d };
  });
}

function bucketOf(period: Period, date: ISODate, at?: string): string {
  if (period === 'day') return String(at ? Math.floor(istMinuteOfDay(at) / 60) : 0);
  if (period === 'year') return date.slice(0, 7);
  return date;
}

function figures(s: State, r: Range, filter: (i: Invoice) => boolean = () => true) {
  const inv = s.invoices.filter((i) => live(i) && inRange(i.date, r.from, r.to) && filter(i));
  const sales = inv.reduce((a, i) => a + i.taxableTotal, 0);
  const salesGross = inv.reduce((a, i) => a + i.grandTotal, 0);
  const purchases = s.goodsReceipts.filter((g) => inRange(g.date, r.from, r.to)).reduce((a, g) => a + g.billAmount, 0);
  const collections = s.payments.filter((p) => inRange(p.date, r.from, r.to)).reduce((a, p) => a + p.amount, 0);
  const expenses = s.expenses.filter((e) => inRange(e.date, r.from, r.to)).reduce((a, e) => a + e.amount, 0);
  return { sales, salesGross, purchases, grossProfit: sales - purchases, bills: inv.length, avgBill: inv.length ? Math.round(salesGross / inv.length) : 0, collections, expenses, invoices: inv };
}

export function companyOverview(s: State, ctx: Ctx, period: Period, date: ISODate, compare: boolean) {
  const full = ctx.actor.role === 'ADMIN';
  const r = periodRange(period, date);
  const prev = previousRange(period, r);
  const cur = figures(s, r);
  const old = figures(s, prev);
  const buckets = bucketKeys(period, r);
  const prevBuckets = bucketKeys(period, prev);
  const series = buckets.map((b, idx) => {
    const sales = cur.invoices.filter((i) => bucketOf(period, i.date, i.finalizedAt) === b.key).reduce((a, i) => a + i.taxableTotal, 0);
    const purchases = s.goodsReceipts.filter((g) => inRange(g.date, r.from, r.to) && bucketOf(period, g.date, g.createdAt) === b.key).reduce((a, g) => a + g.billAmount, 0);
    const pb = prevBuckets[idx];
    const prevSales = pb ? old.invoices.filter((i) => bucketOf(period, i.date, i.finalizedAt) === pb.key).reduce((a, i) => a + i.taxableTotal, 0) : 0;
    return { key: b.key, label: b.label, sales, purchases, profit: full ? sales - purchases : undefined, prevSales: compare ? prevSales : undefined };
  });
  const byCustomer = new Map<string, number>();
  const byProduct = new Map<string, { qty: number; value: number }>();
  const byCategory = new Map<string, number>();
  const byWorker = new Map<string, { bills: number; value: number }>();
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const i of cur.invoices) {
    const cname = s.customers.find((c) => c.id === i.customerId)?.name ?? 'Walk-in customers';
    byCustomer.set(cname, (byCustomer.get(cname) ?? 0) + i.taxableTotal);
    const w = byWorker.get(i.createdById) ?? { bills: 0, value: 0 };
    w.bills++;
    w.value += i.taxableTotal;
    byWorker.set(i.createdById, w);
    if (i.finalizedAt) byHour[Math.floor(istMinuteOfDay(i.finalizedAt) / 60)]! += i.taxableTotal;
    for (const it of i.items) {
      const p = byProduct.get(it.productId) ?? { qty: 0, value: 0 };
      p.qty = roundQty(p.qty + it.qty);
      p.value += it.taxableValue;
      byProduct.set(it.productId, p);
      const prod = s.products.find((x) => x.id === it.productId);
      const cat = s.categories.find((c) => c.id === prod?.categoryId)?.name ?? 'Other';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + it.taxableValue);
    }
  }
  const modes = new Map<string, number>();
  for (const p of s.payments.filter((x) => inRange(x.date, r.from, r.to))) modes.set(p.mode, (modes.get(p.mode) ?? 0) + p.amount);
  const sales = salesTracker(s, ctx.today);
  const raw = purchaseTracker(s, ctx.today);
  const dueRows = dues(s, ctx.today);
  const fund = fundFigures(s);
  const loanOutstanding = loansWithOutstanding(s).reduce((a, l) => a + l.outstanding, 0);
  const batches = s.batches.filter((b) => inRange(b.date, r.from, r.to));
  const outputQty = roundQty(batches.reduce((a, b) => a + b.outputs.reduce((x, o) => x + o.qty, 0), 0));
  const inputQty = roundQty(batches.reduce((a, b) => a + b.inputs.reduce((x, o) => x + o.qty, 0), 0));
  const wastage = roundQty(batches.reduce((a, b) => a + b.wastageQty, 0));
  const pending = s.indents.filter((i) => i.status.startsWith('PENDING')).map((i) => ({
    id: i.id,
    number: i.number,
    stage: i.status === 'PENDING_S1' ? 1 : i.status === 'PENDING_S2' ? 2 : 3,
    total: i.total,
    supplier: s.suppliers.find((x) => x.id === i.supplierId)?.name ?? '',
  }));
  const loginStaff = s.staff.filter((x) => x.active);
  const presentToday = loginStaff.filter((x) => s.attendance.some((a) => a.staffId === x.id && a.date === ctx.today && (a.status === 'PRESENT' || a.status === 'HALF'))).length;
  const kpis = {
    sales: cur.sales,
    salesGross: cur.salesGross,
    purchases: cur.purchases,
    grossProfit: full ? cur.grossProfit : undefined,
    bills: cur.bills,
    avgBill: cur.avgBill,
    collections: cur.collections,
    dues: dueRows.reduce((a, d) => a + Math.max(0, d.balance), 0),
    overdue: dueRows.reduce((a, d) => a + d.overdue, 0),
    expenses: cur.expenses,
    fundReceived: fund.received,
    fundUtilised: fund.utilised,
    fundBalance: fund.balance,
    loanOutstanding: full ? loanOutstanding : undefined,
    finishedStockValue: sales.reduce((a, x) => a + x.value, 0),
    rawStockValue: raw.reduce((a, x) => a + x.value, 0),
  };
  const prevKpis = {
    sales: old.sales,
    purchases: old.purchases,
    grossProfit: full ? old.grossProfit : undefined,
    bills: old.bills,
    avgBill: old.avgBill,
    collections: old.collections,
    expenses: old.expenses,
  };
  return {
    range: r,
    previous: prev,
    kpis,
    prevKpis: compare ? prevKpis : null,
    series,
    topCustomers: [...byCustomer].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6),
    topProducts: [...byProduct]
      .map(([id, v]) => ({ id, name: s.products.find((p) => p.id === id)?.name ?? '', ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    categoryShare: [...byCategory].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 4),
    paymentModes: [...modes].map(([mode, value]) => ({ mode, value })).sort((a, b) => b.value - a.value),
    salesByHour: byHour.map((value, hour) => ({ hour, value })),
    workers: full
      ? [...byWorker].map(([id, v]) => ({ id, name: userName(s, id), ...v })).sort((a, b) => b.value - a.value)
      : [],
    lowStock: [...sales.filter((x) => x.status !== 'IN_STOCK').map((x) => ({ ...x, kind: 'sales' as const })), ...raw.filter((x) => x.status !== 'IN_STOCK').map((x) => ({ ...x, kind: 'purchase' as const }))],
    duesAgeing: {
      b0_15: dueRows.reduce((a, d) => a + d.b0_15, 0),
      b16_30: dueRows.reduce((a, d) => a + d.b16_30, 0),
      b31: dueRows.reduce((a, d) => a + d.b31, 0),
    },
    pendingApprovals: pending,
    production: { batches: batches.length, inputQty, outputQty, wastage, wastagePct: inputQty ? Math.round((wastage / inputQty) * 1000) / 10 : 0 },
    attendance: full ? { presentToday, activeWorkers: loginStaff.length } : null,
  };
}

/** Worker dashboard: only their own work and pay. */
export function myOverview(s: State, ctx: Ctx, period: Period, date: ISODate, compare: boolean) {
  const r = periodRange(period, date);
  const prev = previousRange(period, r);
  const own = (i: Invoice) => i.createdById === ctx.actor.id;
  const calc = (rg: Range) => {
    const inv = s.invoices.filter((i) => live(i) && own(i) && inRange(i.date, rg.from, rg.to));
    return {
      bills: inv.length,
      salesValue: inv.reduce((a, i) => a + i.grandTotal, 0),
      itemsSold: roundQty(inv.reduce((a, i) => a + i.items.reduce((x, it) => x + it.qty, 0), 0)),
      receipts: s.payments.filter((p) => p.createdById === ctx.actor.id && !p.auto && inRange(p.date, rg.from, rg.to)).length,
      receiptValue: s.payments.filter((p) => p.createdById === ctx.actor.id && inRange(p.date, rg.from, rg.to)).reduce((a, p) => a + p.amount, 0),
      batches: s.batches.filter((b) => b.createdById === ctx.actor.id && inRange(b.date, rg.from, rg.to)).length,
      invoices: inv,
    };
  };
  const cur = calc(r);
  const old = calc(prev);
  const staffId = ctx.actor.staffId;
  const att = staffId ? summarize(s, staffId, r.from, r.to < ctx.today ? r.to : ctx.today, ctx.today) : null;
  const paid = staffId
    ? s.payslips.filter((p) => p.staffId === staffId && p.status === 'PAID' && p.paidOn && inRange(p.paidOn, r.from, r.to)).reduce((a, p) => a + p.net, 0)
    : 0;
  const buckets = bucketKeys(period, r);
  const prevBuckets = bucketKeys(period, prev);
  const series = buckets.map((b, idx) => {
    const pb = prevBuckets[idx];
    return {
      key: b.key,
      label: b.label,
      sales: cur.invoices.filter((i) => bucketOf(period, i.date, i.finalizedAt) === b.key).reduce((a, i) => a + i.grandTotal, 0),
      prevSales: compare && pb ? old.invoices.filter((i) => bucketOf(period, i.date, i.finalizedAt) === pb.key).reduce((a, i) => a + i.grandTotal, 0) : undefined,
    };
  });
  const strip = ({ invoices: _i, ...rest }: ReturnType<typeof calc>) => rest;
  return {
    range: r,
    previous: prev,
    kpis: { ...strip(cur), daysWorked: att ? att.presentDays + att.halfDays + att.offDayWorkDays : 0, hoursWorked: att?.paidHours ?? 0, paid },
    prevKpis: compare ? strip(old) : null,
    series,
    recentBills: s.invoices
      .filter(own)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8)
      .map((i) => ({ id: i.id, number: i.number, date: i.date, total: i.grandTotal, status: displayStatus(i, ctx.today), customer: s.customers.find((c) => c.id === i.customerId)?.name ?? i.walkInName ?? '' })),
  };
}

export function explorerSales(s: State, ctx: Ctx, f: { from?: string; to?: string; createdById?: string; customerId?: string; type?: string; status?: string; q?: string }) {
  const own = ctx.actor.role === 'STAFF' || ctx.actor.role === 'OPERATING';
  const rows = s.invoices
    .filter((i) => i.status !== 'DRAFT' || own || ctx.actor.role === 'ADMIN')
    .filter((i) => (own ? i.createdById === ctx.actor.id : true))
    .filter((i) => inRange(i.date, f.from, f.to))
    .filter((i) => !f.createdById || i.createdById === f.createdById)
    .filter((i) => !f.customerId || i.customerId === f.customerId)
    .filter((i) => !f.type || i.type === f.type)
    .filter((i) => !f.status || displayStatus(i, ctx.today) === f.status)
    .map((i) => ({
      id: i.id,
      number: i.number ?? 'Draft',
      date: i.date,
      type: i.type,
      status: displayStatus(i, ctx.today),
      customer: s.customers.find((c) => c.id === i.customerId)?.name ?? i.walkInName ?? 'Walk-in customer',
      customerId: i.customerId,
      createdById: i.createdById,
      createdBy: userName(s, i.createdById),
      taxable: i.taxableTotal,
      tax: i.cgst + i.sgst + i.igst,
      total: i.grandTotal,
      paid: i.paidAmount,
      balance: outstanding(i),
    }))
    .filter((r) => !f.q || `${r.number} ${r.customer} ${r.createdBy}`.toLowerCase().includes(f.q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  return rows;
}

export function explorerPurchases(s: State, ctx: Ctx, f: { from?: string; to?: string; createdById?: string; supplierId?: string; q?: string }) {
  const own = ctx.actor.role === 'OPERATING';
  return s.goodsReceipts
    .filter((g) => (own ? g.createdById === ctx.actor.id : true))
    .filter((g) => inRange(g.date, f.from, f.to))
    .filter((g) => !f.createdById || g.createdById === f.createdById)
    .map((g) => {
      const ind = s.indents.find((i) => i.id === g.indentId);
      return {
        id: g.id,
        number: g.number,
        supplierBillNo: g.supplierBillNo,
        date: g.date,
        indentId: g.indentId,
        indentNumber: ind?.number ?? '',
        supplierId: ind?.supplierId ?? '',
        supplier: s.suppliers.find((x) => x.id === ind?.supplierId)?.name ?? '',
        createdById: g.createdById,
        createdBy: userName(s, g.createdById),
        items: g.items.length,
        total: g.billAmount,
        variance: g.items.reduce((a, it) => a + (it.amount - Math.round(it.qty * it.indentRate)), 0),
      };
    })
    .filter((r) => !f.supplierId || r.supplierId === f.supplierId)
    .filter((r) => !f.q || `${r.number} ${r.supplierBillNo} ${r.supplier}`.toLowerCase().includes(f.q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
}
