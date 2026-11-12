import {
  calcPayslip,
  formatINR,
  monthEnd,
  monthStart,
  workingDaysInMonth,
  type AdvanceInput,
  type ISODate,
  type PayInput,
  type Payslip,
  type PayslipPreviewInput,
  type Staff,
  type StaffAdvance,
} from '@app/contract';
import { audit, emit, newId, notify, type Ctx } from '../ctx.js';
import { invalidState, validation } from '../errors.js';
import type { State } from '../state.js';
import { calendarOf, summarize, type AttendanceSummary } from './attendance.js';
import { currentProfile, find, nextNumber, requireRole } from './util.js';

export function outstandingAdvance(s: State, staffId: string): number {
  return s.advances.filter((a) => a.staffId === staffId).reduce((a, x) => a + x.amount - x.recoveredAmount, 0);
}

export function recordAdvance(s: State, ctx: Ctx, i: AdvanceInput): StaffAdvance {
  requireRole(ctx, 'ADMIN');
  const st = find(s.staff, i.staffId, 'Worker');
  const a: StaffAdvance = { id: newId(s, 'adv'), staffId: st.id, date: i.date, amount: i.amount, mode: i.mode, recoveredAmount: 0, note: i.note };
  s.advances.push(a);
  audit(ctx, 'advance', a.id, 'create', `Gave ${st.name} an advance of ${formatINR(a.amount)}`, undefined, a);
  emit(ctx, 'advance.create', 'advance', a.id, `Admin recorded an advance for ${st.name}`, st.userId ? [`user:${st.userId}`] : []);
  return a;
}

function overlapsPaid(s: State, staffId: string, from: ISODate, to: ISODate, exceptId?: string): Payslip | undefined {
  return s.payslips.find((p) => p.staffId === staffId && p.status === 'PAID' && p.id !== exceptId && p.periodFrom <= to && p.periodTo >= from);
}

export interface PayslipPreview {
  staff: Staff;
  periodFrom: ISODate;
  periodTo: ISODate;
  workingDaysInMonth: number;
  summary: AttendanceSummary;
  outstandingAdvance: number;
  allowances: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  result: ReturnType<typeof calcPayslip>;
}

export function previewPayslip(s: State, ctx: Ctx, i: PayslipPreviewInput, exceptId?: string): PayslipPreview {
  requireRole(ctx, 'ADMIN');
  const staff = find(s.staff, i.staffId, 'Worker');
  if (staff.payType === 'SHARE') throw validation('Share workers are paid through the profit settlement');
  const clash = overlapsPaid(s, staff.id, i.periodFrom, i.periodTo, exceptId);
  if (clash) throw validation(`This period overlaps payslip ${clash.number} (${clash.periodFrom} to ${clash.periodTo}) which is already paid`, { periodFrom: 'Choose days that are not yet paid' });
  const month = i.periodFrom.slice(0, 7);
  const wd = workingDaysInMonth(month, calendarOf(s));
  const summary = summarize(s, staff.id, i.periodFrom, i.periodTo, ctx.today);
  const adv = outstandingAdvance(s, staff.id);
  const result = calcPayslip({
    payType: staff.payType,
    basePay: staff.basePay,
    hourlyRate: staff.hourlyRate,
    workingDaysInMonth: wd,
    presentDays: summary.presentDays,
    halfDays: summary.halfDays,
    paidHours: summary.paidHours,
    allowances: i.allowances,
    deductions: i.deductions,
    advanceRecoveryRequested: i.advanceRecovery ?? adv,
    outstandingAdvance: adv,
  });
  return { staff, periodFrom: i.periodFrom, periodTo: i.periodTo, workingDaysInMonth: wd, summary, outstandingAdvance: adv, allowances: i.allowances, deductions: i.deductions, result };
}

function toPayslip(s: State, ctx: Ctx, p: PayslipPreview, id?: string): Payslip {
  const r = p.result;
  return {
    id: id ?? newId(s, 'psl'),
    staffId: p.staff.id,
    periodFrom: p.periodFrom,
    periodTo: p.periodTo,
    status: 'DRAFT',
    source: 'PAYROLL',
    payType: p.staff.payType,
    rateSnapshot: { basePay: p.staff.basePay, hourlyRate: p.staff.hourlyRate },
    workingDaysInMonth: p.workingDaysInMonth,
    perDayRate: r.perDayRate,
    daysPresent: p.summary.presentDays,
    halfDays: p.summary.halfDays,
    absentDays: p.summary.absentDays,
    leaveDays: p.summary.leaveDays,
    paidHours: p.summary.paidHours,
    basePayEarned: r.basePayEarned,
    allowancesTotal: r.allowancesTotal,
    deductionsTotal: r.deductionsTotal,
    advanceRecovery: r.advanceRecovery,
    alreadyPaid: 0,
    gross: r.gross,
    net: r.net,
    roundOff: r.roundOff,
    lines: [
      ...p.allowances.map((l) => ({ kind: 'ALLOWANCE' as const, ...l })),
      ...p.deductions.map((l) => ({ kind: 'DEDUCTION' as const, ...l })),
    ],
    attendanceIds: p.summary.attendanceIds,
    advanceAllocations: [],
    createdById: ctx.actor.id,
    createdAt: ctx.now,
  };
}

export function createPayslipDraft(s: State, ctx: Ctx, i: PayslipPreviewInput): Payslip {
  const p = toPayslip(s, ctx, previewPayslip(s, ctx, i));
  s.payslips.push(p);
  const st = find(s.staff, p.staffId, 'Worker');
  audit(ctx, 'payslip', p.id, 'create', `Saved draft payslip for ${st.name} (${p.periodFrom} to ${p.periodTo}), net ${formatINR(p.net)}`, undefined, p);
  return p;
}

export function updatePayslipDraft(s: State, ctx: Ctx, id: string, i: PayslipPreviewInput): Payslip {
  const cur = find(s.payslips, id, 'Payslip');
  if (cur.status !== 'DRAFT' || cur.source !== 'PAYROLL') throw invalidState('Only draft payroll payslips can be edited');
  const next = toPayslip(s, ctx, previewPayslip(s, ctx, { ...i, staffId: cur.staffId }), cur.id);
  const before = { ...cur };
  Object.assign(cur, next, { createdAt: cur.createdAt });
  audit(ctx, 'payslip', cur.id, 'update', 'Updated draft payslip', before, cur);
  return cur;
}

/** Recover advances oldest first; returns the allocation so a cancel can restore it. */
function recoverAdvances(s: State, staffId: string, amount: number) {
  const allocs: { advanceId: string; amount: number }[] = [];
  let left = amount;
  for (const a of s.advances.filter((x) => x.staffId === staffId).sort((x, y) => x.date.localeCompare(y.date))) {
    if (left <= 0) break;
    const take = Math.min(left, a.amount - a.recoveredAmount);
    if (take <= 0) continue;
    a.recoveredAmount += take;
    allocs.push({ advanceId: a.id, amount: take });
    left -= take;
  }
  return allocs;
}

/** PAID: number assigned, attendance locked, advances recovered, cash or bank paid out, worker notified. */
export function payPayslip(s: State, ctx: Ctx, id: string, i: PayInput): Payslip {
  requireRole(ctx, 'ADMIN');
  const p = find(s.payslips, id, 'Payslip');
  if (p.status !== 'DRAFT') throw invalidState('Only draft payslips can be paid');
  const st = find(s.staff, p.staffId, 'Worker');
  if (p.source === 'PAYROLL') {
    const fresh = previewPayslip(s, ctx, {
      staffId: p.staffId,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      allowances: p.lines.filter((l) => l.kind === 'ALLOWANCE').map(({ label, amount }) => ({ label, amount })),
      deductions: p.lines.filter((l) => l.kind === 'DEDUCTION').map(({ label, amount }) => ({ label, amount })),
      advanceRecovery: p.advanceRecovery,
    }, p.id);
    Object.assign(p, toPayslip(s, ctx, fresh, p.id), { createdAt: p.createdAt, createdById: p.createdById });
  } else {
    const clash = s.payslips.find((x) => x.staffId === p.staffId && x.status === 'PAID' && x.source === 'SETTLEMENT' && x.periodFrom === p.periodFrom);
    if (clash) throw invalidState('This month is already settled for this worker');
  }
  const before = { status: p.status };
  p.advanceAllocations = recoverAdvances(s, p.staffId, p.advanceRecovery);
  p.status = 'PAID';
  p.number = nextNumber(s, 'PAY', i.date);
  p.paidOn = i.date;
  p.mode = i.mode;
  p.reference = i.reference;
  p.companyProfileVersionId = currentProfile(s).id;
  const lockIds = s.attendance.filter((a) => a.staffId === p.staffId && a.date >= p.periodFrom && a.date <= p.periodTo && !a.payslipId);
  for (const a of lockIds) a.payslipId = p.id;
  p.attendanceIds = [...new Set([...p.attendanceIds, ...lockIds.map((a) => a.id)])];
  if (st.userId) notify(s, ctx, [st.userId], 'Payslip paid', `${p.number}: ${formatINR(p.net)} paid by ${i.mode.toLowerCase()}.`, '/my/pay');
  audit(ctx, 'payslip', p.id, 'pay', `Paid payslip ${p.number} to ${st.name}: ${formatINR(p.net)} by ${i.mode.toLowerCase()}`, before, p);
  emit(ctx, 'payslip.pay', 'payslip', p.id, `Admin paid ${st.name} ${formatINR(p.net)}`, st.userId ? [`user:${st.userId}`] : [], p.net);
  return p;
}

/** Cancel: reverses the payout, unlocks attendance, restores the advances recovered. */
export function cancelPayslip(s: State, ctx: Ctx, id: string, reason: string): Payslip {
  requireRole(ctx, 'ADMIN');
  const p = find(s.payslips, id, 'Payslip');
  if (p.status === 'CANCELLED') throw invalidState('This payslip is already cancelled');
  const settlement = p.settlementId ? s.settlements.find((x) => x.id === p.settlementId) : undefined;
  if (settlement && settlement.status === 'FINALIZED' && p.status === 'DRAFT')
    throw invalidState('Cancel the settlement to remove its unpaid payslips');
  const before = { ...p };
  if (p.status === 'PAID') {
    for (const a of s.attendance) if (a.payslipId === p.id) delete a.payslipId;
    for (const al of p.advanceAllocations) {
      const adv = s.advances.find((x) => x.id === al.advanceId);
      if (adv) adv.recoveredAmount = Math.max(0, adv.recoveredAmount - al.amount);
    }
    if (settlement) {
      const line = settlement.lines.find((l) => l.payslipId === p.id);
      if (line) delete line.payslipId;
      const fresh: Payslip = { ...structuredClone(p), id: newId(s, 'psl'), status: 'DRAFT', number: undefined, paidOn: undefined, mode: undefined, reference: undefined, advanceAllocations: [], createdAt: ctx.now };
      s.payslips.push(fresh);
      if (line) line.payslipId = fresh.id;
    }
  }
  p.status = 'CANCELLED';
  p.cancelReason = reason;
  const st = find(s.staff, p.staffId, 'Worker');
  audit(ctx, 'payslip', p.id, 'cancel', `Cancelled payslip ${p.number ?? 'draft'} of ${st.name}: ${reason}`, before, p);
  emit(ctx, 'payslip.cancel', 'payslip', p.id, `Admin cancelled a payslip of ${st.name}`, st.userId ? [`user:${st.userId}`] : []);
  return p;
}

export function bulkDrafts(s: State, ctx: Ctx, month: string): Payslip[] {
  requireRole(ctx, 'ADMIN');
  const from = monthStart(month);
  const end = monthEnd(month);
  const to = end < ctx.today ? end : ctx.today;
  if (from > ctx.today) throw validation('This month has not started yet');
  const made: Payslip[] = [];
  for (const st of s.staff.filter((x) => x.active && x.payType !== 'SHARE')) {
    const paid = s.payslips.filter((p) => p.staffId === st.id && p.status === 'PAID' && p.periodFrom <= to && p.periodTo >= from);
    const lastPaid = paid.map((p) => p.periodTo).sort().pop();
    const start = lastPaid ? new Date(Date.parse(lastPaid) + 86400000).toISOString().slice(0, 10) : from;
    if (start > to) continue;
    if (s.payslips.some((p) => p.staffId === st.id && p.status === 'DRAFT' && p.source === 'PAYROLL' && p.periodFrom === start && p.periodTo === to)) continue;
    made.push(createPayslipDraft(s, ctx, { staffId: st.id, periodFrom: start, periodTo: to, allowances: [], deductions: [] }));
  }
  return made;
}
