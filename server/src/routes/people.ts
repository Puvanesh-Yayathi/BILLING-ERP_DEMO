import { z } from 'zod';
import {
  addDays,
  AdvanceBody,
  AttendanceEditBody,
  AttendanceManualBody,
  BulkDraftsBody,
  CancelBody,
  ExpenseBody,
  monthEnd,
  monthStart,
  PayAllBody,
  PayBody,
  PayslipPreviewBody,
  SettlementBody,
  workingDaysInMonth,
} from '@app/contract';
import { forbidden, notFound } from '../errors.js';
import { route } from '../http.js';
import { calendarOf, clockToday, editAttendance, manualAttendance, summarize } from '../services/attendance.js';
import { bankLedger, cashFlow, cashLedger, createExpense, customerLedger, dayBook, expenseHeadLedger, staffLedger, supplierLedger } from '../services/ledgers.js';
import { bulkDrafts, cancelPayslip, createPayslipDraft, outstandingAdvance, payPayslip, previewPayslip, recordAdvance, updatePayslipDraft } from '../services/payroll.js';
import { payslipPrint, settlementPrint } from '../services/print.js';
import { buildSettlement, cancelSettlement, finalizeSettlement, monthFigures, payAllSettlement, saveSettlementDraft } from '../services/settlement.js';
import { loansWithOutstanding } from '../services/purchasing.js';
import { find, inRange } from '../services/util.js';
import type { State } from '../state.js';
import { presenceOf } from './auth.js';

const Range = z.object({ from: z.string().optional(), to: z.string().optional() });
const COMPANY = ['ADMIN', 'MONITOR', 'COLLECTOR'] as const;

route({ method: 'get', path: '/ledgers/:type/:id', summary: 'Ledger with opening, rows and running balance', tag: 'Ledgers', roles: [...COMPANY, 'DISTRIBUTOR'], query: Range }, async ({ read, param, query, ctx }) => {
  const s = await read();
  const type = param('type');
  const id = param('id');
  if (ctx.actor.role === 'DISTRIBUTOR' && !((type === 'customer' || type === 'distributor') && id === ctx.actor.customerId)) throw notFound('Ledger');
  if (type === 'staff' && ctx.actor.role !== 'ADMIN') throw forbidden();
  switch (type) {
    case 'customer':
    case 'distributor':
      return customerLedger(s, id, query.from, query.to);
    case 'supplier':
      return supplierLedger(s, id, query.from, query.to);
    case 'cash':
      return cashLedger(s, query.from, query.to);
    case 'bank':
      return bankLedger(s, id === 'default' ? undefined : id, query.from, query.to);
    case 'expense-head':
      return expenseHeadLedger(s, id, query.from, query.to);
    case 'staff':
      return staffLedger(s, id, query.from, query.to);
    default:
      throw notFound('Ledger type');
  }
});

route({ method: 'get', path: '/daybook', summary: 'All transactions in date order', tag: 'Ledgers', roles: COMPANY, query: Range }, async ({ read, query, ctx }) => {
  const from = query.from ?? addDays(ctx.today, -6);
  const to = query.to ?? ctx.today;
  const rows = dayBook(await read(), from, to);
  return { from, to, items: rows, totalDebit: rows.reduce((a, r) => a + r.debit, 0), totalCredit: rows.reduce((a, r) => a + r.credit, 0) };
});
route({ method: 'get', path: '/cashflow', summary: 'Cash and bank in and out with closing balances', tag: 'Ledgers', roles: COMPANY, query: Range }, async ({ read, query, ctx }) => {
  const from = query.from ?? `${ctx.today.slice(0, 7)}-01`;
  const to = query.to ?? ctx.today;
  return { from, to, ...cashFlow(await read(), from, to) };
});

route({ method: 'get', path: '/expenses', summary: 'Other expenses with head and month summaries', tag: 'Expenses', roles: ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'], query: Range.extend({ headId: z.string().optional() }) }, async ({ read, query }) => {
  const s = await read();
  const rows = s.expenses.filter((e) => inRange(e.date, query.from, query.to) && (!query.headId || e.headId === query.headId)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const byHead = s.expenseHeads.map((h) => ({ headId: h.id, head: h.name, amount: rows.filter((e) => e.headId === h.id).reduce((a, e) => a + e.amount, 0) }));
  const months = [...new Set(rows.map((e) => e.date.slice(0, 7)))].sort().reverse().map((m) => ({ month: m, amount: rows.filter((e) => e.date.startsWith(m)).reduce((a, e) => a + e.amount, 0) }));
  return { items: rows.map((e) => ({ ...e, head: s.expenseHeads.find((h) => h.id === e.headId)?.name ?? '', by: s.users.find((u) => u.id === e.createdById)?.name ?? '' })), byHead, byMonth: months, total: rows.reduce((a, e) => a + e.amount, 0) };
});
route({ method: 'post', path: '/expenses', summary: 'Add an expense (description required)', tag: 'Expenses', roles: ['ADMIN', 'OPERATING'], body: ExpenseBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createExpense(s, ctx, body)));

function staffRows(s: State) {
  return s.staff.map((x) => ({ id: x.id, name: x.name, code: x.code, payType: x.payType, hasLogin: !!x.userId, active: x.active }));
}

route({ method: 'get', path: '/attendance', summary: 'Attendance grid by date range and worker', tag: 'Attendance', roles: ['ADMIN', 'OPERATING'], query: Range.extend({ staffId: z.string().optional() }) }, async ({ read, query, ctx }) => {
  const s = await read();
  const to = query.to ?? ctx.today;
  const from = query.from ?? addDays(to, -13);
  const workers = s.staff.filter((x) => (x.active || s.attendance.some((a) => a.staffId === x.id && a.date >= from)) && (!query.staffId || x.id === query.staffId)).filter((x) => ctx.actor.role === 'ADMIN' || x.id === ctx.actor.staffId);
  const rows = [];
  for (const w of workers) {
    const sum = summarize(s, w.id, from, to, ctx.today);
    const presence = await presenceOf(w.id);
    rows.push({ staff: { id: w.id, name: w.name, code: w.code, payType: w.payType, hasLogin: !!w.userId }, summary: { ...sum, days: undefined }, days: sum.days, today: w.userId ? clockToday(s, w.id, new Date().toISOString(), presence) : null });
  }
  return { from, to, rows, workers: ctx.actor.role === 'ADMIN' ? staffRows(s) : [] };
});
route({ method: 'put', path: '/attendance/:id', summary: 'Correct a day with a reason (marked edited)', tag: 'Attendance', roles: ['ADMIN'], body: AttendanceEditBody }, async ({ body, tx, ctx, param }) => tx((s) => editAttendance(s, ctx, param('id'), body)));
route({ method: 'post', path: '/attendance/manual', summary: 'Mark attendance manually', tag: 'Attendance', roles: ['ADMIN'], body: AttendanceManualBody }, async ({ body, tx, ctx }) => tx((s) => manualAttendance(s, ctx, body)));

route({ method: 'get', path: '/my/attendance', summary: 'Own attendance calendar and hours today', tag: 'My pay', roles: ['STAFF', 'OPERATING'], query: z.object({ month: z.string().optional() }) }, async ({ read, query, ctx }) => {
  const s = await read();
  const staffId = ctx.actor.staffId;
  if (!staffId) throw notFound('Worker');
  const st = find(s.staff, staffId, 'Worker');
  const month = query.month ?? ctx.today.slice(0, 7);
  const from = monthStart(month);
  const to = monthEnd(month);
  const sum = summarize(s, staffId, from, to, ctx.today);
  const wd = workingDaysInMonth(month, calendarOf(s));
  const upTo = to < ctx.today ? to : ctx.today;
  const soFar = summarize(s, staffId, from, upTo, ctx.today);
  const unpaidFrom = s.payslips.filter((p) => p.staffId === staffId && p.status === 'PAID' && p.periodTo >= from && p.periodFrom <= upTo).map((p) => p.periodTo).sort().pop();
  let estimate: number | null = null;
  if (st.payType !== 'SHARE') {
    const pendingFrom = unpaidFrom ? addDays(unpaidFrom, 1) : from;
    if (pendingFrom <= upTo) {
      try {
        estimate = previewPayslip(s, { ...ctx, actor: { ...ctx.actor, role: 'ADMIN' } }, { staffId, periodFrom: pendingFrom, periodTo: upTo, allowances: [], deductions: [], advanceRecovery: 0 }).result.basePayEarned;
      } catch {
        estimate = null;
      }
    } else estimate = 0;
  }
  return {
    month,
    staff: { id: st.id, name: st.name, payType: st.payType, basePay: st.basePay, hourlyRate: st.hourlyRate, sharePercent: st.sharePercent, reduceByAbsence: st.reduceByAbsence },
    workingDays: wd,
    days: sum.days,
    soFar: { presentDays: soFar.presentDays, halfDays: soFar.halfDays, absentDays: soFar.absentDays, leaveDays: soFar.leaveDays, paidHours: soFar.paidHours, offDayWorkDays: soFar.offDayWorkDays },
    estimate,
    outstandingAdvance: outstandingAdvance(s, staffId),
    today: clockToday(s, staffId, new Date().toISOString(), await presenceOf(staffId)),
  };
});

route({ method: 'get', path: '/my/payslips', summary: 'Own paid payslips', tag: 'My pay', roles: ['STAFF', 'OPERATING'] }, async ({ read, ctx }) => {
  const s = await read();
  return { items: s.payslips.filter((p) => p.staffId === ctx.actor.staffId && p.status === 'PAID').sort((a, b) => (b.paidOn ?? '').localeCompare(a.paidOn ?? '')).map((p) => ({ id: p.id, number: p.number, periodFrom: p.periodFrom, periodTo: p.periodTo, payType: p.payType, net: p.net, paidOn: p.paidOn, mode: p.mode })) };
});

route({ method: 'get', path: '/advances', summary: 'Staff advances', tag: 'Payroll', roles: ['ADMIN'] }, async ({ read }) => {
  const s = await read();
  return { items: [...s.advances].sort((a, b) => b.date.localeCompare(a.date)).map((a) => ({ ...a, staff: s.staff.find((x) => x.id === a.staffId)?.name ?? '', outstanding: a.amount - a.recoveredAmount })) };
});
route({ method: 'post', path: '/advances', summary: 'Give an advance', tag: 'Payroll', roles: ['ADMIN'], body: AdvanceBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => recordAdvance(s, ctx, body)));

route({ method: 'post', path: '/payslips/preview', summary: 'Payslip overview (FIXED or HOURLY, inside one month, no overlap with paid)', tag: 'Payroll', roles: ['ADMIN'], body: PayslipPreviewBody }, async ({ body, read, ctx }) => previewPayslip(await read(), ctx, body));
route({ method: 'get', path: '/payslips', summary: 'Payroll list', tag: 'Payroll', roles: ['ADMIN'], query: z.object({ month: z.string().optional(), staffId: z.string().optional(), status: z.string().optional(), source: z.string().optional() }) }, async ({ read, query }) => {
  const s = await read();
  const rows = s.payslips
    .filter((p) => (!query.month || p.periodFrom.startsWith(query.month)) && (!query.staffId || p.staffId === query.staffId) && (!query.status || p.status === query.status) && (!query.source || p.source === query.source))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({ ...p, staff: s.staff.find((x) => x.id === p.staffId)?.name ?? '' }));
  return { items: rows, totals: { gross: rows.filter((r) => r.status !== 'CANCELLED').reduce((a, r) => a + r.gross, 0), net: rows.filter((r) => r.status !== 'CANCELLED').reduce((a, r) => a + r.net, 0) } };
});
route({ method: 'post', path: '/payslips', summary: 'Save a draft payslip', tag: 'Payroll', roles: ['ADMIN'], body: PayslipPreviewBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createPayslipDraft(s, ctx, body)));
route({ method: 'get', path: '/payslips/:id', summary: 'Payslip', tag: 'Payroll', roles: ['ADMIN'], etag: false }, async ({ read, param }) => {
  const s = await read();
  const p = find(s.payslips, param('id'), 'Payslip');
  return { payslip: p, staff: find(s.staff, p.staffId, 'Worker'), outstandingAdvance: outstandingAdvance(s, p.staffId) };
});
route({ method: 'patch', path: '/payslips/:id', summary: 'Edit a draft payslip', tag: 'Payroll', roles: ['ADMIN'], body: PayslipPreviewBody }, async ({ body, tx, ctx, param }) => tx((s) => updatePayslipDraft(s, ctx, param('id'), body)));
route({ method: 'post', path: '/payslips/bulk-drafts', summary: 'Drafts for every active Fixed and Hourly worker', tag: 'Payroll', roles: ['ADMIN'], body: BulkDraftsBody }, async ({ body, tx, ctx }) => tx((s) => ({ created: bulkDrafts(s, ctx, body.month).length })));
route({ method: 'post', path: '/payslips/:id/pay', summary: 'Pay: locks attendance, recovers advances, notifies the worker', tag: 'Payroll', roles: ['ADMIN'], body: PayBody, idempotent: true }, async ({ body, tx, ctx, param }) => tx((s) => payPayslip(s, ctx, param('id'), body)));
route({ method: 'post', path: '/payslips/pay-selected', summary: 'Pay all selected drafts', tag: 'Payroll', roles: ['ADMIN'], body: PayAllBody, idempotent: true }, async ({ body, tx, ctx }) => tx((s) => ({ paid: body.ids.map((id) => payPayslip(s, ctx, id, body)).length })));
route({ method: 'post', path: '/payslips/:id/cancel', summary: 'Cancel with a reason (reverses payout, unlocks attendance)', tag: 'Payroll', roles: ['ADMIN'], body: CancelBody }, async ({ body, tx, ctx, param }) => tx((s) => cancelPayslip(s, ctx, param('id'), body.reason)));
route({ method: 'get', path: '/payslips/:id/print-data', summary: 'Payslip document data (Admin or the worker, others get 404)', tag: 'Payroll', roles: ['ADMIN', 'STAFF', 'OPERATING'], etag: false }, async ({ read, param, ctx }) => payslipPrint(await read(), ctx, param('id')));

route({ method: 'get', path: '/settlements/figures', summary: 'Sales, purchases, expenses and loans for a month', tag: 'Settlement', roles: ['ADMIN'], query: z.object({ month: z.string() }) }, async ({ read, query }) => {
  const s = await read();
  return { ...monthFigures(s, query.month), loans: loansWithOutstanding(s).map((l) => ({ id: l.id, lender: l.lender, amount: l.amount, outstanding: l.outstanding })) };
});
route({ method: 'post', path: '/settlements/preview', summary: 'Waterfall and worker table (nothing saved)', tag: 'Settlement', roles: ['ADMIN'], body: SettlementBody }, async ({ body, read, ctx }) => {
  const s = await read();
  const st = buildSettlement(s, ctx, body);
  return { ...st, lines: st.lines.map((l) => ({ ...l, name: s.staff.find((x) => x.id === l.staffId)?.name ?? '' })) };
});
route({ method: 'post', path: '/settlements', summary: 'Save or re-run the month as a draft', tag: 'Settlement', roles: ['ADMIN'], body: SettlementBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => saveSettlementDraft(s, ctx, body)));
route({ method: 'get', path: '/settlements', summary: 'Settlements', tag: 'Settlement', roles: ['ADMIN'] }, async ({ read }) => ({ items: [...(await read()).settlements].sort((a, b) => b.month.localeCompare(a.month) || b.createdAt.localeCompare(a.createdAt)) }));
route({ method: 'get', path: '/settlements/:id', summary: 'Settlement with workers and payslips', tag: 'Settlement', roles: ['ADMIN'], etag: false }, async ({ read, param }) => settlementPrint(await read(), param('id')));
route({ method: 'post', path: '/settlements/:id/finalize', summary: 'Finalize: loan repayment and a payslip per worker', tag: 'Settlement', roles: ['ADMIN'], idempotent: true }, async ({ tx, ctx, param }) => tx((s) => finalizeSettlement(s, ctx, param('id'))));
route({ method: 'post', path: '/settlements/:id/pay-all', summary: 'Pay every unpaid settlement payslip', tag: 'Settlement', roles: ['ADMIN'], body: PayBody, idempotent: true }, async ({ body, tx, ctx, param }) => tx((s) => ({ paid: payAllSettlement(s, ctx, param('id'), body).length })));
route({ method: 'post', path: '/settlements/:id/cancel', summary: 'Cancel before any payslip is paid', tag: 'Settlement', roles: ['ADMIN'], body: CancelBody }, async ({ body, tx, ctx, param }) => tx((s) => cancelSettlement(s, ctx, param('id'), body.reason)));
route({ method: 'get', path: '/settlements/:id/consolidated-print-data', summary: 'Consolidated payslip and settlement statement', tag: 'Settlement', roles: ['ADMIN'], etag: false }, async ({ read, param, ctx }) => {
  const s = await read();
  const base = settlementPrint(s, param('id'));
  return { ...base, payslips: base.payslipIds.map((id) => payslipPrint(s, ctx, id)) };
});
