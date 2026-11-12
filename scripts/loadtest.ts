/**
 * pnpm loadtest [baseUrl]
 * Drives several concurrent workers against the API (default http://localhost:8888, or a Netlify
 * deploy preview URL), then prints latency percentiles, status codes, how many function instances
 * served the requests, and shows the login limiter returning 429.
 * Reads are the bulk of the load; each worker also saves a few draft bills (no stock is used).
 */
const BASE = (process.argv[2] ?? process.env.LOADTEST_URL ?? 'http://localhost:8888').replace(/\/$/, '');
const WORKERS = ['admin', 'staff1', 'staff2', 'staff3', 'operating1', 'operating2', 'monitor', 'collector'];
const ROUNDS = Number(process.env.LOADTEST_ROUNDS ?? 12);

interface Sample {
  ms: number;
  status: number;
  instance: string;
}
const samples: Sample[] = [];

async function call(cookie: string, method: string, path: string, body?: unknown) {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: { 'content-type': 'application/json', cookie, origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ms = performance.now() - t0;
  samples.push({ ms, status: r.status, instance: r.headers.get('x-instance-id') ?? 'unknown' });
  const text = await r.text();
  return { status: r.status, headers: r.headers, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function login(user: string): Promise<string> {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ username: user, password: 'Demo@123' }) });
  if (!r.ok) throw new Error(`login ${user}: ${r.status}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function worker(user: string) {
  const cookie = await login(user);
  const reads = user === 'admin' || user === 'monitor' || user === 'collector' ? ['/analytics/overview?period=month', '/invoices?limit=50', '/inventory/sales', '/funds/summary', '/events?after=0'] : ['/my/analytics?period=month', '/invoices?limit=50', '/products/available', '/dues', '/events?after=0'];
  for (let i = 0; i < ROUNDS; i++) {
    await Promise.all(reads.map((p) => call(cookie, 'GET', p)));
    if ((user.startsWith('staff') || user.startsWith('operating')) && i % 4 === 0) {
      const products = await call(cookie, 'GET', '/products/available');
      const items = (products.json.items as { id: string; stock: number }[] | undefined) ?? [];
      const p = items.find((x) => x.stock > 0);
      if (p) await call(cookie, 'POST', '/invoices', { type: 'CASH', items: [{ productId: p.id, qty: 1, discountPct: 0 }], notes: 'Load test draft' });
    }
  }
}

function pct(list: number[], p: number) {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) : 0;
}

async function main() {
  console.log(`Load test against ${BASE}: ${WORKERS.length} concurrent users, ${ROUNDS} rounds each`);
  const t0 = performance.now();
  await Promise.all(WORKERS.map(worker));
  const secs = (performance.now() - t0) / 1000;
  const lat = samples.map((s) => s.ms);
  const codes = samples.reduce<Record<number, number>>((a, s) => ((a[s.status] = (a[s.status] ?? 0) + 1), a), {});
  const inst = samples.reduce<Record<string, number>>((a, s) => ((a[s.instance] = (a[s.instance] ?? 0) + 1), a), {});
  console.log(`\nRequests: ${samples.length} in ${secs.toFixed(1)} s (${(samples.length / secs).toFixed(1)} per second)`);
  console.log(`Latency: p50 ${pct(lat, 50)} ms, p95 ${pct(lat, 95)} ms, p99 ${pct(lat, 99)} ms`);
  console.log(`Status codes: ${JSON.stringify(codes)}`);
  console.log(`Function instances: ${Object.keys(inst).length}`);
  for (const [k, v] of Object.entries(inst)) console.log(`  ${k}: ${v} requests`);

  console.log('\nLogin limiter: 7 wrong attempts for one username');
  const user = `loadtest-${Date.now()}`;
  for (let i = 1; i <= 7; i++) {
    const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ username: user, password: 'wrong' }) });
    console.log(`  attempt ${i}: ${r.status}${r.headers.get('retry-after') ? `, Retry-After ${r.headers.get('retry-after')} s` : ''}`);
  }
  if (Object.keys(codes).some((c) => Number(c) >= 500)) {
    console.error('Server errors occurred during the load test');
    process.exit(1);
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
