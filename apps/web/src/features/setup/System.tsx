import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Invoice } from '@app/contract';
import { api, ApiError, newIdempotencyKey } from '../../api/client';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, SkeletonRows } from '../../ui/feedback';
import { KeyValue, PageHeader, Section } from '../../ui/layout';
import { Tabs } from '../../ui/overlay';

interface Status {
  instanceId: string;
  instanceStartedAt: string;
  store: string;
  deployContext: string;
  stateBytes: number;
  stateHardCap: number;
  seedVersion: number;
  seededAt: string;
  eventSeq: number;
  counts: Record<string, number>;
  node: string;
}
interface Req {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string;
  netlifyRequestId?: string;
  instanceId: string;
}

function StatusTab() {
  const q = useQuery({ queryKey: ['system-status'], queryFn: () => api.get<Status>('/system/status'), refetchInterval: 10_000 });
  if (q.error) return <ErrorState error={q.error} />;
  const s = q.data;
  return (
    <Section>
      <div className="pt-5">
        <KeyValue
          cols={3}
          items={[
            { label: 'Function instance that answered', value: s?.instanceId ?? '—' },
            { label: 'Instance started', value: s ? new Date(s.instanceStartedAt).toLocaleString('en-IN') : '—' },
            { label: 'Data store', value: s ? (s.store === 'blobs' ? 'Netlify Blobs (demo persistence, not a database)' : 'In-memory (lost when the instance restarts)') : '—' },
            { label: 'Deploy context', value: s?.deployContext ?? '—' },
            { label: 'State document size', value: s ? `${(s.stateBytes / 1024).toFixed(0)} KB of ${(s.stateHardCap / 1024 / 1024).toFixed(0)} MB` : '—' },
            { label: 'Seed version', value: s ? `${s.seedVersion}, loaded ${new Date(s.seededAt).toLocaleDateString('en-IN')}` : '—' },
            { label: 'Events published', value: s?.eventSeq ?? '—' },
            { label: 'Records', value: s ? Object.entries(s.counts).map(([k, v]) => `${v} ${k}`).join(', ') : '—' },
            { label: 'Runtime', value: s ? `Node ${s.node}` : '—' },
          ]}
        />
      </div>
    </Section>
  );
}

function RequestsTab() {
  const q = useQuery({ queryKey: ['system-requests'], queryFn: () => api.get<{ items: Req[] }>('/system/requests'), refetchInterval: 5_000 });
  const items = q.data?.items ?? [];
  const instances = [...new Set(items.map((r) => r.instanceId))];
  const lat = items.map((r) => r.ms).sort((a, b) => a - b);
  const p95 = lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0;
  return (
    <>
      <p className="border-b border-hairline px-6 py-3 text-sm">
        {items.length} recent requests served by <span className="font-semibold">{instances.length}</span> function instance{instances.length === 1 ? '' : 's'}: {instances.join(', ')}. p95 latency {p95} ms.
      </p>
      <DataTable
        caption="Request log"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        rowId={(r) => `${r.requestId}-${r.at}`}
        empty={{ title: 'No requests recorded yet', body: 'Every API call is listed with its status, latency and the instance that served it.' }}
        columns={[
          { id: 'at', header: 'Time', cell: (r) => new Date(r.at).toLocaleTimeString('en-IN'), width: 110 },
          { id: 'm', header: 'Method', cell: (r) => r.method, width: 80 },
          { id: 'p', header: 'Path', cell: (r) => <span className="break-all">{r.path}</span>, hideable: false },
          { id: 's', header: 'Status', align: 'right', cell: (r) => <span className={r.status >= 500 ? 'text-danger' : r.status >= 400 ? 'text-brown' : 'text-success'}>{r.status}</span>, sortValue: (r) => r.status },
          { id: 'ms', header: 'Latency', align: 'right', cell: (r) => `${r.ms} ms`, sortValue: (r) => r.ms },
          { id: 'i', header: 'Instance', cell: (r) => r.instanceId },
          { id: 'r', header: 'Request id', cell: (r) => <span className="text-slate">{r.requestId.slice(0, 8)}</span> },
          { id: 'n', header: 'Netlify request id', cell: (r) => r.netlifyRequestId ?? '', defaultHidden: true },
        ]}
      />
    </>
  );
}

interface OpenApi {
  info: { title: string; version: string };
  paths: Record<string, Record<string, { summary?: string; tags?: string[]; description?: string; requestBody?: { content: { 'application/json': { schema: unknown } } } }>>;
}

function ApiTab() {
  const q = useQuery({ queryKey: ['openapi'], queryFn: () => api.get<OpenApi>('/openapi.json') });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <SkeletonRows rows={10} cols={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} />;
  const ops = Object.entries(q.data.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method: method.toUpperCase(), ...op })));
  const tags = [...new Set(ops.map((o) => o.tags?.[0] ?? 'Other'))];
  return (
    <div>
      <p className="border-b border-hairline px-6 py-3 text-sm text-slate">
        {q.data.info.title} {q.data.info.version}. {ops.length} operations generated from the same zod schemas the server validates with. <a className="link" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">Open the JSON document</a>.
      </p>
      {tags.map((t) => (
        <Section key={t} title={t} flush>
          <ul className="divide-y divide-hairline border-t border-hairline">
            {ops
              .filter((o) => (o.tags?.[0] ?? 'Other') === t)
              .map((o) => {
                const k = `${o.method} ${o.path}`;
                return (
                  <li key={k}>
                    <button type="button" className="grid w-full grid-cols-[72px_1fr] gap-3 px-6 py-2 text-left text-sm hover:bg-mist md:grid-cols-[72px_minmax(260px,1fr)_1fr]" onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k}>
                      <span className={`font-semibold ${o.method === 'GET' ? 'text-tide' : o.method === 'DELETE' ? 'text-danger' : 'text-brown'}`}>{o.method}</span>
                      <span className="break-all font-medium text-deep">{o.path}</span>
                      <span className="col-span-2 text-slate md:col-span-1">
                        {o.summary} <span className="text-meta">({o.description})</span>
                      </span>
                    </button>
                    {open === k && o.requestBody ? <pre className="mx-6 mb-3 max-h-80 overflow-auto rounded-ctl border border-hairline bg-mist p-3 text-meta">{JSON.stringify(o.requestBody.content['application/json'].schema, null, 2)}</pre> : null}
                    {open === k && !o.requestBody ? <p className="mx-6 mb-3 text-meta text-slate">No request body.</p> : null}
                  </li>
                );
              })}
          </ul>
        </Section>
      ))}
    </div>
  );
}

function Box({ x, y, w, h, title, sub, tone = 'plain' }: { x: number; y: number; w: number; h: number; title: string; sub?: string; tone?: 'plain' | 'deep' | 'dashed' }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={tone === 'deep' ? '#0F2A47' : '#FFFFFF'} stroke={tone === 'deep' ? '#0F2A47' : '#DCE2EA'} strokeDasharray={tone === 'dashed' ? '5 4' : undefined} />
      <text x={x + w / 2} y={y + (sub ? h / 2 - 4 : h / 2 + 4)} textAnchor="middle" fontSize="13" fontWeight="600" fill={tone === 'deep' ? '#FFFFFF' : '#0F2A47'} fontFamily="IBM Plex Sans">
        {title}
      </text>
      {sub ? (
        <text x={x + w / 2} y={y + h / 2 + 14} textAnchor="middle" fontSize="11" fill={tone === 'deep' ? '#DCE2EA' : '#5B6878'} fontFamily="IBM Plex Sans">
          {sub}
        </text>
      ) : null}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#5B6878" strokeWidth={1.2} markerEnd="url(#arrow)" />;
}

function ArchitectureTab() {
  return (
    <>
      <Section title="Demo edition: what is running now">
        <svg viewBox="0 0 900 250" className="w-full max-w-4xl" role="img" aria-label="Demo architecture: browser, Netlify CDN, Netlify Function running Hono, DataStore on Netlify Blobs">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#5B6878" />
            </marker>
          </defs>
          <Box x={10} y={90} w={150} h={64} title="Browser" sub="React app, 2 s polling" />
          <Box x={210} y={90} w={170} h={64} title="Netlify CDN and edge" sub="Static files, rate-limit rule" />
          <Box x={430} y={40} w={210} h={64} tone="deep" title="Netlify Function" sub="Hono API, many instances" />
          <Box x={430} y={140} w={210} h={64} title="Scheduled function" sub="Session sweeper every 5 min" />
          <Box x={690} y={90} w={200} h={64} title="DataStore" sub="Netlify Blobs, compare-and-set" />
          <Arrow x1={160} y1={122} x2={208} y2={122} />
          <Arrow x1={380} y1={110} x2={428} y2={80} />
          <Arrow x1={640} y1={72} x2={688} y2={108} />
          <Arrow x1={640} y1={172} x2={688} y2={140} />
          <text x={450} y={238} fontSize="11" fill="#5B6878" fontFamily="IBM Plex Sans">
            Scaling across instances is provided by Netlify. There is no custom load balancer and no database in the demo.
          </text>
        </svg>
      </Section>
      <Section title="Production target (design only, not running)">
        <svg viewBox="0 0 900 260" className="w-full max-w-4xl" role="img" aria-label="Production target architecture: nginx load balancer, several app servers, Postgres, Redis, PDF worker">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" fill="#5B6878" />
            </marker>
          </defs>
          <Box x={10} y={98} w={130} h={60} tone="dashed" title="Browser" sub="SSE push updates" />
          <Box x={180} y={98} w={150} h={60} tone="dashed" title="nginx" sub="Load balancer, TLS" />
          <Box x={380} y={20} w={170} h={56} tone="dashed" title="App server 1" sub="Same API contract" />
          <Box x={380} y={100} w={170} h={56} tone="dashed" title="App server 2" />
          <Box x={380} y={180} w={170} h={56} tone="dashed" title="PDF worker" sub="Headless Chromium" />
          <Box x={610} y={40} w={150} h={56} tone="dashed" title="PostgreSQL" sub="Row locks, backups" />
          <Box x={610} y={140} w={150} h={56} tone="dashed" title="Redis" sub="Rate limits, queue" />
          <Arrow x1={140} y1={128} x2={178} y2={128} />
          <Arrow x1={330} y1={118} x2={378} y2={52} />
          <Arrow x1={330} y1={128} x2={378} y2={128} />
          <Arrow x1={550} y1={52} x2={608} y2={66} />
          <Arrow x1={550} y1={128} x2={608} y2={160} />
          <Arrow x1={550} y1={206} x2={608} y2={176} />
          <text x={780} y={128} fontSize="11" fill="#8A5A2B" fontFamily="IBM Plex Sans">
            Target design
          </text>
        </svg>
      </Section>
      <Section title="What is real and what is simulated" flush>
        <table className="w-full text-sm">
          <thead className="bg-mist">
            <tr className="border-y border-hairline text-th text-slate">
              <th className="h-9 px-6 text-left font-semibold">Item</th>
              <th className="h-9 px-6 text-left font-semibold">In this demo</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Backend, sign-in, roles, validation, rate limiting, concurrency control', 'Real, running on Netlify Functions'],
              ['Scaling across instances', 'Real, provided by Netlify serverless and CDN. No custom load balancer. The nginx design above is the production target only.'],
              ['Database', 'None. Bundled seed data plus Netlify Blobs for new records. Not a production data store.'],
              ['Live updates to Admin', 'Real across devices by polling every 2 seconds, instant within one browser. Not push.'],
              ['PDF', 'Browser print or Save as PDF with the A4 templates, not rendered on the server'],
              ['Email', 'Outbox screen only, nothing is sent'],
              ['Security hardening', 'Good for a demo. Production needs its own review, a real database and secrets management.'],
            ].map(([a, b]) => (
              <tr key={a} className="border-b border-hairline align-top">
                <td className="px-6 py-2.5 font-medium">{a}</td>
                <td className="px-6 py-2.5">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function Demo({ title, body, label, run }: { title: string; body: string; label: string; run: () => Promise<string[]> }) {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <li className="border-b border-hairline px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-base font-semibold">{title}</p>
          <p className="mt-1 text-sm text-slate">{body}</p>
        </div>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setLines(await run());
            } catch (e) {
              setLines([e instanceof ApiError ? `${e.status} ${e.code}: ${e.message}` : 'The demo could not run']);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </Button>
      </div>
      {lines.length ? (
        <ol className="mt-3 rounded-ctl border border-hairline bg-mist px-4 py-3 text-sm tabular-nums">
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

async function raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`/api/v1${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, retry: r.headers.get('retry-after'), replay: r.headers.get('idempotent-replay'), body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

function DemosTab() {
  return (
    <ul>
      <Demo
        title="Rate limiting"
        body="Sends seven wrong sign-in attempts for a demo username. The sixth is refused with 429 and a Retry-After header. Ten failures lock an account for 15 minutes."
        label="Run sign-in burst"
        run={async () => {
          const out: string[] = [];
          const user = `burst-${Math.floor(Date.now() / 1000)}`;
          for (let i = 1; i <= 7; i++) {
            const r = await raw('POST', '/auth/login', { username: user, password: 'wrong' });
            out.push(`Attempt ${i}: ${r.status}${r.retry ? `, Retry-After ${r.retry} s` : ''}`);
          }
          return out;
        }}
      />
      <Demo
        title="Idempotent replay"
        body="Sends the same create-bill request twice with one Idempotency-Key. One draft is created; the second call returns the first response."
        label="Send twice"
        run={async () => {
          const products = await api.get<{ items: { id: string; stock: number }[] }>('/products/available');
          const p = products.items.find((x) => x.stock > 0);
          const key = newIdempotencyKey();
          const body = { type: 'CASH', items: [{ productId: p?.id, qty: 1, discountPct: 0 }], notes: 'Idempotency demo' };
          const a = await raw('POST', '/invoices', body, { 'idempotency-key': key });
          const b = await raw('POST', '/invoices', body, { 'idempotency-key': key });
          return [`First call: ${a.status}, draft ${String(a.body.id)}`, `Second call: ${b.status}, draft ${String(b.body.id)}${b.replay ? ', replayed' : ''}`, a.body.id === b.body.id ? 'Same draft. Nothing was created twice.' : 'Different drafts'];
        }}
      />
      <Demo
        title="Edit conflict"
        body="Two editors load the same draft bill. The first saves; the second saves with the old version and gets 409 with a message to reload."
        label="Simulate two editors"
        run={async () => {
          const products = await api.get<{ items: { id: string; stock: number }[] }>('/products/available');
          const p = products.items.find((x) => x.stock > 0);
          const d = await api.post<Invoice>('/invoices', { type: 'CASH', items: [{ productId: p?.id, qty: 1, discountPct: 0 }], notes: 'Conflict demo' });
          const body = { type: 'CASH', items: [{ productId: p?.id, qty: 2, discountPct: 0 }] };
          const a = await raw('PATCH', `/invoices/${d.id}`, body, { 'if-match': `"${d.rev}"` });
          const b = await raw('PATCH', `/invoices/${d.id}`, body, { 'if-match': `"${d.rev}"` });
          return [`Editor 1 saves version ${d.rev}: ${a.status}`, `Editor 2 saves version ${d.rev}: ${b.status} ${String(b.body.message ?? '')}`];
        }}
      />
      <Demo
        title="No overselling"
        body="Adds one unit of Product C to stock, then finalizes two bills for that last unit at the same moment. Exactly one succeeds. This creates a real cash bill."
        label="Bill the last unit twice"
        run={async () => {
          const products = await api.get<{ items: { id: string; code: string; stock: number }[] }>('/products/available');
          const p = products.items.find((x) => x.code === 'PRD-C') ?? products.items[0];
          if (!p) return ['No product found'];
          await api.post('/stock-adjustments', { kind: 'SALES', itemId: p.id, qty: 1 - p.stock, reason: 'Concurrency demo: leave exactly one unit' });
          const a = await api.post<Invoice>('/invoices', { type: 'CASH', items: [{ productId: p.id, qty: 1, discountPct: 0 }] });
          const b = await api.post<Invoice>('/invoices', { type: 'CASH', items: [{ productId: p.id, qty: 1, discountPct: 0 }] });
          const [ra, rb] = await Promise.all([raw('POST', `/invoices/${a.id}/finalize`), raw('POST', `/invoices/${b.id}/finalize`)]);
          if (p.stock > 1) await api.post('/stock-adjustments', { kind: 'SALES', itemId: p.id, qty: p.stock - 1, reason: 'Concurrency demo: restore the other units' });
          return [`Session 1: ${ra.status} ${ra.status === 200 ? String(ra.body.number) : String(ra.body.message)}`, `Session 2: ${rb.status} ${rb.status === 200 ? String(rb.body.number) : String(rb.body.message)}`, 'The other units were put back afterwards.'];
        }}
      />
    </ul>
  );
}

export function SystemPage() {
  const [tab, setTab] = useState<'status' | 'requests' | 'api' | 'arch' | 'demos'>('status');
  return (
    <div>
      <PageHeader title="System" description="How the demo runs: instance and store status, every API request, the API document and the architecture." />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="System"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'status', label: 'Status' },
            { value: 'requests', label: 'Request log' },
            { value: 'api', label: 'API explorer' },
            { value: 'arch', label: 'Architecture' },
            { value: 'demos', label: 'Engineering demos' },
          ]}
        />
      </div>
      {tab === 'status' ? <StatusTab /> : tab === 'requests' ? <RequestsTab /> : tab === 'api' ? <ApiTab /> : tab === 'arch' ? <ArchitectureTab /> : <DemosTab />}
    </div>
  );
}
