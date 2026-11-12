import {
  diffDays,
  formatDocNumber,
  roundQty,
  type CompanyProfile,
  type Invoice,
  type ISODate,
} from '@app/contract';
import type { Ctx } from '../ctx.js';
import { AppError, forbidden, notFound } from '../errors.js';
import type { State } from '../state.js';

export function find<T extends { id: string }>(list: T[], id: string | undefined, what: string): T {
  const v = id ? list.find((x) => x.id === id) : undefined;
  if (!v) throw notFound(what);
  return v;
}

export function nextNumber(s: State, prefix: string, date: ISODate): string {
  const key = `${prefix}/${formatDocNumber(prefix, date, 0).split('/')[1]}`;
  const n = (s.counters[key] ?? 0) + 1;
  s.counters[key] = n;
  return formatDocNumber(prefix, date, n);
}

export function currentProfile(s: State): CompanyProfile {
  const p = s.companyProfiles[s.companyProfiles.length - 1];
  if (!p) throw new AppError('INTERNAL', 'Company profile missing');
  return p;
}

export function finishedStockMap(s: State): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of s.finishedMoves) m.set(mv.productId, roundQty((m.get(mv.productId) ?? 0) + mv.qty));
  return m;
}

export function rawStockMap(s: State): Map<string, number> {
  const m = new Map<string, number>();
  for (const mv of s.rawMoves) m.set(mv.rawMaterialId, roundQty((m.get(mv.rawMaterialId) ?? 0) + mv.qty));
  return m;
}

export function finishedStock(s: State, productId: string): number {
  return roundQty(s.finishedMoves.reduce((a, m) => (m.productId === productId ? a + m.qty : a), 0));
}

export function rawStock(s: State, id: string): number {
  return roundQty(s.rawMoves.reduce((a, m) => (m.rawMaterialId === id ? a + m.qty : a), 0));
}

export function outstanding(inv: Invoice): number {
  if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') return 0;
  return Math.max(0, inv.grandTotal - inv.paidAmount);
}

/** OVERDUE is computed: SENT, unpaid balance, due date before today. */
export function displayStatus(inv: Invoice, today: ISODate): Invoice['status'] | 'OVERDUE' {
  if (inv.status === 'SENT' && outstanding(inv) > 0 && inv.dueDate && inv.dueDate < today) return 'OVERDUE';
  return inv.status;
}

export function daysOverdue(inv: Invoice, today: ISODate): number {
  return inv.dueDate ? Math.max(0, diffDays(today, inv.dueDate)) : 0;
}

export function companyState(s: State): { state: string; code: string } {
  const p = currentProfile(s);
  return { state: p.state, code: p.stateCode };
}

export function adminIds(s: State): string[] {
  return s.users.filter((u) => u.role === 'ADMIN' && u.active).map((u) => u.id);
}

export function userIdsByRole(s: State, role: string): string[] {
  return s.users.filter((u) => u.role === role && u.active).map((u) => u.id);
}

export function requireRole(ctx: Ctx, ...roles: string[]): void {
  if (!roles.includes(ctx.actor.role)) throw forbidden();
}

export function userName(s: State, id: string | undefined): string {
  if (!id) return '';
  if (id === 'system') return 'System';
  return s.users.find((u) => u.id === id)?.name ?? 'Unknown';
}

export function inRange(d: string, from?: string, to?: string): boolean {
  return (!from || d >= from) && (!to || d <= to);
}

export function paginate<T>(items: T[], limit = 50, cursor?: string | null) {
  const start = cursor ? Number(cursor) || 0 : 0;
  const lim = Math.min(Math.max(1, limit), 500);
  const page = items.slice(start, start + lim);
  return { items: page, nextCursor: start + lim < items.length ? String(start + lim) : null, total: items.length };
}

export function matchQ(q: string | undefined, ...fields: (string | undefined)[]): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(needle));
}

/** Customer visibility: Distributor only sees their own customer record. */
export function assertCustomerScope(ctx: Ctx, customerId: string | undefined): void {
  if (ctx.actor.role === 'DISTRIBUTOR' && ctx.actor.customerId !== customerId) throw notFound('Record');
}

export function canSeeInvoice(ctx: Ctx, inv: Invoice): boolean {
  switch (ctx.actor.role) {
    case 'ADMIN':
    case 'MONITOR':
    case 'COLLECTOR':
      return true;
    case 'STAFF':
    case 'OPERATING':
      return inv.createdById === ctx.actor.id;
    case 'DISTRIBUTOR':
      return inv.customerId === ctx.actor.customerId && inv.status !== 'DRAFT';
  }
}

export function checkRev(current: number, ifMatch: string | undefined): void {
  if (ifMatch === undefined) return;
  if (ifMatch.replace(/"/g, '').replace(/^W\//, '') !== String(current))
    throw new AppError('STALE', 'This record was changed by someone else. Reload to see the latest version.');
}

/** Reorder alert fires once when an item crosses below its reorder level; clears when restocked. */
export function lowStockCheck(
  s: State,
  kind: 'P' | 'R',
  itemId: string,
  notifyFn: (title: string, body: string, link: string) => void,
): void {
  const key = `${kind}:${itemId}`;
  const item = kind === 'P' ? s.products.find((p) => p.id === itemId) : s.rawMaterials.find((r) => r.id === itemId);
  if (!item) return;
  const stock = kind === 'P' ? finishedStock(s, itemId) : rawStock(s, itemId);
  const below = stock < item.reorderLevel;
  const alerted = s.lowStockAlerted.includes(key);
  if (below && !alerted) {
    s.lowStockAlerted.push(key);
    notifyFn(
      'Low stock',
      `${item.name} is at ${stock}, below its reorder level of ${item.reorderLevel}.`,
      `/inventory/${kind === 'P' ? 'sales' : 'purchase'}/${itemId}`,
    );
  } else if (!below && alerted) {
    s.lowStockAlerted = s.lowStockAlerted.filter((k) => k !== key);
  }
}
