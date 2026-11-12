import {
  calcPayslip,
  calcSettlement,
  formatINR,
  monthEnd,
  monthStart,
  SettlementError,
  workingDaysInMonth,
  type PayInput,
  type Payslip,
  type ProfitSettlement,
  type SettlementInputBody,
  type SettlementLine,
} from '@app/contract';
import { audit, newId, type Ctx } from '../ctx.js';
import { invalidState, validation } from '../errors.js';
import type { State } from '../state.js';
import { calendarOf, summarize } from './attendance.js';
import { outstandingAdvance, payPayslip } from './payroll.js';
import { loansWithOutstanding } from './purchasing.js';
import { currentProfile, find, requireRole } from './util.js';

/** Gross profit inputs: sales at taxable value, purchases at goods-receipt bill value, other expenses. */
export function monthFigures(s: State, month: string) {
  const sales = s.invoices
    .filter((i) => (i.status === 'SENT' || i.status === 'PAID') && i.date.startsWith(month))
    .reduce((a, i) => a + i.taxableTotal, 0);
  const purchases = s.goodsReceipts.filter((g) => g.date.startsWith(month)).reduce((a, g) => a + g.billAmount, 0);
  const otherExpenses = s.expenses.filter((e) => e.date.startsWith(month)).reduce((a, e) => a + e.amount, 0);
  return { sales, purchases, otherExpenses };
}

export function buildSettlement(s: State, ctx: Ctx, i: SettlementInputBody): ProfitSettlement {
  requireRole(ctx, 'ADMIN');
  if (i.month > ctx.today.slice(0, 7)) throw validation('Choose the current month or an earlier one', { month: 'This month has not started' });
  const from = monthStart(i.month);
  const to = monthEnd(i.month);
  const wd = workingDaysInMonth(i.month, calendarOf(s));
  const fig = monthFigures(s, i.month);
  let loanOutstanding: number | undefined;
  if (i.loanRepayment > 0) {
    const loan = loansWithOutstanding(s).find((l) => l.id === i.loanTrancheId);
    if (!loan) throw validation('Choose the loan to repay', { loanTrancheId: 'Choose a loan' });
    loanOutstanding = loan.outstanding;
  }
  const workers = s.staff.filter((st) => st.active || s.attendance.some((a) => a.staffId === st.id && a.date >= from && a.date <= to));
  const meta = new Map<string, Omit<SettlementLine, 'earned' | 'scaled' | 'adjustment' | 'payable' | 'advanceRecovery' | 'alreadyPaid' | 'balancePayable' | 'carryAdvance' | 'effectivePercent'>>();
  const inputs = workers.map((st) => {
    const sum = summarize(s, st.id, from, to, ctx.today);
    const adj = i.adjustments.find((a) => a.staffId === st.id);
    const rec = i.advanceRecoveries.find((a) => a.staffId === st.id);
    const alreadyPaid = s.payslips
      .filter((p) => p.staffId === st.id && p.status === 'PAID' && p.source === 'PAYROLL' && p.periodFrom >= from && p.periodTo <= to)
      .reduce((a, p) => a + p.basePayEarned, 0);
    meta.set(st.id, {
      staffId: st.id,
      payType: st.payType,
      rate: st.payType === 'FIXED' ? (st.basePay ?? 0) : st.payType === 'HOURLY' ? (st.hourlyRate ?? 0) : null,
      sharePercent: st.payType === 'SHARE' ? (st.sharePercent ?? 0) : null,
      reduceByAbsence: st.reduceByAbsence,
      workingDays: wd,
      presentDays: sum.presentDays,
      halfDays: sum.halfDays,
      absentDays: sum.absentDays,
      leaveDays: sum.leaveDays,
      paidHours: sum.paidHours,
      adjustmentReason: adj?.reason,
    });
    const earned =
      st.payType === 'SHARE'
        ? undefined
        : calcPayslip({
            payType: st.payType,
            basePay: st.basePay,
            hourlyRate: st.hourlyRate,
            workingDaysInMonth: wd,
            presentDays: sum.presentDays,
            halfDays: sum.halfDays,
            paidHours: sum.paidHours,
            allowances: [],
            deductions: [],
            advanceRecoveryRequested: 0,
            outstandingAdvance: 0,
          }).basePayEarned;
    return {
      staffId: st.id,
      payType: st.payType,
      earned,
      sharePercent: st.sharePercent,
      reduceByAbsence: st.reduceByAbsence,
      presentDays: sum.presentDays,
      halfDays: sum.halfDays,
      workingDaysInMonth: wd,
      adjustment: adj?.amount ?? 0,
      advanceRecovery: rec ? Math.min(rec.amount, outstandingAdvance(s, st.id)) : outstandingAdvance(s, st.id),
      alreadyPaid,
    };
  });
  let r;
  try {
    r = calcSettlement({ ...fig, loanRepaymentRequested: i.loanRepayment, loanOutstanding, shareBasis: s.settings.shareBasis, workers: inputs });
  } catch (e) {
    if (e instanceof SettlementError) throw validation(e.message);
    throw e;
  }
  return {
    id: '',
    month: i.month,
    status: 'DRAFT',
    sales: r.sales,
    purchases: r.purchases,
    grossProfit: r.grossProfit,
    loanTrancheId: i.loanRepayment > 0 ? i.loanTrancheId : undefined,
    loanRepaymentRequested: i.loanRepayment,
    loanRepayment: r.loanRepaymentApplied,
    loanRepaymentUnpaid: r.loanRepaymentUnpaid,
    poolAfterLoan: r.poolAfterLoan,
    shareBase: r.shareBase,
    shareBasis: s.settings.shareBasis,
    fixedHourlyTotal: r.fixedHourlyTotal,
    shareTotal: r.shareTotal,
    workerTotal: r.workerTotal,
    scaleFactor: r.scaleFactor,
    payableTotal: r.payableTotal,
    otherExpenses: r.otherExpenses,
    ownerAmount: r.ownerAmount,
    lines: r.lines.map((l) => ({
      ...(meta.get(l.staffId) as NonNullable<ReturnType<typeof meta.get>>),
      effectivePercent: l.effectivePercent,
      earned: l.earned,
      scaled: l.scaled,
      adjustment: l.adjustment,
      payable: l.payable,
      advanceRecovery: l.advanceRecovery,
      alreadyPaid: l.alreadyPaid,
      balancePayable: l.balancePayable,
      carryAdvance: l.carryAdvance,
    })),
    createdById: ctx.actor.id,
    createdAt: ctx.now,
  };
}

/** One settlement per month. A month can be re-run as a draft until finalized. */
export function saveSettlementDraft(s: State, ctx: Ctx, i: SettlementInputBody): ProfitSettlement {
  const built = buildSettlement(s, ctx, i);
  if (s.settlements.some((x) => x.month === i.month && x.status === 'FINALIZED'))
    throw invalidState('This month is already settled. Cancel the settlement to run it again.');
  const existing = s.settlements.find((x) => x.month === i.month && x.status === 'DRAFT');
  if (existing) {
    const before = { ...existing };
    Object.assign(existing, built, { id: existing.id, createdAt: existing.createdAt });
    audit(ctx, 'settlement', existing.id, 'update', `Re-ran the ${i.month} settlement draft`, before, existing);
    return existing;
  }
  built.id = newId(s, 'set');
  s.settlements.push(built);
  audit(ctx, 'settlement', built.id, 'create', `Saved the ${i.month} settlement as a draft`, undefined, built);
  return built;
}

/** Finalize: loan repayment posted, a draft payslip per worker with fixed amounts, carried advances created. */
export function finalizeSettlement(s: State, ctx: Ctx, id: string): ProfitSettlement {
  requireRole(ctx, 'ADMIN');
  const st = find(s.settlements, id, 'Settlement');
  if (st.status !== 'DRAFT') throw invalidState('Only a draft settlement can be finalized');
  const before = { status: st.status };
  if (st.loanRepayment > 0 && st.loanTrancheId) {
    const rep = { id: newId(s, 'lrp'), trancheId: st.loanTrancheId, settlementId: st.id, date: ctx.today, amount: st.loanRepayment, mode: 'BANK' as const, note: `Settlement ${st.month}` };
    s.loanRepayments.push(rep);
    st.loanRepaymentId = rep.id;
  }
  const from = monthStart(st.month);
  const to = monthEnd(st.month);
  for (const l of st.lines) {
    const p: Payslip = {
      id: newId(s, 'psl'),
      staffId: l.staffId,
      periodFrom: from,
      periodTo: to,
      status: 'DRAFT',
      source: 'SETTLEMENT',
      settlementId: st.id,
      payType: l.payType,
      rateSnapshot:
        l.payType === 'SHARE'
          ? { sharePercent: l.sharePercent ?? 0, reduceByAbsence: l.reduceByAbsence, effectivePercent: l.effectivePercent ?? undefined }
          : l.payType === 'FIXED'
            ? { basePay: l.rate ?? 0 }
            : { hourlyRate: l.rate ?? 0 },
      workingDaysInMonth: l.workingDays,
      perDayRate: l.payType === 'FIXED' && l.workingDays ? Math.round((l.rate ?? 0) / l.workingDays) : null,
      daysPresent: l.presentDays,
      halfDays: l.halfDays,
      absentDays: l.absentDays,
      leaveDays: l.leaveDays,
      paidHours: l.paidHours,
      basePayEarned: l.scaled,
      allowancesTotal: Math.max(0, l.adjustment),
      deductionsTotal: Math.max(0, -l.adjustment),
      advanceRecovery: l.advanceRecovery,
      alreadyPaid: l.alreadyPaid,
      gross: l.payable,
      net: l.balancePayable,
      roundOff: l.payable - (l.scaled + l.adjustment),
      lines: l.adjustment ? [{ kind: l.adjustment > 0 ? 'ALLOWANCE' : 'DEDUCTION', label: l.adjustmentReason ?? 'Adjustment', amount: Math.abs(l.adjustment) }] : [],
      attendanceIds: [],
      advanceAllocations: [],
      createdById: ctx.actor.id,
      createdAt: ctx.now,
    };
    s.payslips.push(p);
    l.payslipId = p.id;
    if (l.carryAdvance > 0)
      s.advances.push({ id: newId(s, 'adv'), staffId: l.staffId, date: ctx.today, amount: l.carryAdvance, mode: 'CASH', recoveredAmount: 0, note: `Carried from ${st.month} settlement`, settlementId: st.id });
  }
  st.status = 'FINALIZED';
  st.finalizedAt = ctx.now;
  st.companyProfileVersionId = currentProfile(s).id;
  audit(ctx, 'settlement', st.id, 'finalize', `Finalized the ${st.month} settlement. Owner amount ${formatINR(st.ownerAmount)}`, before, st);
  return st;
}

export function payAllSettlement(s: State, ctx: Ctx, id: string, pay: PayInput): Payslip[] {
  requireRole(ctx, 'ADMIN');
  const st = find(s.settlements, id, 'Settlement');
  if (st.status !== 'FINALIZED') throw invalidState('Finalize the settlement before paying');
  const paid: Payslip[] = [];
  for (const l of st.lines) {
    const p = s.payslips.find((x) => x.id === l.payslipId);
    if (p && p.status === 'DRAFT') paid.push(payPayslip(s, ctx, p.id, pay));
  }
  return paid;
}

/** Cancel before any payslip is paid. After payments, the payslips must be cancelled first. */
export function cancelSettlement(s: State, ctx: Ctx, id: string, reason: string): ProfitSettlement {
  requireRole(ctx, 'ADMIN');
  const st = find(s.settlements, id, 'Settlement');
  if (st.status === 'CANCELLED') throw invalidState('This settlement is already cancelled');
  const slips = s.payslips.filter((p) => p.settlementId === st.id);
  if (slips.some((p) => p.status === 'PAID')) throw invalidState('Some payslips of this settlement are paid. Cancel those payslips first.');
  const before = { status: st.status };
  for (const p of slips) if (p.status === 'DRAFT') {
    p.status = 'CANCELLED';
    p.cancelReason = `Settlement cancelled: ${reason}`;
  }
  s.loanRepayments = s.loanRepayments.filter((r) => r.settlementId !== st.id);
  s.advances = s.advances.filter((a) => a.settlementId !== st.id || a.recoveredAmount > 0);
  st.status = 'CANCELLED';
  st.cancelReason = reason;
  audit(ctx, 'settlement', st.id, 'cancel', `Cancelled the ${st.month} settlement: ${reason}`, before, { status: st.status });
  return st;
}
