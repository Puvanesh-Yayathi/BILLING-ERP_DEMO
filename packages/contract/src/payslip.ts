import { divRound, roundToRupee, type Paise } from './money.js';

export type PayType = 'FIXED' | 'HOURLY' | 'SHARE';

export interface PayslipLineInput {
  label: string;
  amount: Paise;
}

export interface PayslipInput {
  payType: 'FIXED' | 'HOURLY';
  basePay?: Paise;
  hourlyRate?: Paise;
  workingDaysInMonth: number;
  presentDays: number;
  halfDays: number;
  paidHours: number;
  allowances: PayslipLineInput[];
  deductions: PayslipLineInput[];
  advanceRecoveryRequested: Paise;
  outstandingAdvance: Paise;
}

export interface PayslipResult {
  perDayRate: Paise | null;
  payableDays: number;
  basePayEarned: Paise;
  allowancesTotal: Paise;
  deductionsTotal: Paise;
  advanceRecovery: Paise;
  gross: Paise;
  netExact: Paise;
  net: Paise;
  roundOff: Paise;
  advanceRemaining: Paise;
}

/** FIXED earned = basePay × payable days ÷ working days of the full month, capped at basePay. */
export function fixedEarned(basePay: Paise, workingDays: number, presentDays: number, halfDays: number): Paise {
  if (workingDays <= 0) return 0;
  const halfUnits = presentDays * 2 + halfDays;
  return Math.min(basePay, divRound(basePay * halfUnits, 2 * workingDays));
}

/** HOURLY earned = paid hours × rate. Hours may carry 2 decimals in the exact-minutes mode. */
export function hourlyEarned(hours: number, rate: Paise): Paise {
  return divRound(Math.round(hours * 100) * rate, 100);
}

export function calcPayslip(input: PayslipInput): PayslipResult {
  const payableDays = input.presentDays + 0.5 * input.halfDays;
  let basePayEarned = 0;
  let perDayRate: Paise | null = null;
  if (input.payType === 'FIXED') {
    const base = input.basePay ?? 0;
    perDayRate = input.workingDaysInMonth > 0 ? divRound(base, input.workingDaysInMonth) : 0;
    basePayEarned = fixedEarned(base, input.workingDaysInMonth, input.presentDays, input.halfDays);
  } else {
    basePayEarned = hourlyEarned(input.paidHours, input.hourlyRate ?? 0);
  }
  const allowancesTotal = input.allowances.reduce((a, l) => a + Math.max(0, l.amount), 0);
  const gross = basePayEarned + allowancesTotal;
  const deductionsRequested = input.deductions.reduce((a, l) => a + Math.max(0, l.amount), 0);
  const deductionsTotal = Math.min(deductionsRequested, gross);
  const advanceRecovery = Math.max(
    0,
    Math.min(input.advanceRecoveryRequested, input.outstandingAdvance, gross - deductionsTotal),
  );
  const netExact = gross - deductionsTotal - advanceRecovery;
  const net = Math.max(0, roundToRupee(netExact));
  return {
    perDayRate,
    payableDays,
    basePayEarned,
    allowancesTotal,
    deductionsTotal,
    advanceRecovery,
    gross,
    netExact,
    net,
    roundOff: net - netExact,
    advanceRemaining: input.outstandingAdvance - advanceRecovery,
  };
}
