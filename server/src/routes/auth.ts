import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { LoginBody, toISTDate, type MeResponse } from '@app/contract';
import { makeCtx, SYSTEM_ACTOR, type Actor } from '../ctx.js';
import { AppError } from '../errors.js';
import { route, type AppContext } from '../http.js';
import { appendLogin, loginEvent } from '../logs.js';
import { actorFromState, clearSession, issueSession, readSession } from '../middleware/auth.js';
import { loginFailed, loginGate, loginSucceeded } from '../middleware/ratelimit.js';
import { clockToday, closeSessions, startSession, sweepSessions } from '../services/attendance.js';
import { publicUser } from '../services/users.js';
import { currentProfile } from '../services/util.js';
import type { State } from '../state.js';
import { store } from '../store/index.js';
import { readState, transact } from '../tx.js';

function clientInfo(c: AppContext) {
  return {
    ip: c.req.header('x-nf-client-connection-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1',
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 160),
  };
}

export async function presenceOf(staffId: string): Promise<string | undefined> {
  return (await store().get<string>(`presence/staff/${staffId}`)).value ?? undefined;
}

export function branding(s: State) {
  const p = currentProfile(s);
  return {
    brandName: p.brandName,
    logoDataUrl: p.logoAssetId ? `/api/v1/assets/${p.logoAssetId}` : undefined,
    faviconDataUrl: p.faviconAssetId ? `/api/v1/assets/${p.faviconAssetId}` : undefined,
    versionNo: p.versionNo,
  };
}

export async function meFor(s: State, actor: Actor): Promise<MeResponse> {
  const u = s.users.find((x) => x.id === actor.id);
  if (!u) throw new AppError('UNAUTHENTICATED', 'Sign in again');
  const staff = u.staffId ? s.staff.find((x) => x.id === u.staffId) : undefined;
  const presence = staff ? await presenceOf(staff.id) : undefined;
  return {
    user: publicUser(u),
    branding: branding(s),
    staff: staff ? { id: staff.id, name: staff.name, payType: staff.payType } : undefined,
    clock: staff ? clockToday(s, staff.id, new Date().toISOString(), presence) : undefined,
    idleTimeoutMinutes: s.settings.idleTimeoutMinutes,
  };
}

route({ method: 'post', path: '/auth/login', summary: 'Sign in. Starts attendance for Staff and Operating.', tag: 'Auth', roles: 'public', body: LoginBody }, async ({ c, body }) => {
  const st = store();
  const { state } = await readState();
  const info = clientInfo(c);
  const at = () => new Date().toISOString();
  await loginGate(st, body.username, state.settings.rateLimitLoginPerMinute).catch(async (e: unknown) => {
    if (e instanceof AppError && e.code === 'LOCKED')
      await appendLogin(st, [loginEvent({ username: body.username.toLowerCase(), outcome: 'LOCKED', ...info, at: at() })]);
    throw e;
  });
  const u = state.users.find((x) => x.username === body.username.toLowerCase());
  const ok = !!u && u.active && bcrypt.compareSync(body.password, u.passwordHash);
  if (!ok || !u) {
    const locked = await loginFailed(st, body.username);
    await appendLogin(st, [loginEvent({ userId: u?.id, username: body.username.toLowerCase(), outcome: locked ? 'LOCKED' : 'FAILED', ...info, at: at() })]);
    throw new AppError('UNAUTHENTICATED', 'The username or password is not correct.');
  }
  await loginSucceeded(st, body.username);
  const actor: Actor = { id: u.id, name: u.name, role: u.role, staffId: u.staffId, customerId: u.customerId };
  let s = state;
  if (u.staffId && (u.role === 'STAFF' || u.role === 'OPERATING')) {
    const ctx = makeCtx(actor, { ip: info.ip, requestId: c.get('requestId') });
    s = await transact(ctx, (draft) => {
      const staff = draft.staff.find((x) => x.id === u.staffId);
      if (staff) startSession(draft, ctx, staff);
      return draft;
    });
    await st.set(`presence/staff/${u.staffId}`, ctx.now);
  }
  await st.set(`presence/user/${u.id}`, { at: at(), since: at() });
  await appendLogin(st, [loginEvent({ userId: u.id, username: u.username, outcome: 'SUCCESS', ...info, at: at() })]);
  await issueSession(c, u.id, u.tokenVersion, u.role);
  c.set('actor', actor);
  return meFor(s, actor);
});

route(
  { method: 'post', path: '/auth/logout', summary: 'Sign out. Closes the open attendance session.', tag: 'Auth', roles: 'any', body: z.object({ reason: z.enum(['LOGOUT', 'TIMEOUT']).default('LOGOUT') }) },
  async ({ c, actor, ctx, body }) => {
    const info = clientInfo(c);
    if (actor.staffId) {
      const presence = await presenceOf(actor.staffId);
      await transact(ctx, (s) => closeSessions(s, actor.staffId as string, ctx.now, body.reason === 'TIMEOUT' ? 'IDLE_TIMEOUT' : 'LOGOUT', presence));
    }
    await store().delete(`presence/user/${actor.id}`);
    const u = (await readState()).state.users.find((x) => x.id === actor.id);
    await appendLogin(store(), [loginEvent({ userId: actor.id, username: u?.username ?? '', outcome: body.reason === 'TIMEOUT' ? 'TIMEOUT' : 'LOGOUT', ...info, at: ctx.now })]);
    clearSession(c);
    return { ok: true };
  },
);

route({ method: 'get', path: '/auth/session', summary: 'Current session or null (no 401 before sign-in)', tag: 'Auth', roles: 'public', etag: false }, async ({ c }) => {
  const claims = await readSession(c);
  if (!claims) return { me: null };
  const { state } = await readState();
  const actor = actorFromState(state, claims);
  if (!actor) {
    clearSession(c);
    return { me: null };
  }
  c.set('actor', actor);
  return { me: await meFor(state, actor) };
});

route({ method: 'get', path: '/auth/me', summary: 'Current user, role and company branding', tag: 'Auth', roles: 'any', etag: false }, async ({ read, actor }) => meFor(await read(), actor));

route(
  { method: 'post', path: '/presence/heartbeat', summary: 'Sent every 60 s while the user is active. Keeps attendance open.', tag: 'Auth', roles: 'any' },
  async ({ actor, read }) => {
    const now = new Date().toISOString();
    const prev = (await store().get<{ at: string; since: string }>(`presence/user/${actor.id}`)).value;
    await store().set(`presence/user/${actor.id}`, { at: now, since: prev?.since ?? now });
    if (actor.staffId) await store().set(`presence/staff/${actor.staffId}`, now);
    const s = await read();
    return { ok: true, clock: actor.staffId ? clockToday(s, actor.staffId, now, now) : null };
  },
);

/** Sweeper body, shared by the scheduled function and local development. */
export async function runSweep(nowIso = new Date().toISOString()): Promise<{ closed: number }> {
  const st = store();
  const { state } = await readState();
  const open = state.sessions.filter((x) => !x.logoutAt);
  if (!open.length) return { closed: 0 };
  const presence: Record<string, string> = {};
  for (const sess of open) {
    const p = await presenceOf(sess.staffId);
    if (p) presence[sess.staffId] = p;
  }
  const ctx = makeCtx(SYSTEM_ACTOR, { now: nowIso, requestId: `sweep-${Date.now()}` });
  const { closed } = await transact(ctx, (s) => sweepSessions(s, nowIso, presence));
  if (closed.length) {
    const users = state.users.filter((u) => u.staffId && closed.includes(u.staffId));
    await appendLogin(st, users.map((u) => loginEvent({ userId: u.id, username: u.username, outcome: 'TIMEOUT', ip: 'scheduler', userAgent: 'Session sweeper', at: nowIso })));
  }
  return { closed: closed.length };
}

route({ method: 'get', path: '/healthz', summary: 'Health check', tag: 'System', roles: 'public', etag: false }, async () => ({
  ok: true,
  today: toISTDate(new Date()),
}));
