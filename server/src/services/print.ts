import { amountInWords, type CompanyProfile } from '@app/contract';
import type { Ctx } from '../ctx.js';
import { notFound } from '../errors.js';
import type { State } from '../state.js';
import { defaultBank } from './masters.js';
import { paidOnIndent, receivedValue } from './purchasing.js';
import { canSeeInvoice, currentProfile, displayStatus, find, outstanding, userName } from './util.js';

/** Documents print with the profile version in force when they were finalized; drafts use the live one. */
function profileFor(s: State, versionId?: string): CompanyProfile {
  return (versionId && s.companyProfiles.find((p) => p.id === versionId)) || currentProfile(s);
}

function party(s: State, customerId?: string, walkIn?: string) {
  const c = customerId ? s.customers.find((x) => x.id === customerId) : undefined;
  return c
    ? { name: c.name, address: c.address, gstin: c.gstin, state: c.state, stateCode: c.stateCode, phone: c.phone }
    : { name: walkIn ?? 'Walk-in customer', address: '', gstin: undefined, state: '', stateCode: '', phone: '' };
}

export function invoicePrint(s: State, ctx: Ctx, id: string) {
  const inv = s.invoices.find((x) => x.id === id);
  if (!inv || !canSeeInvoice(ctx, inv)) throw notFound('Bill');
  const company = profileFor(s, inv.companyProfileVersionId);
  const bank = defaultBank(s);
  const balance = outstanding(inv);
  return {
    invoice: { ...inv, displayStatus: displayStatus(inv, ctx.today), balance },
    company,
    party: party(s, inv.customerId, inv.walkInName),
    bank: bank ?? null,
    amountInWords: amountInWords(inv.grandTotal),
    upiUri: bank && balance > 0 ? `upi://pay?pa=${encodeURIComponent(bank.upiId)}&pn=${encodeURIComponent(company.brandName)}&am=${(balance / 100).toFixed(2)}&cu=INR` : null,
    taxCharged: inv.cgst + inv.sgst + inv.igst > 0,
    createdBy: userName(s, inv.createdById),
  };
}

export function paymentPrint(s: State, ctx: Ctx, id: string) {
  const p = find(s.payments, id, 'Receipt');
  if (ctx.actor.role === 'DISTRIBUTOR' && p.customerId !== ctx.actor.customerId) throw notFound('Receipt');
  if ((ctx.actor.role === 'STAFF' || ctx.actor.role === 'OPERATING') && p.createdById !== ctx.actor.id) throw notFound('Receipt');
  return {
    payment: p,
    company: profileFor(s, p.companyProfileVersionId),
    party: party(s, p.customerId, 'Walk-in customer'),
    allocations: p.allocations.filter((a) => a.amount > 0).map((a) => {
      const inv = s.invoices.find((x) => x.id === a.invoiceId);
      return { number: inv?.number ?? '', date: inv?.date ?? '', total: inv?.grandTotal ?? 0, amount: a.amount };
    }),
    amountInWords: amountInWords(p.amount),
    receivedBy: userName(s, p.createdById),
  };
}

export function indentPrint(s: State, id: string) {
  const ind = find(s.indents, id, 'Indent');
  const sup = find(s.suppliers, ind.supplierId, 'Supplier');
  return {
    indent: ind,
    company: profileFor(s, ind.companyProfileVersionId),
    supplier: sup,
    items: ind.items.map((it) => {
      const r = s.rawMaterials.find((x) => x.id === it.rawMaterialId);
      return { ...it, name: r?.name ?? '', unit: s.units.find((u) => u.id === r?.unitId)?.name ?? '' };
    }),
    amountInWords: amountInWords(ind.total),
    approvals: ind.approvals.map((a) => ({ ...a, by: userName(s, a.userId) })),
  };
}

export function goodsReceiptPrint(s: State, id: string) {
  const g = find(s.goodsReceipts, id, 'Goods receipt');
  const ind = find(s.indents, g.indentId, 'Indent');
  return {
    receipt: g,
    indent: { id: ind.id, number: ind.number, poNumber: ind.poNumber },
    company: profileFor(s, g.companyProfileVersionId),
    supplier: find(s.suppliers, ind.supplierId, 'Supplier'),
    items: g.items.map((it) => {
      const r = s.rawMaterials.find((x) => x.id === it.rawMaterialId);
      return { ...it, name: r?.name ?? '', unit: s.units.find((u) => u.id === r?.unitId)?.name ?? '', variance: it.amount - Math.round(it.qty * it.indentRate) };
    }),
    amountInWords: amountInWords(g.billAmount),
    receivedBy: userName(s, g.createdById),
  };
}

export function supplierPaymentPrint(s: State, id: string) {
  const p = find(s.supplierPayments, id, 'Voucher');
  const ind = find(s.indents, p.indentId, 'Indent');
  return {
    payment: p,
    indent: { number: ind.number, total: ind.total, received: receivedValue(s, ind.id), paid: paidOnIndent(s, ind.id) },
    company: profileFor(s, p.companyProfileVersionId),
    supplier: find(s.suppliers, p.supplierId, 'Supplier'),
    amountInWords: amountInWords(p.amount),
    paidBy: userName(s, p.createdById),
  };
}

export function payslipPrint(s: State, ctx: Ctx, id: string) {
  const p = s.payslips.find((x) => x.id === id);
  const own = ctx.actor.staffId && p?.staffId === ctx.actor.staffId && p.status === 'PAID';
  if (!p || (ctx.actor.role !== 'ADMIN' && !own)) throw notFound('Payslip');
  const st = find(s.staff, p.staffId, 'Worker');
  const days = s.attendance
    .filter((a) => a.staffId === p.staffId && a.date >= p.periodFrom && a.date <= p.periodTo)
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    payslip: p,
    staff: { id: st.id, code: st.code, name: st.name, phone: st.phone, joinDate: st.joinDate, role: s.users.find((u) => u.id === st.userId)?.role ?? 'Worker without login' },
    company: profileFor(s, p.companyProfileVersionId),
    days,
    amountInWords: amountInWords(p.net),
  };
}

export function settlementPrint(s: State, id: string) {
  const st = find(s.settlements, id, 'Settlement');
  return {
    settlement: st,
    company: profileFor(s, st.companyProfileVersionId),
    loan: st.loanTrancheId ? s.tranches.find((t) => t.id === st.loanTrancheId) ?? null : null,
    workers: st.lines.map((l) => {
      const w = s.staff.find((x) => x.id === l.staffId);
      const slip = s.payslips.find((p) => p.id === l.payslipId);
      return { ...l, name: w?.name ?? '', code: w?.code ?? '', payslipNumber: slip?.number ?? null, payslipStatus: slip?.status ?? null, paidOn: slip?.paidOn ?? null };
    }),
    payslipIds: st.lines.map((l) => l.payslipId).filter((x): x is string => !!x),
  };
}
