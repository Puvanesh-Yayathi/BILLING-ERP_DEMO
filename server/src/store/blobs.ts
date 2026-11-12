import { getStore, type Store } from '@netlify/blobs';
import type { DataStore, Versioned } from './types.js';

/**
 * Netlify Blobs adapter. Object storage, not a database: used only as the demo's persistence
 * behind the DataStore interface. Strong consistency and conditional writes give compare-and-set.
 * The store name is namespaced by deploy context so previews never touch production demo data.
 */
export class BlobStore implements DataStore {
  readonly kind = 'blobs' as const;
  constructor(private readonly namespace: string) {}

  /** Netlify issues a short-lived Blobs token per request, so the store client is created on each use. */
  private get store(): Store {
    return getStore({ name: `billing-demo-${this.namespace}`, consistency: 'strong' });
  }

  async get<T>(key: string): Promise<Versioned<T>> {
    const r = await this.store.getWithMetadata(key, { type: 'json' });
    if (!r) return { value: null, etag: null };
    return { value: r.data as T, etag: r.etag ?? null };
  }

  async etag(key: string): Promise<string | null> {
    const m = await this.store.getMetadata(key);
    return m?.etag ?? null;
  }

  async setIfMatch(key: string, value: unknown, expectEtag: string | null) {
    const r =
      expectEtag === null
        ? await this.store.setJSON(key, value, { onlyIfNew: true })
        : await this.store.setJSON(key, value, { onlyIfMatch: expectEtag });
    return { ok: r.modified, etag: r.etag ?? null };
  }

  async set(key: string, value: unknown) {
    await this.store.setJSON(key, value);
  }

  async delete(key: string) {
    await this.store.delete(key);
  }

  async list(prefix: string) {
    const { blobs } = await this.store.list({ prefix });
    return blobs.map((b) => b.key);
  }
}
