import type { DataStore } from '../store/index.js';

interface Stored {
  state: 'pending' | 'done';
  route: string;
  status?: number;
  body?: unknown;
  at: number;
}

const TTL_MS = 24 * 3600 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type IdemResult = { replay: true; status: number; body: unknown } | { replay: false; finish: (status: number, body: unknown) => Promise<void> };

/**
 * Idempotency-Key: the first request claims the key; a repeat returns the stored response
 * and changes nothing. A repeat that arrives while the first is still running waits for it.
 */
export async function claimIdempotency(s: DataStore, userId: string, key: string, route: string): Promise<IdemResult> {
  const k = `idem/${userId}/${key.slice(0, 80)}`;
  for (let i = 0; i < 60; i++) {
    const { value, etag } = await s.get<Stored>(k);
    if (value && Date.now() - value.at < TTL_MS) {
      if (value.state === 'done' && value.status !== undefined) return { replay: true, status: value.status, body: value.body };
      await sleep(100);
      continue;
    }
    const claim = await s.setIfMatch(k, { state: 'pending', route, at: Date.now() } satisfies Stored, etag);
    if (claim.ok) {
      return {
        replay: false,
        finish: async (status, body) => {
          if (status >= 500) await s.delete(k);
          else await s.set(k, { state: 'done', route, status, body, at: Date.now() } satisfies Stored);
        },
      };
    }
  }
  return { replay: true, status: 409, body: { code: 'CONFLICT', message: 'The same request is still being processed', requestId: '' } };
}
