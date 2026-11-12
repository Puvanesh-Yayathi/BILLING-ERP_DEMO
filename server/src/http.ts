import { createHash, randomUUID } from 'node:crypto';
import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { Hono, type Context } from 'hono';
import { z, ZodError, type ZodTypeAny } from 'zod';
import type { Role } from '@app/contract';
import { INSTANCE_ID } from './config.js';
import { makeCtx, type Actor, type Ctx } from './ctx.js';
import { AppError } from './errors.js';
import { flushRequestLog, logRequest } from './logs.js';
import { actorFromState, issueSession, readSession, shouldRefresh, type SessionClaims } from './middleware/auth.js';
import { claimIdempotency } from './middleware/idempotency.js';
import { hit } from './middleware/ratelimit.js';
import type { State } from './state.js';
import { store } from './store/index.js';
import { readState, transact } from './tx.js';

export type Vars = { requestId: string; actor: Actor | null; claims: SessionClaims | null; started: number };
export type AppContext = Context<{ Variables: Vars }>;

export const app = new Hono<{ Variables: Vars }>().basePath('/api/v1');
export const registry = new OpenAPIRegistry();

/** Routes that are polled often do not count toward the general per-user limit. */
const UNMETERED = new Set(['/api/v1/events', '/api/v1/presence/heartbeat', '/api/v1/healthz']);
let lastFlush = 0;

app.use('*', async (c, next) => {
  const requestId = c.req.header('x-request-id')?.slice(0, 64) || randomUUID();
  c.set('requestId', requestId);
  c.set('started', Date.now());
  c.set('actor', null);
  c.set('claims', null);
  c.header('x-request-id', requestId);
  c.header('x-instance-id', INSTANCE_ID);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin');
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
    if (origin && host && new URL(origin).host !== host) throw new AppError('FORBIDDEN', 'Cross-site requests are not allowed');
  }
  try {
    await next();
  } finally {
    const actor = c.get('actor');
    logRequest({
      at: new Date().toISOString(),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      ms: Date.now() - c.get('started'),
      requestId,
      netlifyRequestId: c.req.header('x-nf-request-id'),
      instanceId: INSTANCE_ID,
      userId: actor?.id,
    });
    if (Date.now() - lastFlush > 3000) {
      lastFlush = Date.now();
      await flushRequestLog(store()).catch(() => undefined);
    }
  }
});

function errorBody(c: AppContext, code: string, message: string, details?: unknown) {
  return { code, message, details, requestId: c.get('requestId') };
}

/** Plain-language field errors from zod. */
export function zodDetails(e: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of e.issues) {
    const k = i.path.join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

app.onError((err, c) => {
  const ctx = c as unknown as AppContext;
  if (err instanceof AppError) {
    if (err.retryAfter) c.header('Retry-After', String(err.retryAfter));
    return c.json(errorBody(ctx, err.code, err.message, err.details), err.status as 400);
  }
  if (err instanceof ZodError) {
    const details = zodDetails(err);
    return c.json(errorBody(ctx, 'VALIDATION', Object.values(details)[0] ?? 'Check the highlighted fields', details), 400);
  }
  console.error(JSON.stringify({ level: 'error', requestId: ctx.get('requestId'), message: err.message, stack: err.stack }));
  return c.json(errorBody(ctx, 'INTERNAL', 'Something went wrong on the server. Try again.', { error: err.message }), 500);
});

app.notFound((c) => c.json(errorBody(c as unknown as AppContext, 'NOT_FOUND', 'This API route does not exist'), 404));

type Infer<T> = T extends ZodTypeAny ? z.infer<T> : undefined;

export interface RouteArgs<B, Q> {
  c: AppContext;
  ctx: Ctx;
  actor: Actor;
  body: B;
  query: Q;
  param: (name: string) => string;
  read: () => Promise<State>;
  tx: <R>(fn: (s: State) => R) => Promise<R>;
}

export interface RouteDef<BS extends ZodTypeAny | undefined, QS extends ZodTypeAny | undefined> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  tag: string;
  roles: readonly Role[] | 'public' | 'any';
  body?: BS;
  query?: QS;
  /** 'export' routes have their own lower limit. */
  rate?: 'export';
  /** Mutations accept Idempotency-Key. */
  idempotent?: boolean;
  /** Conditional GET with ETag / 304 for lists. */
  etag?: boolean;
  status?: number;
}

async function authenticate(c: AppContext): Promise<{ actor: Actor; state: State } | null> {
  const claims = await readSession(c);
  if (!claims) return null;
  const { state } = await readState();
  const actor = actorFromState(state, claims);
  if (!actor) return null;
  c.set('claims', claims);
  c.set('actor', actor);
  if (shouldRefresh(claims)) {
    const u = state.users.find((x) => x.id === actor.id);
    if (u) await issueSession(c, u.id, u.tokenVersion, u.role);
  }
  return { actor, state };
}

export function route<BS extends ZodTypeAny | undefined = undefined, QS extends ZodTypeAny | undefined = undefined>(
  def: RouteDef<BS, QS>,
  handler: (a: RouteArgs<Infer<BS>, Infer<QS>>) => Promise<unknown> | unknown,
): void {
  const openPath = def.path.replace(/:(\w+)/g, '{$1}');
  const params = [...def.path.matchAll(/:(\w+)/g)].map((m) => m[1] as string);
  registry.registerPath({
    method: def.method,
    path: `/api/v1${openPath}`,
    summary: def.summary,
    tags: [def.tag],
    description: def.roles === 'public' ? 'Public' : def.roles === 'any' ? 'Any signed-in user' : `Roles: ${def.roles.join(', ')}`,
    request: {
      params: params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) : undefined,
      query: def.query && def.query instanceof z.ZodObject ? def.query : undefined,
      body: def.body ? { content: { 'application/json': { schema: def.body } } } : undefined,
    },
    responses: {
      [def.status ?? 200]: { description: 'Success' },
      400: { description: 'Validation error' },
      401: { description: 'Not signed in' },
      403: { description: 'Not allowed for this role' },
      404: { description: 'Not found' },
      409: { description: 'Conflict or stale If-Match' },
      429: { description: 'Rate limited, see Retry-After' },
    },
  });

  app.on(def.method.toUpperCase(), def.path, async (raw) => {
    const c = raw as unknown as AppContext;
    let actor: Actor | null = null;
    if (def.roles !== 'public') {
      const auth = await authenticate(c);
      if (!auth) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Sign in again.');
      actor = auth.actor;
      if (def.roles !== 'any' && !def.roles.includes(actor.role)) throw new AppError('FORBIDDEN', 'You do not have access to this action');
      const path = new URL(c.req.url).pathname;
      if (!UNMETERED.has(path)) {
        const { state } = await readState();
        await hit(store(), `api/${actor.id}`, state.settings.rateLimitApiPerMinute);
        if (def.rate === 'export') await hit(store(), `export/${actor.id}`, 20);
      }
    }
    const query = (def.query ? def.query.parse(c.req.query()) : undefined) as Infer<QS>;
    let body = undefined as Infer<BS>;
    if (def.body) {
      let json: unknown;
      try {
        json = await c.req.json();
      } catch {
        throw new AppError('VALIDATION', 'The request body is not valid JSON');
      }
      body = def.body.parse(json) as Infer<BS>;
    }
    const who: Actor = actor ?? { id: 'anonymous', name: 'Anonymous', role: 'STAFF' };
    const ctx = makeCtx(who, { ip: c.req.header('x-nf-client-connection-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1', requestId: c.get('requestId') });
    const args: RouteArgs<Infer<BS>, Infer<QS>> = {
      c,
      ctx,
      actor: who,
      body,
      query,
      param: (n) => c.req.param(n) ?? '',
      read: async () => (await readState()).state,
      tx: (fn) => transact(ctx, fn),
    };

    const idemKey = c.req.header('idempotency-key');
    if (def.idempotent && idemKey && actor) {
      const claim = await claimIdempotency(store(), actor.id, idemKey, `${def.method} ${def.path}`);
      if (claim.replay) {
        c.header('Idempotent-Replay', 'true');
        return c.json(claim.body as object, claim.status as 200);
      }
      try {
        const out = await handler(args);
        const status = def.status ?? 200;
        await claim.finish(status, out ?? { ok: true });
        return c.json((out ?? { ok: true }) as object, status as 200);
      } catch (e) {
        if (e instanceof AppError) await claim.finish(e.status, errorBody(c, e.code, e.message, e.details));
        else if (e instanceof ZodError) await claim.finish(400, errorBody(c, 'VALIDATION', 'Check the highlighted fields', zodDetails(e)));
        else await claim.finish(500, null);
        throw e;
      }
    }

    const out = await handler(args);
    if (out instanceof Response) return out;
    const payload = (out ?? { ok: true }) as object;
    if (def.method === 'get' && def.etag !== false) {
      const json = JSON.stringify(payload);
      const tag = `W/"${createHash('sha1').update(json).digest('base64url').slice(0, 20)}"`;
      c.header('ETag', tag);
      c.header('Cache-Control', 'private, no-cache');
      if (c.req.header('if-none-match') === tag) return c.body(null, 304);
      return c.body(json, 200, { 'content-type': 'application/json; charset=utf-8' });
    }
    return c.json(payload, (def.status ?? 200) as 200);
  });
}
