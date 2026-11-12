import { calcInvoice, calcSettlement, roundQty } from '@app/contract';
import type { ActivityLog } from '@app/contract';
import type { State } from '../state.js';
import { cashLedger, bankLedger, customerLedger, dues } from '../services/ledgers.js';
import { fundFigures, loansWithOutstanding } from '../services/purchasing.js';
import { displayStatus } from '../services/util.js';

export interface Check {
  id: number;
  name: string;
  ok: boolean;
  detail: string;
}

/** Seed invariants from doc 10. Returns one entry per invariant. */
export function verifyState(s: State, audits: ActivityLog[]): Check[] {
  const checks: Check[] = [];
  const add = (id: number, name: string, problems: string[]) =>
    checks.push({ id, name, ok: problems.length === 0, detail: problems.slice(0, 5).join('; ') || 'ok' });

  // 1. No stock item is ever negative at any point.
  {
    const p: string[] = [];
    const walk = (moves: { id: string; qty: number; date: string; at: string }[], name: string) => {
      let bal = 0;
      for (const m of [...moves].sort((a, b) => a.at.localeCompare(b.at) || a.date.localeCompare(b.date))) {
        bal = roundQty(bal + m.qty);
        if (bal < 0) p.push(`${name} negative (${bal}) at ${m.at}`);
      }
    };
    for (const pr of s.products) walk(s.finishedMoves.filter((m) => m.productId === pr.id), pr.name);
    for (const r of s.rawMaterials) walk(s.rawMoves.filter((m) => m.rawMaterialId === r.id), r.name);
    add(1, 'No stock item is ever negative', p);
  }

  // 2. Finished = opening + produced − sold ± adjustments; purchase = opening + received − used ± adjustments.
  {
    const p: string[] = [];
    for (const pr of s.products) {
      const mv = s.finishedMoves.filter((m) => m.productId === pr.id);
      const produced = s.batches.flatMap((b) => b.outputs).filter((o) => o.productId === pr.id).reduce((a, o) => a + o.qty, 0);
      const sold = s.invoices.filter((i) => i.number && i.status !== 'DRAFT').flatMap((i) => i.items).filter((it) => it.productId === pr.id).reduce((a, it) => a + it.qty, 0);
      const returned = s.invoices.filter((i) => i.number && i.status === 'CANCELLED').flatMap((i) => i.items).filter((it) => it.productId === pr.id).reduce((a, it) => a + it.qty, 0);
      const other = mv.filter((m) => m.reason === 'OPENING' || m.reason === 'ADJUSTMENT').reduce((a, m) => a + m.qty, 0);
      const expected = roundQty(other + produced - sold + returned);
      const actual = roundQty(mv.reduce((a, m) => a + m.qty, 0));
      if (expected !== actual) p.push(`${pr.name}: expected ${expected}, movements ${actual}`);
    }
    for (const r of s.rawMaterials) {
      const mv = s.rawMoves.filter((m) => m.rawMaterialId === r.id);
      const received = s.goodsReceipts.flatMap((g) => g.items).filter((it) => it.rawMaterialId === r.id).reduce((a, it) => a + it.qty, 0);
      const used = s.batches.flatMap((b) => b.inputs).filter((x) => x.rawMaterialId === r.id).reduce((a, x) => a + x.qty, 0);
      const other = mv.filter((m) => m.reason === 'OPENING' || m.reason === 'ADJUSTMENT').reduce((a, m) => a + m.qty, 0);
      const expected = roundQty(other + received - used);
      const actual = roundQty(mv.reduce((a, m) => a + m.qty, 0));
      if (expected !== actual) p.push(`${r.name}: expected ${expected}, movements ${actual}`);
    }
    add(2, 'Stock equals the sum of its business events', p);
  }

  // 3. Invoice totals recompute; paid = allocated payments; statuses consistent.
  {
    const p: string[] = [];
    for (const inv of s.invoices) {
      const t = calcInvoice(inv.items, inv.intraState);
      if (t.grandTotal !== inv.grandTotal || t.taxableTotal !== inv.taxableTotal) p.push(`${inv.number ?? inv.id} total mismatch`);
      if (inv.status === 'CANCELLED') continue;
      const alloc = s.payments.flatMap((x) => x.allocations).filter((a) => a.invoiceId === inv.id).reduce((a, x) => a + x.amount, 0);
      if (alloc !== inv.paidAmount) p.push(`${inv.number} paid ${inv.paidAmount} vs allocated ${alloc}`);
      if (inv.status === 'PAID' && inv.paidAmount < inv.grandTotal) p.push(`${inv.number} marked paid but short`);
      if (inv.status === 'SENT' && inv.paidAmount >= inv.grandTotal) p.push(`${inv.number} fully paid but not marked paid`);
      if (displayStatus(inv, s.meta.seedToday) === 'OVERDUE' && !(inv.dueDate && inv.dueDate < s.meta.seedToday)) p.push(`${inv.number} overdue without due date`);
    }
    add(3, 'Invoice totals, paid amounts and statuses are consistent', p);
  }

  // 4. Customer ledger = dues; cash and bank ledgers = receipts − payments.
  {
    const p: string[] = [];
    const d = new Map(dues(s, s.meta.seedToday).map((r) => [r.customerId, r.balance]));
    for (const c of s.customers) {
      const l = customerLedger(s, c.id).closing;
      const inv = s.invoices.filter((i) => i.customerId === c.id && i.status !== 'DRAFT' && i.status !== 'CANCELLED').reduce((a, i) => a + i.grandTotal, 0);
      const paid = s.payments.filter((x) => x.customerId === c.id).reduce((a, x) => a + x.amount, 0);
      if (l !== c.openingBalance + inv - paid) p.push(`${c.name} ledger ${l} vs ${c.openingBalance + inv - paid}`);
      if ((d.get(c.id) ?? 0) !== l) p.push(`${c.name} dues ${d.get(c.id) ?? 0} vs ledger ${l}`);
    }
    const cash = cashLedger(s);
    const bank = bankLedger(s, undefined);
    const inflow = s.payments.reduce((a, x) => a + x.amount, 0) + s.tranches.reduce((a, t) => a + t.amount, 0);
    const outflow =
      s.supplierPayments.reduce((a, x) => a + x.amount, 0) +
      s.expenses.reduce((a, x) => a + x.amount, 0) +
      s.payslips.filter((x) => x.status === 'PAID').reduce((a, x) => a + x.net, 0) +
      s.advances.filter((x) => !x.settlementId).reduce((a, x) => a + x.amount, 0) +
      s.loanRepayments.reduce((a, x) => a + x.amount, 0);
    const opening = s.openingCash + s.bankAccounts.reduce((a, b) => a + b.openingBalance, 0);
    if (cash.closing + bank.closing !== opening + inflow - outflow) p.push(`cash+bank ${cash.closing + bank.closing} vs ${opening + inflow - outflow}`);
    add(4, 'Ledgers reconcile with dues, cash and bank', p);
  }

  // 5. Fund balance and loan outstanding.
  {
    const p: string[] = [];
    const f = fundFigures(s);
    const rec = s.tranches.reduce((a, t) => a + t.amount, 0);
    const util = s.supplierPayments.reduce((a, x) => a + x.amount, 0);
    if (f.balance !== rec - util) p.push(`fund balance ${f.balance} vs ${rec - util}`);
    for (const l of loansWithOutstanding(s)) {
      const repaid = s.loanRepayments.filter((x) => x.trancheId === l.id).reduce((a, x) => a + x.amount, 0);
      if (l.outstanding !== l.amount - repaid) p.push(`${l.lender} outstanding mismatch`);
    }
    add(5, 'Fund and loan balances reconcile', p);
  }

  // 6. Settlements recompute to the paisa; payslips sum to the worker total.
  {
    const p: string[] = [];
    for (const st of s.settlements.filter((x) => x.status === 'FINALIZED')) {
      const r = calcSettlement({
        sales: st.sales,
        purchases: st.purchases,
        loanRepaymentRequested: st.loanRepaymentRequested,
        otherExpenses: st.otherExpenses,
        shareBasis: st.shareBasis,
        workers: st.lines.map((l) => ({
          staffId: l.staffId,
          payType: l.payType,
          earned: l.payType === 'SHARE' ? undefined : l.earned,
          sharePercent: l.sharePercent ?? undefined,
          reduceByAbsence: l.reduceByAbsence,
          presentDays: l.presentDays,
          halfDays: l.halfDays,
          workingDaysInMonth: l.workingDays,
          adjustment: l.adjustment,
          advanceRecovery: l.advanceRecovery,
          alreadyPaid: l.alreadyPaid,
        })),
      });
      if (r.ownerAmount !== st.ownerAmount) p.push(`${st.month} owner ${st.ownerAmount} vs ${r.ownerAmount}`);
      if (r.payableTotal !== st.payableTotal) p.push(`${st.month} payable mismatch`);
      const slips = s.payslips.filter((x) => x.settlementId === st.id && x.status !== 'CANCELLED');
      const sum = slips.reduce((a, x) => a + x.gross, 0);
      if (sum !== st.payableTotal) p.push(`${st.month} payslips ${sum} vs worker total ${st.payableTotal}`);
    }
    add(6, 'Settlement figures recompute and payslips sum to the worker total', p);
  }

  // 7. Document numbers unique and gapless per financial year.
  {
    const p: string[] = [];
    const nums = [
      ...s.invoices.map((i) => i.number),
      ...s.payments.map((x) => x.receiptNo),
      ...s.indents.map((i) => i.number),
      ...s.indents.map((i) => i.poNumber),
      ...s.batches.map((b) => b.batchNo),
      ...s.payslips.map((x) => x.number),
      ...s.goodsReceipts.map((g) => g.number),
      ...s.supplierPayments.map((x) => x.number),
    ].filter((x): x is string => !!x);
    const seen = new Set<string>();
    for (const n of nums) {
      if (seen.has(n)) p.push(`duplicate ${n}`);
      seen.add(n);
    }
    const groups = new Map<string, number[]>();
    for (const n of seen) {
      const [pre, fy, seq] = n.split('/');
      const k = `${pre}/${fy}`;
      groups.set(k, [...(groups.get(k) ?? []), Number(seq)]);
    }
    for (const [k, list] of groups) {
      list.sort((a, b) => a - b);
      list.forEach((v, i) => {
        if (v !== i + 1) p.push(`${k} gap at ${i + 1}`);
      });
    }
    add(7, 'Document numbers are unique and gapless', [...new Set(p)]);
  }

  // 8. Every business record has an audit entry; every login worker has sessions.
  {
    const p: string[] = [];
    const ids = new Set(audits.map((a) => a.entityId));
    const records: [string, { id: string }[]][] = [
      ['invoice', s.invoices],
      ['payment', s.payments],
      ['indent', s.indents],
      ['purchase bill', s.goodsReceipts],
      ['supplier payment', s.supplierPayments],
      ['batch', s.batches],
      ['expense', s.expenses],
      ['payslip', s.payslips.filter((x) => x.source === 'PAYROLL')],
      ['settlement', s.settlements],
      ['tranche', s.tranches],
      ['advance', s.advances.filter((a) => !a.settlementId)],
    ];
    for (const [name, list] of records) for (const r of list) if (!ids.has(r.id)) p.push(`${name} ${r.id} has no audit entry`);
    for (const st of s.staff.filter((x) => x.userId)) if (!s.sessions.some((x) => x.staffId === st.id)) p.push(`${st.name} has no sessions`);
    add(8, 'Every record is audited and login workers have sessions', p);
  }

  // 9. State document under 1.5 MB.
  {
    const bytes = JSON.stringify(s).length;
    add(9, 'State document is under 1.5 MB', bytes < 1.5 * 1024 * 1024 ? [] : [`${bytes} bytes`]);
    checks[checks.length - 1]!.detail = `${(bytes / 1024).toFixed(0)} KB`;
  }
  return checks;
}
