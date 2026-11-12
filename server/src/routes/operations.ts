import { z } from 'zod';
import {
  IndentBody,
  ProductionBody,
  PurchaseBillBody,
  RejectBody,
  RemarksBody,
  StockAdjustmentBody,
  StockCountBody,
  SupplierPaymentBody,
  TrancheBody,
} from '@app/contract';
import { forbidden } from '../errors.js';
import { route } from '../http.js';
import {
  adjustStock,
  confirmStockCount,
  createStockCount,
  itemMovements,
  purchaseTracker,
  recordProduction,
  salesTracker,
} from '../services/inventory.js';
import { goodsReceiptPrint, indentPrint, supplierPaymentPrint } from '../services/print.js';
import {
  addTranche,
  approveIndent,
  createIndent,
  fundFigures,
  loansWithOutstanding,
  paidOnIndent,
  receivedQty,
  receivedValue,
  recordPurchaseBill,
  recordSupplierPayment,
  rejectIndent,
  submitIndent,
  updateIndent,
} from '../services/purchasing.js';
import { find, inRange, matchQ, userName } from '../services/util.js';
import type { State } from '../state.js';

const VIEW_FUNDS = ['ADMIN', 'MONITOR', 'COLLECTOR'] as const;
const INV_READ = ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'] as const;
const INV_WRITE = ['ADMIN', 'OPERATING'] as const;

route({ method: 'get', path: '/fund-tranches', summary: 'Fund tranches', tag: 'Funds', roles: VIEW_FUNDS }, async ({ read, ctx }) => {
  const s = await read();
  const loans = ctx.actor.role === 'ADMIN';
  return { items: [...s.tranches].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (loans ? t : { ...t, lender: t.isLoan ? 'Loan' : undefined })) };
});
route({ method: 'post', path: '/fund-tranches', summary: 'Add a tranche (optionally a loan)', tag: 'Funds', roles: ['ADMIN'], body: TrancheBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => addTranche(s, ctx, body)));
route({ method: 'get', path: '/funds/summary', summary: 'Received, committed, utilised, balance and utilisation list', tag: 'Funds', roles: VIEW_FUNDS }, async ({ read }) => {
  const s = await read();
  return {
    ...fundFigures(s),
    utilisation: [...s.supplierPayments]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => ({ id: p.id, number: p.number, date: p.date, amount: p.amount, mode: p.mode, indentId: p.indentId, indent: s.indents.find((i) => i.id === p.indentId)?.number ?? '', supplier: s.suppliers.find((x) => x.id === p.supplierId)?.name ?? '' })),
    committedIndents: s.indents.filter((i) => i.status === 'APPROVED' || i.status === 'RECEIVED').map((i) => ({ id: i.id, number: i.number, total: i.total, paid: paidOnIndent(s, i.id), status: i.status })),
  };
});
route({ method: 'get', path: '/loans', summary: 'Loans with outstanding and repayments', tag: 'Funds', roles: ['ADMIN'] }, async ({ read }) => ({ items: loansWithOutstanding(await read()) }));

function indentView(s: State, id: string) {
  const ind = find(s.indents, id, 'Indent');
  return {
    ...ind,
    supplier: s.suppliers.find((x) => x.id === ind.supplierId)?.name ?? '',
    raisedBy: userName(s, ind.raisedById),
    lines: ind.items.map((it) => {
      const r = s.rawMaterials.find((x) => x.id === it.rawMaterialId);
      return { ...it, name: r?.name ?? '', unit: s.units.find((u) => u.id === r?.unitId)?.name ?? '', received: receivedQty(s, ind.id, it.rawMaterialId) };
    }),
    trail: ind.approvals.map((a) => ({ ...a, by: userName(s, a.userId) })),
    receipts: s.goodsReceipts.filter((g) => g.indentId === ind.id),
    payments: s.supplierPayments.filter((p) => p.indentId === ind.id),
    receivedValue: receivedValue(s, ind.id),
    paid: paidOnIndent(s, ind.id),
  };
}

route({ method: 'get', path: '/indents', summary: 'Purchase indents', tag: 'Purchasing', roles: INV_READ, query: z.object({ status: z.string().optional(), q: z.string().optional() }) }, async ({ read, query }) => {
  const s = await read();
  return {
    items: [...s.indents]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter((i) => !query.status || i.status === query.status || (query.status === 'PENDING' && i.status.startsWith('PENDING')))
      .map((i) => ({ id: i.id, number: i.number, poNumber: i.poNumber, date: i.date, status: i.status, total: i.total, supplier: s.suppliers.find((x) => x.id === i.supplierId)?.name ?? '', items: i.items.length, receivedValue: receivedValue(s, i.id), paid: paidOnIndent(s, i.id) }))
      .filter((i) => matchQ(query.q, i.number, i.supplier, i.poNumber)),
  };
});
route({ method: 'post', path: '/indents', summary: 'Raise an indent (items from the Purchase List)', tag: 'Purchasing', roles: ['ADMIN'], body: IndentBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => indentView(s, createIndent(s, ctx, body).id)));
route({ method: 'get', path: '/indents/:id', summary: 'Indent with approval trail', tag: 'Purchasing', roles: INV_READ, etag: false }, async ({ read, param, c }) => {
  const v = indentView(await read(), param('id'));
  c.header('ETag', `"${v.rev}"`);
  return v;
});
route({ method: 'patch', path: '/indents/:id', summary: 'Edit while draft or rejected', tag: 'Purchasing', roles: ['ADMIN'], body: IndentBody }, async ({ body, tx, ctx, param, c }) => tx((s) => indentView(s, updateIndent(s, ctx, param('id'), body, c.req.header('if-match')).id)));
route({ method: 'post', path: '/indents/:id/submit', summary: 'Submit for approval. Returns a fund warning, never blocks.', tag: 'Purchasing', roles: ['ADMIN'] }, async ({ tx, ctx, param }) =>
  tx((s) => {
    const r = submitIndent(s, ctx, param('id'));
    return { indent: indentView(s, r.indent.id), warning: r.warning };
  }),
);
route({ method: 'post', path: '/indents/:id/approve', summary: 'Approve an indent (Admin)', tag: 'Purchasing', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'], body: RemarksBody, idempotent: true }, async ({ body, tx, ctx, param }) => tx((s) => indentView(s, approveIndent(s, ctx, param('id'), body.remarks).id)));
route({ method: 'post', path: '/indents/:id/reject', summary: 'Reject with remarks (Admin)', tag: 'Purchasing', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'], body: RejectBody }, async ({ body, tx, ctx, param }) => tx((s) => indentView(s, rejectIndent(s, ctx, param('id'), body.remarks).id)));

route({ method: 'get', path: '/approvals/inbox', summary: 'Indents waiting for approval', tag: 'Purchasing', roles: ['ADMIN'] }, async ({ read }) => {
  const s = await read();
  return { stage: 1, items: s.indents.filter((i) => i.status.startsWith('PENDING')).map((i) => indentView(s, i.id)) };
});

route({ method: 'get', path: '/indents/:id/po-print-data', summary: 'Purchase order data (after final approval)', tag: 'Purchasing', roles: INV_READ, etag: false }, async ({ read, param }) => {
  const s = await read();
  const ind = find(s.indents, param('id'), 'Indent');
  if (!ind.poNumber) throw forbidden('The purchase order is available after final approval');
  return indentPrint(s, ind.id);
});

route({ method: 'get', path: '/purchase-bills', summary: 'Goods receipts and supplier bills', tag: 'Purchasing', roles: INV_READ, query: z.object({ from: z.string().optional(), to: z.string().optional() }) }, async ({ read, query }) => {
  const s = await read();
  return {
    items: s.goodsReceipts
      .filter((g) => inRange(g.date, query.from, query.to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((g) => {
        const ind = s.indents.find((i) => i.id === g.indentId);
        return { ...g, indentNumber: ind?.number ?? '', supplier: s.suppliers.find((x) => x.id === ind?.supplierId)?.name ?? '', createdBy: userName(s, g.createdById) };
      }),
  };
});
route({ method: 'post', path: '/purchase-bills', summary: 'Record a goods receipt and supplier bill', tag: 'Purchasing', roles: INV_WRITE, body: PurchaseBillBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => recordPurchaseBill(s, ctx, body)));
route({ method: 'get', path: '/purchase-bills/:id/print-data', summary: 'Goods receipt note data', tag: 'Purchasing', roles: INV_READ, etag: false }, async ({ read, param }) => goodsReceiptPrint(await read(), param('id')));

route({ method: 'get', path: '/supplier-payments', summary: 'Supplier payments', tag: 'Purchasing', roles: ['ADMIN'] }, async ({ read }) => {
  const s = await read();
  return { items: [...s.supplierPayments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => ({ ...p, indent: s.indents.find((i) => i.id === p.indentId)?.number ?? '', supplier: s.suppliers.find((x) => x.id === p.supplierId)?.name ?? '' })) };
});
route({ method: 'post', path: '/supplier-payments', summary: 'Pay a supplier (counts toward fund utilisation)', tag: 'Purchasing', roles: ['ADMIN'], body: SupplierPaymentBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => recordSupplierPayment(s, ctx, body)));
route({ method: 'get', path: '/supplier-payments/:id/print-data', summary: 'Supplier payment voucher data', tag: 'Purchasing', roles: ['ADMIN'], etag: false }, async ({ read, param }) => supplierPaymentPrint(await read(), param('id')));

const Range = z.object({ from: z.string().optional(), to: z.string().optional() });
route({ method: 'get', path: '/inventory/purchase', summary: 'Purchase stock tracker', tag: 'Inventory', roles: INV_READ, query: Range }, async ({ read, query, ctx }) => {
  const rows = purchaseTracker(await read(), ctx.today, query.from, query.to);
  return { items: rows, totalValue: rows.reduce((a, r) => a + r.value, 0) };
});
route({ method: 'get', path: '/inventory/sales', summary: 'Sales stock tracker', tag: 'Inventory', roles: INV_READ, query: Range }, async ({ read, query, ctx }) => {
  const s = await read();
  const rows = salesTracker(s, ctx.today, query.from, query.to);
  const wastage = s.batches.filter((b) => inRange(b.date, query.from, query.to)).map((b) => ({ id: b.id, batchNo: b.batchNo, date: b.date, wastageQty: b.wastageQty, inputQty: b.inputs.reduce((a, x) => a + x.qty, 0), note: b.wastageNote }));
  return { items: rows, totalValue: rows.reduce((a, r) => a + r.value, 0), wastage };
});
route({ method: 'get', path: '/inventory/items/:kind/:id/movements', summary: 'Item timeline with running balance', tag: 'Inventory', roles: INV_READ, etag: false }, async ({ read, param }) => {
  const s = await read();
  const kind = param('kind') === 'sales' ? 'sales' : 'purchase';
  const item = kind === 'sales' ? find(s.products, param('id'), 'Product') : find(s.rawMaterials, param('id'), 'Purchase item');
  return { kind, item, movements: itemMovements(s, kind, param('id')) };
});
route({ method: 'post', path: '/stock-adjustments', summary: 'Manual stock adjustment with a reason', tag: 'Inventory', roles: INV_WRITE, body: StockAdjustmentBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => adjustStock(s, ctx, body)));
route({ method: 'get', path: '/stock-counts', summary: 'Stock takes', tag: 'Inventory', roles: INV_READ }, async ({ read }) => {
  const s = await read();
  return { items: [...s.stockCounts].reverse().map((c) => ({ ...c, by: userName(s, c.createdById) })) };
});
route({ method: 'post', path: '/stock-counts', summary: 'Start a stock take with counted quantities', tag: 'Inventory', roles: INV_WRITE, body: StockCountBody, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createStockCount(s, ctx, body)));
route({ method: 'post', path: '/stock-counts/:id/confirm', summary: 'Confirm: variances post as adjustments', tag: 'Inventory', roles: INV_WRITE, idempotent: true }, async ({ tx, ctx, param }) => tx((s) => confirmStockCount(s, ctx, param('id'))));

route({ method: 'get', path: '/production-batches', summary: 'Production batches', tag: 'Inventory', roles: ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'] }, async ({ read }) => {
  const s = await read();
  return {
    items: [...s.batches].reverse().map((b) => ({
      ...b,
      by: userName(s, b.createdById),
      inputLines: b.inputs.map((x) => ({ ...x, name: s.rawMaterials.find((r) => r.id === x.rawMaterialId)?.name ?? '' })),
      outputLines: b.outputs.map((x) => ({ ...x, name: s.products.find((p) => p.id === x.productId)?.name ?? '', code: s.products.find((p) => p.id === x.productId)?.code ?? '' })),
    })),
  };
});
route({ method: 'post', path: '/production-batches', summary: 'Record a batch: raw down, finished up, atomically', tag: 'Inventory', roles: INV_WRITE, body: ProductionBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => recordProduction(s, ctx, body)));
route({ method: 'get', path: '/production-batches/:id/print-data', summary: 'Batch sheet data', tag: 'Inventory', roles: ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'], etag: false }, async ({ read, param }) => {
  const s = await read();
  const b = find(s.batches, param('id'), 'Batch');
  return {
    batch: b,
    by: userName(s, b.createdById),
    company: s.companyProfiles[s.companyProfiles.length - 1],
    inputs: b.inputs.map((x) => {
      const r = s.rawMaterials.find((y) => y.id === x.rawMaterialId);
      return { ...x, name: r?.name ?? '', unit: s.units.find((u) => u.id === r?.unitId)?.name ?? '' };
    }),
    outputs: b.outputs.map((x) => {
      const p = s.products.find((y) => y.id === x.productId);
      return { ...x, code: p?.code ?? '', name: p?.name ?? '', unit: s.units.find((u) => u.id === p?.unitId)?.name ?? '' };
    }),
  };
});
