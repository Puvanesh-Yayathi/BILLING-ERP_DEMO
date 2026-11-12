import {
  divRound,
  formatINR,
  fundSummary,
  fundWarning,
  qtyMilli,
  roundQty,
  type FundTranche,
  type GoodsReceipt,
  type IndentInput,
  type PurchaseBillInput,
  type PurchaseIndent,
  type SupplierPayment,
  type SupplierPaymentInput,
  type TrancheInput,
} from '@app/contract';
import { audit, COMPANY_AUDIENCE, emit, newId, notify, sendEmail, type Ctx } from '../ctx.js';
import { forbidden, invalidState, validation } from '../errors.js';
import type { State } from '../state.js';
import { adminIds, checkRev, currentProfile, find, lowStockCheck, nextNumber, requireRole } from './util.js';

export function addTranche(s: State, ctx: Ctx, i: TrancheInput): FundTranche {
  requireRole(ctx, 'ADMIN');
  const t: FundTranche = { ...i, lender: i.isLoan ? i.lender : undefined, id: newId(s, 'fnd'), createdAt: ctx.now };
  s.tranches.push(t);
  audit(ctx, 'fund-tranche', t.id, 'create', `Added ${t.isLoan ? 'loan' : 'fund'} tranche of ${formatINR(t.amount)} from ${t.source}`, undefined, t);
  emit(ctx, 'fund.create', 'fund-tranche', t.id, `Admin added a fund tranche of ${formatINR(t.amount)}`, COMPANY_AUDIENCE, t.amount);
  return t;
}

export function paidOnIndent(s: State, indentId: string): number {
  return s.supplierPayments.filter((p) => p.indentId === indentId).reduce((a, p) => a + p.amount, 0);
}

export function receivedValue(s: State, indentId: string): number {
  return s.goodsReceipts.filter((g) => g.indentId === indentId).reduce((a, g) => a + g.billAmount, 0);
}

/** Amount due to the supplier on an indent: received bill value (or total if fully received) minus payments. */
export function payableOnIndent(s: State, ind: PurchaseIndent): number {
  return Math.max(0, receivedValue(s, ind.id) - paidOnIndent(s, ind.id));
}

export function fundFigures(s: State) {
  const received = s.tranches.reduce((a, t) => a + t.amount, 0);
  const utilised = s.supplierPayments.reduce((a, p) => a + p.amount, 0);
  const committed = s.indents
    .filter((i) => i.status === 'APPROVED' || i.status === 'RECEIVED')
    .reduce((a, i) => a + Math.max(0, i.total - paidOnIndent(s, i.id)), 0);
  return fundSummary({ received, utilised, committed });
}

export function loansWithOutstanding(s: State) {
  return s.tranches
    .filter((t) => t.isLoan)
    .map((t) => {
      const repaid = s.loanRepayments.filter((r) => r.trancheId === t.id).reduce((a, r) => a + r.amount, 0);
      return { ...t, repaid, outstanding: t.amount - repaid, repayments: s.loanRepayments.filter((r) => r.trancheId === t.id) };
    });
}

function buildItems(s: State, i: IndentInput) {
  return i.items.map((it) => {
    const r = find(s.rawMaterials, it.rawMaterialId, 'Purchase item');
    if (!r.active) throw validation(`${r.name} is not active in the Purchase List`);
    return { rawMaterialId: r.id, qty: roundQty(it.qty), rate: it.rate, amount: divRound(qtyMilli(it.qty) * it.rate, 1000) };
  });
}

export function createIndent(s: State, ctx: Ctx, i: IndentInput): PurchaseIndent {
  requireRole(ctx, 'ADMIN');
  find(s.suppliers, i.supplierId, 'Supplier');
  const items = buildItems(s, i);
  const date = i.date ?? ctx.today;
  const ind: PurchaseIndent = {
    id: newId(s, 'ind'),
    number: nextNumber(s, 'PI', date),
    date,
    supplierId: i.supplierId,
    status: 'DRAFT',
    items,
    total: items.reduce((a, x) => a + x.amount, 0),
    note: i.note,
    raisedById: ctx.actor.id,
    approvals: [],
    createdAt: ctx.now,
    updatedAt: ctx.now,
    rev: 1,
  };
  s.indents.push(ind);
  audit(ctx, 'indent', ind.id, 'create', `Raised indent ${ind.number} for ${formatINR(ind.total)}`, undefined, ind);
  return ind;
}

export function updateIndent(s: State, ctx: Ctx, id: string, i: IndentInput, ifMatch?: string): PurchaseIndent {
  requireRole(ctx, 'ADMIN');
  const ind = find(s.indents, id, 'Indent');
  checkRev(ind.rev, ifMatch);
  if (ind.status !== 'DRAFT' && ind.status !== 'REJECTED') throw invalidState('Only draft or rejected indents can be edited');
  find(s.suppliers, i.supplierId, 'Supplier');
  const before = structuredClone(ind);
  ind.items = buildItems(s, i);
  ind.total = ind.items.reduce((a, x) => a + x.amount, 0);
  ind.supplierId = i.supplierId;
  ind.note = i.note;
  ind.updatedAt = ctx.now;
  ind.rev++;
  audit(ctx, 'indent', ind.id, 'update', `Edited indent ${ind.number}`, before, ind);
  return ind;
}

const isPending = (st: string) => st.startsWith('PENDING');

function announce(s: State, ctx: Ctx, ind: PurchaseIndent, to: string[], title: string, body: string) {
  notify(s, ctx, to, title, body, `/indents/${ind.id}`);
  for (const uid of to) {
    const u = s.users.find((x) => x.id === uid);
    if (u) sendEmail(s, ctx, `${u.username}@example.com`, `${title}: ${ind.number}`, body);
  }
}

/** Submit (Admin): DRAFT or REJECTED → PENDING_S1. Returns a fund warning, never blocks. */
export function submitIndent(s: State, ctx: Ctx, id: string): { indent: PurchaseIndent; warning: string | null } {
  requireRole(ctx, 'ADMIN');
  const ind = find(s.indents, id, 'Indent');
  if (ind.status !== 'DRAFT' && ind.status !== 'REJECTED') throw invalidState('Only draft or rejected indents can be submitted');
  const before = { status: ind.status };
  const warning = fundWarning(fundFigures(s), ind.total);
  ind.status = 'PENDING_S1';
  ind.approvals.push({ stage: 0, decision: 'SUBMITTED', remarks: warning ?? '', userId: ctx.actor.id, at: ctx.now });
  ind.updatedAt = ctx.now;
  ind.rev++;
  announce(s, ctx, ind, adminIds(s), 'Indent waiting for approval', `${ind.number} for ${formatINR(ind.total)} needs your approval.`);
  audit(ctx, 'indent', ind.id, 'submit', `Submitted indent ${ind.number}`, before, { status: ind.status });
  emit(ctx, 'indent.submit', 'indent', ind.id, `Admin submitted indent ${ind.number}`, COMPANY_AUDIENCE, ind.total);
  return { indent: ind, warning };
}

/** Admin approves (and rejects) indents. One approval makes the purchase order available. */
export function approveIndent(s: State, ctx: Ctx, id: string, remarks: string): PurchaseIndent {
  const ind = find(s.indents, id, 'Indent');
  if (!isPending(ind.status)) throw invalidState('This indent is not waiting for approval');
  if (ctx.actor.role !== 'ADMIN') throw forbidden('Indents are approved by Admin');
  const before = { status: ind.status };
  ind.approvals.push({ stage: 1, decision: 'APPROVED', remarks, userId: ctx.actor.id, at: ctx.now });
  ind.status = 'APPROVED';
  ind.approvedAt = ctx.now;
  ind.poNumber = nextNumber(s, 'PO', ctx.today);
  ind.companyProfileVersionId = currentProfile(s).id;
  ind.updatedAt = ctx.now;
  ind.rev++;
  notify(s, ctx, adminIds(s), 'Indent approved', `${ind.number} is approved. Purchase order ${ind.poNumber} is ready.`, `/indents/${ind.id}`);
  audit(ctx, 'indent', ind.id, 'approve', `Approved indent ${ind.number}`, before, { status: ind.status });
  emit(ctx, 'indent.approve', 'indent', ind.id, `${ctx.actor.name} approved ${ind.number}`, COMPANY_AUDIENCE);
  return ind;
}

export function rejectIndent(s: State, ctx: Ctx, id: string, remarks: string): PurchaseIndent {
  const ind = find(s.indents, id, 'Indent');
  if (!isPending(ind.status)) throw invalidState('This indent is not waiting for approval');
  if (ctx.actor.role !== 'ADMIN') throw forbidden('Indents are decided by Admin');
  const before = { status: ind.status };
  ind.status = 'REJECTED';
  ind.approvals.push({ stage: 1, decision: 'REJECTED', remarks, userId: ctx.actor.id, at: ctx.now });
  ind.updatedAt = ctx.now;
  ind.rev++;
  audit(ctx, 'indent', ind.id, 'reject', `Rejected indent ${ind.number}: ${remarks}`, before, { status: ind.status });
  emit(ctx, 'indent.reject', 'indent', ind.id, `${ctx.actor.name} rejected ${ind.number}`, COMPANY_AUDIENCE);
  return ind;
}

export function receivedQty(s: State, indentId: string, rawMaterialId: string): number {
  return roundQty(
    s.goodsReceipts
      .filter((g) => g.indentId === indentId)
      .flatMap((g) => g.items)
      .filter((x) => x.rawMaterialId === rawMaterialId)
      .reduce((a, x) => a + x.qty, 0),
  );
}

/** Goods receipt / purchase bill (Admin or Operating). Partial receipts keep the indent APPROVED. */
export function recordPurchaseBill(s: State, ctx: Ctx, i: PurchaseBillInput): GoodsReceipt {
  requireRole(ctx, 'ADMIN', 'OPERATING');
  const ind = find(s.indents, i.indentId, 'Indent');
  if (ind.status !== 'APPROVED') throw invalidState('Goods can only be received against an approved indent that is not yet fully received');
  const items = i.items
    .filter((x) => x.qty > 0)
    .map((x) => {
      const line = ind.items.find((l) => l.rawMaterialId === x.rawMaterialId);
      if (!line) throw validation('An item is not on this indent');
      const pending = roundQty(line.qty - receivedQty(s, ind.id, x.rawMaterialId));
      if (x.qty > pending) {
        const r = find(s.rawMaterials, x.rawMaterialId, 'Purchase item');
        throw validation(`${r.name}: only ${pending} is still to be received`);
      }
      return { rawMaterialId: x.rawMaterialId, qty: roundQty(x.qty), rate: x.rate, amount: divRound(qtyMilli(x.qty) * x.rate, 1000), indentRate: line.rate };
    });
  if (!items.length) throw validation('Enter a received quantity for at least one item');
  if (s.goodsReceipts.some((g) => g.supplierBillNo.toLowerCase() === i.supplierBillNo.toLowerCase() && s.indents.find((x) => x.id === g.indentId)?.supplierId === ind.supplierId))
    throw validation('This supplier bill number is already recorded', { supplierBillNo: 'Check the bill number' });
  const date = i.date ?? ctx.today;
  const g: GoodsReceipt = {
    id: newId(s, 'grn'),
    number: nextNumber(s, 'GRN', date),
    indentId: ind.id,
    date,
    items,
    supplierBillNo: i.supplierBillNo,
    supplierBillDate: i.supplierBillDate,
    billAmount: i.billAmount,
    note: i.note,
    createdById: ctx.actor.id,
    createdAt: ctx.now,
    companyProfileVersionId: currentProfile(s).id,
  };
  s.goodsReceipts.push(g);
  for (const it of items) {
    s.rawMoves.push({
      id: newId(s, 'rsm'),
      rawMaterialId: it.rawMaterialId,
      qty: it.qty,
      reason: 'PURCHASE',
      refType: 'goods-receipt',
      refId: g.id,
      rate: it.rate,
      date,
      note: `${g.number} (${ind.number})`,
      createdById: ctx.actor.id,
      at: ctx.now,
    });
    const r = find(s.rawMaterials, it.rawMaterialId, 'Purchase item');
    r.lastRate = it.rate;
    lowStockCheck(s, 'R', r.id, () => undefined);
    if (it.rate !== it.indentRate)
      audit(ctx, 'purchase-item', r.id, 'rate-variance', `${r.name} billed at ${formatINR(it.rate)} against indent rate ${formatINR(it.indentRate)}`);
  }
  const fully = ind.items.every((l) => receivedQty(s, ind.id, l.rawMaterialId) >= l.qty);
  const before = { status: ind.status };
  if (fully) ind.status = paidOnIndent(s, ind.id) >= Math.max(ind.total, receivedValue(s, ind.id)) ? 'PAID' : 'RECEIVED';
  ind.rev++;
  audit(ctx, 'purchase-bill', g.id, 'create', `Recorded purchase bill ${g.supplierBillNo} (${g.number}) for ${formatINR(g.billAmount)}`, before, g);
  emit(ctx, 'purchase.create', 'purchase-bill', g.id, `${ctx.actor.name} recorded goods receipt ${g.number}, ${formatINR(g.billAmount)}`, COMPANY_AUDIENCE, g.billAmount);
  return g;
}

/** Supplier payment (Admin). Counts toward fund utilisation. Indent becomes PAID when payments ≥ total. */
export function recordSupplierPayment(s: State, ctx: Ctx, i: SupplierPaymentInput): SupplierPayment {
  requireRole(ctx, 'ADMIN');
  const ind = find(s.indents, i.indentId, 'Indent');
  if (ind.status !== 'APPROVED' && ind.status !== 'RECEIVED') throw invalidState('Payments can only be made on approved or received indents');
  const due = Math.max(0, Math.max(ind.total, receivedValue(s, ind.id)) - paidOnIndent(s, ind.id));
  if (i.amount > due) throw validation(`Amount is more than the ${formatINR(due)} still due on ${ind.number}`, { amount: `At most ${formatINR(due)}` });
  const date = i.date ?? ctx.today;
  const p: SupplierPayment = {
    id: newId(s, 'spy'),
    number: nextNumber(s, 'SPV', date),
    indentId: ind.id,
    supplierId: ind.supplierId,
    date,
    mode: i.mode,
    amount: i.amount,
    reference: i.reference,
    createdById: ctx.actor.id,
    createdAt: ctx.now,
    companyProfileVersionId: currentProfile(s).id,
  };
  s.supplierPayments.push(p);
  const before = { status: ind.status };
  const target = Math.max(ind.total, receivedValue(s, ind.id));
  if (ind.status === 'RECEIVED' && paidOnIndent(s, ind.id) >= target) ind.status = 'PAID';
  ind.rev++;
  audit(ctx, 'supplier-payment', p.id, 'create', `Paid ${formatINR(p.amount)} to supplier on ${ind.number}`, before, p);
  emit(ctx, 'supplier.payment', 'supplier-payment', p.id, `Admin paid ${formatINR(p.amount)} on ${ind.number}`, COMPANY_AUDIENCE, p.amount);
  return p;
}
