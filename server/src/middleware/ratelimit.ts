import { AppError } from '../errors.js';
import { ABORT, casUpdate, type DataStore } from '../store/index.js';

/**
 * App-level limiter (the second layer after the Netlify platform rule).
 * Fixed one-minute windows with counters in the store, so all function instances share them.
 */
export async function hit(s: DataStore, bucket: string, limit: number, nowMs = Date.now()): Promise<void> {
  const win = Math.floor(nowMs / 60000);
  const key = `rl/${bucket}/${win}`;
  const count = await casUpdate<number, number>(s, key, (cur) => ({ next: (cur ?? 0) + 1, result: (cur ?? 0) + 1 }), 6);
  if (count === ABORT) return;
  if (count > limit) {
    const retryAfter = Math.max(1, 60 - Math.floor((nowMs % 60000) / 1000));
    throw new AppError('RATE_LIMITED', `Too many requests. Try again in ${retryAfter} seconds.`, { retryAfter }, retryAfter);
  }
}

interface FailState {
  count: number;
  first: number;
  lockedUntil?: number;
}

const LOCK_MS = 15 * 60000;
const LOCK_AFTER = 10;

/** Before checking a password: refuse when locked, or when this minute already had too many failures. */
export async function loginGate(s: DataStore, username: string, perMinute: number, nowMs = Date.now()): Promise<void> {
  const u = username.toLowerCase();
  const f = (await s.get<FailState>(`login-fail/${u}`)).value;
  if (f?.lockedUntil && f.lockedUntil > nowMs) {
    const retryAfter = Math.ceil((f.lockedUntil - nowMs) / 1000);
    throw new AppError('LOCKED', 'Too many attempts. Try again later.', { retryAfter, lockedUntil: new Date(f.lockedUntil).toISOString() }, retryAfter);
  }
  const win = Math.floor(nowMs / 60000);
  const n = (await s.get<number>(`rl/login/${u}/${win}`)).value ?? 0;
  if (n >= perMinute) {
    const retryAfter = Math.max(1, 60 - Math.floor((nowMs % 60000) / 1000));
    throw new AppError('RATE_LIMITED', 'Too many attempts. Try again in a minute.', { retryAfter }, retryAfter);
  }
}

/** Returns true when this failure locked the account. */
export async function loginFailed(s: DataStore, username: string, nowMs = Date.now()): Promise<boolean> {
  const u = username.toLowerCase();
  const win = Math.floor(nowMs / 60000);
  await casUpdate<number, number>(s, `rl/login/${u}/${win}`, (cur) => ({ next: (cur ?? 0) + 1, result: 0 }), 6);
  const r = await casUpdate<FailState, boolean>(
    s,
    `login-fail/${u}`,
    (cur) => {
      const fresh = !cur || nowMs - cur.first > LOCK_MS || (cur.lockedUntil !== undefined && cur.lockedUntil <= nowMs);
      const next: FailState = fresh ? { count: 1, first: nowMs } : { ...cur, count: cur.count + 1 };
      const lock = next.count >= LOCK_AFTER;
      if (lock) next.lockedUntil = nowMs + LOCK_MS;
      return { next, result: lock };
    },
    6,
  );
  return r === true;
}

export async function loginSucceeded(s: DataStore, username: string): Promise<void> {
  await s.delete(`login-fail/${username.toLowerCase()}`);
}
