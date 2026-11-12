import {
  addDays,
  divRound,
  formatQty,
  qtyMilli,
  roundQty,
  type ISODate,
  type ProductionBatch,
  type ProductionInput,
  type StockAdjustmentInput,
  type StockCount,
  type StockCountInput,
} from '@app/contract';
import { audit, COMPANY_AUDIENCE, emit, newId, notify, type Ctx } from '../ctx.js';
import { AppError, invalidState } from '../errors.js';
import type { State } from '../state.js';
import { adminIds, find, finishedStock, lowStockCheck, nextNumber, rawStock, requireRole, userName } from './util.js';

function alertTo(s: State) {
  return [...adminIds(s), ...s.users.filter((u) => u.role === 'OPERATING' && u.active).map((u) => u.id)];
}

/** One transaction: purchase stock down, sales inventory up. Blocked if raw stock is short. */
export function recordProduction(s: State, ctx: Ctx, i: ProductionInput): ProductionBatch {
  requireRole(ctx, 'ADMIN', 'OPERATING');
  const date = i.date ?? ctx.today;
  const use = new Map<string, number>();
  for (const x of i.inputs) use.set(x.rawMaterialId, roundQty((use.get(x.rawMaterialId) ?? 0) + x.qty));
  for (const [id, qty] of use) {
    const r = find(s.rawMaterials, id, 'Purchase item');
    const available = rawStock(s, id);
    if (available < qty)
      throw new AppError('INSUFFICIENT_STOCK', `Not enough ${r.name} in stock. Available ${formatQty(available)}.`, { itemId: id, available });
  }
  for (const o of i.outputs) find(s.products, o.productId, 'Product');
  const b: ProductionBatch = {
    id: newId(s, 'bat'),
    batchNo: nextNumber(s, 'BATCH', date),
    date,
    inputs: i.inputs.map((x) => ({ ...x, qty: roundQty(x.qty) })),
    outputs: i.outputs.map((x) => ({ ...x, qty: roundQty(x.qty) })),
    wastageQty: roundQty(i.wastageQty),
    wastageNote: i.wastageNote,
    createdById: ctx.actor.id,
    createdAt: ctx.now,
  };
  s.batches.push(b);
  for (const x of b.inputs) {
    s.rawMoves.push({ id: newId(s, 'rsm'), rawMaterialId: x.rawMaterialId, qty: -x.qty, reason: 'PRODUCTION', refType: 'batch', refId: b.id, date, note: b.batchNo, createdById: ctx.actor.id, at: ctx.now });
  }
  for (const x of b.outputs) {
    s.finishedMoves.push({ id: newId(s, 'fsm'), productId: x.productId, qty: x.qty, reason: 'PRODUCTION', refType: 'batch', refId: b.id, date, note: b.batchNo, createdById: ctx.actor.id, at: ctx.now });
    lowStockCheck(s, 'P', x.productId, () => undefined);
  }
  for (const id of use.keys()) lowStockCheck(s, 'R', id, (t, body, l) => notify(s, ctx, alertTo(s), t, body, l));
  audit(ctx, 'production-batch', b.id, 'create', `Recorded production batch ${b.batchNo}`, undefined, b);
  emit(ctx, 'production.create', 'production-batch', b.id, `${ctx.actor.name} recorded batch ${b.batchNo}`, COMPANY_AUDIENCE);
  return b;
}

export function adjustStock(s: State, ctx: Ctx, i: StockAdjustmentInput, refType = 'adjustment', refId = '', note?: string) {
  requireRole(ctx, 'ADMIN', 'OPERATING');
  const qty = roundQty(i.qty);
  if (i.kind === 'SALES') {
    const p = find(s.products, i.itemId, 'Product');
    if (finishedStock(s, p.id) + qty < 0) throw new AppError('INSUFFICIENT_STOCK', `Stock of ${p.name} cannot go below zero`);
    const m = { id: newId(s, 'fsm'), productId: p.id, qty, reason: 'ADJUSTMENT' as const, refType, refId: refId || 'manual', date: ctx.today, note: note ?? i.reason, createdById: ctx.actor.id, at: ctx.now };
    s.finishedMoves.push(m);
    lowStockCheck(s, 'P', p.id, (t, b, l) => notify(s, ctx, alertTo(s), t, b, l));
    audit(ctx, 'stock-adjustment', m.id, 'create', `Adjusted ${p.name} by ${qty > 0 ? '+' : ''}${formatQty(qty)}: ${i.reason}`, undefined, m);
    emit(ctx, 'stock.adjust', 'product', p.id, `${ctx.actor.name} adjusted ${p.name} by ${formatQty(qty)}`, COMPANY_AUDIENCE);
    return m;
  }
  const r = find(s.rawMaterials, i.itemId, 'Purchase item');
  if (rawStock(s, r.id) + qty < 0) throw new AppError('INSUFFICIENT_STOCK', `Stock of ${r.name} cannot go below zero`);
  const m = { id: newId(s, 'rsm'), rawMaterialId: r.id, qty, reason: 'ADJUSTMENT' as const, refType, refId: refId || 'manual', date: ctx.today, note: note ?? i.reason, createdById: ctx.actor.id, at: ctx.now };
  s.rawMoves.push(m);
  lowStockCheck(s, 'R', r.id, (t, b, l) => notify(s, ctx, alertTo(s), t, b, l));
  audit(ctx, 'stock-adjustment', m.id, 'create', `Adjusted ${r.name} by ${qty > 0 ? '+' : ''}${formatQty(qty)}: ${i.reason}`, undefined, m);
  emit(ctx, 'stock.adjust', 'raw-material', r.id, `${ctx.actor.name} adjusted ${r.name} by ${formatQty(qty)}`, COMPANY_AUDIENCE);
  return m;
}

export function createStockCount(s: State, ctx: Ctx, i: StockCountInput): StockCount {
  requireRole(ctx, 'ADMIN', 'OPERATING');
  const c: StockCount = {
    id: newId(s, 'stc'),
    number: nextNumber(s, 'SC', ctx.today),
    date: ctx.today,
    kind: i.kind,
    status: 'DRAFT',
    lines: i.lines.map((l) => {
      const systemQty = i.kind === 'SALES' ? (find(s.products, l.itemId, 'Product'), finishedStock(s, l.itemId)) : (find(s.rawMaterials, l.itemId, 'Purchase item'), rawStock(s, l.itemId));
      return { itemId: l.itemId, systemQty, countedQty: roundQty(l.countedQty), variance: roundQty(l.countedQty - systemQty), reason: l.reason };
    }),
    createdById: ctx.actor.id,
    createdAt: ctx.now,
  };
  s.stockCounts.push(c);
  audit(ctx, 'stock-count', c.id, 'create', `Started stock take ${c.number}`, undefined, c);
  return c;
}

/** Confirmed variances post as adjustments with a mandatory reason. System qty is re-read at confirm time. */
export function confirmStockCount(s: State, ctx: Ctx, id: string): StockCount {
  requireRole(ctx, 'ADMIN', 'OPERATING');
  const c = find(s.stockCounts, id, 'Stock take');
  if (c.status !== 'DRAFT') throw invalidState('This stock take is already confirmed');
  for (const l of c.lines) {
    l.systemQty = c.kind === 'SALES' ? finishedStock(s, l.itemId) : rawStock(s, l.itemId);
    l.variance = roundQty(l.countedQty - l.systemQty);
    if (l.variance !== 0 && l.reason.trim().length < 3)
      throw new AppError('VALIDATION', 'Enter a reason for every line with a variance', { itemId: l.itemId });
  }
  for (const l of c.lines.filter((x) => x.variance !== 0)) {
    adjustStock(s, ctx, { kind: c.kind, itemId: l.itemId, qty: l.variance, reason: l.reason }, 'stock-count', c.id, `${c.number}: ${l.reason}`);
  }
  c.status = 'CONFIRMED';
  audit(ctx, 'stock-count', c.id, 'confirm', `Confirmed stock take ${c.number}`, undefined, c);
  return c;
}

export interface TrackerRow {
  id: string;
  code?: string;
  name: string;
  category: string;
  unit: string;
  supplier?: string;
  opening: number;
  inQty: number;
  outQty: number;
  adjusted: number;
  closing: number;
  reorderLevel: number;
  status: 'IN_STOCK' | 'LOW' | 'OUT';
  unitValue: number;
  value: number;
  suggestedReorder: number;
  slowMoving: boolean;
  wastage: number;
}

function status(closing: number, reorder: number): TrackerRow['status'] {
  if (closing <= 0) return 'OUT';
  if (closing < reorder) return 'LOW';
  return 'IN_STOCK';
}

export function averageCost(s: State, rawMaterialId: string): number {
  const buys = s.rawMoves.filter((m) => m.rawMaterialId === rawMaterialId && m.reason === 'PURCHASE' && m.rate !== undefined);
  const qty = buys.reduce((a, m) => a + qtyMilli(m.qty), 0);
  if (!qty) return s.rawMaterials.find((r) => r.id === rawMaterialId)?.lastRate ?? 0;
  return divRound(buys.reduce((a, m) => a + qtyMilli(m.qty) * (m.rate ?? 0), 0), qty);
}

export function purchaseTracker(s: State, today: ISODate, from?: ISODate, to?: ISODate): TrackerRow[] {
  const f = from ?? '0000-01-01';
  const t = to ?? '9999-12-31';
  const since30 = addDays(today, -30);
  return s.rawMaterials.map((r) => {
    const moves = s.rawMoves.filter((m) => m.rawMaterialId === r.id);
    const sum = (pred: (m: (typeof moves)[number]) => boolean) => roundQty(moves.filter(pred).reduce((a, m) => a + m.qty, 0));
    const opening = sum((m) => m.date < f);
    const inQty = sum((m) => m.date >= f && m.date <= t && (m.reason === 'PURCHASE' || m.reason === 'OPENING'));
    const outQty = -sum((m) => m.date >= f && m.date <= t && m.reason === 'PRODUCTION');
    const adjusted = sum((m) => m.date >= f && m.date <= t && m.reason === 'ADJUSTMENT');
    const closing = roundQty(opening + inQty - outQty + adjusted);
    const use30 = -sum((m) => m.date >= since30 && m.reason === 'PRODUCTION');
    const avg = averageCost(s, r.id);
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      unit: s.units.find((u) => u.id === r.unitId)?.name ?? '',
      supplier: s.suppliers.find((x) => x.id === r.preferredSupplierId)?.name,
      opening,
      inQty,
      outQty,
      adjusted,
      closing,
      reorderLevel: r.reorderLevel,
      status: status(closing, r.reorderLevel),
      unitValue: avg,
      value: divRound(qtyMilli(Math.max(0, closing)) * avg, 1000),
      suggestedReorder: closing < r.reorderLevel ? Math.max(0, Math.ceil(use30 + r.reorderLevel - closing)) : 0,
      slowMoving: false,
      wastage: 0,
    };
  });
}

export function salesTracker(s: State, today: ISODate, from?: ISODate, to?: ISODate): TrackerRow[] {
  const f = from ?? '0000-01-01';
  const t = to ?? '9999-12-31';
  const since30 = addDays(today, -30);
  return s.products.map((p) => {
    const moves = s.finishedMoves.filter((m) => m.productId === p.id);
    const sum = (pred: (m: (typeof moves)[number]) => boolean) => roundQty(moves.filter(pred).reduce((a, m) => a + m.qty, 0));
    const opening = sum((m) => m.date < f);
    const inQty = sum((m) => m.date >= f && m.date <= t && (m.reason === 'PRODUCTION' || m.reason === 'OPENING'));
    const outQty = -sum((m) => m.date >= f && m.date <= t && m.reason === 'SALE');
    const adjusted = sum((m) => m.date >= f && m.date <= t && (m.reason === 'ADJUSTMENT' || m.reason === 'CANCEL'));
    const closing = roundQty(opening + inQty - outQty + adjusted);
    const sold30 = -sum((m) => m.date >= since30 && m.reason === 'SALE');
    return {
      id: p.id,
      code: p.code,
      name: p.name,
      category: s.categories.find((c) => c.id === p.categoryId)?.name ?? '',
      unit: s.units.find((u) => u.id === p.unitId)?.name ?? '',
      opening,
      inQty,
      outQty,
      adjusted,
      closing,
      reorderLevel: p.reorderLevel,
      status: status(closing, p.reorderLevel),
      unitValue: p.retailPrice,
      value: divRound(qtyMilli(Math.max(0, closing)) * p.retailPrice, 1000),
      suggestedReorder: closing < p.reorderLevel ? Math.max(0, Math.ceil(sold30 + p.reorderLevel - closing)) : 0,
      slowMoving: sold30 === 0 && closing > 0,
      wastage: 0,
    };
  });
}

export function itemMovements(s: State, kind: 'purchase' | 'sales', id: string) {
  const moves =
    kind === 'sales'
      ? (find(s.products, id, 'Product'), s.finishedMoves.filter((m) => m.productId === id))
      : (find(s.rawMaterials, id, 'Purchase item'), s.rawMoves.filter((m) => m.rawMaterialId === id));
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  let bal = 0;
  return sorted.map((m) => {
    bal = roundQty(bal + m.qty);
    return { id: m.id, date: m.date, at: m.at, qty: m.qty, reason: m.reason, refType: m.refType, refId: m.refId, note: m.note, by: userName(s, m.createdById), balance: bal };
  });
}

/** Products the sales picker can offer, with live stock and the price for the customer type. */
export function availableProducts(s: State, customerType: 'RETAIL' | 'DISTRIBUTOR') {
  return s.products
    .filter((p) => p.active)
    .map((p) => {
      const stock = finishedStock(s, p.id);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        unit: s.units.find((u) => u.id === p.unitId)?.name ?? '',
        hsn: p.hsn,
        gstRate: p.gstRate,
        taxInclusive: p.taxInclusive,
        price: customerType === 'DISTRIBUTOR' ? p.distributorPrice : p.retailPrice,
        retailPrice: p.retailPrice,
        distributorPrice: p.distributorPrice,
        stock,
        reorderLevel: p.reorderLevel,
        status: status(stock, p.reorderLevel),
      };
    });
}

export function purchasePicker(s: State) {
  return s.rawMaterials
    .filter((r) => r.active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      unit: s.units.find((u) => u.id === r.unitId)?.name ?? '',
      lastRate: r.lastRate,
      stock: rawStock(s, r.id),
      supplierId: r.preferredSupplierId,
      supplier: s.suppliers.find((x) => x.id === r.preferredSupplierId)?.name,
    }));
}
