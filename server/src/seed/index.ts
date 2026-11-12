import bcrypt from 'bcryptjs';
import {
  addDays,
  isOffDay,
  istTimestamp,
  monthStart,
  prevMonth,
  roundQty,
  toISTDate,
  weekday,
  type ActivityLog,
  type DomainEvent,
  type ISODate,
  type LoginEvent,
  type User,
} from '@app/contract';
import { makeCtx, newId, type Actor, type Ctx } from '../ctx.js';
import { loginEvent } from '../logs.js';
import { emptyState, type State } from '../state.js';
import { calendarOf, closeSessions, editAttendance, manualAttendance, startSession } from '../services/attendance.js';
import { createInvoice, createOrderRequest, convertOrderRequest, finalizeInvoice, recordPayment } from '../services/invoices.js';
import { adjustStock, recordProduction } from '../services/inventory.js';
import { createExpense } from '../services/ledgers.js';
import { createBankAccount, createCustomer, createNamed, createProduct, createPurchaseItem, createSupplier } from '../services/masters.js';
import { recordAdvance } from '../services/payroll.js';
import {
  addTranche,
  approveIndent,
  createIndent,
  recordPurchaseBill,
  recordSupplierPayment,
  rejectIndent,
  submitIndent,
} from '../services/purchasing.js';
import { buildSettlement, finalizeSettlement, payAllSettlement, saveSettlementDraft } from '../services/settlement.js';
import { createWorker } from '../services/users.js';
import { finishedStock, outstanding, rawStock } from '../services/util.js';
import { rng } from './rng.js';

export const SEED = 20261112;
export const DEMO_PASSWORD = 'Demo@123';

export interface SeedResult {
  state: State;
  audits: ActivityLog[];
  logins: LoginEvent[];
  events: Omit<DomainEvent, 'seq'>[];
}

const R = (rupees: number) => Math.round(rupees * 100);

/**
 * Generates the demo data by running the real services over a simulated 60-day history,
 * so every invariant (stock, ledgers, numbering, settlement) holds by construction.
 * Dates are relative to the day the seed is first loaded.
 */
export function buildSeed(nowIso: string, seedVersion: number): SeedResult {
  const r = rng(SEED);
  const today = toISTDate(nowIso);
  // About 60 days, always reaching back before last month so last month is complete.
  const lastMonthStart = monthStart(prevMonth(today.slice(0, 7)));
  const start = addDays(today, -60) < addDays(lastMonthStart, -7) ? addDays(today, -60) : addDays(lastMonthStart, -7);
  const s = emptyState(today, nowIso, seedVersion);
  const audits: ActivityLog[] = [];
  const logins: LoginEvent[] = [];
  const events: Omit<DomainEvent, 'seq'>[] = [];
  let reqN = 0;
  const hash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const ctxAt = (actor: Actor, date: ISODate, minute: number): Ctx => {
    const c = makeCtx(actor, { now: istTimestamp(date, minute), ip: '10.0.0.10', requestId: `seed-${++reqN}` });
    return c;
  };
  const run = <T>(actor: Actor, date: ISODate, minute: number, fn: (ctx: Ctx) => T): T => {
    const ctx = ctxAt(actor, date, minute);
    const out = fn(ctx);
    audits.push(...ctx.audits);
    events.push(...ctx.events);
    return out;
  };

  // Company, settings and calendar
  const thisMonth = today.slice(0, 7);
  const lastMonth = prevMonth(thisMonth);
  let holiday = `${thisMonth}-15`;
  if (weekday(holiday) === 0) holiday = `${thisMonth}-16`;
  s.holidays.push({ id: newId(s, 'hol'), date: holiday, name: 'Company holiday' });
  s.companyProfiles.push({
    id: newId(s, 'cpv'),
    versionNo: 1,
    effectiveFrom: istTimestamp(start, 480),
    brandName: '[Your Brand Name]',
    addressLine1: '[Address line 1]',
    city: '[City]',
    state: 'Tamil Nadu',
    stateCode: '33',
    pincode: '600001',
    phone: '+91 90000 00000',
    email: 'accounts@example.com',
    gstin: '33AAAAA0000A1Z5',
    invoiceTerms: 'Goods once sold will not be taken back. Payment due as per credit period.',
    footerNote: 'Thank you for your business.',
    signatoryLabel: 'Authorised signatory',
    createdById: 'system',
  });
  s.openingCash = R(50000);

  // Users
  const mkUser = (username: string, name: string, role: User['role'], extra: Partial<User> = {}): User => {
    const u: User = { id: newId(s, 'usr'), username, passwordHash: hash, name, role, active: true, tokenVersion: 1, createdAt: istTimestamp(start, 480), ...extra };
    s.users.push(u);
    return u;
  };
  const admin = mkUser('admin', 'Admin', 'ADMIN');
  // Monitor and Collector are read-only accounts. Indent approval stays with Admin.
  mkUser('monitor', 'Monitor', 'MONITOR');
  mkUser('collector', 'Collector', 'COLLECTOR');
  const A = (u: User): Actor => ({ id: u.id, name: u.name, role: u.role, staffId: u.staffId, customerId: u.customerId });
  const ADMIN = A(admin);

  // Masters
  const d0 = start;
  const units = Object.fromEntries(['kg', 'packet', 'piece'].map((n) => [n, run(ADMIN, d0, 490, (c) => createNamed(s, c, 'units', n)).id])) as Record<string, string>;
  const cat1 = run(ADMIN, d0, 491, (c) => createNamed(s, c, 'categories', 'Category 1')).id;
  const cat2 = run(ADMIN, d0, 491, (c) => createNamed(s, c, 'categories', 'Category 2')).id;
  for (const h of ['Electricity', 'Tea', 'Food', 'Travel', 'Diesel', 'Other']) run(ADMIN, d0, 492, (c) => createNamed(s, c, 'expenseHeads', h));
  run(ADMIN, d0, 493, (c) =>
    createBankAccount(s, c, { bankName: '[Bank name]', accountName: '[Your Brand Name]', accountNo: '000000000000', ifsc: 'ABCD0123456', upiId: 'brand@bank', isInvoiceDefault: true, openingBalance: R(200000) }),
  );

  const productDefs: [string, string, string, number, number, number, number, string][] = [
    ['PRD-A', 'Product A', 'packet', 250, 225, 5, 100, cat1],
    ['PRD-B', 'Product B', 'packet', 400, 360, 5, 80, cat1],
    ['PRD-C', 'Product C', 'packet', 150, 135, 5, 150, cat1],
    ['PRD-D', 'Product D', 'kg', 600, 540, 5, 40, cat2],
    ['PRD-E', 'Product E', 'piece', 120, 108, 12, 100, cat2],
    ['PRD-F', 'Product F', 'packet', 320, 288, 12, 60, cat1],
    ['PRD-G', 'Product G', 'piece', 85, 75, 0, 100, cat2],
    ['PRD-H', 'Product H', 'kg', 950, 855, 18, 30, cat2],
  ];
  const P: Record<string, string> = {};
  productDefs.forEach(([code, name, unit, retail, dist, gst, reorder, cat], i) => {
    P[code.slice(-1)] = run(ADMIN, d0, 494, (c) =>
      createProduct(s, c, { code, name, categoryId: cat, unitId: units[unit] as string, hsn: String(2100 + i * 7), gstRate: gst, taxInclusive: false, mrp: R(Math.round(retail * 1.1)), retailPrice: R(retail), distributorPrice: R(dist), reorderLevel: reorder, active: true }),
    ).id;
  });

  const supplierDefs: [string, string][] = [
    ['Supplier A', 'Tamil Nadu'],
    ['Supplier B', 'Kerala'],
    ['Supplier C', 'Tamil Nadu'],
    ['Supplier D', 'Karnataka'],
    ['Supplier E', 'Tamil Nadu'],
  ];
  const SUP = supplierDefs.map(([name, state], i) =>
    run(ADMIN, d0, 495, (c) =>
      createSupplier(s, c, { name, phone: `+91 90000 1000${i}`, address: `[Address], [City], ${state}`, gstin: i % 2 === 0 ? `33AABC${String.fromCharCode(65 + i)}000${i}A1Z5`.replace(/^33/, state === 'Tamil Nadu' ? '33' : state === 'Kerala' ? '32' : '29') : undefined, state, openingBalance: 0, active: true }),
    ).id,
  );

  const rawDefs: [string, 'RAW_MATERIAL' | 'PACKAGING' | 'CONSUMABLE', string, number, number, number][] = [
    ['Raw Material A', 'RAW_MATERIAL', 'kg', 120, 200, 0],
    ['Raw Material B', 'RAW_MATERIAL', 'kg', 95, 150, 1],
    ['Raw Material C', 'RAW_MATERIAL', 'kg', 210, 100, 2],
    ['Raw Material D', 'RAW_MATERIAL', 'kg', 40, 100, 3],
    ['Packaging Material A', 'PACKAGING', 'piece', 3.5, 500, 4],
    ['Packaging Material B', 'PACKAGING', 'piece', 6, 300, 4],
    ['Consumable A', 'CONSUMABLE', 'kg', 18, 50, 4],
  ];
  const RM = rawDefs.map(([name, category, unit, rate, reorder, sup]) =>
    run(ADMIN, d0, 496, (c) => createPurchaseItem(s, c, { name, category, unitId: units[unit] as string, preferredSupplierId: SUP[sup], lastRate: R(rate), reorderLevel: reorder, active: true })).id,
  ) as [string, string, string, string, string, string, string];

  const states: Record<string, string> = { 'Tamil Nadu': '33', Kerala: '32', Karnataka: '29' };
  const custDefs: [string, 'RETAIL' | 'DISTRIBUTOR', string, boolean][] = [
    ['Customer A', 'RETAIL', 'Tamil Nadu', true],
    ['Customer B', 'RETAIL', 'Tamil Nadu', false],
    ['Customer C', 'RETAIL', 'Tamil Nadu', true],
    ['Customer D', 'RETAIL', 'Tamil Nadu', false],
    ['Customer E', 'RETAIL', 'Tamil Nadu', true],
    ['Customer F', 'RETAIL', 'Kerala', true],
    ['Customer G', 'RETAIL', 'Kerala', false],
    ['Customer H', 'RETAIL', 'Karnataka', true],
    ['Distributor A', 'DISTRIBUTOR', 'Tamil Nadu', true],
    ['Distributor B', 'DISTRIBUTOR', 'Tamil Nadu', true],
    ['Distributor C', 'DISTRIBUTOR', 'Kerala', true],
    ['Distributor D', 'DISTRIBUTOR', 'Karnataka', true],
  ];
  const CUS = custDefs.map(([name, type, state, gst], i) =>
    run(ADMIN, d0, 497, (c) =>
      createCustomer(s, c, {
        name,
        type,
        phone: `+91 90000 2${String(i).padStart(4, '0')}`,
        address: `[Address], [City], ${state}`,
        gstin: gst ? `${states[state]}AAB${type === 'DISTRIBUTOR' ? 'D' : 'C'}${String.fromCharCode(65 + i)}${String(1000 + i)}A1Z${i % 10}` : undefined,
        state,
        stateCode: states[state] as string,
        openingBalance: 0,
        active: true,
      }),
    ),
  );
  const retail = CUS.filter((c) => c.type === 'RETAIL');
  const distributors = CUS.filter((c) => c.type === 'DISTRIBUTOR');
  const distA = distributors[0]!;
  const distUser = mkUser('distributor', 'Distributor A', 'DISTRIBUTOR', { customerId: distA.id });

  // Workers: 10, five with logins
  const workerDefs: { name: string; login?: string; role?: 'STAFF' | 'OPERATING'; payType: 'FIXED' | 'HOURLY' | 'SHARE'; basePay?: number; hourlyRate?: number; sharePercent?: number; reduce?: boolean }[] = [
    { name: 'Worker A', login: 'staff1', role: 'STAFF', payType: 'FIXED', basePay: 17000 },
    { name: 'Worker B', login: 'staff2', role: 'STAFF', payType: 'HOURLY', hourlyRate: 90 },
    { name: 'Worker C', login: 'staff3', role: 'STAFF', payType: 'SHARE', sharePercent: 5, reduce: true },
    { name: 'Worker D', payType: 'FIXED', basePay: 15000 },
    { name: 'Worker E', payType: 'HOURLY', hourlyRate: 80 },
    { name: 'Worker F', payType: 'FIXED', basePay: 12000 },
    { name: 'Worker G', payType: 'HOURLY', hourlyRate: 70 },
    { name: 'Worker H', payType: 'SHARE', sharePercent: 3, reduce: false },
    { name: 'Worker I', payType: 'FIXED', basePay: 14000 },
    { name: 'Worker J', payType: 'HOURLY', hourlyRate: 75 },
  ];
  const workers = workerDefs.map((w, i) =>
    run(ADMIN, d0, 500 + i, (c) =>
      createWorker(
        s,
        c,
        {
          name: w.name,
          phone: `+91 90000 3${String(i).padStart(4, '0')}`,
          role: w.role,
          withLogin: !!w.login,
          loginId: w.login,
          password: w.login ? DEMO_PASSWORD : undefined,
          joinDate: addDays(start, -120),
          payType: w.payType,
          basePay: w.basePay ? R(w.basePay) : undefined,
          hourlyRate: w.hourlyRate ? R(w.hourlyRate) : undefined,
          sharePercent: w.sharePercent,
          reduceByAbsence: w.reduce ?? false,
        },
        w.login ? hash : undefined,
      ),
    ),
  );
  const loginWorkers = workers.filter((w) => w.user);
  const manualWorkers = workers.filter((w) => !w.user);
  const actorOf = (username: string) => A(s.users.find((u) => u.username === username) as User);
  const STAFF = ['staff1', 'staff2', 'staff3'].map(actorOf);
  const OP1 = ADMIN;
  const DIST = A(distUser);

  // Opening stock
  const openingRaw: [number, number][] = [
    [0, 300],
    [1, 250],
    [2, 150],
    [3, 200],
    [4, 2500],
    [5, 1200],
    [6, 80],
  ];
  for (const [i, q] of openingRaw)
    s.rawMoves.push({ id: newId(s, 'rsm'), rawMaterialId: RM[i]!, qty: q, reason: 'OPENING', refType: 'opening', refId: 'opening', rate: s.rawMaterials[i]!.lastRate, date: start, note: 'Opening stock', createdById: admin.id, at: istTimestamp(start, 500) });
  const openingFinished: [string, number][] = [
    ['A', 400],
    ['B', 260],
    ['C', 420],
    ['D', 70],
    ['E', 320],
    ['F', 180],
    ['H', 14],
  ];
  for (const [k, q] of openingFinished)
    s.finishedMoves.push({ id: newId(s, 'fsm'), productId: P[k]!, qty: q, reason: 'OPENING', refType: 'opening', refId: 'opening', date: start, note: 'Opening stock', createdById: admin.id, at: istTimestamp(start, 500) });

  // Funds
  const loanA = run(ADMIN, addDays(start, 1), 600, (c) => addTranche(s, c, { date: addDays(start, 1), source: 'Lender A', amount: R(1000000), note: 'Working capital loan', isLoan: true, lender: 'Lender A' }));
  run(ADMIN, addDays(start, 8), 600, (c) => addTranche(s, c, { date: addDays(start, 8), source: 'Owner', amount: R(500000), note: 'Own fund', isLoan: false }));
  const lmStart = monthStart(lastMonth);
  const tmStart = monthStart(thisMonth);
  const tranche3Day = addDays(lmStart, 10) < today ? addDays(lmStart, 10) : addDays(start, 30);
  run(ADMIN, tranche3Day, 600, (c) => addTranche(s, c, { date: tranche3Day, source: 'Lender B', amount: R(250000), note: 'Short-term loan', isLoan: true, lender: 'Lender B' }));

  // Admin approves indents alone (no separate Monitor or Collector).
  const approveAll = (id: string, d: ISODate, approve = true) => {
    if (approve) run(ADMIN, d, 640, (c) => approveIndent(s, c, id, 'Approved for purchase'));
  };
  const indentFlow = (d: ISODate, sup: number, items: [number, number, number][], note: string) => {
    const ind = run(ADMIN, d, 610, (c) => createIndent(s, c, { supplierId: SUP[sup]!, date: d, note, items: items.map(([i, qty, rate]) => ({ rawMaterialId: RM[i]!, qty, rate: R(rate) })) }));
    run(ADMIN, d, 620, (c) => submitIndent(s, c, ind.id));
    return ind;
  };
  const receive = (indId: string, d: ISODate, billNo: string, rateFactor: number, by = ADMIN) => {
    const ind = s.indents.find((x) => x.id === indId)!;
    const items = ind.items.map((it) => ({ rawMaterialId: it.rawMaterialId, qty: it.qty, rate: Math.round(it.rate * rateFactor) }));
    const billAmount = items.reduce((a, it) => a + Math.round(it.qty * it.rate), 0);
    run(by, d, 660, (c) => recordPurchaseBill(s, c, { indentId: indId, date: d, supplierBillNo: billNo, supplierBillDate: d, billAmount, note: '', items }));
  };

  // Daily simulation
  const sched: Record<string, ((d: ISODate) => void)[]> = {};
  const on = (d: ISODate, fn: (d: ISODate) => void) => {
    if (d >= today) return;
    (sched[d] ??= []).push(fn);
  };

  // Indent 1: fully paid
  // Indent 1 always falls in the month before last, indent 2 in last month.
  const i1Day = start;
  on(i1Day, (d) => {
    const ind = indentFlow(d, 0, [[0, 1600, 120], [1, 1300, 95]], 'Monthly raw material');
    approveAll(ind.id, d);
    const grn = addDays(d, 3) < lmStart ? addDays(d, 3) : d;
    on(grn, (d2) => receive(ind.id, d2, 'SA/1182', 1.02));
    on(addDays(d, 6), (d2) => run(ADMIN, d2, 690, (c) => recordSupplierPayment(s, c, { indentId: ind.id, date: d2, mode: 'BANK', amount: s.goodsReceipts.find((g) => g.indentId === ind.id)!.billAmount, reference: 'NEFT 50211' })));
  });
  // Indent 2: last month, received, partly paid
  const i2Day = addDays(lmStart, 2);
  on(i2Day, (d) => {
    const ind = indentFlow(d, 2, [[2, 500, 210], [3, 1800, 40], [0, 600, 120]], 'Raw material for the month');
    approveAll(ind.id, d);
    on(addDays(d, 3), (d2) => receive(ind.id, d2, 'SC/0457', 0.98, OP1));
    on(addDays(d, 8), (d2) => run(ADMIN, d2, 690, (c) => recordSupplierPayment(s, c, { indentId: ind.id, date: d2, mode: 'BANK', amount: R(200000), reference: 'NEFT 50388' })));
  });
  // Indent 3: packaging, received, unpaid
  const i3Day = addDays(tmStart, -5);
  on(i3Day, (d) => {
    const ind = indentFlow(d, 4, [[4, 6000, 3.5], [5, 3000, 6], [6, 300, 18]], 'Packaging and consumables');
    approveAll(ind.id, d);
    on(addDays(d, 4), (d2) => receive(ind.id, d2, 'SE/2290', 1.03, OP1));
  });
  // Indents waiting at each stage, a draft and a rejected one
  on(addDays(today, -6), (d) => {
    const ind = indentFlow(d, 1, [[1, 900, 96]], 'Stock for next month');
    run(ADMIN, d, 700, (c) => rejectIndent(s, c, ind.id, 'Rate is higher than last purchase. Recheck with supplier.'));
  });
  on(addDays(today, -5), (d) => approveAll(indentFlow(d, 3, [[3, 1500, 41]], 'Additional Raw Material D').id, d, false));
  on(addDays(today, -4), (d) => approveAll(indentFlow(d, 0, [[0, 800, 122]], 'Top-up for Raw Material A').id, d, false));
  on(addDays(today, -3), (d) => void indentFlow(d, 2, [[2, 300, 212]], 'Raw Material C for Product H'));
  on(addDays(today, -1), (d) => void run(ADMIN, d, 615, (c) => createIndent(s, c, { supplierId: SUP[4]!, date: d, note: 'Packaging for festival orders', items: [{ rawMaterialId: RM[5]!, qty: 2000, rate: R(6) }] })));

  // Production every 5 days
  const recipes: { raw: number; pack: number; outs: [string, number][] }[] = [
    { raw: 0, pack: 4, outs: [['A', 0.6], ['C', 0.4]] },
    { raw: 1, pack: 4, outs: [['B', 0.6], ['F', 0.4]] },
    { raw: 0, pack: 4, outs: [['A', 0.55], ['C', 0.45]] },
    { raw: 3, pack: 5, outs: [['E', 1]] },
    { raw: 2, pack: 4, outs: [['D', 0.94], ['H', 0.06]] },
  ];
  let batchNo = 0;
  const batchDays: { d: ISODate }[] = [];
  for (let d = addDays(start, 4); d < addDays(today, -5); d = addDays(d, 5)) batchDays.push({ d });
  for (const { d } of batchDays) {
    on(d, (day) => {
      const rec = recipes[batchNo++ % recipes.length]!;
      const rawId = RM[rec.raw]!;
      const want = rec.raw === 2 ? r.int(110, 160) : rec.raw === 3 ? r.int(200, 260) : r.int(320, 440);
      const qty = Math.min(want, Math.floor(rawStock(s, rawId)));
      if (qty < 20) return;
      const w = r.int(3, 8) / 100;
      const net = qty * (1 - w);
      const isKg = rec.raw === 2;
      const perUnit = isKg ? 1 : 2;
      const outs = rec.outs.map(([k, share]) => ({ productId: P[k]!, qty: isKg ? roundQty(net * share) : Math.floor(net * share * perUnit) }));
      const packQty = isKg ? Math.ceil(net) : outs.reduce((a, o) => a + o.qty, 0);
      const pack = Math.min(packQty, Math.floor(rawStock(s, RM[rec.pack]!)));
      const inputs = [{ rawMaterialId: rawId, qty }];
      if (pack > 0) inputs.push({ rawMaterialId: RM[rec.pack]!, qty: pack });
      if (rec.raw === 0 && rawStock(s, RM[6]!) >= 5) inputs.push({ rawMaterialId: RM[6]!, qty: 5 });
      if (outs.every((o) => o.qty > 0)) run(OP1, day, 600, (c) => recordProduction(s, c, { date: day, inputs, outputs: outs, wastageQty: roundQty(qty * w), wastageNote: 'Trimming and moisture loss' }));
    });
  }

  // Sales
  type Plan = { kind: 'CASH' | 'CREDIT' | 'DISTRIBUTOR'; count: number };
  const plans: Plan[] = [
    { kind: 'CASH', count: 15 },
    { kind: 'CREDIT', count: 17 },
    { kind: 'DISTRIBUTOR', count: 13 },
  ];
  const slots: ('CASH' | 'CREDIT' | 'DISTRIBUTOR')[] = plans.flatMap((p) => Array.from({ length: p.count }, () => p.kind));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = r.int(0, i);
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  const saleDays: ISODate[] = [];
  for (let d = addDays(start, 2); d < today; d = addDays(d, 1)) if (!isOffDay(d, calendarOf(s))) saleDays.push(d);
  const stride = saleDays.length / slots.length;
  const invoicesMade: string[] = [];
  const slotDays = slots.map((_, idx) => saleDays[Math.min(saleDays.length - 1, Math.floor(idx * stride + r.next() * stride * 0.6))]!);
  let overdueLeft = 5;
  let oldCandidates = slots.filter((k, idx) => k !== 'CASH' && slotDays[idx]! <= addDays(today, -16)).length;
  slots.forEach((kind, idx) => {
    const day = slotDays[idx]!;
    on(day, (d) => {
      const seller = kind === 'DISTRIBUTOR' && r.chance(0.3) ? ADMIN : r.pick(STAFF);
      const cust = kind === 'CASH' ? (r.chance(0.6) ? undefined : r.pick(retail)) : kind === 'CREDIT' ? r.pick(retail) : r.pick(distributors);
      const pool = ['A', 'B', 'C', 'D', 'E', 'F', 'H'].filter((x) => x !== 'H' || r.chance(0.25));
      const n = kind === 'CASH' ? r.int(1, 3) : r.int(2, 5);
      const chosen = new Set<string>();
      while (chosen.size < n) chosen.add(r.pick(pool));
      const items = [...chosen]
        .map((code) => {
          const kg = code === 'D' || code === 'H';
          const base = kind === 'CASH' ? r.int(2, 8) : kind === 'CREDIT' ? r.int(35, 80) : r.int(190, 320);
          let qty = kg ? roundQty(Math.max(1, base / 4) + (r.chance(0.3) ? 0.5 : 0)) : base;
          const reserve = code === 'H' ? 12 : 10;
          const avail = finishedStock(s, P[code]!) - reserve;
          if (qty > avail) qty = Math.floor(avail);
          return { productId: P[code]!, qty, discountPct: kind === 'CREDIT' && r.chance(0.25) ? 5 : 0 };
        })
        .filter((x) => x.qty > 0);
      if (!items.length) return;
      const minute = r.int(600, 1050);
      const inv = run(seller, d, minute, (c) => createInvoice(s, c, { type: kind, customerId: cust?.id, walkInName: kind === 'CASH' && !cust ? 'Walk-in customer' : undefined, date: d, items }));
      run(seller, d, minute + 2, (c) => finalizeInvoice(s, c, inv.id));
      invoicesMade.push(inv.id);
    });
  });

  // Keep the demo picture stable whatever the load date: healthy stock for A to F,
  // Product H just under its reorder level, Product G out of stock.
  on(addDays(today, -1), (day) => {
    for (const [code, raw, share, perUnit] of [['A', 0, 0.6, 2], ['C', 0, 0.4, 2], ['B', 1, 0.6, 2], ['F', 1, 0.4, 2], ['E', 3, 1, 2], ['D', 2, 1, 1]] as const) {
      const p = s.products.find((x) => x.id === P[code])!;
      const stock = finishedStock(s, p.id);
      if (stock >= p.reorderLevel * 1.5) continue;
      const need = p.reorderLevel * 2.5 - stock;
      const qty = Math.min(Math.ceil(need / (share * perUnit * 0.95)), Math.floor(rawStock(s, RM[raw]!)));
      if (qty < 10) continue;
      const out = perUnit === 1 ? roundQty(qty * 0.95) : Math.floor(qty * 0.95 * perUnit);
      run(OP1, day, 590, (c) => recordProduction(s, c, { date: day, inputs: [{ rawMaterialId: RM[raw]!, qty }], outputs: [{ productId: p.id, qty: out }], wastageQty: roundQty(qty * 0.05), wastageNote: 'Trimming loss' }));
    }
  });
  on(addDays(today, -1), (day) => {
    const h = s.products.find((x) => x.id === P.H)!;
    const excess = roundQty(finishedStock(s, h.id) - (h.reorderLevel - 8));
    if (excess <= 0) return;
    const buyer = retail[retail.length - 1]!;
    const inv = run(STAFF[0]!, day, 700, (c) => createInvoice(s, c, { type: 'CREDIT', customerId: buyer.id, date: day, items: [{ productId: h.id, qty: excess, discountPct: 0 }] }));
    run(STAFF[0]!, day, 702, (c) => finalizeInvoice(s, c, inv.id));
  });

  // Expenses (about 25)
  const expenseDefs: [string, number, number, string][] = [
    ['Electricity', 6800, 9200, 'Monthly electricity bill'],
    ['Tea', 300, 650, 'Tea and snacks for staff'],
    ['Food', 600, 1400, 'Lunch for workers on a long shift'],
    ['Travel', 400, 1800, 'Travel to supplier'],
    ['Diesel', 1500, 3200, 'Diesel for the delivery vehicle'],
    ['Other', 250, 900, 'Stationery and printing'],
  ];
  for (let i = 0; i < 25; i++) {
    const d = addDays(start, 2 + Math.floor((i * 57) / 25));
    on(d, (day) => {
      const [head, lo, hi, desc] = i % 12 === 0 ? expenseDefs[0]! : r.pick(expenseDefs.slice(1));
      const headId = s.expenseHeads.find((h) => h.name === head)!.id;
      run(i % 3 === 0 ? OP1 : ADMIN, day, 1000, (c) => createExpense(s, c, { date: day, headId, amount: R(r.int(lo, hi)), mode: head === 'Electricity' ? 'BANK' : 'CASH', description: desc }));
    });
  }

  // Advances
  on(addDays(lmStart, 4) < today ? addDays(lmStart, 4) : addDays(start, 10), (d) => run(ADMIN, d, 1020, (c) => recordAdvance(s, c, { staffId: workers[1]!.staff.id, date: d, amount: R(3000), mode: 'CASH', note: 'Family function' })));
  on(addDays(lmStart, 9) < today ? addDays(lmStart, 9) : addDays(start, 14), (d) => run(ADMIN, d, 1020, (c) => recordAdvance(s, c, { staffId: workers[5]!.staff.id, date: d, amount: R(2000), mode: 'CASH', note: 'Medical expense' })));

  // A small damage adjustment
  on(addDays(start, 26), (d) => run(OP1, d, 1030, (c) => adjustStock(s, c, { kind: 'SALES', itemId: P.C!, qty: -6, reason: 'Damaged packets found during handling' })));

  // Attendance: sessions for login workers, manual rows for the others
  const forgot = new Set<string>();
  const forgotDays = [addDays(start, 12), addDays(start, 31), addDays(start, 47)];
  for (let d = start; d < today; d = addDays(d, 1)) {
    const off = isOffDay(d, calendarOf(s));
    on(d, (day) => {
      loginWorkers.forEach((w, wi) => {
        const u = w.user!;
        const actor = A(s.users.find((x) => x.id === u.id)!);
        const present = off ? r.chance(0.04) : r.chance(0.93);
        if (!present) return;
        const login = r.int(520, 580);
        const split = r.chance(0.3);
        const end = r.int(1000, 1080);
        const isForgot = forgotDays.includes(day) && wi === forgotDays.indexOf(day) + 1;
        const ip = `10.0.1.${20 + wi}`;
        const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130';
        run(actor, day, login, (c) => {
          const staff = s.staff.find((x) => x.id === u.staffId)!;
          startSession(s, c, staff);
          logins.push(loginEvent({ userId: u.id, username: u.username, outcome: 'SUCCESS', ip, userAgent: ua, at: c.now }));
        });
        const sess = () => s.sessions.filter((x) => x.staffId === u.staffId && !x.logoutAt);
        if (isForgot) {
          forgot.add(`${u.staffId}|${day}`);
          for (const x of sess()) x.lastSeenAt = istTimestamp(day, login + 95);
          run(actor, day, login + 125, (c) => {
            closeSessions(s, u.staffId!, c.now, 'IDLE_TIMEOUT');
            logins.push(loginEvent({ userId: u.id, username: u.username, outcome: 'TIMEOUT', ip, userAgent: ua, at: c.now }));
          });
          return;
        }
        if (split) {
          const lunch = r.int(770, 790);
          for (const x of sess()) x.lastSeenAt = istTimestamp(day, lunch);
          run(actor, day, lunch, (c) => {
            closeSessions(s, u.staffId!, c.now, 'LOGOUT');
            logins.push(loginEvent({ userId: u.id, username: u.username, outcome: 'LOGOUT', ip, userAgent: ua, at: c.now }));
          });
          run(actor, day, lunch + r.int(30, 45), (c) => {
            startSession(s, c, s.staff.find((x) => x.id === u.staffId)!);
            logins.push(loginEvent({ userId: u.id, username: u.username, outcome: 'SUCCESS', ip, userAgent: ua, at: c.now }));
          });
        }
        for (const x of sess()) x.lastSeenAt = istTimestamp(day, end);
        run(actor, day, end, (c) => {
          closeSessions(s, u.staffId!, c.now, 'LOGOUT');
          logins.push(loginEvent({ userId: u.id, username: u.username, outcome: 'LOGOUT', ip, userAgent: ua, at: c.now }));
        });
      });
      if (!off)
        manualWorkers.forEach((w) => {
          const absent = r.chance(0.07);
          const hours = w.staff.payType === 'HOURLY' ? r.int(7, 9) : 8;
          run(ADMIN, day, 1100, (c) => manualAttendance(s, c, { staffId: w.staff.id, date: day, status: absent ? 'ABSENT' : 'PRESENT', paidHours: absent ? 0 : hours, reason: 'Daily attendance register' }));
        });
    });
    // Admin fixes forgotten logouts the next morning
    on(addDays(d, 1), (day) => {
      for (const key of [...forgot]) {
        const [staffId, fd] = key.split('|') as [string, string];
        if (fd !== d) continue;
        const row = s.attendance.find((a) => a.staffId === staffId && a.date === fd);
        if (row && !row.payslipId) run(ADMIN, day, 545, (c) => editAttendance(s, c, row.id, { status: 'PRESENT', paidHours: 8, reason: 'Forgot to log out. Worked the full shift.' }));
        forgot.delete(key);
      }
    });
  }

  // Admin, Monitor and Collector sign in on most days
  for (let d = start; d < today; d = addDays(d, 1)) {
    if (isOffDay(d, calendarOf(s))) continue;
    on(d, (day) => {
      logins.push(loginEvent({ userId: admin.id, username: 'admin', outcome: 'SUCCESS', ip: '10.0.0.10', userAgent: 'Mozilla/5.0 (Macintosh) Safari/18', at: istTimestamp(day, 535) }));
      if (r.chance(0.05)) logins.push(loginEvent({ userId: undefined, username: r.pick(['staff1', 'staff2', 'admin']), outcome: 'FAILED', ip: '10.0.0.40', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', at: istTimestamp(day, 528) }));
    });
  }

  // Last month's settlement (finalized and paid on the first working day of this month)
  let settleDay = tmStart;
  while (isOffDay(settleDay, calendarOf(s)) && settleDay < addDays(today, -1)) settleDay = addDays(settleDay, 1);
  if (settleDay >= today) settleDay = addDays(today, -1);
  const settle = (d: ISODate) => {
    const base = {
      month: lastMonth,
      adjustments: [{ staffId: workers[0]!.staff.id, amount: R(500), reason: 'Festival bonus' }],
      advanceRecoveries: [
        { staffId: workers[1]!.staff.id, amount: R(1500) },
        { staffId: workers[5]!.staff.id, amount: R(1000) },
      ],
    };
    // ₹3,00,000 repayment when the month's profit allows it, otherwise the largest round amount that keeps the owner positive.
    const probe = buildSettlement(s, ctxAt(ADMIN, d, 955), { ...base, loanRepayment: 0 });
    const room = probe.grossProfit - probe.workerTotal - probe.otherExpenses - R(40000);
    const loanRepayment = Math.max(0, Math.min(R(300000), Math.floor(room / R(10000)) * R(10000)));
    const draft = run(ADMIN, d, 960, (c) =>
      saveSettlementDraft(s, c, {
        month: lastMonth,
        loanTrancheId: loanA.id,
        loanRepayment,
        adjustments: [{ staffId: workers[0]!.staff.id, amount: R(500), reason: 'Festival bonus' }],
        advanceRecoveries: [
          { staffId: workers[1]!.staff.id, amount: R(1500) },
          { staffId: workers[5]!.staff.id, amount: R(1000) },
        ],
      }),
    );
    run(ADMIN, d, 965, (c) => finalizeSettlement(s, c, draft.id));
    run(ADMIN, d, 970, (c) => payAllSettlement(s, c, draft.id, { date: d, mode: 'BANK', reference: `SAL-${lastMonth}` }));
  };

  // Distributor order requests: one converted and billed, one waiting for Admin
  on(addDays(today, -8), (d) => {
    const items = [
      { productId: P.A!, qty: 40 },
      { productId: P.B!, qty: 20 },
    ].map((x) => ({ ...x, qty: Math.min(x.qty, Math.floor(finishedStock(s, x.productId) - 5)) })).filter((x) => x.qty > 0);
    if (!items.length) return;
    const o = run(DIST, d, 660, (c) => createOrderRequest(s, c, { items, note: 'Regular weekly order' }));
    const inv = run(ADMIN, d, 720, (c) => convertOrderRequest(s, c, o.id));
    run(ADMIN, d, 725, (c) => finalizeInvoice(s, c, inv.id));
    invoicesMade.push(inv.id);
  });
  on(addDays(today, -1), (d) =>
    void run(DIST, d, 640, (c) => createOrderRequest(s, c, { items: [{ productId: P.A!, qty: 60 }, { productId: P.C!, qty: 50 }, { productId: P.F!, qty: 24 }], note: 'Please deliver before the weekend' })),
  );

  // Execute the timeline.
  const pendingPayments: { due: ISODate; fn: (d: ISODate) => void }[] = [];
  for (let d = start; d < today; d = addDays(d, 1)) {
    const before = invoicesMade.length;
    for (const fn of sched[d] ?? []) fn(d);
    if (d === settleDay) settle(d);
    for (const id of invoicesMade.slice(before)) planPayment(id, d);
    for (const p of pendingPayments.filter((x) => x.due === d)) p.fn(d);
  }

  function planPayment(id: string, day: ISODate) {
    const inv = s.invoices.find((x) => x.id === id)!;
    if (inv.type === 'CASH') return;
    const ageAtToday = Math.round((Date.parse(today) - Date.parse(day)) / 86400000);
    const roll = r.next();
    const mode = r.pick(['UPI', 'BANK', 'CARD', 'CASH'] as const);
    const by = s.users.find((u) => u.id === inv.createdById)!;
    const payer = by.role === 'ADMIN' ? ADMIN : A(by);
    if (ageAtToday <= 15) {
      if (roll < 0.35) schedulePay(id, day, r.int(1, Math.max(1, ageAtToday - 1)), 1, mode, payer);
      return;
    }
    // Exactly a handful stay overdue: some unpaid, some partly paid.
    const makeOverdue = oldCandidates > 0 && r.next() < overdueLeft / oldCandidates;
    oldCandidates = Math.max(0, oldCandidates - 1);
    if (makeOverdue) {
      overdueLeft--;
      if (roll < 0.5) return;
      return schedulePay(id, day, r.int(3, 12), 0.4, mode, payer);
    }
    schedulePay(id, day, r.int(2, 14), 1, mode, payer);
  }

  function schedulePay(id: string, day: ISODate, after: number, frac: number, mode: 'UPI' | 'BANK' | 'CARD' | 'CASH', payer: Actor) {
    const due = addDays(day, after);
    if (due >= today) return;
    pendingPayments.push({
      due,
      fn: (d) => {
        const inv = s.invoices.find((x) => x.id === id)!;
        const out = outstanding(inv);
        if (out <= 0) return;
        const amount = frac >= 1 ? out : Math.round((out * frac) / 100) * 100;
        const onAccount = frac >= 1 && r.chance(0.12) && inv.customerId;
        run(payer, d, r.int(620, 1080), (c) =>
          recordPayment(s, c, { customerId: inv.customerId ?? '', invoiceId: onAccount ? undefined : inv.id, mode, amount, reference: mode === 'CASH' ? undefined : `REF${r.int(10000, 99999)}`, date: d }),
        );
      },
    });
  }

  s.notifications.forEach((n) => {
    if (n.at < istTimestamp(addDays(today, -3), 0)) n.read = true;
  });
  s.counters.__seed = SEED;
  return { state: s, audits, logins: logins.sort((a, b) => a.at.localeCompare(b.at)), events };
}
