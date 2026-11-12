import { config } from '../config.js';
import { BlobStore } from './blobs.js';
import { MemoryStore } from './memory.js';
import type { DataStore } from './types.js';

export type { DataStore, Versioned } from './types.js';
export { MemoryStore } from './memory.js';

let current: DataStore | null = null;

export function store(): DataStore {
  if (!current) {
    const c = config();
    current = c.dataStore === 'blobs' ? new BlobStore(c.deployContext) : new MemoryStore();
  }
  return current;
}

export function setStore(s: DataStore): void {
  current = s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ABORT = Symbol('abort');

/**
 * Read → apply → write only if unchanged → retry with jitter (up to 5 attempts).
 * Returning ABORT from fn leaves the key untouched.
 */
export async function casUpdate<T, R = T>(
  s: DataStore,
  key: string,
  fn: (cur: T | null) => { next: T; result: R } | typeof ABORT,
  attempts = 5,
): Promise<R | typeof ABORT> {
  for (let i = 0; i < attempts; i++) {
    const { value, etag } = await s.get<T>(key);
    const out = fn(value);
    if (out === ABORT) return ABORT;
    const w = await s.setIfMatch(key, out.next, etag);
    if (w.ok) return out.result;
    await sleep(10 + Math.random() * 30 * (i + 1));
  }
  throw new Error(`Could not update ${key} after ${attempts} attempts`);
}
