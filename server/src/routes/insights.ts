import { z } from 'zod';
import { REPORTS, addDays, canReport } from '@app/contract';
import { route } from '../http.js';
import { readEvents } from '../logs.js';
import { companyOverview, explorerPurchases, explorerSales, myOverview, type Period } from '../services/analytics.js';
import { runReport } from '../services/reports.js';
import { paginate } from '../services/util.js';
import { store } from '../store/index.js';

const PeriodQuery = z.object({ period: z.enum(['day', 'week', 'month', 'year']).default('month'), date: z.string().optional(), compare: z.enum(['true', 'false']).default('true') });

route({ method: 'get', path: '/analytics/overview', summary: 'Company analytics (profit and loan for Admin only)', tag: 'Analytics', roles: ['ADMIN', 'MONITOR', 'COLLECTOR'], query: PeriodQuery }, async ({ read, query, ctx }) =>
  companyOverview(await read(), ctx, query.period as Period, query.date ?? ctx.today, query.compare === 'true'),
);
route({ method: 'get', path: '/my/analytics', summary: 'Own work only, same periods', tag: 'Analytics', roles: ['STAFF', 'OPERATING'], query: PeriodQuery }, async ({ read, query, ctx }) =>
  myOverview(await read(), ctx, query.period as Period, query.date ?? ctx.today, query.compare === 'true'),
);

const ExplorerQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  createdById: z.string().optional(),
  customerId: z.string().optional(),
  supplierId: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
  groupBy: z.enum(['worker', 'none']).default('none'),
  limit: z.coerce.number().default(100),
  cursor: z.string().optional(),
});

function group<T extends { createdById: string; createdBy: string; total: number }>(rows: T[]) {
  const m = new Map<string, { workerId: string; worker: string; count: number; total: number }>();
  for (const r of rows) {
    const g = m.get(r.createdById) ?? { workerId: r.createdById, worker: r.createdBy, count: 0, total: 0 };
    g.count++;
    g.total += r.total;
    m.set(r.createdById, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

route({ method: 'get', path: '/explorer/sales', summary: 'All sales bills, overall or worker-wise', tag: 'Explorer', roles: ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR'], query: ExplorerQuery }, async ({ read, query, ctx }) => {
  const s = await read();
  const from = query.from ?? addDays(ctx.today, -29);
  const to = query.to ?? ctx.today;
  const rows = explorerSales(s, ctx, { ...query, from, to });
  const live = rows.filter((r) => r.status !== 'CANCELLED' && r.status !== 'DRAFT');
  return {
    from,
    to,
    ...paginate(rows, query.limit, query.cursor),
    totals: { count: live.length, taxable: live.reduce((a, r) => a + r.taxable, 0), tax: live.reduce((a, r) => a + r.tax, 0), total: live.reduce((a, r) => a + r.total, 0), balance: live.reduce((a, r) => a + r.balance, 0) },
    groups: query.groupBy === 'worker' ? group(live) : [],
    workers: ctx.actor.role === 'STAFF' || ctx.actor.role === 'OPERATING' ? [] : s.users.filter((u) => ['ADMIN', 'STAFF', 'OPERATING'].includes(u.role)).map((u) => ({ id: u.id, name: u.name })),
  };
});
route({ method: 'get', path: '/explorer/purchases', summary: 'All purchase bills, overall or worker-wise', tag: 'Explorer', roles: ['ADMIN', 'OPERATING', 'MONITOR', 'COLLECTOR'], query: ExplorerQuery }, async ({ read, query, ctx }) => {
  const s = await read();
  const from = query.from ?? addDays(ctx.today, -59);
  const to = query.to ?? ctx.today;
  const rows = explorerPurchases(s, ctx, { ...query, from, to });
  return {
    from,
    to,
    ...paginate(rows, query.limit, query.cursor),
    totals: { count: rows.length, total: rows.reduce((a, r) => a + r.total, 0) },
    groups: query.groupBy === 'worker' ? group(rows) : [],
  };
});

route({ method: 'get', path: '/reports', summary: 'Reports available to the caller', tag: 'Reports', roles: 'any' }, async ({ ctx }) => ({ items: REPORTS.filter((r) => canReport(ctx.actor.role, r.key)).map((r) => ({ key: r.key, title: r.title })) }));
route({ method: 'get', path: '/reports/:key', summary: 'Run a report (12 keys, matrix in doc 09)', tag: 'Reports', roles: 'any', rate: 'export', query: z.object({ from: z.string().optional(), to: z.string().optional() }) }, async ({ read, param, query, ctx }) =>
  runReport(await read(), ctx, param('key'), query.from ?? `${ctx.today.slice(0, 7)}-01`, query.to ?? ctx.today),
);

route({ method: 'get', path: '/notifications', summary: 'Own notifications', tag: 'Notifications', roles: 'any', etag: false }, async ({ read, ctx }) => {
  const s = await read();
  const mine = s.notifications.filter((n) => n.userId === ctx.actor.id).sort((a, b) => b.at.localeCompare(a.at));
  return { items: mine.slice(0, 40), unread: mine.filter((n) => !n.read).length };
});
route({ method: 'post', path: '/notifications/:id/read', summary: 'Mark one read (or "all")', tag: 'Notifications', roles: 'any' }, async ({ tx, param, ctx }) =>
  tx((s) => {
    for (const n of s.notifications) if (n.userId === ctx.actor.id && (param('id') === 'all' || n.id === param('id'))) n.read = true;
    return { ok: true };
  }),
);
route({ method: 'get', path: '/outbox', summary: 'Simulated emails', tag: 'Notifications', roles: ['ADMIN'] }, async ({ read }) => ({ items: [...(await read()).outbox].reverse() }));

/** Realtime by polling: role and ownership filtered so a worker never receives another worker's events. */
route({ method: 'get', path: '/events', summary: 'Events after a cursor (polled every 2 s)', tag: 'Realtime', roles: 'any', query: z.object({ after: z.coerce.number().default(0) }), etag: false }, async ({ query, ctx }) => {
  const { seq, items } = await readEvents(store(), query.after);
  const role = ctx.actor.role;
  const visible = items.filter((e) => role === 'ADMIN' || e.audience.includes('*') || e.audience.includes(`role:${role}`) || e.audience.includes(`user:${ctx.actor.id}`));
  return { cursor: seq, items: query.after === 0 ? visible.slice(-25) : visible };
});
