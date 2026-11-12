import { divRound, pctBp, roundToRupee, type Paise } from './money.js';

export type ShareBasis = 'POOL' | 'NET';

export interface SettlementWorkerInput {
  staffId: string;
  payType: 'FIXED' | 'HOURLY' | 'SHARE';
  /** FIXED and HOURLY: whole-month amount from calcPayslip. */
  earned?: Paise;
  sharePercent?: number;
  reduceByAbsence?: boolean;
  presentDays?: number;
  halfDays?: number;
  workingDaysInMonth?: number;
  adjustment?: Paise;
  advanceRecovery?: Paise;
  alreadyPaid?: Paise;
}

export interface SettlementInput {
  sales: Paise;
  purchases: Paise;
  loanRepaymentRequested: Paise;
  loanOutstanding?: Paise;
  otherExpenses: Paise;
  shareBasis?: ShareBasis;
  workers: SettlementWorkerInput[];
}

export interface SettlementWorkerResult {
  staffId: string;
  payType: 'FIXED' | 'HOURLY' | 'SHARE';
  earned: Paise;
  sharePercent: number | null;
  effectivePercent: number | null;
  computed: Paise;
  scaled: Paise;
  adjustment: Paise;
  payable: Paise;
  advanceRecovery: Paise;
  alreadyPaid: Paise;
  balancePayable: Paise;
  carryAdvance: Paise;
}

export interface SettlementResult {
  sales: Paise;
  purchases: Paise;
  grossProfit: Paise;
  loanRepaymentApplied: Paise;
  loanRepaymentUnpaid: Paise;
  poolAfterLoan: Paise;
  shareBase: Paise;
  fixedHourlyTotal: Paise;
  shareTotal: Paise;
  workerTotal: Paise;
  scaleFactor: number;
  payableTotal: Paise;
  otherExpenses: Paise;
  ownerAmount: Paise;
  lines: SettlementWorkerResult[];
}

export class SettlementError extends Error {}

/** Share amount, optionally reduced by absences: percent × payable days ÷ working days, capped. */
export function shareAmount(
  shareBase: Paise,
  sharePercent: number,
  reduceByAbsence: boolean,
  presentDays: number,
  halfDays: number,
  workingDays: number,
): { amount: Paise; effectivePercent: number } {
  const bp = pctBp(sharePercent);
  if (!reduceByAbsence || workingDays <= 0) {
    return { amount: divRound(shareBase * bp, 10000), effectivePercent: sharePercent };
  }
  const halfUnits = Math.min(presentDays * 2 + halfDays, 2 * workingDays);
  const amount = divRound(shareBase * bp * halfUnits, 10000 * 2 * workingDays);
  return { amount, effectivePercent: (sharePercent * halfUnits) / (2 * workingDays) };
}

/** Profit settlement waterfall (Module 11): loan, workers, expenses, owner. */
export function calcSettlement(input: SettlementInput): SettlementResult {
  const shareTotalPct = input.workers
    .filter((w) => w.payType === 'SHARE')
    .reduce((a, w) => a + pctBp(w.sharePercent ?? 0), 0);
  if (shareTotalPct > 10000) throw new SettlementError('Share percentages total more than 100%');

  const grossProfit = input.sales - input.purchases;
  const available = Math.max(0, grossProfit);
  const loanCap = input.loanOutstanding ?? Number.MAX_SAFE_INTEGER;
  const loanRepaymentApplied = Math.max(0, Math.min(input.loanRepaymentRequested, available, loanCap));
  const loanRepaymentUnpaid = Math.max(0, input.loanRepaymentRequested - loanRepaymentApplied);
  const poolAfterLoan = Math.max(0, available - loanRepaymentApplied);
  const shareBase = input.shareBasis === 'NET' ? Math.max(0, poolAfterLoan - input.otherExpenses) : poolAfterLoan;

  const pre = input.workers.map((w) => {
    if (w.payType === 'SHARE') {
      const s = shareAmount(
        shareBase,
        w.sharePercent ?? 0,
        w.reduceByAbsence ?? false,
        w.presentDays ?? 0,
        w.halfDays ?? 0,
        w.workingDaysInMonth ?? 0,
      );
      return { w, earned: s.amount, effectivePercent: s.effectivePercent };
    }
    return { w, earned: Math.max(0, w.earned ?? 0), effectivePercent: null };
  });
  const fixedHourlyTotal = pre.filter((p) => p.w.payType !== 'SHARE').reduce((a, p) => a + p.earned, 0);
  const shareTotal = pre.filter((p) => p.w.payType === 'SHARE').reduce((a, p) => a + p.earned, 0);
  const workerTotal = fixedHourlyTotal + shareTotal;
  const scaling = workerTotal > poolAfterLoan;
  const scaleFactor = scaling && workerTotal > 0 ? poolAfterLoan / workerTotal : 1;

  const lines: SettlementWorkerResult[] = pre.map(({ w, earned, effectivePercent }) => {
    const scaled = scaling ? (workerTotal > 0 ? divRound(earned * poolAfterLoan, workerTotal) : 0) : earned;
    const adjustment = w.adjustment ?? 0;
    const payable = Math.max(0, roundToRupee(scaled + adjustment));
    const advanceRecovery = Math.max(0, Math.min(w.advanceRecovery ?? 0, payable));
    const alreadyPaid = Math.max(0, w.alreadyPaid ?? 0);
    const balance = payable - advanceRecovery - alreadyPaid;
    return {
      staffId: w.staffId,
      payType: w.payType,
      earned,
      sharePercent: w.payType === 'SHARE' ? (w.sharePercent ?? 0) : null,
      effectivePercent,
      computed: earned,
      scaled,
      adjustment,
      payable,
      advanceRecovery,
      alreadyPaid,
      balancePayable: Math.max(0, balance),
      carryAdvance: Math.max(0, -balance),
    };
  });
  const payableTotal = lines.reduce((a, l) => a + l.payable, 0);
  return {
    sales: input.sales,
    purchases: input.purchases,
    grossProfit,
    loanRepaymentApplied,
    loanRepaymentUnpaid,
    poolAfterLoan,
    shareBase,
    fixedHourlyTotal,
    shareTotal,
    workerTotal,
    scaleFactor,
    payableTotal,
    otherExpenses: input.otherExpenses,
    ownerAmount: poolAfterLoan - payableTotal - input.otherExpenses,
    lines,
  };
}
