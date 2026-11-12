import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ActivityLog, EmailOutbox, LoginEvent } from '@app/contract';
import { api } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Select } from '../../ui/form';
import { KeyValue, PageHeader, Section, Toolbar } from '../../ui/layout';
import { Drawer, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { DateRange, SearchBox, daysAgo, today, useDebounced } from '../common';

const when = (at: string) => new Date(at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });

function flatten(v: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (v === null || v === undefined) return out;
  if (typeof v !== 'object') {
    out[prefix || 'value'] = String(v);
    return out;
  }
  if (Array.isArray(v)) {
    out[prefix || 'value'] = v.length > 6 ? `${v.length} items` : JSON.stringify(v);
    return out;
  }
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (val && typeof val === 'object' && !Array.isArray(val)) Object.assign(out, flatten(val, key));
    else out[key] = Array.isArray(val) ? (val.length > 6 ? `${val.length} items` : JSON.stringify(val)) : String(val ?? '');
  }
  return out;
}

/** Before and after side by side, changed fields first. */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = flatten(before);
  const a = flatten(after);
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const changed = keys.filter((k) => b[k] !== a[k]);
  const same = keys.filter((k) => b[k] === a[k]);
  if (!keys.length) return <p className="text-sm text-slate">No field values were recorded for this entry.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-hairline text-th text-slate">
          <th className="py-2 text-left font-semibold">Field</th>
          <th className="py-2 text-left font-semibold">Before</th>
          <th className="py-2 text-left font-semibold">After</th>
        </tr>
      </thead>
      <tbody>
        {[...changed, ...same].map((k) => {
          const diff = b[k] !== a[k];
          return (
            <tr key={k} className="border-b border-hairline align-top">
              <td className={`relative py-1.5 pr-3 ${diff ? 'font-medium' : 'text-slate'}`}>
                {diff ? <span className="absolute inset-y-1 -left-3 w-0.5 bg-brown" /> : null}
                {k}
              </td>
              <td className="break-all py-1.5 pr-3 text-slate">{b[k] ?? ''}</td>
              <td className={`break-all py-1.5 ${diff ? 'text-deep' : 'text-slate'}`}>{a[k] ?? ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AuditTab() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const [userId, setUserId] = useState('');
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [open, setOpen] = useState<ActivityLog | null>(null);
  const dq = useDebounced(q);
  const users = useQuery({ queryKey: ['all-users'], queryFn: async () => [...(await api.get<{ items: { id: string; name: string }[] }>('/users')).items, ...(await api.get<{ items: { login: { id: string; name: string } | null }[] }>('/workers')).items.flatMap((w) => (w.login ? [w.login] : []))] });
  const params = { from, to, userId, entity, action, q: dq, limit: 100, cursor };
  const list = useQuery({ queryKey: ['audit', params], queryFn: () => api.get<{ items: ActivityLog[]; nextCursor: string | null; total: number; entities: string[]; actions: string[] }>('/audit-log', params), placeholderData: keepPreviousData });
  return (
    <>
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t), setCursor(undefined))} />
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">User</span>
          <Select value={userId} onChange={(e) => (setUserId(e.target.value), setCursor(undefined))} className="w-[160px]">
            <option value="">Everyone</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Record</span>
          <Select value={entity} onChange={(e) => (setEntity(e.target.value), setCursor(undefined))} className="w-[160px]">
            <option value="">All</option>
            {list.data?.entities.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Action</span>
          <Select value={action} onChange={(e) => (setAction(e.target.value), setCursor(undefined))} className="w-[140px]">
            <option value="">All</option>
            {list.data?.actions.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </label>
        <SearchBox value={q} onChange={(v) => (setQ(v), setCursor(undefined))} placeholder="Search the summary" />
        <Button
          size="sm"
          onClick={() =>
            list.data &&
            void exportExcel(`audit-log-${from}-${to}`, [{ name: 'Audit log', columns: [{ header: 'When', key: 'at' }, { header: 'User', key: 'userName' }, { header: 'Record', key: 'entity' }, { header: 'Action', key: 'action' }, { header: 'Summary', key: 'summary', width: 60 }, { header: 'IP', key: 'ip' }, { header: 'Request id', key: 'requestId', width: 38 }], rows: list.data.items.map((x) => ({ ...x, at: when(x.at) })) }])
          }
        >
          Export to Excel
        </Button>
      </Toolbar>
      <DataTable
        caption="Audit log"
        rows={list.data?.items}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        rowId={(r) => r.id}
        onRowClick={setOpen}
        empty={{ title: 'No entries match', body: 'Every create, update, cancel, approval, payment and setting change is recorded here.' }}
        columns={[
          { id: 'at', header: 'When', cell: (r) => when(r.at), width: 190 },
          { id: 'u', header: 'User', cell: (r) => r.userName },
          { id: 'e', header: 'Record', cell: (r) => r.entity },
          { id: 'a', header: 'Action', cell: (r) => r.action },
          { id: 's', header: 'Summary', cell: (r) => r.summary, hideable: false },
          { id: 'ip', header: 'IP', cell: (r) => r.ip, defaultHidden: true },
        ]}
      />
      <div className="flex items-center gap-3 px-6 py-3 text-sm text-slate">
        {list.data ? `${list.data.total} entries` : ''}
        {cursor ? (
          <Button size="sm" onClick={() => setCursor(undefined)}>
            First page
          </Button>
        ) : null}
        {list.data?.nextCursor ? (
          <Button size="sm" onClick={() => setCursor(list.data?.nextCursor ?? undefined)}>
            Next page
          </Button>
        ) : null}
      </div>
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Audit entry">
        {open ? (
          <div className="flex flex-col gap-6">
            <KeyValue
              items={[
                { label: 'When', value: when(open.at) },
                { label: 'Who', value: open.userName },
                { label: 'Record', value: `${open.entity} ${open.entityId}` },
                { label: 'Action', value: open.action },
                { label: 'IP', value: open.ip },
                { label: 'Request id', value: <span className="break-all">{open.requestId}</span> },
              ]}
            />
            <p className="text-base">{open.summary}</p>
            <div>
              <h3 className="mb-2 text-base font-semibold">Before and after</h3>
              <Diff before={open.before} after={open.after} />
            </div>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

function LoginsTab() {
  const [outcome, setOutcome] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['login-history', outcome, dq], queryFn: () => api.get<{ items: LoginEvent[]; total: number }>('/login-history', { outcome, q: dq, limit: 200 }) });
  const online = useQuery({ queryKey: ['presence'], queryFn: () => api.get<{ items: { userId: string; name: string; role: string; since: string; minutes: number }[] }>('/presence'), refetchInterval: 15_000 });
  return (
    <>
      <Section title="Online now">
        {online.data?.items.length ? (
          <ul className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {online.data.items.map((p) => (
              <li key={p.userId} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                <span className="font-medium">{p.name}</span>
                <span className="text-slate">
                  {Math.floor(p.minutes / 60)} h {p.minutes % 60} m
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate">Nobody else is active right now.</p>
        )}
      </Section>
      <Toolbar>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Outcome</span>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="w-[160px]">
            <option value="">All</option>
            <option value="SUCCESS">Signed in</option>
            <option value="FAILED">Failed</option>
            <option value="LOCKED">Locked</option>
            <option value="LOGOUT">Signed out</option>
            <option value="TIMEOUT">Timed out</option>
          </Select>
        </label>
        <SearchBox value={q} onChange={setQ} placeholder="Username or IP" />
      </Toolbar>
      <DataTable
        caption="Login history"
        rows={list.data?.items}
        loading={list.isLoading}
        error={list.error}
        rowId={(r) => r.id}
        empty={{ title: 'No sign-in events match', body: 'Every sign-in, failure, lockout, sign-out and timeout is listed here.' }}
        columns={[
          { id: 'at', header: 'When', cell: (r) => when(r.at), width: 190 },
          { id: 'u', header: 'Username', cell: (r) => r.username },
          { id: 'o', header: 'Outcome', cell: (r) => <StatusText status={r.outcome} /> },
          { id: 'ip', header: 'IP', cell: (r) => r.ip },
          { id: 'ua', header: 'Device', cell: (r) => <span className="text-slate">{r.userAgent}</span> },
        ]}
      />
    </>
  );
}

function OutboxTab() {
  const q = useQuery({ queryKey: ['outbox'], queryFn: () => api.get<{ items: EmailOutbox[] }>('/outbox') });
  const [open, setOpen] = useState<EmailOutbox | null>(null);
  return (
    <>
      <p className="border-b border-hairline px-6 py-3 text-sm text-slate">Emails are simulated in the demo. They are listed here instead of being sent.</p>
      <DataTable
        caption="Outbox"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        rowId={(r) => r.id}
        onRowClick={setOpen}
        empty={{ title: 'No emails yet', body: 'Approval notifications create an email here.' }}
        columns={[
          { id: 'at', header: 'When', cell: (r) => when(r.at), width: 190 },
          { id: 'to', header: 'To', cell: (r) => r.to },
          { id: 's', header: 'Subject', cell: (r) => r.subject, hideable: false },
        ]}
      />
      <Drawer open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.subject ?? ''}>
        {open ? (
          <div className="flex flex-col gap-4 text-sm">
            <KeyValue items={[{ label: 'To', value: open.to }, { label: 'When', value: when(open.at) }]} />
            <p className="whitespace-pre-wrap border-t border-hairline pt-4 text-base">{open.body}</p>
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

export function Audit() {
  const [tab, setTab] = useState<'audit' | 'logins' | 'outbox'>('audit');
  return (
    <div>
      <PageHeader title="Audit and logins" description="An append-only record of who did what and when, with before and after values." />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Audit"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'audit', label: 'Audit log' },
            { value: 'logins', label: 'Login history' },
            { value: 'outbox', label: 'Email outbox' },
          ]}
        />
      </div>
      {tab === 'audit' ? <AuditTab /> : tab === 'logins' ? <LoginsTab /> : <OutboxTab />}
    </div>
  );
}
