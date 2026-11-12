import type { DataStore, Versioned } from './types.js';

/** In-memory adapter: same compare-and-set semantics as the BlobStore. Values are stored as JSON. */
export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const;
  private data = new Map<string, { json: string; etag: string }>();
  private n = 0;

  async get<T>(key: string): Promise<Versioned<T>> {
    const e = this.data.get(key);
    if (!e) return { value: null, etag: null };
    return { value: JSON.parse(e.json) as T, etag: e.etag };
  }

  async etag(key: string): Promise<string | null> {
    return this.data.get(key)?.etag ?? null;
  }

  async setIfMatch(key: string, value: unknown, expectEtag: string | null) {
    const cur = this.data.get(key);
    if ((cur?.etag ?? null) !== expectEtag) return { ok: false, etag: cur?.etag ?? null };
    const etag = `m${++this.n}`;
    this.data.set(key, { json: JSON.stringify(value), etag });
    return { ok: true, etag };
  }

  async set(key: string, value: unknown) {
    this.data.set(key, { json: JSON.stringify(value), etag: `m${++this.n}` });
  }

  async delete(key: string) {
    this.data.delete(key);
  }

  async list(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}
