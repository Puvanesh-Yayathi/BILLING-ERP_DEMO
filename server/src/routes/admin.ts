import { createHash } from 'node:crypto';
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  CalendarBody,
  CompanyProfileBody,
  HolidayBody,
  LogoBody,
  ResetPasswordBody,
  SettingsBody,
  UserCreateBody,
  UserUpdateBody,
  WORKER_ROLES,
  WorkerCreateBody,
  WorkerUpdateBody,
  workingDaysInMonth,
} from '@app/contract';
import { config, INSTANCE_ID, INSTANCE_STARTED_AT } from '../config.js';
import { AppError, notFound } from '../errors.js';
import { registry, route } from '../http.js';
import { flushRequestLog, readAudit, readEvents, readLogins, readRequestLog } from '../logs.js';
import { calendarOf } from '../services/attendance.js';
import { outstandingAdvance } from '../services/payroll.js';
import { addHoliday, registerAsset, removeHoliday, updateCompanyProfile, updateSettings, updateWeeklyOffs } from '../services/settings.js';
import {
  activeWorkerLogins,
  createUser,
  createWorker,
  deactivateWorker,
  hashPassword,
  publicUser,
  resetPassword,
  updateUser,
  updateWorker,
} from '../services/users.js';
import { find, paginate } from '../services/util.js';
import type { State } from '../state.js';
import { store } from '../store/index.js';
import { loadSeed, readState, replaceState, stateBytes } from '../tx.js';
import { branding } from './auth.js';

const A = ['ADMIN'] as const;

function workerView(s: State, id: string) {
  const st = find(s.staff, id, 'Worker');
  const u = st.userId ? s.users.find((x) => x.id === st.userId) : undefined;
  return { ...st, login: u ? publicUser(u) : null, outstandingAdvance: outstandingAdvance(s, st.id) };
}

route({ method: 'get', path: '/workers', summary: 'Workers with login usage', tag: 'Workers', roles: A }, async ({ read }) => {
  const s = await read();
  return { items: s.staff.map((x) => workerView(s, x.id)), loginsUsed: activeWorkerLogins(s), maxWorkerLogins: s.settings.maxWorkerLogins };
});

route({ method: 'get', path: '/workers/check-login', summary: 'Live check that a login ID is free', tag: 'Workers', roles: A, query: z.object({ loginId: z.string() }), etag: false }, async ({ read, query }) => {
  const s = await read();
  return { available: !s.users.some((u) => u.username === query.loginId.toLowerCase()) };
});

route({ method: 'post', path: '/workers', summary: 'Create a worker with an optional login. Enforces maxWorkerLogins.', tag: 'Workers', roles: A, body: WorkerCreateBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => {
  const hash = body.withLogin && body.password ? hashPassword(body.password) : undefined;
  return tx((s) => workerView(s, createWorker(s, ctx, body, hash).staff.id));
});

route({ method: 'get', path: '/workers/:id', summary: 'Worker details', tag: 'Workers', roles: A }, async ({ read, param }) => workerView(await read(), param('id')));

route({ method: 'patch', path: '/workers/:id', summary: 'Edit pay type, rates, share percent, role', tag: 'Workers', roles: A, body: WorkerUpdateBody, idempotent: true }, async ({ body, tx, ctx, param }) =>
  tx((s) => {
    updateWorker(s, ctx, param('id'), body);
    return workerView(s, param('id'));
  }),
);

route({ method: 'post', path: '/workers/:id/reset-password', summary: 'Set a new password. Signs the worker out everywhere.', tag: 'Workers', roles: A, body: ResetPasswordBody }, async ({ body, tx, ctx, param }) => {
  const hash = hashPassword(body.password);
  return tx((s) => {
    const st = find(s.staff, param('id'), 'Worker');
    if (!st.userId) throw new AppError('VALIDATION', 'This worker has no login');
    return resetPassword(s, ctx, st.userId, hash);
  });
});

route({ method: 'post', path: '/workers/:id/deactivate', summary: 'Deactivate a worker and their login', tag: 'Workers', roles: A }, async ({ tx, ctx, param }) =>
  tx((s) => {
    deactivateWorker(s, ctx, param('id'));
    return workerView(s, param('id'));
  }),
);

route({ method: 'get', path: '/users', summary: 'Admin, Monitor, Collector and Distributor accounts', tag: 'Users', roles: A }, async ({ read }) => {
  const s = await read();
  return { items: s.users.filter((u) => !WORKER_ROLES.includes(u.role)).map(publicUser) };
});

route({ method: 'post', path: '/users', summary: 'Create an account', tag: 'Users', roles: A, body: UserCreateBody, idempotent: true, status: 201 }, async ({ body, tx, ctx }) => {
  const hash = hashPassword(body.password);
  return tx((s) => createUser(s, ctx, body, hash));
});

route({ method: 'patch', path: '/users/:id', summary: 'Edit an account or set its password', tag: 'Users', roles: A, body: UserUpdateBody }, async ({ body, tx, ctx, param }) => {
  const hash = body.password ? hashPassword(body.password) : undefined;
  return tx((s) => updateUser(s, ctx, param('id'), body, hash));
});

route({ method: 'get', path: '/settings', summary: 'Settings', tag: 'Settings', roles: A }, async ({ read }) => (await read()).settings);
route({ method: 'put', path: '/settings', summary: 'Change settings', tag: 'Settings', roles: A, body: SettingsBody }, async ({ body, tx, ctx }) => tx((s) => updateSettings(s, ctx, body)));

function calendarView(s: State, month: string) {
  const months = [0, 1, 2].map((i) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7);
    return { month: d, workingDays: workingDaysInMonth(d, calendarOf(s)) };
  });
  return { weeklyOffs: s.settings.weeklyOffs, holidays: s.holidays, months };
}

route({ method: 'get', path: '/calendar', summary: 'Weekly offs, holidays and working days', tag: 'Settings', roles: A, query: z.object({ month: z.string().optional() }) }, async ({ read, query, ctx }) =>
  calendarView(await read(), query.month ?? ctx.today.slice(0, 7)),
);
route({ method: 'put', path: '/calendar', summary: 'Set weekly off days', tag: 'Settings', roles: A, body: CalendarBody }, async ({ body, tx, ctx }) =>
  tx((s) => {
    updateWeeklyOffs(s, ctx, body.weeklyOffs);
    return calendarView(s, ctx.today.slice(0, 7));
  }),
);
route({ method: 'post', path: '/calendar/holidays', summary: 'Add a holiday', tag: 'Settings', roles: A, body: HolidayBody, status: 201 }, async ({ body, tx, ctx }) => tx((s) => addHoliday(s, ctx, body.date, body.name)));
route({ method: 'delete', path: '/calendar/holidays/:id', summary: 'Remove a holiday', tag: 'Settings', roles: A }, async ({ tx, ctx, param }) => tx((s) => removeHoliday(s, ctx, param('id'))));

route({ method: 'get', path: '/company-profile', summary: 'Current company profile and branding', tag: 'Company', roles: 'any' }, async ({ read }) => {
  const s = await read();
  return { profile: s.companyProfiles[s.companyProfiles.length - 1], branding: branding(s) };
});
route({ method: 'get', path: '/branding', summary: 'Public branding for the login page', tag: 'Company', roles: 'public' }, async ({ read }) => branding(await read()));
route({ method: 'put', path: '/company-profile', summary: 'Save the profile as a new version', tag: 'Company', roles: A, body: CompanyProfileBody }, async ({ body, tx, ctx }) => tx((s) => updateCompanyProfile(s, ctx, body)));
route({ method: 'get', path: '/company-profile/versions', summary: 'Profile history', tag: 'Company', roles: A }, async ({ read }) => {
  const s = await read();
  return { items: [...s.companyProfiles].reverse().map((p) => ({ ...p, createdBy: s.users.find((u) => u.id === p.createdById)?.name ?? 'System' })) };
});

/** The browser resizes the logo to 512 px and a 64 px favicon; the server checks type, size and dimensions. */
route({ method: 'post', path: '/assets/logo', summary: 'Upload a logo (checked and stored, a favicon is kept with it)', tag: 'Company', roles: A, body: LogoBody, status: 201 }, async ({ body, tx, ctx }) => {
  const bytes = Math.round((body.dataUrl.length * 3) / 4);
  if (bytes > 2 * 1024 * 1024) throw new AppError('VALIDATION', 'The logo must be 2 MB or smaller');
  if (body.dataUrl.startsWith('data:image/svg') && /<script|on\w+=/i.test(Buffer.from(body.dataUrl.split(',')[1] ?? '', 'base64').toString('utf8')))
    throw new AppError('VALIDATION', 'This SVG contains scripts and cannot be used');
  const sha = (v: string) => createHash('sha256').update(v).digest('hex');
  const mime = body.dataUrl.slice(5, body.dataUrl.indexOf(';'));
  const { logo, fav } = await tx((s) => ({
    logo: registerAsset(s, ctx, { kind: 'LOGO', mime, sha256: sha(body.dataUrl), width: body.width, height: body.height, bytes }),
    fav: registerAsset(s, ctx, { kind: 'FAVICON', mime: 'image/png', sha256: sha(body.faviconDataUrl), width: 64, height: 64, bytes: Math.round((body.faviconDataUrl.length * 3) / 4) }),
  }));
  await store().set(`asset/${logo.id}`, body.dataUrl);
  await store().set(`asset/${fav.id}`, body.faviconDataUrl);
  return { logoAssetId: logo.id, faviconAssetId: fav.id };
});

route({ method: 'get', path: '/assets/:id', summary: 'Logo or favicon image', tag: 'Company', roles: 'public' }, async ({ param, c }) => {
  const dataUrl = (await store().get<string>(`asset/${param('id')}`)).value;
  if (!dataUrl) throw notFound('Image');
  const [head, b64] = dataUrl.split(',');
  const mime = head?.slice(5, head.indexOf(';')) ?? 'image/png';
  return c.body(Buffer.from(b64 ?? '', 'base64'), 200, { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
});

const LogQuery = z.object({
  userId: z.string().optional(),
  entity: z.string().optional(),
  action: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().default(50),
  cursor: z.string().optional(),
});

route({ method: 'get', path: '/audit-log', summary: 'Append-only audit log with before and after', tag: 'Audit', roles: A, query: LogQuery }, async ({ query }) => {
  const all = await readAudit(store());
  const rows = all.filter(
    (a) =>
      (!query.userId || a.userId === query.userId) &&
      (!query.entity || a.entity === query.entity) &&
      (!query.action || a.action === query.action) &&
      (!query.from || a.at.slice(0, 10) >= query.from) &&
      (!query.to || a.at.slice(0, 10) <= query.to) &&
      (!query.q || `${a.summary} ${a.userName} ${a.entity}`.toLowerCase().includes(query.q.toLowerCase())),
  );
  return { ...paginate(rows, query.limit, query.cursor), entities: [...new Set(all.map((a) => a.entity))].sort(), actions: [...new Set(all.map((a) => a.action))].sort() };
});

route({ method: 'get', path: '/login-history', summary: 'Logins, failures, lockouts, logouts and timeouts', tag: 'Audit', roles: A, query: LogQuery.extend({ outcome: z.string().optional() }) }, async ({ query }) => {
  const rows = (await readLogins(store())).filter(
    (e) =>
      (!query.userId || e.userId === query.userId) &&
      (!query.outcome || e.outcome === query.outcome) &&
      (!query.from || e.at.slice(0, 10) >= query.from) &&
      (!query.to || e.at.slice(0, 10) <= query.to) &&
      (!query.q || `${e.username} ${e.ip}`.toLowerCase().includes(query.q.toLowerCase())),
  );
  return paginate(rows, query.limit, query.cursor);
});

route({ method: 'get', path: '/presence', summary: 'Who is online now', tag: 'Audit', roles: A, etag: false }, async ({ read }) => {
  const s = await read();
  const now = Date.now();
  const out: { userId: string; name: string; role: string; lastSeen: string; since: string; minutes: number }[] = [];
  for (const u of s.users) {
    const p = (await store().get<{ at: string; since: string }>(`presence/user/${u.id}`)).value;
    if (p && now - Date.parse(p.at) < 3 * 60000) out.push({ userId: u.id, name: u.name, role: u.role, lastSeen: p.at, since: p.since, minutes: Math.floor((now - Date.parse(p.since)) / 60000) });
  }
  return { items: out };
});

route({ method: 'get', path: '/system/status', summary: 'Instance, store and document size', tag: 'System', roles: A, etag: false }, async ({ read }) => {
  const s = await read();
  const ring = await readEvents(store(), 0);
  return {
    instanceId: INSTANCE_ID,
    instanceStartedAt: INSTANCE_STARTED_AT,
    store: store().kind,
    deployContext: config().deployContext,
    stateBytes: stateBytes(),
    stateHardCap: config().stateHardCap,
    seedVersion: s.meta.seedVersion,
    seededAt: s.meta.seededAt,
    eventSeq: ring.seq,
    counts: { invoices: s.invoices.length, payments: s.payments.length, indents: s.indents.length, payslips: s.payslips.length, users: s.users.length },
    node: process.version,
  };
});

route({ method: 'get', path: '/system/requests', summary: 'Request log with function instance ids', tag: 'System', roles: A, etag: false }, async () => {
  await flushRequestLog(store());
  return { items: await readRequestLog(store()) };
});

route({ method: 'get', path: '/openapi.json', summary: 'OpenAPI 3.1 document', tag: 'System', roles: A }, async () =>
  new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Billing and Management API (Demo Edition)', version: '1.0.0', description: 'Generated from the shared zod schemas.' },
    servers: [{ url: '/' }],
  }),
);

route({ method: 'post', path: '/admin/reset', summary: 'Restore the demo seed', tag: 'System', roles: A }, async () => {
  if (!config().resetEnabled) throw new AppError('FORBIDDEN', 'Reset is turned off for this deploy');
  const { etag } = await readState();
  const ok = await loadSeed(etag);
  if (!ok) throw new AppError('CONFLICT', 'The data changed while resetting. Try again.');
  return { ok: true };
});

route({ method: 'get', path: '/admin/export', summary: 'Export all demo data as JSON', tag: 'System', roles: A, rate: 'export', etag: false }, async ({ read }) => ({ exportedAt: new Date().toISOString(), state: await read() }));

route({ method: 'post', path: '/admin/import', summary: 'Replace the demo data with an export', tag: 'System', roles: A, body: z.object({ state: z.record(z.unknown()) }) }, async ({ body }) => {
  const next = body.state as unknown as State;
  const required: (keyof State)[] = ['meta', 'users', 'invoices', 'products', 'companyProfiles', 'settings'];
  for (const k of required) if (!(k in next)) throw new AppError('VALIDATION', `The file is missing "${k}". Use a file made by Export data.`);
  if (!next.users.some((u) => u.role === 'ADMIN' && u.active)) throw new AppError('VALIDATION', 'The file has no active admin account');
  const { etag } = await readState();
  if (!(await replaceState(next, etag))) throw new AppError('CONFLICT', 'The data changed while importing. Try again.');
  return { ok: true };
});
