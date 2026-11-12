import { describe, expect, it } from 'vitest';
import {
  allocateFifo,
  amountInWords,
  calcInvoice,
  calcPayslip,
  calcSettlement,
  formatDocNumber,
  formatINR,
  fundSummary,
  fundWarning,
  roundHours,
  shareAmount,
  workingDaysInMonth,
} from '@app/contract';

const R = (r: number) => Math.round(r * 100);

describe('calcInvoice', () => {
  it('I-1 tax-exclusive, intra-state, item discount', () => {
    const t = calcInvoice(
      [
        { qty: 10, rate: R(250), discountPct: 0, gstRate: 5, taxInclusive: false },
        { qty: 4, rate: R(400), discountPct: 10, gstRate: 5, taxInclusive: false },
      ],
      true,
    );
    expect(t.lines[0]).toMatchObject({ taxableValue: R(2500), cgst: R(62.5), sgst: R(62.5), lineTotal: R(2625) });
    expect(t.lines[1]).toMatchObject({ taxableValue: R(1440), cgst: R(36), sgst: R(36), lineTotal: R(1512) });
    expect(t).toMatchObject({
      subtotal: R(4100),
      discountTotal: R(160),
      taxableTotal: R(3940),
      cgst: R(98.5),
      sgst: R(98.5),
      igst: 0,
      roundOff: 0,
      grandTotal: R(4137),
    });
    expect(t.taxSummary).toHaveLength(1);
  });

  it('I-2 tax-inclusive, inter-state', () => {
    const t = calcInvoice([{ qty: 1, rate: R(1050), discountPct: 0, gstRate: 5, taxInclusive: true }], false);
    expect(t).toMatchObject({ taxableTotal: R(1000), igst: R(50), cgst: 0, sgst: 0, grandTotal: R(1050) });
  });

  it('I-3 round-off', () => {
    const t = calcInvoice([{ qty: 7, rate: R(199.5), discountPct: 0, gstRate: 12, taxInclusive: false }], true);
    expect(t).toMatchObject({
      taxableTotal: R(1396.5),
      cgst: R(83.79),
      sgst: R(83.79),
      totalBeforeRoundOff: R(1564.08),
      roundOff: -8,
      grandTotal: R(1564),
    });
  });

  it('handles fractional quantities', () => {
    const t = calcInvoice([{ qty: 1.255, rate: R(600), discountPct: 0, gstRate: 5, taxInclusive: false }], true);
    expect(t.lines[0]?.taxableValue).toBe(R(753));
  });
});

describe('numbering', () => {
  it('NUM-1 financial year boundary', () => {
    expect(formatDocNumber('INV', '2027-03-31', 12)).toBe('INV/26-27/0012');
    expect(formatDocNumber('INV', '2027-04-01', 1)).toBe('INV/27-28/0001');
  });
});

describe('working days', () => {
  it('W-1 30-day month with 4 Sundays', () => {
    // November 2026: 30 days, Sundays on 1, 8, 15, 22, 29 (5). September 2026 has 4 Sundays.
    expect(workingDaysInMonth('2026-09', { weeklyOffs: [0], holidays: [] })).toBe(26);
  });
  it('W-2 31-day month with 5 Sundays and 1 holiday', () => {
    // May 2026: 31 days, Sundays 3, 10, 17, 24, 31.
    expect(workingDaysInMonth('2026-05', { weeklyOffs: [0], holidays: ['2026-05-01'] })).toBe(25);
  });
  it('a holiday on a Sunday is not counted twice', () => {
    expect(workingDaysInMonth('2026-05', { weeklyOffs: [0], holidays: ['2026-05-03'] })).toBe(26);
  });
});

describe('hours rounding', () => {
  const cases: [number, number][] = [
    [95, 2],
    [80, 1],
    [449, 7],
    [450, 8],
    [490, 8],
    [29, 0],
    [30, 1],
    [70 + 40, 2],
  ];
  it.each(cases)('%i minutes -> %i hours', (m, h) => expect(roundHours(m)).toBe(h));
  it('round up and exact modes', () => {
    expect(roundHours(61, 'UP')).toBe(2);
    expect(roundHours(90, 'EXACT')).toBe(1.5);
  });
});

describe('calcPayslip', () => {
  const base = {
    payType: 'FIXED' as const,
    basePay: R(17000),
    workingDaysInMonth: 26,
    presentDays: 24,
    halfDays: 0,
    paidHours: 0,
    allowances: [],
    deductions: [],
    advanceRecoveryRequested: 0,
    outstandingAdvance: 0,
  };
  it('P-1 fixed', () => {
    const r = calcPayslip(base);
    expect(r.basePayEarned).toBe(R(15692.31));
    expect(r.perDayRate).toBe(R(653.85));
  });
  it('P-2 half days and advance', () => {
    const r = calcPayslip({ ...base, presentDays: 22, halfDays: 2, advanceRecoveryRequested: R(2000), outstandingAdvance: R(5000) });
    expect(r.basePayEarned).toBe(R(15038.46));
    expect(r.netExact).toBe(R(13038.46));
    expect(r.net).toBe(R(13038));
    expect(r.roundOff).toBe(-46);
  });
  it('P-3 month to date uses full month day rate', () => {
    expect(calcPayslip({ ...base, presentDays: 8 }).basePayEarned).toBe(R(5230.77));
  });
  it('per-day rate with 27 working days', () => {
    expect(calcPayslip({ ...base, workingDaysInMonth: 27, presentDays: 27 }).basePayEarned).toBe(R(17000));
  });
  it('fixed earned is capped at base pay', () => {
    expect(calcPayslip({ ...base, presentDays: 30 }).basePayEarned).toBe(R(17000));
  });
  it('P-4 hourly, no overtime', () => {
    const r = calcPayslip({ ...base, payType: 'HOURLY', basePay: undefined, hourlyRate: R(90), paidHours: 8 + 8 + 7 + 8 + 2 });
    expect(r.basePayEarned).toBe(R(2970));
  });
  it('P-5 net never negative', () => {
    const r = calcPayslip({
      ...base,
      payType: 'HOURLY',
      hourlyRate: R(100),
      paidHours: 10,
      advanceRecoveryRequested: R(1500),
      outstandingAdvance: R(1500),
    });
    expect(r.gross).toBe(R(1000));
    expect(r.advanceRecovery).toBe(R(1000));
    expect(r.net).toBe(0);
    expect(r.advanceRemaining).toBe(R(500));
  });
  it('allowances add to gross', () => {
    const r = calcPayslip({ ...base, allowances: [{ label: 'Bonus', amount: R(500) }] });
    expect(r.gross).toBe(R(16192.31));
  });
});

describe('share pay', () => {
  it('S-1 reduce by absences on and off', () => {
    expect(shareAmount(R(3000000), 5, true, 23, 0, 26).amount).toBe(R(132692.31));
    expect(shareAmount(R(3000000), 5, true, 23, 0, 26).effectivePercent).toBeCloseTo(4.4230769, 6);
    expect(shareAmount(R(3000000), 5, false, 23, 0, 26).amount).toBe(R(150000));
  });
});

describe('calcSettlement', () => {
  it('ST-1 normal month', () => {
    const r = calcSettlement({
      sales: R(8000000),
      purchases: R(3000000),
      loanRepaymentRequested: R(2000000),
      otherExpenses: R(150000),
      workers: [
        { staffId: 'f', payType: 'FIXED', earned: R(70000) },
        { staffId: 'h', payType: 'HOURLY', earned: R(50000) },
        { staffId: 's1', payType: 'SHARE', sharePercent: 5 },
        { staffId: 's2', payType: 'SHARE', sharePercent: 3 },
      ],
    });
    expect(r.grossProfit).toBe(R(5000000));
    expect(r.poolAfterLoan).toBe(R(3000000));
    expect(r.lines.find((l) => l.staffId === 's1')?.payable).toBe(R(150000));
    expect(r.lines.find((l) => l.staffId === 's2')?.payable).toBe(R(90000));
    expect(r.workerTotal).toBe(R(360000));
    expect(r.scaleFactor).toBe(1);
    expect(r.ownerAmount).toBe(R(2490000));
  });

  it('ST-2 small profit scaling', () => {
    const r = calcSettlement({
      sales: R(400000),
      purchases: R(300000),
      loanRepaymentRequested: 0,
      otherExpenses: R(20000),
      workers: [
        { staffId: 'a', payType: 'FIXED', earned: R(17000) },
        { staffId: 'b', payType: 'FIXED', earned: R(103000) },
        { staffId: 's', payType: 'SHARE', sharePercent: 5 },
      ],
    });
    expect(r.workerTotal).toBe(R(125000));
    expect(r.scaleFactor).toBeCloseTo(0.8);
    expect(r.lines.find((l) => l.staffId === 'a')?.payable).toBe(R(13600));
    expect(r.lines.find((l) => l.staffId === 's')?.payable).toBe(R(4000));
    expect(r.payableTotal).toBe(R(100000));
    expect(r.ownerAmount).toBe(R(-20000));
  });

  it('ST-3 loan capped at profit', () => {
    const r = calcSettlement({
      sales: R(150000),
      purchases: R(100000),
      loanRepaymentRequested: R(80000),
      otherExpenses: R(5000),
      workers: [{ staffId: 'a', payType: 'FIXED', earned: R(17000) }],
    });
    expect(r.loanRepaymentApplied).toBe(R(50000));
    expect(r.loanRepaymentUnpaid).toBe(R(30000));
    expect(r.poolAfterLoan).toBe(0);
    expect(r.lines[0]?.payable).toBe(0);
    expect(r.ownerAmount).toBe(R(-5000));
  });

  it('negative gross profit gives a zero pool', () => {
    const r = calcSettlement({ sales: R(100), purchases: R(500), loanRepaymentRequested: R(10), otherExpenses: 0, workers: [] });
    expect(r.poolAfterLoan).toBe(0);
    expect(r.loanRepaymentApplied).toBe(0);
  });

  it('ST-4 already paid and carry-forward advance', () => {
    const r = calcSettlement({
      sales: R(1000000),
      purchases: 0,
      loanRepaymentRequested: 0,
      otherExpenses: 0,
      workers: [
        { staffId: 'a', payType: 'FIXED', earned: R(17000), alreadyPaid: R(10000) },
        { staffId: 'b', payType: 'FIXED', earned: R(5000), alreadyPaid: R(6000) },
      ],
    });
    expect(r.lines[0]?.balancePayable).toBe(R(7000));
    expect(r.lines[1]?.balancePayable).toBe(0);
    expect(r.lines[1]?.carryAdvance).toBe(R(1000));
  });

  it('adjustments apply after scaling and owner reconciles', () => {
    const r = calcSettlement({
      sales: R(1000000),
      purchases: 0,
      loanRepaymentRequested: 0,
      otherExpenses: R(1000),
      workers: [{ staffId: 'a', payType: 'FIXED', earned: R(10000), adjustment: R(500) }],
    });
    expect(r.lines[0]?.payable).toBe(R(10500));
    expect(r.ownerAmount + r.payableTotal + r.otherExpenses).toBe(r.poolAfterLoan);
  });

  it('NET share basis deducts expenses first', () => {
    const r = calcSettlement({
      sales: R(100000),
      purchases: 0,
      loanRepaymentRequested: 0,
      otherExpenses: R(20000),
      shareBasis: 'NET',
      workers: [{ staffId: 's', payType: 'SHARE', sharePercent: 10 }],
    });
    expect(r.lines[0]?.payable).toBe(R(8000));
  });

  it('share unpaid portion stays with owner when reduced by absences', () => {
    const r = calcSettlement({
      sales: R(3000000),
      purchases: 0,
      loanRepaymentRequested: 0,
      otherExpenses: 0,
      workers: [{ staffId: 's', payType: 'SHARE', sharePercent: 5, reduceByAbsence: true, presentDays: 23, workingDaysInMonth: 26 }],
    });
    expect(r.lines[0]?.payable).toBe(R(132692));
    expect(r.ownerAmount).toBe(R(3000000) - R(132692));
  });

  it('rejects share percentages over 100', () => {
    expect(() =>
      calcSettlement({
        sales: 0,
        purchases: 0,
        loanRepaymentRequested: 0,
        otherExpenses: 0,
        workers: [
          { staffId: 'a', payType: 'SHARE', sharePercent: 60 },
          { staffId: 'b', payType: 'SHARE', sharePercent: 41 },
        ],
      }),
    ).toThrow();
  });
});

describe('payments and funds', () => {
  it('PAY-1 FIFO allocation', () => {
    const open = [
      { id: '2', date: '2026-10-05', number: 'INV-2', outstanding: R(2000) },
      { id: '1', date: '2026-10-01', number: 'INV-1', outstanding: R(1000) },
    ];
    expect(allocateFifo(R(1500), open)).toEqual([
      { invoiceId: '1', amount: R(1000) },
      { invoiceId: '2', amount: R(500) },
    ]);
    expect(() => allocateFifo(R(3000.01), open)).toThrow();
  });
  it('FUND-1 warning, not a block', () => {
    const f = { received: R(1000000), utilised: R(400000), committed: R(200000) };
    expect(fundSummary(f)).toMatchObject({ balance: R(600000), available: R(400000) });
    expect(fundWarning(f, R(500000))).not.toBeNull();
    expect(fundWarning(f, R(300000))).toBeNull();
  });
});

describe('formatting', () => {
  it('Indian grouping', () => {
    expect(formatINR(R(123456))).toBe('₹1,23,456.00');
    expect(formatINR(R(8000000))).toBe('₹80,00,000.00');
    expect(formatINR(-R(20000))).toBe('−₹20,000.00');
  });
  it('amount in words', () => {
    expect(amountInWords(R(4137))).toBe('Rupees Four Thousand One Hundred Thirty Seven Only');
    expect(amountInWords(R(123456.5))).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');
  });
});
