import { randomUUID } from 'node:crypto';
import type { ActivityLog, DomainEvent, LoginEvent } from '@app/contract';
import { INSTANCE_ID } from './config.js';
import { ABORT, casUpdate, type DataStore } from './store/index.js';

/** Append-only logs kept outside the transactional document so they never cause conflicts on it. */

const CHUNK = 400;

interface Head {
  idx: number;
}

export async function appendChunked<T>(s: DataStore, name: string, entries: T[]): Promise<void> {
  if (!entries.length) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    const head = (await s.get<Head>(`${name}/head`)).value ?? { idx: 0 };
    const key = `${name}/chunk/${String(head.idx).padStart(6, '0')}`;
    const { value, etag } = await s.get<T[]>(key);
    const cur = value ?? [];
    if (cur.length > 0 && cur.length + entries.length > CHUNK) {
      await casUpdate<Head>(s, `${name}/head`, (h) =>
        (h?.idx ?? 0) === head.idx ? { next: { idx: head.idx + 1 }, result: { idx: head.idx + 1 } } : ABORT,
      );
      continue;
    }
    const w = await s.setIfMatch(key, [...cur, ...entries], etag);
    if (w.ok) return;
    await new Promise((r) => setTimeout(r, 5 + Math.random() * 25));
  }
  throw new Error(`Could not append to ${name}`);
}

/** Newest first. */
export async function readChunked<T>(s: DataStore, name: string, maxChunks = 50): Promise<T[]> {
  const head = (await s.get<Head>(`${name}/head`)).value ?? { idx: 0 };
  const out: T[] = [];
  for (let i = head.idx; i >= 0 && head.idx - i < maxChunks; i--) {
    const v = (await s.get<T[]>(`${name}/chunk/${String(i).padStart(6, '0')}`)).value ?? [];
    for (let j = v.length - 1; j >= 0; j--) out.push(v[j] as T);
  }
  return out;
}

export const appendAudit = (s: DataStore, e: ActivityLog[]) => appendChunked(s, 'audit', e);
export const readAudit = (s: DataStore) => readChunked<ActivityLog>(s, 'audit');

export function loginEvent(e: Omit<LoginEvent, 'id'>): LoginEvent {
  return { id: randomUUID(), ...e };
}
export const appendLogin = (s: DataStore, e: LoginEvent[]) => appendChunked(s, 'logins', e);
export const readLogins = (s: DataStore) => readChunked<LoginEvent>(s, 'logins');

/** Event log ring buffer: realtime feed for polling clients. */
interface EventRing {
  seq: number;
  items: DomainEvent[];
}
const EVENT_RING = 600;

export async function appendEvents(s: DataStore, events: Omit<DomainEvent, 'seq'>[]): Promise<void> {
  if (!events.length) return;
  await casUpdate<EventRing, void>(s, 'events', (cur) => {
    const ring = cur ?? { seq: 0, items: [] };
    let seq = ring.seq;
    const added = events.map((e) => ({ ...e, seq: ++seq }));
    return { next: { seq, items: [...ring.items, ...added].slice(-EVENT_RING) }, result: undefined };
  }, 8);
}

export async function readEvents(s: DataStore, after: number): Promise<{ seq: number; items: DomainEvent[] }> {
  const ring = (await s.get<EventRing>('events')).value ?? { seq: 0, items: [] };
  return { seq: ring.seq, items: ring.items.filter((e) => e.seq > after) };
}

/** Request log: one ring per function instance (no cross-instance contention). */
export interface RequestLogEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string;
  netlifyRequestId?: string;
  instanceId: string;
  userId?: string;
}

const pending: RequestLogEntry[] = [];
let flushing: Promise<void> | null = null;

export function logRequest(e: RequestLogEntry): void {
  pending.push(e);
  console.log(JSON.stringify({ level: 'info', type: 'request', ...e }));
}

export async function flushRequestLog(s: DataStore): Promise<void> {
  if (flushing) await flushing;
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  flushing = (async () => {
    const key = `requests/${INSTANCE_ID}`;
    const cur = (await s.get<RequestLogEntry[]>(key)).value ?? [];
    await s.set(key, [...cur, ...batch].slice(-150));
  })().finally(() => {
    flushing = null;
  });
  await flushing;
}

export async function readRequestLog(s: DataStore): Promise<RequestLogEntry[]> {
  const keys = await s.list('requests/');
  const all: RequestLogEntry[] = [];
  for (const k of keys) all.push(...((await s.get<RequestLogEntry[]>(k)).value ?? []));
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
}
