import type {
  BankAccount,
  BankAccountInput,
  Customer,
  CustomerInput,
  Product,
  ProductInput,
  RawMaterial,
  PurchaseItemInput,
  Supplier,
  SupplierInput,
} from '@app/contract';
import { audit, emit, newId, type Ctx } from '../ctx.js';
import { validation } from '../errors.js';
import type { State } from '../state.js';
import { find, requireRole } from './util.js';

export type NamedKind = 'units' | 'categories' | 'expenseHeads';

function nextCode(list: { code: string }[], prefix: string): string {
  const max = list.reduce((m, x) => Math.max(m, Number(x.code.replace(/\D/g, '')) || 0), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** Customers can be added by Admin, Staff and Operating (doc 02). Editing stays with Admin. */
export function createCustomer(s: State, ctx: Ctx, i: CustomerInput): Customer {
  requireRole(ctx, 'ADMIN', 'STAFF', 'OPERATING');
  if (ctx.actor.role !== 'ADMIN' && (i.type === 'DISTRIBUTOR' || i.openingBalance))
    throw validation('Only Admin can add distributors or opening balances');
  const c: Customer = {
    ...i,
    id: newId(s, 'cus'),
    code: nextCode(s.customers, i.type === 'DISTRIBUTOR' ? 'D' : 'C'),
    createdAt: ctx.now,
  };
  s.customers.push(c);
  audit(ctx, 'customer', c.id, 'create', `Added ${c.type === 'DISTRIBUTOR' ? 'distributor' : 'customer'} ${c.name}`, undefined, c);
  emit(ctx, 'customer.create', 'customer', c.id, `${ctx.actor.name} added customer ${c.name}`);
  return c;
}

export function updateCustomer(s: State, ctx: Ctx, id: string, i: CustomerInput): Customer {
  requireRole(ctx, 'ADMIN');
  const c = find(s.customers, id, 'Customer');
  const before = { ...c };
  Object.assign(c, i);
  audit(ctx, 'customer', c.id, 'update', `Updated ${c.name}`, before, c);
  return c;
}

export function createSupplier(s: State, ctx: Ctx, i: SupplierInput): Supplier {
  requireRole(ctx, 'ADMIN');
  const v: Supplier = { ...i, id: newId(s, 'sup') };
  s.suppliers.push(v);
  audit(ctx, 'supplier', v.id, 'create', `Added supplier ${v.name}`, undefined, v);
  return v;
}

export function updateSupplier(s: State, ctx: Ctx, id: string, i: SupplierInput): Supplier {
  requireRole(ctx, 'ADMIN');
  const v = find(s.suppliers, id, 'Supplier');
  const before = { ...v };
  Object.assign(v, i);
  audit(ctx, 'supplier', v.id, 'update', `Updated supplier ${v.name}`, before, v);
  return v;
}

function assertProductRefs(s: State, i: ProductInput, id?: string) {
  find(s.categories, i.categoryId, 'Category');
  find(s.units, i.unitId, 'Unit');
  if (s.products.some((p) => p.code === i.code && p.id !== id))
    throw validation('This product code is already used', { code: 'Product codes must be unique' });
}

export function createProduct(s: State, ctx: Ctx, i: ProductInput): Product {
  requireRole(ctx, 'ADMIN');
  assertProductRefs(s, i);
  const p: Product = { ...i, id: newId(s, 'prd') };
  s.products.push(p);
  audit(ctx, 'product', p.id, 'create', `Added product ${p.code} ${p.name}`, undefined, p);
  return p;
}

export function updateProduct(s: State, ctx: Ctx, id: string, i: ProductInput): Product {
  requireRole(ctx, 'ADMIN');
  const p = find(s.products, id, 'Product');
  assertProductRefs(s, i, id);
  const before = { ...p };
  Object.assign(p, i);
  audit(ctx, 'product', p.id, 'update', `Updated product ${p.code}`, before, p);
  return p;
}

export function createPurchaseItem(s: State, ctx: Ctx, i: PurchaseItemInput): RawMaterial {
  requireRole(ctx, 'ADMIN');
  find(s.units, i.unitId, 'Unit');
  if (i.preferredSupplierId) find(s.suppliers, i.preferredSupplierId, 'Supplier');
  const r: RawMaterial = { ...i, id: newId(s, 'raw') };
  s.rawMaterials.push(r);
  audit(ctx, 'purchase-item', r.id, 'create', `Added purchase item ${r.name}`, undefined, r);
  return r;
}

export function updatePurchaseItem(s: State, ctx: Ctx, id: string, i: PurchaseItemInput): RawMaterial {
  requireRole(ctx, 'ADMIN');
  const r = find(s.rawMaterials, id, 'Purchase item');
  find(s.units, i.unitId, 'Unit');
  const before = { ...r };
  Object.assign(r, i);
  audit(ctx, 'purchase-item', r.id, 'update', `Updated purchase item ${r.name}`, before, r);
  return r;
}

const NAMED_LABEL: Record<NamedKind, string> = { units: 'unit', categories: 'category', expenseHeads: 'expense head' };

export function createNamed(s: State, ctx: Ctx, kind: NamedKind, name: string) {
  requireRole(ctx, 'ADMIN');
  const list = s[kind];
  if (list.some((x) => x.name.toLowerCase() === name.toLowerCase()))
    throw validation(`This ${NAMED_LABEL[kind]} already exists`, { name: 'Use a different name' });
  const v = { id: newId(s, kind.slice(0, 3)), name };
  list.push(v);
  audit(ctx, NAMED_LABEL[kind], v.id, 'create', `Added ${NAMED_LABEL[kind]} ${name}`, undefined, v);
  return v;
}

export function updateNamed(s: State, ctx: Ctx, kind: NamedKind, id: string, name: string) {
  requireRole(ctx, 'ADMIN');
  const v = find(s[kind], id, NAMED_LABEL[kind]);
  const before = { ...v };
  v.name = name;
  audit(ctx, NAMED_LABEL[kind], v.id, 'update', `Renamed ${NAMED_LABEL[kind]} to ${name}`, before, v);
  return v;
}

export function createBankAccount(s: State, ctx: Ctx, i: BankAccountInput): BankAccount {
  requireRole(ctx, 'ADMIN');
  const b: BankAccount = { ...i, id: newId(s, 'bnk') };
  if (b.isInvoiceDefault || !s.bankAccounts.length) {
    s.bankAccounts.forEach((x) => (x.isInvoiceDefault = false));
    b.isInvoiceDefault = true;
  }
  s.bankAccounts.push(b);
  audit(ctx, 'bank-account', b.id, 'create', `Added bank account ${b.bankName}`, undefined, b);
  return b;
}

export function updateBankAccount(s: State, ctx: Ctx, id: string, i: BankAccountInput): BankAccount {
  requireRole(ctx, 'ADMIN');
  const b = find(s.bankAccounts, id, 'Bank account');
  const before = { ...b };
  if (i.isInvoiceDefault) s.bankAccounts.forEach((x) => (x.isInvoiceDefault = false));
  Object.assign(b, i);
  if (!s.bankAccounts.some((x) => x.isInvoiceDefault)) b.isInvoiceDefault = true;
  audit(ctx, 'bank-account', b.id, 'update', `Updated bank account ${b.bankName}`, before, b);
  return b;
}

export function setOpeningBalances(
  s: State,
  ctx: Ctx,
  i: { cash: number; customers: { id: string; amount: number }[]; suppliers: { id: string; amount: number }[]; banks: { id: string; amount: number }[] },
) {
  requireRole(ctx, 'ADMIN');
  const before = {
    cash: s.openingCash,
    customers: s.customers.map((c) => ({ id: c.id, amount: c.openingBalance })),
    suppliers: s.suppliers.map((c) => ({ id: c.id, amount: c.openingBalance })),
    banks: s.bankAccounts.map((c) => ({ id: c.id, amount: c.openingBalance })),
  };
  s.openingCash = i.cash;
  for (const c of i.customers) find(s.customers, c.id, 'Customer').openingBalance = c.amount;
  for (const c of i.suppliers) find(s.suppliers, c.id, 'Supplier').openingBalance = c.amount;
  for (const c of i.banks) find(s.bankAccounts, c.id, 'Bank account').openingBalance = c.amount;
  audit(ctx, 'opening-balance', 'opening', 'update', 'Updated opening balances', before, i);
}

export function defaultBank(s: State): BankAccount | undefined {
  return s.bankAccounts.find((b) => b.isInvoiceDefault) ?? s.bankAccounts[0];
}
