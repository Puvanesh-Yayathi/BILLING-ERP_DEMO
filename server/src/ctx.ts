import { randomUUID } from 'node:crypto';
import { toISTDate, type ActivityLog, type DomainEvent, type ISODate, type Role } from '@app/contract';
import type { State } from './state.js';

export interface Actor {
  id: string;
  name: string;
  role: Role;
  staffId?: string;
  customerId?: string;
}

export interface Ctx {
  actor: Actor;
  now: string;
  today: ISODate;
  ip: string;
  requestId: string;
  audits: ActivityLog[];
  events: Omit<DomainEvent, 'seq'>[];
}

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'System', role: 'ADMIN' };

export function makeCtx(actor: Actor, opts: { now?: string; ip?: string; requestId?: string } = {}): Ctx {
  const now = opts.now ?? new Date().toISOString();
  return {
    actor,
    now,
    today: toISTDate(now),
    ip: opts.ip ?? '127.0.0.1',
    requestId: opts.requestId ?? randomUUID(),
    audits: [],
    events: [],
  };
}

/** Deterministic id from the state counter (keeps the seed identical every time). */
export function newId(s: State, prefix: string): string {
  const n = (s.counters.__id ?? 0) + 1;
  s.counters.__id = n;
  return `${prefix}_${n.toString(36).padStart(5, '0')}`;
}

/** Strip noisy fields before storing audit before/after snapshots. */
function snapshot(v: unknown): unknown {
  if (v === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val: unknown) => (k === 'passwordHash' || k === 'dataUrl' ? undefined : val)),
  ) as unknown;
}

export function audit(
  ctx: Ctx,
  entity: string,
  entityId: string,
  action: string,
  summary: string,
  before?: unknown,
  after?: unknown,
): void {
  ctx.audits.push({
    id: randomUUID(),
    userId: ctx.actor.id,
    userName: ctx.actor.name,
    entity,
    entityId,
    action,
    summary,
    before: snapshot(before),
    after: snapshot(after),
    ip: ctx.ip,
    requestId: ctx.requestId,
    at: ctx.now,
  });
}

/**
 * Audience: admins always receive events. Add 'role:MONITOR', 'role:COLLECTOR', 'user:<id>'
 * so workers only ever receive their own events.
 */
export function emit(
  ctx: Ctx,
  type: string,
  entity: string,
  entityId: string,
  summary: string,
  audience: string[] = [],
  amount?: number,
): void {
  ctx.events.push({
    type,
    entity,
    entityId,
    summary,
    actorId: ctx.actor.id,
    actorName: ctx.actor.name,
    audience: [...new Set([...audience, `user:${ctx.actor.id}`])],
    amount,
    at: ctx.now,
  });
}

export const COMPANY_AUDIENCE = ['role:MONITOR', 'role:COLLECTOR'];

export function notify(s: State, ctx: Ctx, userIds: string[], title: string, body: string, link: string): void {
  for (const userId of new Set(userIds)) {
    s.notifications.push({ id: newId(s, 'ntf'), userId, title, body, link, read: false, at: ctx.now });
  }
  if (s.notifications.length > 600) s.notifications.splice(0, s.notifications.length - 600);
}

export function sendEmail(s: State, ctx: Ctx, to: string, subject: string, body: string): void {
  s.outbox.push({ id: newId(s, 'eml'), to, subject, body, at: ctx.now });
  if (s.outbox.length > 300) s.outbox.splice(0, s.outbox.length - 300);
}
