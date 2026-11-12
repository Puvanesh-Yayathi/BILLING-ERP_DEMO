import { app, MemoryStore, resetCache, setConfig, setStore } from '@app/server';

export function freshStore(): void {
  setConfig({ dataStore: 'memory', resetEnabled: true });
  setStore(new MemoryStore());
  resetCache();
}

export interface Client {
  cookie: string;
  call: <T = Record<string, unknown>>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: T; headers: Headers }>;
}

export function client(): Client {
  const c: Client = {
    cookie: '',
    call: async (method, path, body, headers = {}) => {
      const res = await app.request(`/api/v1${path}`, {
        method,
        headers: { 'content-type': 'application/json', cookie: c.cookie, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const set = res.headers.get('set-cookie');
      if (set) {
        const v = set.split(';')[0] ?? '';
        c.cookie = v.endsWith('=') ? '' : v;
      }
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : null) as never, headers: res.headers };
    },
  };
  return c;
}

export async function login(username: string, password = 'Demo@123'): Promise<Client> {
  const c = client();
  const r = await c.call('POST', '/auth/login', { username, password });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}
