import { z } from 'zod';
import { CancelBody, InvoiceBody, OrderRequestBody, PaymentBody, RemarkBody } from '@app/contract';
import { notFound } from '../errors.js';
import { route } from '../http.js';
import {
  cancelInvoice,
  convertOrderRequest,
  createInvoice,
  createOrderRequest,
  finalizeInvoice,
  getInvoice,
  recordPayment,
  rejectOrderRequest,
  updateInvoice,
} from '../services/invoices.js';
import { dues } from '../services/ledgers.js';
import { invoicePrint, paymentPrint } from '../services/print.js';
import { canSeeInvoice, displayStatus, inRange, matchQ, outstanding, paginate, userName } from '../services/util.js';

const SELL = ['ADMIN', 'STAFF', 'OPERATING'] as const;
const READ = ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR', 'DISTRIBUTOR'] as const;

const InvoiceQuery = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  customerId: z.string().optional(),
  createdById: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().default(50),
  cursor: z.string().optional(),
});

route({ method: 'get', path: '/invoices', summary: 'Bills, scoped to the caller', tag: 'Sales', roles: READ, query: InvoiceQuery }, async ({ read, query, ctx }) => {
  const s = await read();
  const rows = s.invoices
    .filter((i) => canSeeInvoice(ctx, i))
    .filter((i) => (ctx.actor.role === 'MONITOR' || ctx.actor.role === 'COLLECTOR' ? i.status !== 'DRAFT' : true))
    .filter((i) => (!query.status || displayStatus(i, ctx.today) === query.status) && (!query.type || i.type === query.type) && (!query.customerId || i.customerId === query.customerId) && (!query.createdById || i.createdById === query.createdById) && inRange(i.date, query.from, query.to))
    .map((i) => ({
      id: i.id,
      number: i.number ?? null,
      date: i.date,
      type: i.type,
      status: displayStatus(i, ctx.today),
      dueDate: i.dueDate ?? null,
      customerId: i.customerId ?? null,
      customer: s.customers.find((c) => c.id === i.customerId)?.name ?? i.walkInName ?? 'Walk-in customer',
      createdBy: userName(s, i.createdById),
      createdById: i.createdById,
      items: i.items.length,
      total: i.grandTotal,
      paid: i.paidAmount,
      balance: outstanding(i),
      createdAt: i.createdAt,
    }))
    .filter((r) => matchQ(query.q, r.number ?? 'draft', r.customer))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paginate(rows, query.limit, query.cursor);
});

route({ method: 'post', path: '/invoices', summary: 'Create a draft bill. The server recalculates with calcInvoice.', tag: 'Sales', roles: SELL, body: InvoiceBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createInvoice(s, ctx, body)));

route({ method: 'get', path: '/invoices/:id', summary: 'Bill with lines', tag: 'Sales', roles: READ, etag: false }, async ({ read, param, ctx, c }) => {
  const s = await read();
  const inv = getInvoice(s, ctx, param('id'));
  c.header('ETag', `"${inv.rev}"`);
  return {
    invoice: { ...inv, displayStatus: displayStatus(inv, ctx.today), balance: outstanding(inv) },
    customer: s.customers.find((x) => x.id === inv.customerId) ?? null,
    createdBy: userName(s, inv.createdById),
    payments: s.payments.filter((p) => p.allocations.some((a) => a.invoiceId === inv.id && a.amount > 0)).map((p) => ({ id: p.id, receiptNo: p.receiptNo, date: p.date, mode: p.mode, amount: p.allocations.find((a) => a.invoiceId === inv.id)?.amount ?? 0, reference: p.reference })),
  };
});

route({ method: 'patch', path: '/invoices/:id', summary: 'Edit a draft bill (If-Match required for edits)', tag: 'Sales', roles: SELL, body: InvoiceBody }, async ({ body, tx, ctx, param, c }) => tx((s) => updateInvoice(s, ctx, param('id'), body, c.req.header('if-match'))));

route({ method: 'post', path: '/invoices/:id/finalize', summary: 'Finalize: number, stock out, cash auto-payment', tag: 'Sales', roles: SELL, idempotent: true }, async ({ tx, ctx, param }) => tx((s) => finalizeInvoice(s, ctx, param('id'))));
route({ method: 'post', path: '/invoices/:id/cancel', summary: 'Cancel with a reason. Returns stock.', tag: 'Sales', roles: ['ADMIN'], body: CancelBody }, async ({ body, tx, ctx, param }) => tx((s) => cancelInvoice(s, ctx, param('id'), body.reason)));
route({ method: 'get', path: '/invoices/:id/print-data', summary: 'Data for the A4 invoice template', tag: 'Sales', roles: READ, etag: false }, async ({ read, param, ctx }) => invoicePrint(await read(), ctx, param('id')));

route({ method: 'get', path: '/payments', summary: 'Receipts', tag: 'Sales', roles: [...SELL, 'MONITOR', 'COLLECTOR', 'DISTRIBUTOR'], query: z.object({ customerId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), q: z.string().optional(), limit: z.coerce.number().default(50), cursor: z.string().optional() }) }, async ({ read, query, ctx }) => {
  const s = await read();
  const own = ctx.actor.role === 'STAFF' || ctx.actor.role === 'OPERATING';
  const rows = s.payments
    .filter((p) => (own ? p.createdById === ctx.actor.id : ctx.actor.role === 'DISTRIBUTOR' ? p.customerId === ctx.actor.customerId : true))
    .filter((p) => (!query.customerId || p.customerId === query.customerId) && inRange(p.date, query.from, query.to))
    .map((p) => ({ ...p, customer: s.customers.find((c) => c.id === p.customerId)?.name ?? 'Walk-in customer', receivedBy: userName(s, p.createdById), invoices: p.allocations.filter((a) => a.amount > 0).map((a) => s.invoices.find((i) => i.id === a.invoiceId)?.number ?? '') }))
    .filter((p) => matchQ(query.q, p.receiptNo, p.customer, p.reference))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return paginate(rows, query.limit, query.cursor);
});

route({ method: 'post', path: '/payments', summary: 'Record a payment: bill-wise or on account (oldest first)', tag: 'Sales', roles: SELL, body: PaymentBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => recordPayment(s, ctx, body)));
route({ method: 'get', path: '/payments/:id/print-data', summary: 'Data for the receipt template', tag: 'Sales', roles: [...SELL, 'DISTRIBUTOR'], etag: false }, async ({ read, param, ctx }) => paymentPrint(await read(), ctx, param('id')));

route({ method: 'get', path: '/customers/:id/open-invoices', summary: 'Unpaid bills of a customer for allocation', tag: 'Sales', roles: SELL, etag: false }, async ({ read, param, ctx }) => {
  const s = await read();
  return {
    items: s.invoices
      .filter((i) => i.customerId === param('id') && outstanding(i) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((i) => ({ id: i.id, number: i.number, date: i.date, dueDate: i.dueDate, total: i.grandTotal, paid: i.paidAmount, balance: outstanding(i), status: displayStatus(i, ctx.today) })),
  };
});

route({ method: 'get', path: '/dues', summary: 'Customer balances with ageing and overdue', tag: 'Sales', roles: SELL }, async ({ read, ctx }) => {
  const rows = dues(await read(), ctx.today).sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
  return { items: rows, totals: { balance: rows.reduce((a, r) => a + r.balance, 0), overdue: rows.reduce((a, r) => a + r.overdue, 0), b0_15: rows.reduce((a, r) => a + r.b0_15, 0), b16_30: rows.reduce((a, r) => a + r.b16_30, 0), b31: rows.reduce((a, r) => a + r.b31, 0) } };
});

route({ method: 'get', path: '/order-requests', summary: 'Order requests (Distributor: own, Admin: all)', tag: 'Sales', roles: ['ADMIN', 'DISTRIBUTOR'], query: z.object({ status: z.string().optional() }) }, async ({ read, ctx, query }) => {
  const s = await read();
  return {
    items: s.orderRequests
      .filter((o) => (ctx.actor.role === 'DISTRIBUTOR' ? o.distributorId === ctx.actor.customerId : true) && (!query.status || o.status === query.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => ({
        ...o,
        distributor: s.customers.find((c) => c.id === o.distributorId)?.name ?? '',
        lines: o.items.map((it) => {
          const p = s.products.find((x) => x.id === it.productId);
          return { ...it, code: p?.code ?? '', name: p?.name ?? '', price: p?.distributorPrice ?? 0 };
        }),
        invoiceNumber: s.invoices.find((i) => i.id === o.invoiceId)?.number ?? null,
        invoiceStatus: (() => {
          const i = s.invoices.find((x) => x.id === o.invoiceId);
          return i ? displayStatus(i, ctx.today) : null;
        })(),
      })),
  };
});
route({ method: 'post', path: '/order-requests', summary: 'Submit an order request', tag: 'Sales', roles: ['DISTRIBUTOR'], body: OrderRequestBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createOrderRequest(s, ctx, body)));
route({ method: 'post', path: '/order-requests/:id/convert', summary: 'Convert to a draft distributor bill', tag: 'Sales', roles: ['ADMIN'], idempotent: true }, async ({ tx, ctx, param }) => tx((s) => convertOrderRequest(s, ctx, param('id'))));
route({ method: 'post', path: '/order-requests/:id/reject', summary: 'Reject with a remark', tag: 'Sales', roles: ['ADMIN'], body: RemarkBody }, async ({ body, tx, ctx, param }) => tx((s) => rejectOrderRequest(s, ctx, param('id'), body.remark)));

route({ method: 'get', path: '/portal', summary: 'Distributor home: outstanding, recent bills and payments', tag: 'Sales', roles: ['DISTRIBUTOR'] }, async ({ read, ctx }) => {
  const s = await read();
  const id = ctx.actor.customerId;
  const c = s.customers.find((x) => x.id === id);
  if (!c) throw notFound('Distributor');
  const d = dues(s, ctx.today, new Set([c.id]))[0];
  return {
    customer: c,
    outstanding: d?.balance ?? 0,
    overdue: d?.overdue ?? 0,
    invoices: s.invoices.filter((i) => i.customerId === c.id && i.status !== 'DRAFT').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map((i) => ({ id: i.id, number: i.number, date: i.date, total: i.grandTotal, balance: outstanding(i), status: displayStatus(i, ctx.today), dueDate: i.dueDate })),
    payments: s.payments.filter((p) => p.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
  };
});
