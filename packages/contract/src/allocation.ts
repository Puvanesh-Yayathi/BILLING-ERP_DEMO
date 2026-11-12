import type { Paise } from './money.js';

export interface OpenInvoice {
  id: string;
  date: string;
  number: string;
  outstanding: Paise;
}

export interface Allocation {
  invoiceId: string;
  amount: Paise;
}

export class AllocationError extends Error {
  constructor(
    message: string,
    public readonly outstanding: Paise,
  ) {
    super(message);
  }
}

/** On-account payments go to the oldest unpaid invoice first (FIFO). Overpayment is rejected. */
export function allocateFifo(amount: Paise, open: OpenInvoice[]): Allocation[] {
  if (amount <= 0) throw new AllocationError('Enter an amount greater than zero', 0);
  const sorted = [...open]
    .filter((o) => o.outstanding > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const total = sorted.reduce((a, o) => a + o.outstanding, 0);
  if (amount > total) throw new AllocationError('Amount is more than the total outstanding', total);
  const out: Allocation[] = [];
  let left = amount;
  for (const o of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, o.outstanding);
    out.push({ invoiceId: o.id, amount: take });
    left -= take;
  }
  return out;
}

export interface FundFigures {
  received: Paise;
  utilised: Paise;
  committed: Paise;
}

export function fundSummary(f: FundFigures) {
  const balance = f.received - f.utilised;
  return { ...f, balance, available: balance - f.committed };
}

/** Warning (not a block) when an indent exceeds received − utilised − committed. */
export function fundWarning(f: FundFigures, indentTotal: Paise): string | null {
  const { available } = fundSummary(f);
  return indentTotal > available ? 'This indent is more than the fund available after committed indents.' : null;
}
