import { randomUUID } from 'node:crypto';

/** Generated once per cold start so System Status can show which instance served a request. */
export const INSTANCE_ID = `fn-${randomUUID().slice(0, 8)}`;
export const INSTANCE_STARTED_AT = new Date().toISOString();

export interface AppConfig {
  jwtSecret: Uint8Array;
  dataStore: 'blobs' | 'memory';
  resetEnabled: boolean;
  seedVersion: number;
  deployContext: string;
  /** Hard cap on the transactional state document, bytes. */
  stateHardCap: number;
  secureCookies: boolean;
}

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (cached) return cached;
  const env = process.env;
  const secret = env.JWT_SECRET ?? (env.NODE_ENV === 'production' ? '' : 'local-development-secret-not-for-deploys');
  if (!secret) throw new Error('JWT_SECRET is not set');
  cached = {
    jwtSecret: new TextEncoder().encode(secret),
    dataStore: env.DATA_STORE === 'blobs' ? 'blobs' : env.DATA_STORE === 'memory' ? 'memory' : env.NETLIFY ? 'blobs' : 'memory',
    resetEnabled: env.DEMO_RESET_ENABLED !== 'false',
    seedVersion: Number(env.SEED_VERSION ?? 1),
    deployContext: env.CONTEXT ?? 'dev',
    stateHardCap: 4 * 1024 * 1024,
    secureCookies: !!env.NETLIFY || env.NODE_ENV === 'production',
  };
  return cached;
}

/** Tests swap the config. */
export function setConfig(c: Partial<AppConfig>): void {
  cached = { ...config(), ...c };
}
