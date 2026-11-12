import { beforeAll, describe, expect, it } from 'vitest';
import { monthEnd, monthStart, prevMonth } from '@app/contract';
import { makeCtx, type Actor } from '../../server/src/ctx.js';
import { buildSeed } from '../../server/src/seed/index.js';
import { verifyState } from '../../server/src/seed/verify.js';
import { cancelInvoice, createInvoice, finalizeInvoice } from '../../server/src/services/invoices.js';
import { adjustStock, confirmStockCount, createStockCount, recordProduction, salesTracker } from '../../server/src/services/inventory.js';
import { cancelPayslip, createPayslipDraft, payPayslip } from '../../server/src/services/payroll.js';
import { cancelSettlement, finalizeSettlement, payAllSettlement, saveSettlementDraft } from '../../server/src/services/settlement.js';
import { finishedStock, rawStock } from '../../server/src/services/util.js';
import type { State } from '../../server/src/state.js';

let s: State;
let admin: Actor;
const NOW = '2026-11-12T06:00:00.000Z';
const ctx = () => makeCtx(admin, { now: NOW });

beforeAll(() => {
  s = buildSeed(NOW, 1).state;
  const u = s.users.find((x) => x.username === 'admin')!;
  admin = { id: u.id, name: u.name, role: u.role };
});

const product = (code: string) => s.products.find((p) => p.code === code)!;

describe('inventory', () => {
  it('production consumes raw stock and creates finished stock in one step', () => {
    const raw = s.rawMaterials[0]!;
    const p = product('PRD-A');
    const r0 = rawStock(s, raw.id);
    const f0 = finishedStock(s, p.id);
    recordProduction(s, ctx(), { inputs: [{ rawMaterialId: raw.id, qty: 10 }], outputs: [{ productId: p.id, qty: 18 }], wastageQty: 0.5, wastageNote: 'test' });
    expect(rawStock(s, raw.id)).toBe(r0 - 10);
    expect(finishedStock(s, p.id)).toBe(f0 + 18);
  });

  it('production is refused when raw stock is short', () => {
    const raw = s.rawMaterials[0]!;
    expect(() => recordProduction(s, ctx(), { inputs: [{ rawMaterialId: raw.id, qty: 999999 }], outputs: [{ productId: product('PRD-A').id, qty: 1 }], wastageQty: 0, wastageNote: '' })).toThrow(/Not enough/);
  });

  it('stock take variance posts an adjustment with the reason', () => {
    const p = product('PRD-B');
    const before = finishedStock(s, p.id);
    const c = createStockCount(s, ctx(), { kind: 'SALES', lines: [{ itemId: p.id, countedQty: before - 3, reason: 'Damaged in storage' }] });
    confirmStockCount(s, ctx(), c.id);
    expect(finishedStock(s, p.id)).toBe(before - 3);
    expect(s.finishedMoves.at(-1)?.note).toContain('Damaged in storage');
  });

  it('a variance without a reason cannot be confirmed', () => {
    const p = product('PRD-C');
    const c = createStockCount(s, ctx(), { kind: 'SALES', lines: [{ itemId: p.id, countedQty: finishedStock(s, p.id) + 1, reason: '' }] });
    expect(() => confirmStockCount(s, ctx(), c.id)).toThrow(/reason/);
  });

  it('the low-stock alert fires once when an item crosses its reorder level', () => {
    const p = product('PRD-E');
    const stock = finishedStock(s, p.id);
    const before = s.notifications.filter((n) => n.title === 'Low stock' && n.body.includes(p.name)).length;
    adjustStock(s, ctx(), { kind: 'SALES', itemId: p.id, qty: -(stock - (p.reorderLevel - 1)), reason: 'Move below reorder level' });
    adjustStock(s, ctx(), { kind: 'SALES', itemId: p.id, qty: -1, reason: 'Still below' });
    const after = s.notifications.filter((n) => n.title === 'Low stock' && n.body.includes(p.name)).length;
    expect(after - before).toBeGreaterThan(0);
    const perAdmin = after - before;
    adjustStock(s, ctx(), { kind: 'SALES', itemId: p.id, qty: -1, reason: 'Still below again' });
    expect(s.notifications.filter((n) => n.title === 'Low stock' && n.body.includes(p.name)).length - before).toBe(perAdmin);
  });

  it('cancelling a bill returns its stock and the tracker matches the movements', () => {
    const p = product('PRD-F');
    const before = finishedStock(s, p.id);
    const inv = createInvoice(s, ctx(), { type: 'CASH', items: [{ productId: p.id, qty: 4, discountPct: 0 }] });
    finalizeInvoice(s, ctx(), inv.id);
    expect(finishedStock(s, p.id)).toBe(before - 4);
    cancelInvoice(s, ctx(), inv.id, 'Entered by mistake');
    expect(finishedStock(s, p.id)).toBe(before);
    const row = salesTracker(s, '2026-11-12').find((r) => r.id === p.id)!;
    expect(row.closing).toBe(finishedStock(s, p.id));
  });
});

describe('settlement workflow', () => {
  const month = prevMonth('2026-11');

  it('the seeded last month is finalized and every payslip is paid', () => {
    const st = s.settlements.find((x) => x.month === month)!;
    expect(st.status).toBe('FINALIZED');
    expect(s.payslips.filter((p) => p.settlementId === st.id).every((p) => p.status === 'PAID')).toBe(true);
    expect(s.loanRepayments.some((r) => r.settlementId === st.id)).toBe(true);
  });

  it('a settled month cannot be run again until it is cancelled', () => {
    expect(() => saveSettlementDraft(s, ctx(), { month, loanRepayment: 0, adjustments: [], advanceRecoveries: [] })).toThrow(/already settled/);
  });

  it('cancel is refused after payments; finalize creates the loan repayment and payslips', () => {
    const st = s.settlements.find((x) => x.month === month)!;
    expect(() => cancelSettlement(s, ctx(), st.id, 'test')).toThrow(/Cancel those payslips first/);
    const draft = saveSettlementDraft(s, ctx(), { month: '2026-11', loanRepayment: 0, adjustments: [], advanceRecoveries: [] });
    expect(draft.status).toBe('DRAFT');
    const fin = finalizeSettlement(s, ctx(), draft.id);
    expect(fin.lines.every((l) => l.payslipId)).toBe(true);
    const cancelled = cancelSettlement(s, ctx(), fin.id, 'Wrong month');
    expect(cancelled.status).toBe('CANCELLED');
    expect(s.payslips.filter((p) => p.settlementId === fin.id).every((p) => p.status === 'CANCELLED')).toBe(true);
  });

  it('pay all pays every settlement payslip and the seed still verifies', () => {
    const draft = saveSettlementDraft(s, ctx(), { month: '2026-11', loanRepayment: 0, adjustments: [], advanceRecoveries: [] });
    finalizeSettlement(s, ctx(), draft.id);
    const paid = payAllSettlement(s, ctx(), draft.id, { date: '2026-11-12', mode: 'BANK' });
    expect(paid.length).toBe(draft.lines.length);
    const bad = verifyState(s, []).filter((c) => !c.ok && c.id !== 8);
    expect(bad).toEqual([]);
  });
});

describe('payroll', () => {
  it('cancel restores the advance recovered and unlocks attendance', () => {
    const fresh = buildSeed(NOW, 1).state;
    const w = fresh.staff.find((x) => x.name === 'Worker F')!;
    const c = makeCtx(admin, { now: NOW });
    fresh.advances.push({ id: 'adv_t', staffId: w.id, date: '2026-11-02', amount: 50000, mode: 'CASH', recoveredAmount: 0, note: 'test' });
    const draft = createPayslipDraft(fresh, c, { staffId: w.id, periodFrom: monthStart('2026-11'), periodTo: '2026-11-11', allowances: [], deductions: [], advanceRecovery: 50000 });
    const paid = payPayslip(fresh, c, draft.id, { date: '2026-11-12', mode: 'CASH' });
    expect(fresh.attendance.filter((a) => a.payslipId === paid.id).length).toBeGreaterThan(0);
    const outstanding = () => fresh.advances.filter((a) => a.staffId === w.id).reduce((a, x) => a + x.amount - x.recoveredAmount, 0);
    const afterPay = outstanding();
    cancelPayslip(fresh, c, paid.id, 'Wrong amount');
    expect(fresh.attendance.some((a) => a.payslipId === paid.id)).toBe(false);
    expect(outstanding()).toBe(afterPay + paid.advanceRecovery);
    expect(monthEnd('2026-11')).toBe('2026-11-30');
  });
});
