export interface Versioned<T> {
  value: T | null;
  etag: string | null;
}

/**
 * Persistence adapter. BlobStore (Netlify Blobs, strong consistency) in deploys,
 * MemoryStore in tests and as a fallback. Writes with an etag are compare-and-set.
 */
export interface DataStore {
  readonly kind: 'blobs' | 'memory';
  get<T>(key: string): Promise<Versioned<T>>;
  /** Cheap version probe used to skip downloading an unchanged document. */
  etag(key: string): Promise<string | null>;
  /** expectEtag null means "only if the key does not exist yet". */
  setIfMatch(key: string, value: unknown, expectEtag: string | null): Promise<{ ok: boolean; etag: string | null }>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}
