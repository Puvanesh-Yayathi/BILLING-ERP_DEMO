import { z, type ZodTypeAny } from 'zod';
import {
  BankAccountBody,
  CustomerBody,
  ImportCommitBody,
  NameBody,
  OpeningBalanceBody,
  ProductBody,
  PurchaseItemBody,
  SupplierBody,
  WorkerCreateBody,
  rupeesToPaise,
  type Role,
} from '@app/contract';
import type { Ctx } from '../ctx.js';
import { notFound } from '../errors.js';
import { route, zodDetails } from '../http.js';
import { availableProducts, purchasePicker } from '../services/inventory.js';
import { customerBalance } from '../services/ledgers.js';
import {
  createBankAccount,
  createCustomer,
  createNamed,
  createProduct,
  createPurchaseItem,
  createSupplier,
  setOpeningBalances,
  updateBankAccount,
  updateCustomer,
  updateNamed,
  updateProduct,
  updatePurchaseItem,
  updateSupplier,
  type NamedKind,
} from '../services/masters.js';
import { createWorker } from '../services/users.js';
import { assertCustomerScope, displayStatus, find, finishedStock, matchQ, outstanding, rawStock } from '../services/util.js';
import type { State } from '../state.js';

const A = ['ADMIN'] as const;
const READ: readonly Role[] = ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR'];
const Q = z.object({ q: z.string().optional(), active: z.enum(['true', 'false']).optional(), category: z.string().optional(), type: z.string().optional() });

route({ method: 'get', path: '/customers', summary: 'Customers and distributors with outstanding', tag: 'Masters', roles: [...READ, 'DISTRIBUTOR'], query: Q }, async ({ read, query, ctx }) => {
  const s = await read();
  return {
    items: s.customers
      .filter((c) => ctx.actor.role !== 'DISTRIBUTOR' || c.id === ctx.actor.customerId)
      .filter((c) => (!query.type || c.type === query.type) && (!query.active || String(c.active) === query.active) && matchQ(query.q, c.name, c.code, c.phone, c.gstin))
      .map((c) => ({ ...c, outstanding: customerBalance(s, c.id) })),
  };
});

route({ method: 'get', path: '/customers/:id', summary: 'Customer profile with billing history', tag: 'Masters', roles: [...READ, 'DISTRIBUTOR'] }, async ({ read, param, ctx }) => {
  const s = await read();
  const c = find(s.customers, param('id'), 'Customer');
  assertCustomerScope(ctx, c.id);
  const own = ctx.actor.role === 'STAFF' || ctx.actor.role === 'OPERATING';
  const invoices = s.invoices
    .filter((i) => i.customerId === c.id && i.status !== 'DRAFT' && (!own || i.createdById === ctx.actor.id))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((i) => ({ id: i.id, number: i.number, date: i.date, type: i.type, total: i.grandTotal, paid: i.paidAmount, balance: outstanding(i), status: displayStatus(i, ctx.today), dueDate: i.dueDate }));
  const payments = s.payments.filter((p) => p.customerId === c.id && (!own || p.createdById === ctx.actor.id)).sort((a, b) => b.date.localeCompare(a.date));
  return { customer: c, outstanding: customerBalance(s, c.id), invoices, payments };
});

route({ method: 'post', path: '/customers', summary: 'Add a customer (Admin, Staff, Operating)', tag: 'Masters', roles: ['ADMIN', 'STAFF', 'OPERATING'], body: CustomerBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createCustomer(s, ctx, body)));
route({ method: 'patch', path: '/customers/:id', summary: 'Edit a customer', tag: 'Masters', roles: A, body: CustomerBody }, async ({ body, tx, ctx, param }) => tx((s) => updateCustomer(s, ctx, param('id'), body)));

route({ method: 'get', path: '/suppliers', summary: 'Suppliers', tag: 'Masters', roles: READ, query: Q }, async ({ read, query }) => ({
  items: (await read()).suppliers.filter((x) => matchQ(query.q, x.name, x.phone, x.gstin) && (!query.active || String(x.active) === query.active)),
}));
route({ method: 'post', path: '/suppliers', summary: 'Add a supplier', tag: 'Masters', roles: A, body: SupplierBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createSupplier(s, ctx, body)));
route({ method: 'patch', path: '/suppliers/:id', summary: 'Edit a supplier', tag: 'Masters', roles: A, body: SupplierBody }, async ({ body, tx, ctx, param }) => tx((s) => updateSupplier(s, ctx, param('id'), body)));

route({ method: 'get', path: '/products', summary: 'Sales Inventory items and prices', tag: 'Masters', roles: [...READ, 'DISTRIBUTOR'], query: Q }, async ({ read, query }) => {
  const s = await read();
  return { items: s.products.filter((p) => matchQ(query.q, p.code, p.name) && (!query.category || p.categoryId === query.category) && (!query.active || String(p.active) === query.active)).map((p) => ({ ...p, stock: finishedStock(s, p.id) })) };
});
route({ method: 'post', path: '/products', summary: 'Add a product', tag: 'Masters', roles: A, body: ProductBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createProduct(s, ctx, body)));
route({ method: 'patch', path: '/products/:id', summary: 'Edit a product and its prices', tag: 'Masters', roles: A, body: ProductBody }, async ({ body, tx, ctx, param }) => tx((s) => updateProduct(s, ctx, param('id'), body)));

route({ method: 'get', path: '/products/available', summary: 'Sales picker: price for the customer type and live stock', tag: 'Sales', roles: ['ADMIN', 'STAFF', 'OPERATING', 'DISTRIBUTOR'], query: z.object({ customerType: z.enum(['RETAIL', 'DISTRIBUTOR']).default('RETAIL') }), etag: false }, async ({ read, query, ctx }) =>
  ({ items: availableProducts(await read(), ctx.actor.role === 'DISTRIBUTOR' ? 'DISTRIBUTOR' : query.customerType) }),
);

route({ method: 'get', path: '/purchase-items', summary: 'Purchase List', tag: 'Masters', roles: READ, query: Q }, async ({ read, query }) => {
  const s = await read();
  return { items: s.rawMaterials.filter((r) => matchQ(query.q, r.name) && (!query.category || r.category === query.category) && (!query.active || String(r.active) === query.active)).map((r) => ({ ...r, stock: rawStock(s, r.id) })) };
});
route({ method: 'get', path: '/purchase-items/picker', summary: 'Purchase picker with stock and last rate', tag: 'Masters', roles: ['ADMIN', 'OPERATING'], etag: false }, async ({ read }) => ({ items: purchasePicker(await read()) }));
route({ method: 'post', path: '/purchase-items', summary: 'Add a purchase item', tag: 'Masters', roles: A, body: PurchaseItemBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createPurchaseItem(s, ctx, body)));
route({ method: 'patch', path: '/purchase-items/:id', summary: 'Edit a purchase item', tag: 'Masters', roles: A, body: PurchaseItemBody }, async ({ body, tx, ctx, param }) => tx((s) => updatePurchaseItem(s, ctx, param('id'), body)));

const NAMED: [string, NamedKind][] = [
  ['units', 'units'],
  ['product-categories', 'categories'],
  ['expense-heads', 'expenseHeads'],
];
for (const [path, kind] of NAMED) {
  route({ method: 'get', path: `/${path}`, summary: `List ${path.replace('-', ' ')}`, tag: 'Masters', roles: READ }, async ({ read }) => ({ items: (await read())[kind] }));
  route({ method: 'post', path: `/${path}`, summary: `Add to ${path.replace('-', ' ')}`, tag: 'Masters', roles: A, body: NameBody, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createNamed(s, ctx, kind, body.name)));
  route({ method: 'patch', path: `/${path}/:id`, summary: `Rename in ${path.replace('-', ' ')}`, tag: 'Masters', roles: A, body: NameBody }, async ({ body, tx, ctx, param }) => tx((s) => updateNamed(s, ctx, kind, param('id'), body.name)));
}

route({ method: 'get', path: '/bank-accounts', summary: 'Bank accounts', tag: 'Masters', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'] }, async ({ read }) => ({ items: (await read()).bankAccounts }));
route({ method: 'post', path: '/bank-accounts', summary: 'Add a bank account', tag: 'Masters', roles: A, body: BankAccountBody, status: 201 }, async ({ body, tx, ctx }) => tx((s) => createBankAccount(s, ctx, body)));
route({ method: 'patch', path: '/bank-accounts/:id', summary: 'Edit a bank account', tag: 'Masters', roles: A, body: BankAccountBody }, async ({ body, tx, ctx, param }) => tx((s) => updateBankAccount(s, ctx, param('id'), body)));

route({ method: 'get', path: '/opening-balances', summary: 'Opening balances', tag: 'Masters', roles: A }, async ({ read }) => {
  const s = await read();
  return {
    cash: s.openingCash,
    customers: s.customers.map((c) => ({ id: c.id, name: c.name, amount: c.openingBalance })),
    suppliers: s.suppliers.map((c) => ({ id: c.id, name: c.name, amount: c.openingBalance })),
    banks: s.bankAccounts.map((b) => ({ id: b.id, name: `${b.bankName} ${b.accountNo.slice(-4)}`, amount: b.openingBalance })),
  };
});
route({ method: 'put', path: '/opening-balances', summary: 'Set opening balances', tag: 'Masters', roles: A, body: OpeningBalanceBody }, async ({ body, tx, ctx }) => tx((s) => setOpeningBalances(s, ctx, body)));

/** Excel import: the browser reads the .xlsx and sends rows; the server maps and validates them. */
interface ImportSpec {
  columns: { key: string; label: string; example: string; required: boolean }[];
  toBody: (row: Record<string, unknown>, s: State) => unknown;
  schema: ZodTypeAny;
  create: (s: State, ctx: Ctx, body: never) => unknown;
  duplicate: (s: State, body: never) => string | null;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v: unknown) => (str(v) === '' ? Number.NaN : Number(str(v).replace(/[₹,\s]/g, '')));
const money = (v: unknown) => (Number.isFinite(num(v)) ? rupeesToPaise(num(v)) : Number.NaN);
const yes = (v: unknown) => /^(y|yes|true|1)$/i.test(str(v));
const byName = <T extends { id: string; name: string }>(list: T[], v: unknown) => list.find((x) => x.name.toLowerCase() === str(v).toLowerCase())?.id ?? '';
const STATE_CODES: Record<string, string> = { 'tamil nadu': '33', kerala: '32', karnataka: '29', 'andhra pradesh': '37', telangana: '36', puducherry: '34', maharashtra: '27' };

const IMPORTS: Record<string, ImportSpec> = {
  products: {
    columns: [
      { key: 'code', label: 'Code', example: 'PRD-J', required: true },
      { key: 'name', label: 'Name', example: 'Product J', required: true },
      { key: 'category', label: 'Category', example: 'Category 1', required: true },
      { key: 'unit', label: 'Unit', example: 'packet', required: true },
      { key: 'hsn', label: 'HSN', example: '2106', required: false },
      { key: 'gst', label: 'GST %', example: '5', required: true },
      { key: 'retail', label: 'Retail price', example: '275', required: true },
      { key: 'distributor', label: 'Distributor price', example: '250', required: true },
      { key: 'mrp', label: 'MRP', example: '300', required: false },
      { key: 'reorder', label: 'Reorder level', example: '50', required: true },
    ],
    toBody: (r, s) => ({ code: str(r.code), name: str(r.name), categoryId: byName(s.categories, r.category), unitId: byName(s.units, r.unit), hsn: str(r.hsn), gstRate: num(r.gst), taxInclusive: false, mrp: Number.isFinite(money(r.mrp)) ? money(r.mrp) : 0, retailPrice: money(r.retail), distributorPrice: money(r.distributor), reorderLevel: num(r.reorder), active: true }),
    schema: ProductBody,
    create: (s, ctx, b) => createProduct(s, ctx, b),
    duplicate: (s, b: { code: string }) => (s.products.some((p) => p.code === b.code) ? `Product code ${b.code} already exists` : null),
  },
  customers: {
    columns: [
      { key: 'name', label: 'Name', example: 'Customer J', required: true },
      { key: 'type', label: 'Type (Retail or Distributor)', example: 'Retail', required: true },
      { key: 'phone', label: 'Phone', example: '+91 90000 20099', required: true },
      { key: 'address', label: 'Address', example: '[Address], [City]', required: true },
      { key: 'state', label: 'State', example: 'Tamil Nadu', required: true },
      { key: 'gstin', label: 'GSTIN', example: '', required: false },
    ],
    toBody: (r) => ({ name: str(r.name), type: /^d/i.test(str(r.type)) ? 'DISTRIBUTOR' : 'RETAIL', phone: str(r.phone), address: str(r.address), state: str(r.state), stateCode: STATE_CODES[str(r.state).toLowerCase()] ?? '', gstin: str(r.gstin), openingBalance: 0, active: true }),
    schema: CustomerBody,
    create: (s, ctx, b) => createCustomer(s, ctx, b),
    duplicate: (s, b: { name: string }) => (s.customers.some((c) => c.name.toLowerCase() === b.name.toLowerCase()) ? `${b.name} already exists` : null),
  },
  suppliers: {
    columns: [
      { key: 'name', label: 'Name', example: 'Supplier F', required: true },
      { key: 'phone', label: 'Phone', example: '+91 90000 10099', required: true },
      { key: 'address', label: 'Address', example: '[Address], [City]', required: true },
      { key: 'state', label: 'State', example: 'Tamil Nadu', required: true },
      { key: 'gstin', label: 'GSTIN', example: '', required: false },
    ],
    toBody: (r) => ({ name: str(r.name), phone: str(r.phone), address: str(r.address), state: str(r.state), gstin: str(r.gstin), openingBalance: 0, active: true }),
    schema: SupplierBody,
    create: (s, ctx, b) => createSupplier(s, ctx, b),
    duplicate: (s, b: { name: string }) => (s.suppliers.some((c) => c.name.toLowerCase() === b.name.toLowerCase()) ? `${b.name} already exists` : null),
  },
  staff: {
    columns: [
      { key: 'name', label: 'Name', example: 'Worker K', required: true },
      { key: 'phone', label: 'Phone', example: '+91 90000 30099', required: true },
      { key: 'payType', label: 'Pay type (Fixed, Hourly or Share)', example: 'Fixed', required: true },
      { key: 'rate', label: 'Base pay, hourly rate or share %', example: '13000', required: true },
      { key: 'joinDate', label: 'Join date (YYYY-MM-DD)', example: '2026-04-01', required: true },
      { key: 'reduce', label: 'Reduce share by absences (Yes or No)', example: 'No', required: false },
    ],
    toBody: (r) => {
      const t = str(r.payType).toUpperCase();
      const payType = t.startsWith('H') ? 'HOURLY' : t.startsWith('S') ? 'SHARE' : 'FIXED';
      return { name: str(r.name), phone: str(r.phone), payType, basePay: payType === 'FIXED' ? money(r.rate) : undefined, hourlyRate: payType === 'HOURLY' ? money(r.rate) : undefined, sharePercent: payType === 'SHARE' ? num(r.rate) : undefined, reduceByAbsence: yes(r.reduce), withLogin: false, joinDate: str(r.joinDate) };
    },
    schema: WorkerCreateBody,
    create: (s, ctx, b) => createWorker(s, ctx, b),
    duplicate: (s, b: { name: string }) => (s.staff.some((c) => c.name.toLowerCase() === b.name.toLowerCase()) ? `${b.name} already exists` : null),
  },
};

function spec(master: string): ImportSpec {
  const sp = IMPORTS[master];
  if (!sp) throw notFound('Import type');
  return sp;
}

route({ method: 'get', path: '/templates/:master', summary: 'Excel template columns for a master', tag: 'Imports', roles: A }, async ({ param }) => ({ master: param('master'), columns: spec(param('master')).columns }));

function validateRows(s: State, sp: ImportSpec, rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.map((row, i) => {
    const r = sp.schema.safeParse(sp.toBody(row, s));
    let errors: Record<string, string> = r.success ? {} : zodDetails(r.error);
    if (r.success) {
      const dup = sp.duplicate(s, r.data as never);
      const key = JSON.stringify(Object.values(r.data as object).slice(0, 2));
      if (dup) errors = { _: dup };
      else if (seen.has(key)) errors = { _: 'Repeated in this file' };
      seen.add(key);
    }
    return { row: i + 2, values: row, ok: Object.keys(errors).length === 0, errors, body: r.success ? r.data : null };
  });
}

route({ method: 'post', path: '/imports/:master/preview', summary: 'Validate rows before import', tag: 'Imports', roles: A, body: ImportCommitBody }, async ({ read, param, body }) => {
  const rows = validateRows(await read(), spec(param('master')), body.rows);
  return { rows: rows.map(({ body: _b, ...r }) => r), valid: rows.filter((r) => r.ok).length, invalid: rows.filter((r) => !r.ok).length };
});

route({ method: 'post', path: '/imports/:master/commit', summary: 'Import the valid rows in one transaction', tag: 'Imports', roles: A, body: ImportCommitBody, idempotent: true }, async ({ tx, ctx, param, body }) =>
  tx((s) => {
    const sp = spec(param('master'));
    const rows = validateRows(s, sp, body.rows);
    let imported = 0;
    for (const r of rows) {
      if (!r.ok || !r.body) continue;
      sp.create(s, ctx, r.body as never);
      imported++;
    }
    return { imported, skipped: rows.length - imported };
  }),
);
