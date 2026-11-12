import { canReport, REPORTS, roundQty, type ISODate } from '@app/contract';
import type { Ctx } from '../ctx.js';
import { forbidden, notFound } from '../errors.js';
import type { State } from '../state.js';
import { summarize } from './attendance.js';
import { purchaseTracker, salesTracker } from './inventory.js';
import { cashFlow, customerLedger, dayBook, dues } from './ledgers.js';
import { outstandingAdvance } from './payroll.js';
import { fundFigures, paidOnIndent, receivedValue } from './purchasing.js';
import { monthFigures } from './settlement.js';
import { inRange, userName } from './util.js';

export type ColType = 'text' | 'money' | 'qty' | 'date' | 'number' | 'pct';
export interface Column {
  key: string;
  label: string;
  type: ColType;
}
export type Row = Record<string, string | number | null>;
export interface Section {
  title: string;
  columns: Column[];
  rows: Row[];
  totals?: Row;
}
export interface Report {
  key: string;
  title: string;
  from: ISODate;
  to: ISODate;
  sections: Section[];
}

const c = (key: string, label: string, type: ColType = 'text'): Column => ({ key, label, type });

function totals(rows: Row[], cols: Column[], label = 'Total'): Row {
  const t: Row = {};
  cols.forEach((col, i) => {
    if (i === 0) t[col.key] = label;
    else if (col.type === 'money' || col.type === 'qty' || col.type === 'number')
      t[col.key] = col.type === 'qty' ? roundQty(rows.reduce((a, r) => a + Number(r[col.key] ?? 0), 0)) : rows.reduce((a, r) => a + Number(r[col.key] ?? 0), 0);
    else t[col.key] = null;
  });
  return t;
}

function section(title: string, columns: Column[], rows: Row[], withTotals = true): Section {
  return { title, columns, rows, totals: withTotals && rows.length ? totals(rows, columns) : undefined };
}

export function runReport(s: State, ctx: Ctx, key: string, from: ISODate, to: ISODate): Report {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw notFound('Report');
  if (!canReport(ctx.actor.role, key)) throw forbidden('This report is not available for your role');
  const live = s.invoices.filter((i) => (i.status === 'SENT' || i.status === 'PAID') && inRange(i.date, from, to));
  const sections: Section[] = [];
  const cust = (id?: string, walk?: string) => s.customers.find((x) => x.id === id)?.name ?? walk ?? 'Walk-in customer';

  switch (key) {
    case 'sales': {
      const own = ctx.actor.role === 'STAFF';
      const inv = own ? live.filter((i) => i.createdById === ctx.actor.id) : live;
      const byDay = new Map<string, Row>();
      for (const i of inv) {
        const r = byDay.get(i.date) ?? { date: i.date, bills: 0, taxable: 0, tax: 0, total: 0 };
        r.bills = Number(r.bills) + 1;
        r.taxable = Number(r.taxable) + i.taxableTotal;
        r.tax = Number(r.tax) + i.cgst + i.sgst + i.igst;
        r.total = Number(r.total) + i.grandTotal;
        byDay.set(i.date, r);
      }
      const dayCols = [c('date', 'Date', 'date'), c('bills', 'Bills', 'number'), c('taxable', 'Taxable value', 'money'), c('tax', 'GST', 'money'), c('total', 'Bill value', 'money')];
      sections.push(section('Day-wise sales', dayCols, [...byDay.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))));
      const byMonth = new Map<string, Row>();
      for (const r of byDay.values()) {
        const m = String(r.date).slice(0, 7);
        const x = byMonth.get(m) ?? { month: m, bills: 0, taxable: 0, tax: 0, total: 0 };
        for (const k of ['bills', 'taxable', 'tax', 'total']) x[k] = Number(x[k]) + Number(r[k]);
        byMonth.set(m, x);
      }
      sections.push(section('Month-wise sales', [c('month', 'Month'), ...dayCols.slice(1)], [...byMonth.values()]));
      const byCust = new Map<string, Row>();
      for (const i of inv) {
        const n = cust(i.customerId, i.walkInName ? 'Walk-in customers' : undefined);
        const r = byCust.get(n) ?? { customer: n, bills: 0, taxable: 0, total: 0 };
        r.bills = Number(r.bills) + 1;
        r.taxable = Number(r.taxable) + i.taxableTotal;
        r.total = Number(r.total) + i.grandTotal;
        byCust.set(n, r);
      }
      sections.push(section('Customer-wise sales', [c('customer', 'Customer'), c('bills', 'Bills', 'number'), c('taxable', 'Taxable value', 'money'), c('total', 'Bill value', 'money')], [...byCust.values()].sort((a, b) => Number(b.total) - Number(a.total))));
      const byProd = new Map<string, Row>();
      for (const i of inv)
        for (const it of i.items) {
          const r = byProd.get(it.productId) ?? { code: it.code, product: it.name, qty: 0, taxable: 0 };
          r.qty = roundQty(Number(r.qty) + it.qty);
          r.taxable = Number(r.taxable) + it.taxableValue;
          byProd.set(it.productId, r);
        }
      sections.push(section('Product-wise sales', [c('code', 'Code'), c('product', 'Product'), c('qty', 'Quantity', 'qty'), c('taxable', 'Taxable value', 'money')], [...byProd.values()].sort((a, b) => Number(b.taxable) - Number(a.taxable))));
      const byRate = new Map<number, Row>();
      for (const i of inv)
        for (const it of i.items) {
          const r = byRate.get(it.gstRate) ?? { rate: `${it.gstRate}%`, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
          r.taxable = Number(r.taxable) + it.taxableValue;
          r.cgst = Number(r.cgst) + it.cgst;
          r.sgst = Number(r.sgst) + it.sgst;
          r.igst = Number(r.igst) + it.igst;
          r.tax = Number(r.tax) + it.cgst + it.sgst + it.igst;
          byRate.set(it.gstRate, r);
        }
      sections.push(section('Tax summary', [c('rate', 'GST rate'), c('taxable', 'Taxable value', 'money'), c('cgst', 'CGST', 'money'), c('sgst', 'SGST', 'money'), c('igst', 'IGST', 'money'), c('tax', 'Total tax', 'money')], [...byRate.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])));
      break;
    }
    case 'top': {
      const byCust = new Map<string, number>();
      const byProd = new Map<string, Row>();
      for (const i of live) {
        const n = cust(i.customerId, i.walkInName ? 'Walk-in customers' : undefined);
        byCust.set(n, (byCust.get(n) ?? 0) + i.taxableTotal);
        for (const it of i.items) {
          const r = byProd.get(it.productId) ?? { product: `${it.code} ${it.name}`, qty: 0, taxable: 0 };
          r.qty = roundQty(Number(r.qty) + it.qty);
          r.taxable = Number(r.taxable) + it.taxableValue;
          byProd.set(it.productId, r);
        }
      }
      sections.push(section('Top customers', [c('rank', 'Rank', 'number'), c('customer', 'Customer'), c('taxable', 'Sales (taxable)', 'money')], [...byCust].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([customer, taxable], i) => ({ rank: i + 1, customer, taxable })), false));
      sections.push(section('Top items', [c('rank', 'Rank', 'number'), c('product', 'Product'), c('qty', 'Quantity', 'qty'), c('taxable', 'Sales (taxable)', 'money')], [...byProd.values()].sort((a, b) => Number(b.taxable) - Number(a.taxable)).slice(0, 10).map((r, i) => ({ rank: i + 1, ...r })), false));
      break;
    }
    case 'outstanding': {
      const scope = ctx.actor.role === 'DISTRIBUTOR' && ctx.actor.customerId ? new Set([ctx.actor.customerId]) : undefined;
      const rows = dues(s, to, scope).map((d) => ({ customer: d.name, type: d.type === 'DISTRIBUTOR' ? 'Distributor' : 'Retail', b0_15: d.b0_15, b16_30: d.b16_30, b31: d.b31, overdue: d.overdue, balance: d.balance }));
      sections.push(section('Outstanding and overdue', [c('customer', 'Customer'), c('type', 'Type'), c('b0_15', '0 to 15 days', 'money'), c('b16_30', '16 to 30 days', 'money'), c('b31', '31+ days', 'money'), c('overdue', 'Overdue', 'money'), c('balance', 'Balance', 'money')], rows));
      const ledgerFor = scope ? [...scope] : [];
      for (const id of ledgerFor) {
        const l = customerLedger(s, id, from, to);
        sections.push({
          title: `Ledger: ${l.title}`,
          columns: [c('date', 'Date', 'date'), c('ref', 'Reference'), c('particulars', 'Particulars'), c('debit', 'Debit', 'money'), c('credit', 'Credit', 'money'), c('balance', 'Balance', 'money')],
          rows: [{ date: from, ref: '', particulars: 'Opening balance', debit: null, credit: null, balance: l.opening }, ...l.rows.map((r) => ({ date: r.date, ref: r.ref, particulars: r.particulars, debit: r.debit || null, credit: r.credit || null, balance: r.balance }))],
          totals: { date: 'Closing', ref: null, particulars: null, debit: l.totalDebit, credit: l.totalCredit, balance: l.closing },
        });
      }
      break;
    }
    case 'funds': {
      const f = fundFigures(s);
      sections.push(section('Fund position', [c('item', 'Item'), c('amount', 'Amount', 'money')], [
        { item: 'Fund received', amount: f.received },
        { item: 'Utilised (supplier payments)', amount: f.utilised },
        { item: 'Balance', amount: f.balance },
        { item: 'Committed (approved, unpaid indents)', amount: f.committed },
        { item: 'Available after commitments', amount: f.available },
      ], false));
      sections.push(section('Tranches', [c('date', 'Date', 'date'), c('source', 'Source'), c('kind', 'Kind'), c('amount', 'Amount', 'money')], s.tranches.filter((t) => inRange(t.date, from, to)).map((t) => ({ date: t.date, source: t.source, kind: t.isLoan ? `Loan (${t.lender})` : 'Own fund', amount: t.amount }))));
      sections.push(section('Utilisation', [c('date', 'Date', 'date'), c('number', 'Voucher'), c('indent', 'Indent'), c('supplier', 'Supplier'), c('amount', 'Amount', 'money')], s.supplierPayments.filter((p) => inRange(p.date, from, to)).map((p) => ({ date: p.date, number: p.number, indent: s.indents.find((i) => i.id === p.indentId)?.number ?? '', supplier: s.suppliers.find((x) => x.id === p.supplierId)?.name ?? '', amount: p.amount }))));
      break;
    }
    case 'indents': {
      const label: Record<string, string> = { DRAFT: 'Draft', PENDING_S1: 'Pending stage 1', PENDING_S2: 'Pending stage 2', PENDING_S3: 'Pending stage 3', APPROVED: 'Approved', REJECTED: 'Rejected', RECEIVED: 'Received', PAID: 'Paid' };
      const rows = s.indents.filter((i) => inRange(i.date, from, to)).map((i) => ({ date: i.date, number: i.number, supplier: s.suppliers.find((x) => x.id === i.supplierId)?.name ?? '', status: label[i.status] ?? i.status, total: i.total, received: receivedValue(s, i.id), paid: paidOnIndent(s, i.id) }));
      const groups = ['Pending', 'Approved', 'Rejected', 'Received', 'Paid', 'Draft'];
      sections.push(section('Summary by status', [c('status', 'Status'), c('count', 'Indents', 'number'), c('total', 'Value', 'money')], groups.map((g) => ({ status: g, count: rows.filter((r) => r.status.startsWith(g)).length, total: rows.filter((r) => r.status.startsWith(g)).reduce((a, r) => a + r.total, 0) })).filter((r) => r.count > 0)));
      sections.push(section('Indents', [c('date', 'Date', 'date'), c('number', 'Indent'), c('supplier', 'Supplier'), c('status', 'Status'), c('total', 'Value', 'money'), c('received', 'Received', 'money'), c('paid', 'Paid', 'money')], rows));
      break;
    }
    case 'purchases': {
      const rows = s.goodsReceipts.filter((g) => inRange(g.date, from, to)).map((g) => {
        const ind = s.indents.find((i) => i.id === g.indentId);
        return { date: g.date, grn: g.number, bill: g.supplierBillNo, indent: ind?.number ?? '', supplier: s.suppliers.find((x) => x.id === ind?.supplierId)?.name ?? '', amount: g.billAmount };
      });
      sections.push(section('Purchase register', [c('date', 'Date', 'date'), c('grn', 'GRN'), c('bill', 'Supplier bill'), c('indent', 'Indent'), c('supplier', 'Supplier'), c('amount', 'Bill amount', 'money')], rows));
      const bySup = new Map<string, Row>();
      for (const r of rows) {
        const x = bySup.get(r.supplier) ?? { supplier: r.supplier, bills: 0, amount: 0 };
        x.bills = Number(x.bills) + 1;
        x.amount = Number(x.amount) + r.amount;
        bySup.set(r.supplier, x);
      }
      sections.push(section('Supplier-wise purchases', [c('supplier', 'Supplier'), c('bills', 'Bills', 'number'), c('amount', 'Amount', 'money')], [...bySup.values()]));
      break;
    }
    case 'stock': {
      const cols = [c('name', 'Item'), c('unit', 'Unit'), c('opening', 'Opening', 'qty'), c('inQty', 'In', 'qty'), c('outQty', 'Out', 'qty'), c('adjusted', 'Adjusted', 'qty'), c('closing', 'Closing', 'qty'), c('value', 'Value', 'money')];
      const pick = (r: ReturnType<typeof purchaseTracker>[number]) => ({ name: r.code ? `${r.code} ${r.name}` : r.name, unit: r.unit, opening: r.opening, inQty: r.inQty, outQty: r.outQty, adjusted: r.adjusted, closing: r.closing, value: r.value });
      sections.push(section('Raw material stock', cols, purchaseTracker(s, ctx.today, from, to).map(pick)));
      sections.push(section('Finished product stock', cols, salesTracker(s, ctx.today, from, to).map(pick)));
      break;
    }
    case 'production': {
      const rows = s.batches.filter((b) => inRange(b.date, from, to)).map((b) => {
        const input = roundQty(b.inputs.reduce((a, x) => a + x.qty, 0));
        return {
          date: b.date,
          batch: b.batchNo,
          inputs: b.inputs.map((x) => `${s.rawMaterials.find((r) => r.id === x.rawMaterialId)?.name ?? ''} ${x.qty}`).join(', '),
          outputs: b.outputs.map((x) => `${s.products.find((p) => p.id === x.productId)?.code ?? ''} ${x.qty}`).join(', '),
          input,
          wastage: b.wastageQty,
          pct: input ? Math.round((b.wastageQty / input) * 1000) / 10 : 0,
          by: userName(s, b.createdById),
        };
      });
      sections.push(section('Production batches', [c('date', 'Date', 'date'), c('batch', 'Batch'), c('inputs', 'Inputs'), c('outputs', 'Outputs'), c('input', 'Input qty', 'qty'), c('wastage', 'Wastage', 'qty'), c('pct', 'Wastage %', 'pct'), c('by', 'Recorded by')], rows));
      break;
    }
    case 'daybook': {
      const rows = dayBook(s, from, to).map((r) => ({ date: r.date, kind: r.kind, ref: r.ref, particulars: r.particulars, debit: r.debit || null, credit: r.credit || null }));
      sections.push(section('Day book', [c('date', 'Date', 'date'), c('kind', 'Type'), c('ref', 'Reference'), c('particulars', 'Particulars'), c('debit', 'Debit', 'money'), c('credit', 'Credit', 'money')], rows));
      const cf = cashFlow(s, from, to);
      sections.push({
        title: 'Cash flow book',
        columns: [c('date', 'Date', 'date'), c('cashIn', 'Cash in', 'money'), c('cashOut', 'Cash out', 'money'), c('cashClosing', 'Cash closing', 'money'), c('bankIn', 'Bank in', 'money'), c('bankOut', 'Bank out', 'money'), c('bankClosing', 'Bank closing', 'money')],
        rows: [{ date: from, cashIn: null, cashOut: null, cashClosing: cf.cashOpening, bankIn: null, bankOut: null, bankClosing: cf.bankOpening }, ...cf.days.map((d) => ({ ...d }))],
        totals: { date: 'Closing', cashIn: cf.days.reduce((a, d) => a + d.cashIn, 0), cashOut: cf.days.reduce((a, d) => a + d.cashOut, 0), cashClosing: cf.cashClosing, bankIn: cf.days.reduce((a, d) => a + d.bankIn, 0), bankOut: cf.days.reduce((a, d) => a + d.bankOut, 0), bankClosing: cf.bankClosing },
      });
      break;
    }
    case 'payroll': {
      const workers = ctx.actor.role === 'OPERATING' ? s.staff.filter((x) => x.id === ctx.actor.staffId) : s.staff;
      sections.push(section('Attendance and hours', [c('worker', 'Worker'), c('payType', 'Pay type'), c('present', 'Present', 'number'), c('half', 'Half', 'number'), c('absent', 'Absent', 'number'), c('leave', 'Leave', 'number'), c('hours', 'Paid hours', 'number')], workers.map((w) => {
        const sm = summarize(s, w.id, from, to < ctx.today ? to : ctx.today, ctx.today);
        return { worker: w.name, payType: w.payType, present: sm.presentDays, half: sm.halfDays, absent: sm.absentDays, leave: sm.leaveDays, hours: sm.paidHours };
      })));
      const ids = new Set(workers.map((w) => w.id));
      sections.push(section('Salary statement (payslip register)', [c('number', 'Payslip'), c('worker', 'Worker'), c('period', 'Period'), c('paidOn', 'Paid on', 'date'), c('gross', 'Gross', 'money'), c('recovery', 'Advance recovery', 'money'), c('net', 'Net paid', 'money')], s.payslips.filter((p) => p.status === 'PAID' && ids.has(p.staffId) && p.paidOn && inRange(p.paidOn, from, to)).map((p) => ({ number: p.number ?? '', worker: s.staff.find((x) => x.id === p.staffId)?.name ?? '', period: `${p.periodFrom} to ${p.periodTo}`, paidOn: p.paidOn ?? '', gross: p.gross, recovery: p.advanceRecovery, net: p.net }))));
      sections.push(section('Staff advances', [c('worker', 'Worker'), c('given', 'Given', 'money'), c('recovered', 'Recovered', 'money'), c('outstanding', 'Outstanding', 'money')], workers.filter((w) => s.advances.some((a) => a.staffId === w.id)).map((w) => {
        const adv = s.advances.filter((a) => a.staffId === w.id);
        return { worker: w.name, given: adv.reduce((a, x) => a + x.amount, 0), recovered: adv.reduce((a, x) => a + x.recoveredAmount, 0), outstanding: outstandingAdvance(s, w.id) };
      })));
      break;
    }
    case 'expenses': {
      const ex = s.expenses.filter((e) => inRange(e.date, from, to));
      sections.push(section('Daily expenses', [c('date', 'Date', 'date'), c('head', 'Head'), c('description', 'Description'), c('mode', 'Mode'), c('amount', 'Amount', 'money')], ex.sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ date: e.date, head: s.expenseHeads.find((h) => h.id === e.headId)?.name ?? '', description: e.description, mode: e.mode, amount: e.amount }))));
      sections.push(section('Head-wise summary', [c('head', 'Head'), c('count', 'Entries', 'number'), c('amount', 'Amount', 'money')], s.expenseHeads.map((h) => ({ head: h.name, count: ex.filter((e) => e.headId === h.id).length, amount: ex.filter((e) => e.headId === h.id).reduce((a, e) => a + e.amount, 0) })).filter((r) => r.count > 0)));
      break;
    }
    case 'profit': {
      const months = new Set<string>();
      for (let d = from.slice(0, 7); d <= to.slice(0, 7); ) {
        months.add(d);
        const [y, m] = d.split('-').map(Number) as [number, number];
        d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      }
      sections.push(section('Profit summary by month', [c('month', 'Month'), c('sales', 'Sales (taxable)', 'money'), c('purchases', 'Purchases', 'money'), c('gross', 'Gross profit', 'money'), c('loan', 'Loan repaid', 'money'), c('workers', 'Worker pay', 'money'), c('expenses', 'Other expenses', 'money'), c('owner', 'Owner amount', 'money')], [...months].map((m) => {
        const f = monthFigures(s, m);
        const st = s.settlements.find((x) => x.month === m && x.status === 'FINALIZED');
        return { month: m, sales: f.sales, purchases: f.purchases, gross: f.sales - f.purchases, loan: st?.loanRepayment ?? null, workers: st?.payableTotal ?? null, expenses: f.otherExpenses, owner: st?.ownerAmount ?? null };
      })));
      break;
    }
  }
  return { key, title: def.title, from, to, sections };
}
