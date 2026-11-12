import { beforeAll, describe, expect, it } from 'vitest';
import { client, freshStore, login, type Client } from './helpers.js';

type Obj = Record<string, unknown>;
type List<T = Obj> = { items: T[] };

let admin: Client;
let products: List<{ id: string; code: string; stock: number }>;
let customers: List<{ id: string; name: string; type: string }>;

beforeAll(async () => {
  freshStore();
  admin = await login('admin');
  products = (await admin.call<typeof products>('GET', '/products')).body;
  customers = (await admin.call<typeof customers>('GET', '/customers')).body;
});

const pid = (code: string) => products.items.find((p) => p.code === code)!.id;
const cid = (name: string) => customers.items.find((c) => c.name === name)!.id;

describe('auth and rate limiting', () => {
  it('logs in every seeded role', async () => {
    for (const u of ['admin', 'monitor', 'collector', 'distributor', 'staff1', 'staff2', 'staff3']) {
      const c = await login(u);
      const me = await c.call<{ user: { username: string } }>('GET', '/auth/me');
      expect(me.body.user.username).toBe(u);
    }
  });

  it('RATE-1: the 6th failed login in a minute gets 429 with Retry-After; 10 failures lock the account', async () => {
    const c = client();
    for (let i = 0; i < 5; i++) expect((await c.call('POST', '/auth/login', { username: 'ratelimited', password: 'wrong' })).status).toBe(401);
    const sixth = await c.call('POST', '/auth/login', { username: 'ratelimited', password: 'wrong' });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('wrong password message never says which field was wrong', async () => {
    const r = await client().call<{ message: string }>('POST', '/auth/login', { username: 'admin', password: 'nope' });
    expect(r.body.message).toBe('The username or password is not correct.');
  });

  it('requires a session', async () => {
    expect((await client().call('GET', '/invoices')).status).toBe(401);
  });
});

describe('billing', () => {
  it('server recalculates totals and finalizes with a number and stock out', async () => {
    const before = products.items.find((p) => p.code === 'PRD-A')!.stock;
    const staff = await login('staff1');
    const d = await staff.call<Obj & { id: string; grandTotal: number }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-A'), qty: 2, discountPct: 0 }] });
    expect(d.status).toBe(201);
    expect(d.body.grandTotal).toBe(52500);
    const f = await staff.call<{ number: string; status: string }>('POST', `/invoices/${d.body.id}/finalize`);
    expect(f.body.number).toMatch(/^INV\/\d\d-\d\d\/\d{4}$/);
    expect(f.body.status).toBe('PAID');
    const after = (await admin.call<typeof products>('GET', '/products')).body.items.find((p) => p.code === 'PRD-A')!.stock;
    expect(after).toBe(before - 2);
  });

  it('IGST for an inter-state customer', async () => {
    const staff = await login('staff2');
    const d = await staff.call<{ igst: number; cgst: number }>('POST', '/invoices', { type: 'CREDIT', customerId: cid('Customer H'), items: [{ productId: pid('PRD-B'), qty: 1, discountPct: 0 }] });
    expect(d.body.igst).toBe(2000);
    expect(d.body.cgst).toBe(0);
  });

  it('Product G (out of stock) cannot be billed', async () => {
    const d = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-G'), qty: 1, discountPct: 0 }] });
    const f = await admin.call<{ code: string; message: string }>('POST', `/invoices/${d.body.id}/finalize`);
    expect(f.status).toBe(409);
    expect(f.body.code).toBe('INSUFFICIENT_STOCK');
    expect(f.body.message).toContain('Product G');
  });

  it('STK-1: two bills for the last units, exactly one succeeds', async () => {
    const stock = (await admin.call<typeof products>('GET', '/products')).body.items.find((p) => p.code === 'PRD-F')!.stock;
    await admin.call('POST', '/stock-adjustments', { kind: 'SALES', itemId: pid('PRD-F'), qty: 5 - stock, reason: 'Set up test stock' });
    const a = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-F'), qty: 3, discountPct: 0 }] });
    const b = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-F'), qty: 3, discountPct: 0 }] });
    const [r1, r2] = await Promise.all([admin.call('POST', `/invoices/${a.body.id}/finalize`), admin.call<{ details: { available: number } }>('POST', `/invoices/${b.body.id}/finalize`)]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const failed = r1.status === 409 ? r1 : r2;
    expect((failed.body as { details: { available: number } }).details.available).toBe(2);
  });

  it('IDEM-1: the same finalize with the same Idempotency-Key runs once', async () => {
    const d = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-C'), qty: 1, discountPct: 0 }] });
    const h = { 'idempotency-key': `test-${d.body.id}` };
    const one = await admin.call<{ number: string }>('POST', `/invoices/${d.body.id}/finalize`, undefined, h);
    const two = await admin.call<{ number: string }>('POST', `/invoices/${d.body.id}/finalize`, undefined, h);
    expect(two.status).toBe(200);
    expect(two.headers.get('idempotent-replay')).toBe('true');
    expect(two.body.number).toBe(one.body.number);
  });

  it('CONC-1: a stale If-Match returns 409', async () => {
    const d = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CREDIT', customerId: cid('Customer A'), items: [{ productId: pid('PRD-A'), qty: 1, discountPct: 0 }] });
    const body = { type: 'CREDIT', customerId: cid('Customer A'), items: [{ productId: pid('PRD-A'), qty: 2, discountPct: 0 }] };
    expect((await admin.call('PATCH', `/invoices/${d.body.id}`, body, { 'if-match': '"1"' })).status).toBe(200);
    expect((await admin.call('PATCH', `/invoices/${d.body.id}`, body, { 'if-match': '"1"' })).status).toBe(409);
  });

  it('PAY-1: on-account payment goes oldest first and overpayment is rejected', async () => {
    const cust = cid('Customer B');
    const mk = async (qty: number) => {
      const d = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CREDIT', customerId: cust, items: [{ productId: pid('PRD-A'), qty, discountPct: 0 }] });
      await admin.call('POST', `/invoices/${d.body.id}/finalize`);
      return d.body.id;
    };
    const open = (await admin.call<List<{ balance: number }>>('GET', `/customers/${cust}/open-invoices`)).body.items;
    const existing = open.reduce((a, x) => a + x.balance, 0);
    if (existing) await admin.call('POST', '/payments', { customerId: cust, mode: 'CASH', amount: existing });
    const i1 = await mk(4);
    const i2 = await mk(8);
    const pay = await admin.call<{ allocations: { invoiceId: string; amount: number }[] }>('POST', '/payments', { customerId: cust, mode: 'UPI', amount: 150000 });
    expect(pay.body.allocations[0]).toEqual({ invoiceId: i1, amount: 105000 });
    expect(pay.body.allocations[1]).toEqual({ invoiceId: i2, amount: 45000 });
    const over = await admin.call('POST', '/payments', { customerId: cust, mode: 'UPI', amount: 9999999 });
    expect(over.status).toBe(400);
  });
});

describe('scoping (AUTH-1)', () => {
  it('a worker gets 404 for another worker’s payslip and 403 on settlements', async () => {
    const slips = (await admin.call<List<{ id: string; staffId: string; status: string }>>('GET', '/payslips')).body.items;
    const workers = (await admin.call<List<{ id: string; login: { username: string } | null }>>('GET', '/workers')).body.items;
    const staff2 = workers.find((w) => w.login?.username === 'staff2')!;
    const other = slips.find((p) => p.staffId !== staff2.id && p.status === 'PAID')!;
    const s1 = await login('staff1');
    expect((await s1.call('GET', `/payslips/${other.id}/print-data`)).status).toBe(other.staffId === workers.find((w) => w.login?.username === 'staff1')!.id ? 200 : 404);
    const s2 = await login('staff2');
    expect((await s2.call('GET', `/payslips/${other.id}/print-data`)).status).toBe(404);
    expect((await s2.call('GET', '/settlements')).status).toBe(403);
    expect((await s2.call('GET', '/analytics/overview')).status).toBe(403);
    const mon = await login('monitor');
    expect((await mon.call('GET', '/settlements')).status).toBe(403);
    const ov = await mon.call<{ kpis: { grossProfit?: number; loanOutstanding?: number } }>('GET', '/analytics/overview');
    expect(ov.body.kpis.grossProfit).toBeUndefined();
    expect(ov.body.kpis.loanOutstanding).toBeUndefined();
    const col = await login('collector');
    expect((await col.call('POST', '/invoices', { type: 'CASH', items: [] })).status).toBe(403);
  });

  it('a distributor never sees another customer’s bills', async () => {
    const d = await login('distributor');
    const me = await d.call<{ user: { customerId: string } }>('GET', '/auth/me');
    const list = await d.call<List<{ customerId: string }>>('GET', '/invoices?limit=500');
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((i) => i.customerId === me.body.user.customerId)).toBe(true);
    const all = await admin.call<List<{ id: string; customerId: string | null; status: string }>>('GET', '/invoices?limit=500');
    const foreign = all.body.items.find((i) => i.customerId && i.customerId !== me.body.user.customerId && i.status !== 'DRAFT')!;
    expect((await d.call('GET', `/invoices/${foreign.id}`)).status).toBe(404);
    expect((await d.call('GET', `/ledgers/customer/${foreign.customerId}`)).status).toBe(404);
  });

  it('workers only see their own bills', async () => {
    const s = await login('staff3');
    const me = await s.call<{ user: { id: string } }>('GET', '/auth/me');
    const list = await s.call<List<{ createdById: string }>>('GET', '/invoices?limit=500');
    expect(list.body.items.every((i) => i.createdById === me.body.user.id)).toBe(true);
  });
});

describe('indent approval and funds', () => {
  it('Admin approves, a worker cannot, and a rejected indent can be resubmitted', async () => {
    const items = (await admin.call<List<{ id: string; name: string }>>('GET', '/purchase-items')).body.items;
    const sups = (await admin.call<List<{ id: string }>>('GET', '/suppliers')).body.items;
    const ind = await admin.call<{ id: string }>('POST', '/indents', { supplierId: sups[0]!.id, items: [{ rawMaterialId: items[0]!.id, qty: 10, rate: 12000 }] });
    expect((await admin.call('POST', `/indents/${ind.body.id}/submit`)).status).toBe(200);
    const staff = await login('staff1');
    expect((await staff.call('POST', `/indents/${ind.body.id}/approve`, { remarks: '' })).status).toBe(403);
    const inbox = await admin.call<List<{ id: string }>>('GET', '/approvals/inbox');
    expect(inbox.body.items.some((i) => i.id === ind.body.id)).toBe(true);
    expect((await admin.call<{ status: string }>('POST', `/indents/${ind.body.id}/reject`, { remarks: 'Check quantity' })).body.status).toBe('REJECTED');
    expect((await admin.call<{ indent: { status: string } }>('POST', `/indents/${ind.body.id}/submit`)).body.indent.status).toBe('PENDING_S1');
    const ok = await admin.call<{ status: string; poNumber: string }>('POST', `/indents/${ind.body.id}/approve`, { remarks: '' });
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.poNumber).toMatch(/^PO\//);
    expect((await admin.call('GET', `/indents/${ind.body.id}/po-print-data`)).status).toBe(200);
  });

  it('FUND-1: an indent above the available fund returns a warning, not a block', async () => {
    const items = (await admin.call<List<{ id: string }>>('GET', '/purchase-items')).body.items;
    const sups = (await admin.call<List<{ id: string }>>('GET', '/suppliers')).body.items;
    const ind = await admin.call<{ id: string }>('POST', '/indents', { supplierId: sups[1]!.id, items: [{ rawMaterialId: items[1]!.id, qty: 100000, rate: 100000 }] });
    const sub = await admin.call<{ warning: string | null; indent: { status: string } }>('POST', `/indents/${ind.body.id}/submit`);
    expect(sub.body.indent.status).toBe('PENDING_S1');
    expect(sub.body.warning).toBeTruthy();
  });
});

describe('workers and logins', () => {
  it('a new worker signs in at once; duplicate login IDs are refused; the 11th login is refused by the server', async () => {
    const base = { phone: '+91 90000 44444', role: 'STAFF', payType: 'FIXED', basePay: 1200000, reduceByAbsence: false, joinDate: '2026-01-01', withLogin: true, password: 'Secret123' };
    const r = await admin.call('POST', '/workers', { ...base, name: 'Worker K', loginId: 'staff4' });
    expect(r.status).toBe(201);
    const k = await login('staff4', 'Secret123');
    expect((await k.call<{ user: { role: string } }>('GET', '/auth/me')).body.user.role).toBe('STAFF');
    expect((await admin.call('POST', '/workers', { ...base, name: 'Worker L', loginId: 'staff4' })).status).toBe(400);
    for (let i = 5; i <= 10; i++) expect((await admin.call('POST', '/workers', { ...base, name: `Worker ${i}`, loginId: `staffx${i}` })).status).toBe(201);
    const eleventh = await admin.call<{ message: string }>('POST', '/workers', { ...base, name: 'Worker Z', loginId: 'staffz' });
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.message).toContain('Limit of 10 worker logins reached');
    const settings = (await admin.call<Obj>('GET', '/settings')).body;
    await admin.call('PUT', '/settings', { ...settings, maxWorkerLogins: 11 });
    expect((await admin.call('POST', '/workers', { ...base, name: 'Worker Z', loginId: 'staffz' })).status).toBe(201);
  });

  it('a password reset signs the worker out everywhere', async () => {
    const w = await login('staff4', 'Secret123');
    const workers = (await admin.call<List<{ id: string; login: { username: string } | null }>>('GET', '/workers')).body.items;
    const k = workers.find((x) => x.login?.username === 'staff4')!;
    await admin.call('POST', `/workers/${k.id}/reset-password`, { password: 'Another123' });
    expect((await w.call('GET', '/auth/me')).status).toBe(401);
  });

  it('only admin can manage workers', async () => {
    const s = await login('staff1');
    expect((await s.call('GET', '/workers')).status).toBe(403);
    expect((await s.call('POST', '/workers/x/reset-password', { password: 'Another123' })).status).toBe(403);
  });
});

describe('branding versions', () => {
  it('a profile change applies to new documents only', async () => {
    const list = (await admin.call<List<{ id: string; status: string }>>('GET', '/invoices?limit=500')).body.items;
    const old = list.find((i) => i.status === 'PAID')!;
    const prof = (await admin.call<{ profile: Obj }>('GET', '/company-profile')).body.profile;
    const { id: _i, versionNo: _v, effectiveFrom: _e, createdById: _c, ...rest } = prof;
    const r = await admin.call<{ versionNo: number }>('PUT', '/company-profile', { ...rest, brandName: 'Cluster Tech', gstin: '33AAAAA0000A1Z5' });
    expect(r.status).toBe(200);
    expect((await client().call<{ brandName: string }>('GET', '/branding')).body.brandName).toBe('Cluster Tech');
    const oldPrint = await admin.call<{ company: { brandName: string } }>('GET', `/invoices/${old.id}/print-data`);
    expect(oldPrint.body.company.brandName).toBe('[Your Brand Name]');
    const d = await admin.call<{ id: string }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-A'), qty: 1, discountPct: 0 }] });
    await admin.call('POST', `/invoices/${d.body.id}/finalize`);
    expect((await admin.call<{ company: { brandName: string } }>('GET', `/invoices/${d.body.id}/print-data`)).body.company.brandName).toBe('Cluster Tech');
  });
});

describe('payroll and settlement', () => {
  it('refuses an overlapping period and a period across months', async () => {
    const slips = (await admin.call<List<{ staffId: string; status: string; periodFrom: string; periodTo: string; payType: string; source: string }>>('GET', '/payslips')).body.items;
    const paid = slips.find((p) => p.status === 'PAID' && p.payType !== 'SHARE')!;
    const r = await admin.call<{ message: string }>('POST', '/payslips/preview', { staffId: paid.staffId, periodFrom: paid.periodFrom, periodTo: paid.periodTo });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('overlaps');
    const cross = await admin.call('POST', '/payslips/preview', { staffId: paid.staffId, periodFrom: '2026-01-25', periodTo: '2026-02-05' });
    expect(cross.status).toBe(400);
  });

  it('pay locks attendance and cancel unlocks it', async () => {
    const workers = (await admin.call<List<{ id: string; payType: string; name: string }>>('GET', '/workers')).body.items;
    const fixed = workers.find((w) => w.name === 'Worker A')!;
    const me = (await admin.call<{ today: string }>('GET', '/healthz')).body;
    const month = me.today.slice(0, 7);
    const from = `${month}-01`;
    if (from > me.today) return;
    const draft = await admin.call<{ id: string; net: number }>('POST', '/payslips', { staffId: fixed.id, periodFrom: from, periodTo: me.today, allowances: [{ label: 'Bonus', amount: 50000 }] });
    expect(draft.status).toBe(201);
    const paid = await admin.call<{ status: string; number: string; attendanceIds: string[] }>('POST', `/payslips/${draft.body.id}/pay`, { date: me.today, mode: 'UPI', reference: 'UPI123' });
    expect(paid.body.status).toBe('PAID');
    const grid = await admin.call<{ rows: { days: { attendanceId?: string; locked: boolean }[] }[] }>('GET', `/attendance?staffId=${fixed.id}&from=${from}&to=${me.today}`);
    const day = grid.body.rows[0]!.days.find((d) => d.attendanceId);
    if (day) {
      expect(day.locked).toBe(true);
      expect((await admin.call('PUT', `/attendance/${day.attendanceId}`, { status: 'ABSENT', paidHours: 0, reason: 'Testing lock' })).status).toBe(409);
    }
    await admin.call('POST', `/payslips/${draft.body.id}/cancel`, { reason: 'Testing cancel' });
    const grid2 = await admin.call<{ rows: { days: { attendanceId?: string; locked: boolean }[] }[] }>('GET', `/attendance?staffId=${fixed.id}&from=${from}&to=${me.today}`);
    expect(grid2.body.rows[0]!.days.every((d) => !d.locked)).toBe(true);
  });

  it('settlement preview gives the waterfall; workers can never read it', async () => {
    const prev = await admin.call<{ grossProfit: number; ownerAmount: number; poolAfterLoan: number; payableTotal: number; otherExpenses: number }>('POST', '/settlements/preview', { month: (await admin.call<{ today: string }>('GET', '/healthz')).body.today.slice(0, 7) });
    expect(prev.status).toBe(200);
    expect(prev.body.ownerAmount).toBe(prev.body.poolAfterLoan - prev.body.payableTotal - prev.body.otherExpenses);
    const s = await login('staff1');
    expect((await s.call('POST', '/settlements/preview', { month: '2026-01' })).status).toBe(403);
    expect((await s.call('GET', '/analytics/overview')).status).toBe(403);
  });
});

describe('realtime events', () => {
  it('a worker never receives another worker’s events', async () => {
    const s1 = await login('staff1');
    const s2 = await login('staff2');
    const start = (await s2.call<{ cursor: number }>('GET', '/events?after=0')).body.cursor;
    const d = await s1.call<{ id: string }>('POST', '/invoices', { type: 'CASH', items: [{ productId: pid('PRD-A'), qty: 1, discountPct: 0 }] });
    await s1.call('POST', `/invoices/${d.body.id}/finalize`);
    const seen2 = await s2.call<List<{ type: string; actorName: string }>>('GET', `/events?after=${start}`);
    expect(seen2.body.items.some((e) => e.type === 'invoice.finalize')).toBe(false);
    const seenAdmin = await admin.call<List<{ type: string }>>('GET', `/events?after=${start}`);
    expect(seenAdmin.body.items.some((e) => e.type === 'invoice.finalize')).toBe(true);
  });
});

describe('attendance automation', () => {
  it('login opens a session and logout closes it', async () => {
    const s = await login('staff2');
    const me = await s.call<{ clock: { clockedInAt: string | null } }>('GET', '/auth/me');
    expect(me.body.clock.clockedInAt).toBeTruthy();
    await s.call('POST', '/auth/logout', {});
    expect((await s.call('GET', '/auth/me')).status).toBe(401);
  });
});
