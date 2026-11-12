import { config } from './config.js';
import type { Ctx } from './ctx.js';
import { AppError } from './errors.js';
import { appendAudit, appendEvents, appendLogin } from './logs.js';
import { buildSeed } from './seed/index.js';
import type { State } from './state.js';
import { store } from './store/index.js';

const STATE_KEY = 'state';
let cache: { etag: string; state: State; bytes: number } | null = null;

export function stateBytes(): number {
  return cache?.bytes ?? 0;
}

async function ensureSeeded(): Promise<void> {
  const s = store();
  if (await s.etag(STATE_KEY)) return;
  // SEED_NOW pins the seed date (used by visual tests so documents are identical every run).
  await loadSeed(null, process.env.SEED_NOW || undefined);
}

/** Write a fresh seed. expectEtag null = only if empty; otherwise replaces the given version. */
export async function loadSeed(expectEtag: string | null, now = new Date().toISOString()): Promise<boolean> {
  const s = store();
  const seed = buildSeed(now, config().seedVersion);
  const w = await s.setIfMatch(STATE_KEY, seed.state, expectEtag);
  if (!w.ok) return false;
  cache = null;
  for (const k of ['audit', 'logins']) {
    for (const key of await s.list(`${k}/`)) await s.delete(key);
  }
  await s.delete('events');
  await appendAudit(s, seed.audits);
  await appendLogin(s, seed.logins);
  await appendEvents(s, seed.events.filter((e) => e.type !== 'attendance.clockin').slice(-40));
  return true;
}

/** Strong read of the state document, reusing the parsed copy when the version is unchanged. */
export async function readState(): Promise<{ state: State; etag: string }> {
  await ensureSeeded();
  const s = store();
  const etag = await s.etag(STATE_KEY);
  if (cache && etag && cache.etag === etag) return { state: cache.state, etag };
  const r = await s.get<State>(STATE_KEY);
  if (!r.value || !r.etag) throw new AppError('INTERNAL', 'Demo data is not available');
  cache = { etag: r.etag, state: r.value, bytes: JSON.stringify(r.value).length };
  return { state: r.value, etag: r.etag };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One business operation = one atomic transaction: strong read, apply service logic,
 * compare-and-set write, retry with jitter up to 5 times. Audit entries and events are
 * flushed after the commit.
 */
export async function transact<R>(ctx: Ctx, fn: (s: State) => R): Promise<R> {
  const s = store();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag } = await readState();
    const draft = structuredClone(state);
    ctx.audits = [];
    ctx.events = [];
    const result = fn(draft);
    const json = JSON.stringify(draft);
    if (json.length > config().stateHardCap)
      throw new AppError('STORE_FULL', 'The demo data store is full. Ask the administrator to reset the demo data.');
    const w = await s.setIfMatch(STATE_KEY, draft, etag);
    if (w.ok) {
      if (w.etag) cache = { etag: w.etag, state: draft, bytes: json.length };
      await Promise.all([appendAudit(s, ctx.audits), appendEvents(s, ctx.events)]);
      return result;
    }
    lastErr = new AppError('CONFLICT', 'The data changed while saving. Try again.');
    await sleep(15 + Math.random() * 40 * (attempt + 1));
  }
  throw lastErr;
}

export async function replaceState(next: State, expectEtag: string): Promise<boolean> {
  const w = await store().setIfMatch(STATE_KEY, next, expectEtag);
  if (w.ok) cache = null;
  return w.ok;
}

export function resetCache(): void {
  cache = null;
}
