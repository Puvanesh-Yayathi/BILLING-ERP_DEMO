import type { ApiErrorBody } from '@app/contract';

/** The only way the web app talks to the server. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string> | Record<string, unknown>,
    readonly retryAfter?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
  /** Field errors from validation, keyed by field path. */
  get fields(): Record<string, string> {
    if (this.code !== 'VALIDATION' || !this.details) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.details)) if (typeof v === 'string') out[k] = v;
    return out;
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const SESSION_EXPIRED = 'app:session-expired';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('app-sync') : null;

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

async function request<T>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string; ifMatch?: string; timeoutMs?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  if (opts.ifMatch) headers['if-match'] = opts.ifMatch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', signal: ctrl.signal });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check the connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (data ?? {}) as Partial<ApiErrorBody>;
    const retry = Number(res.headers.get('retry-after') ?? '') || undefined;
    const err = new ApiError(res.status, e.code ?? 'INTERNAL', e.message ?? 'Something went wrong. Try again.', e.details as Record<string, string> | undefined, retry, e.requestId);
    if (res.status === 401 && !path.startsWith('/auth/login')) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED));
    throw err;
  }
  if (method !== 'GET') channel?.postMessage({ type: 'mutated', path });
  return data as T;
}

export const api = {
  get: <T>(path: string, q?: Query) => request<T>('GET', `${path}${qs(q)}`),
  post: <T>(path: string, body?: unknown, opts?: { idempotencyKey?: string }) => request<T>('POST', path, body ?? {}, { idempotencyKey: opts?.idempotencyKey ?? newIdempotencyKey() }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown, ifMatch?: string) => request<T>('PATCH', path, body, { ifMatch }),
  del: <T>(path: string) => request<T>('DELETE', path),
};

export function onCrossTabMutation(fn: () => void): () => void {
  if (!channel) return () => undefined;
  const h = () => fn();
  channel.addEventListener('message', h);
  return () => channel.removeEventListener('message', h);
}
