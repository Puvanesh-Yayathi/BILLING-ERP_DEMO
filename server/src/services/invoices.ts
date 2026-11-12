import {
  addDays,
  allocateFifo,
  AllocationError,
  calcInvoice,
  formatINR,
  formatQty,
  roundQty,
  type Customer,
  type Invoice,
  type InvoiceInput,
  type InvoiceItem,
  type OrderRequest,
  type OrderRequestInput,
  type Payment,
  type PaymentInput,
} from '@app/contract';
import { audit, COMPANY_AUDIENCE, emit, newId, notify, type Ctx } from '../ctx.js';
import { AppError, invalidState, notFound, validation } from '../errors.js';
import type { State } from '../state.js';
import {
  adminIds,
  canSeeInvoice,
  checkRev,
  companyState,
  currentProfile,
  find,
  finishedStock,
  lowStockCheck,
  nextNumber,
  outstanding,
  requireRole,
} from './util.js';

function priceFor(type: Invoice['type'], customer: Customer | undefined, p: { retailPrice: number; distributorPrice: number }) {
  return type === 'DISTRIBUTOR' || customer?.type === 'DISTRIBUTOR' ? p.distributorPrice : p.retailPrice;
}

/** Server always recalculates with calcInvoice. Rates come from the Sales Inventory unless Admin overrides. */
function buildInvoice(s: State, ctx: Ctx, i: InvoiceInput, existing?: Invoice): Omit<Invoice, 'id' | 'createdAt' | 'createdById' | 'rev'> {
  const customer = i.customerId ? find(s.customers, i.customerId, 'Customer') : undefined;
  if (i.type === 'DISTRIBUTOR' && customer?.type !== 'DISTRIBUTOR')
    throw validation('Choose a distributor for a distributor bill', { customerId: 'Choose a distributor' });
  if (i.type !== 'DISTRIBUTOR' && customer?.type === 'DISTRIBUTOR')
    throw validation('Distributors are billed with a distributor bill', { type: 'Choose Distributor as the bill type' });
  const company = companyState(s);
  const intraState = !customer || customer.stateCode === company.code;
  const items: Omit<InvoiceItem, 'gross' | 'discount' | 'taxableValue' | 'cgst' | 'sgst' | 'igst' | 'lineTotal'>[] = i.items.map((l) => {
    const p = find(s.products, l.productId, 'Product');
    if (!p.active) throw validation(`${p.name} is no longer sold`);
    const unit = s.units.find((u) => u.id === p.unitId)?.name ?? '';
    const listRate = priceFor(i.type, customer, p);
    const rate = ctx.actor.role === 'ADMIN' && l.rate !== undefined ? l.rate : listRate;
    return {
      productId: p.id,
      code: p.code,
      name: p.name,
      hsn: p.hsn,
      unit,
      qty: roundQty(l.qty),
      rate,
      discountPct: l.discountPct,
      gstRate: p.gstRate,
      taxInclusive: p.taxInclusive,
    };
  });
  const t = calcInvoice(items, intraState);
  const date = existing?.date ?? i.date ?? ctx.today;
  return {
    date,
    type: i.type,
    customerId: customer?.id,
    walkInName: i.type === 'CASH' && !customer ? i.walkInName || 'Walk-in customer' : undefined,
    placeOfSupply: customer?.state ?? company.state,
    placeOfSupplyCode: customer?.stateCode ?? company.code,
    intraState,
    status: 'DRAFT',
    dueDate: i.type === 'CASH' ? undefined : addDays(date, s.settings.creditDays),
    items: items.map((it, idx) => ({ ...it, ...(t.lines[idx] as NonNullable<(typeof t.lines)[number]>) })),
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxableTotal: t.taxableTotal,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    roundOff: t.roundOff,
    grandTotal: t.grandTotal,
    paidAmount: 0,
    notes: i.notes,
    updatedAt: ctx.now,
  };
}

export function createInvoice(s: State, ctx: Ctx, i: InvoiceInput, extra: Partial<Invoice> = {}): Invoice {
  requireRole(ctx, 'ADMIN', 'STAFF', 'OPERATING');
  const inv: Invoice = { ...buildInvoice(s, ctx, i), ...extra, id: newId(s, 'inv'), createdById: ctx.actor.id, createdAt: ctx.now, rev: 1 };
  s.invoices.push(inv);
  audit(ctx, 'invoice', inv.id, 'create', `Saved draft bill for ${formatINR(inv.grandTotal)}`, undefined, inv);
  return inv;
}

function ownInvoice(s: State, ctx: Ctx, id: string): Invoice {
  const inv = s.invoices.find((x) => x.id === id);
  if (!inv || !canSeeInvoice(ctx, inv)) throw notFound('Bill');
  return inv;
}

export function getInvoice(s: State, ctx: Ctx, id: string): Invoice {
  return ownInvoice(s, ctx, id);
}

export function updateInvoice(s: State, ctx: Ctx, id: string, i: InvoiceInput, ifMatch?: string): Invoice {
  requireRole(ctx, 'ADMIN', 'STAFF', 'OPERATING');
  const inv = ownInvoice(s, ctx, id);
  checkRev(inv.rev, ifMatch);
  if (inv.status !== 'DRAFT') throw invalidState('Only draft bills can be edited');
  const before = structuredClone(inv);
  Object.assign(inv, buildInvoice(s, ctx, { ...i, date: inv.date }, inv), { rev: inv.rev + 1 });
  audit(ctx, 'invoice', inv.id, 'update', 'Updated draft bill', before, inv);
  return inv;
}

/** Draft → Sent: number assigned, stock reduced atomically (blocked if short), cash bills auto-paid. */
export function finalizeInvoice(s: State, ctx: Ctx, id: string): Invoice {
  requireRole(ctx, 'ADMIN', 'STAFF', 'OPERATING');
  const inv = ownInvoice(s, ctx, id);
  if (inv.status !== 'DRAFT') throw invalidState('This bill is already finalized');
  const need = new Map<string, number>();
  for (const it of inv.items) need.set(it.productId, roundQty((need.get(it.productId) ?? 0) + it.qty));
  for (const [productId, qty] of need) {
    const available = finishedStock(s, productId);
    if (available < qty) {
      const p = find(s.products, productId, 'Product');
      throw new AppError('INSUFFICIENT_STOCK', `Not enough stock for ${p.name}. Available ${formatQty(available)}.`, {
        productId,
        product: p.name,
        available,
      });
    }
  }
  const before = structuredClone(inv);
  inv.date = ctx.today < inv.date ? inv.date : ctx.today;
  if (inv.type !== 'CASH') inv.dueDate = addDays(inv.date, s.settings.creditDays);
  inv.number = nextNumber(s, 'INV', inv.date);
  inv.status = 'SENT';
  inv.finalizedAt = ctx.now;
  inv.updatedAt = ctx.now;
  inv.companyProfileVersionId = currentProfile(s).id;
  inv.rev++;
  for (const it of inv.items) {
    s.finishedMoves.push({
      id: newId(s, 'fsm'),
      productId: it.productId,
      qty: -it.qty,
      reason: 'SALE',
      refType: 'invoice',
      refId: inv.id,
      date: inv.date,
      note: inv.number,
      createdById: ctx.actor.id,
      at: ctx.now,
    });
  }
  for (const productId of need.keys())
    lowStockCheck(s, 'P', productId, (t, b, l) => notify(s, ctx, [...adminIds(s), ...s.users.filter((u) => u.role === 'OPERATING' && u.active).map((u) => u.id)], t, b, l));
  audit(ctx, 'invoice', inv.id, 'finalize', `Finalized bill ${inv.number} for ${formatINR(inv.grandTotal)}`, before, inv);
  emit(ctx, 'invoice.finalize', 'invoice', inv.id, `${ctx.actor.name} finalized ${inv.number}, ${formatINR(inv.grandTotal)}`, [...COMPANY_AUDIENCE, ...distributorAudience(s, inv)], inv.grandTotal);
  if (inv.type === 'CASH' && inv.grandTotal > 0) {
    recordPayment(s, ctx, { customerId: inv.customerId ?? '', invoiceId: inv.id, mode: 'CASH', amount: inv.grandTotal, date: inv.date }, true);
  }
  return inv;
}

function distributorAudience(s: State, inv: Invoice): string[] {
  return s.users.filter((u) => u.role === 'DISTRIBUTOR' && u.customerId && u.customerId === inv.customerId).map((u) => `user:${u.id}`);
}

/** Admin only, reason required, stock returned, linked payments reversed. */
export function cancelInvoice(s: State, ctx: Ctx, id: string, reason: string): Invoice {
  requireRole(ctx, 'ADMIN');
  const inv = find(s.invoices, id, 'Bill');
  if (inv.status === 'CANCELLED') throw invalidState('This bill is already cancelled');
  const before = structuredClone(inv);
  if (inv.status !== 'DRAFT') {
    for (const it of inv.items) {
      s.finishedMoves.push({
        id: newId(s, 'fsm'),
        productId: it.productId,
        qty: it.qty,
        reason: 'CANCEL',
        refType: 'invoice',
        refId: inv.id,
        date: ctx.today,
        note: `Cancelled ${inv.number}`,
        createdById: ctx.actor.id,
        at: ctx.now,
      });
      lowStockCheck(s, 'P', it.productId, () => undefined);
    }
    for (const p of s.payments) {
      const a = p.allocations.find((x) => x.invoiceId === inv.id);
      if (a) a.amount = 0;
    }
    s.payments = s.payments.filter((p) => !(p.auto && p.invoiceId === inv.id));
  }
  inv.status = 'CANCELLED';
  inv.paidAmount = 0;
  inv.cancelledAt = ctx.now;
  inv.cancelReason = reason;
  inv.rev++;
  audit(ctx, 'invoice', inv.id, 'cancel', `Cancelled bill ${inv.number ?? 'draft'}: ${reason}`, before, inv);
  emit(ctx, 'invoice.cancel', 'invoice', inv.id, `Admin cancelled ${inv.number ?? 'a draft bill'}`, [...COMPANY_AUDIENCE, `user:${inv.createdById}`]);
  return inv;
}

/** Payments: bill-wise or on account (FIFO). Overpayment rejected. */
export function recordPayment(s: State, ctx: Ctx, i: PaymentInput, auto = false): Payment {
  requireRole(ctx, 'ADMIN', 'STAFF', 'OPERATING');
  let allocations: { invoiceId: string; amount: number }[];
  const customer = i.customerId ? s.customers.find((c) => c.id === i.customerId) : undefined;
  if (i.invoiceId) {
    const inv = find(s.invoices, i.invoiceId, 'Bill');
    if (customer && inv.customerId !== customer.id) throw validation('This bill belongs to another customer');
    const out = outstanding(inv);
    if (i.amount > out) throw validation(`Amount is more than the outstanding ${formatINR(out)} on ${inv.number}`, { amount: `At most ${formatINR(out)}` });
    allocations = [{ invoiceId: inv.id, amount: i.amount }];
  } else {
    if (!customer) throw validation('Choose a customer', { customerId: 'Choose a customer' });
    const open = s.invoices
      .filter((x) => x.customerId === customer.id && outstanding(x) > 0)
      .map((x) => ({ id: x.id, date: x.date, number: x.number ?? '', outstanding: outstanding(x) }));
    try {
      allocations = allocateFifo(i.amount, open);
    } catch (e) {
      if (e instanceof AllocationError)
        throw validation(`${e.message}: ${formatINR(e.outstanding)}`, { amount: `At most ${formatINR(e.outstanding)}` });
      throw e;
    }
  }
  const date = i.date ?? ctx.today;
  const pay: Payment = {
    id: newId(s, 'pay'),
    receiptNo: nextNumber(s, 'RCT', date),
    date,
    customerId: customer?.id,
    invoiceId: i.invoiceId,
    mode: i.mode,
    amount: i.amount,
    reference: i.reference,
    allocations,
    auto,
    createdById: ctx.actor.id,
    createdAt: ctx.now,
    companyProfileVersionId: currentProfile(s).id,
  };
  for (const a of allocations) {
    const inv = find(s.invoices, a.invoiceId, 'Bill');
    inv.paidAmount += a.amount;
    if (inv.paidAmount >= inv.grandTotal) inv.status = 'PAID';
    inv.rev++;
  }
  s.payments.push(pay);
  const who = customer?.name ?? 'walk-in customer';
  audit(ctx, 'payment', pay.id, 'create', `Recorded payment ${pay.receiptNo} of ${formatINR(pay.amount)} from ${who}`, undefined, pay);
  if (!auto)
    emit(ctx, 'payment.create', 'payment', pay.id, `${ctx.actor.name} recorded payment ${pay.receiptNo}, ${formatINR(pay.amount)}`, COMPANY_AUDIENCE, pay.amount);
  return pay;
}

export function createOrderRequest(s: State, ctx: Ctx, i: OrderRequestInput): OrderRequest {
  requireRole(ctx, 'DISTRIBUTOR');
  const customerId = ctx.actor.customerId;
  if (!customerId) throw validation('Your account is not linked to a distributor');
  for (const it of i.items) find(s.products, it.productId, 'Product');
  const n = (s.counters.ORQ ?? 0) + 1;
  s.counters.ORQ = n;
  const o: OrderRequest = {
    id: newId(s, 'orq'),
    number: `ORQ-${String(n).padStart(4, '0')}`,
    distributorId: customerId,
    items: i.items,
    note: i.note,
    status: 'NEW',
    createdById: ctx.actor.id,
    createdAt: ctx.now,
  };
  s.orderRequests.push(o);
  const name = s.customers.find((c) => c.id === customerId)?.name ?? 'A distributor';
  notify(s, ctx, adminIds(s), 'New order request', `${name} requested ${o.items.length} products (${o.number}).`, '/order-requests');
  audit(ctx, 'order-request', o.id, 'create', `${name} submitted order request ${o.number}`, undefined, o);
  emit(ctx, 'order.create', 'order-request', o.id, `${name} submitted order request ${o.number}`);
  return o;
}

export function convertOrderRequest(s: State, ctx: Ctx, id: string): Invoice {
  requireRole(ctx, 'ADMIN');
  const o = find(s.orderRequests, id, 'Order request');
  if (o.status !== 'NEW') throw invalidState('This order request has already been handled');
  const inv = createInvoice(
    s,
    ctx,
    { type: 'DISTRIBUTOR', customerId: o.distributorId, items: o.items.map((x) => ({ ...x, discountPct: 0 })), notes: o.note || undefined },
    { orderRequestId: o.id },
  );
  o.status = 'CONVERTED';
  o.invoiceId = inv.id;
  notify(s, ctx, [o.createdById], 'Order request accepted', `${o.number} was converted to a bill.`, '/portal');
  audit(ctx, 'order-request', o.id, 'convert', `Converted ${o.number} to a draft bill`);
  emit(ctx, 'order.convert', 'order-request', o.id, `Admin converted ${o.number} to a draft bill`, [`user:${o.createdById}`]);
  return inv;
}

export function rejectOrderRequest(s: State, ctx: Ctx, id: string, remark: string): OrderRequest {
  requireRole(ctx, 'ADMIN');
  const o = find(s.orderRequests, id, 'Order request');
  if (o.status !== 'NEW') throw invalidState('This order request has already been handled');
  o.status = 'REJECTED';
  o.remark = remark;
  notify(s, ctx, [o.createdById], 'Order request rejected', `${o.number}: ${remark}`, '/portal');
  audit(ctx, 'order-request', o.id, 'reject', `Rejected ${o.number}: ${remark}`);
  emit(ctx, 'order.reject', 'order-request', o.id, `Admin rejected ${o.number}`, [`user:${o.createdById}`]);
  return o;
}
