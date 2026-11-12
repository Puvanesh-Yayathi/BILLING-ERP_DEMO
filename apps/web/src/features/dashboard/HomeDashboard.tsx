import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatINR, formatINRCompact, formatQty } from '@app/contract';
import { api } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { useMe } from '../../lib/session';
import { Button } from '../../ui/Button';
import { ChartPanel, ChartTooltip, C, RankedBars, axisProps, moneyTick } from '../../ui/charts';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { Input, Switch } from '../../ui/form';
import { PageHeader, Section } from '../../ui/layout';
import { Segmented } from '../../ui/overlay';
import { Change, StatusText } from '../../ui/status';
import { formatDate, today } from '../common';
import { LiveFeed } from './LiveFeed';
import { firstEntrance, useCountUp } from './useCountUp';

type Period = 'day' | 'week' | 'month' | 'year';
interface Range {
  from: string;
  to: string;
  label: string;
}

interface Overview {
  range: Range;
  previous: Range;
  kpis: { sales: number; salesGross: number; purchases: number; grossProfit?: number; bills: number; avgBill: number; collections: number; dues: number; overdue: number; expenses: number; fundReceived: number; fundUtilised: number; fundBalance: number; loanOutstanding?: number; finishedStockValue: number; rawStockValue: number };
  prevKpis: { sales: number; purchases: number; grossProfit?: number; bills: number; avgBill: number; collections: number; expenses: number } | null;
  series: { key: string; label: string; sales: number; purchases: number; profit?: number; prevSales?: number }[];
  topCustomers: { name: string; value: number }[];
  topProducts: { id: string; name: string; qty: number; value: number }[];
  categoryShare: { name: string; value: number }[];
  paymentModes: { mode: string; value: number }[];
  salesByHour: { hour: number; value: number }[];
  workers: { id: string; name: string; bills: number; value: number }[];
  lowStock: { id: string; code?: string; name: string; closing: number; reorderLevel: number; status: string; unit: string; kind: 'sales' | 'purchase' }[];
  duesAgeing: { b0_15: number; b16_30: number; b31: number };
  pendingApprovals: { id: string; number: string; stage: number; total: number; supplier: string }[];
  production: { batches: number; inputQty: number; outputQty: number; wastage: number; wastagePct: number };
  attendance: { presentToday: number; activeWorkers: number } | null;
}

interface MyOverview {
  range: Range;
  kpis: { bills: number; salesValue: number; itemsSold: number; receipts: number; receiptValue: number; batches: number; daysWorked: number; hoursWorked: number; paid: number };
  prevKpis: { bills: number; salesValue: number; itemsSold: number; receipts: number; receiptValue: number; batches: number } | null;
  series: { key: string; label: string; sales: number; prevSales?: number }[];
  recentBills: { id: string; number: string | null; date: string; total: number; status: string; customer: string }[];
}

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
];

function Kpi({ label, value, prev, money = true, invert, onClick, hint }: { label: string; value: number | undefined; prev?: number | null; money?: boolean; invert?: boolean; onClick?: () => void; hint?: ReactNode }) {
  const shown = useCountUp(value);
  const text = shown === undefined ? '—' : money ? formatINRCompact(shown) : String(shown);
  const body = (
    <>
      <span className="text-meta text-slate">{label}</span>
      <span className={`text-kpi font-semibold tabular-nums ${value !== undefined && value < 0 ? 'text-danger' : 'text-deep'}`} title={value !== undefined && money ? formatINR(value) : undefined}>
        {text}
      </span>
      <span className="min-h-[18px]">{value !== undefined && prev !== undefined && prev !== null ? <Change cur={value} prev={prev} invert={invert} /> : hint}</span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-w-[150px] flex-1 flex-col items-start gap-1 border-b border-r border-hairline px-6 py-4 text-left transition-colors duration-120 hover:bg-mist lg:border-b-0">
      {body}
    </button>
  ) : (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1 border-b border-r border-hairline px-6 py-4 lg:border-b-0">{body}</div>
  );
}

function useDashboardControls() {
  const [period, setPeriod] = useState<Period>('month');
  const [date, setDate] = useState(today());
  const [compare, setCompare] = useState(true);
  return { period, setPeriod, date, setDate, compare, setCompare };
}

function Controls({ c, onExport }: { c: ReturnType<typeof useDashboardControls>; onExport?: () => void }) {
  return (
    <>
      <Segmented label="Period" value={c.period} onChange={c.setPeriod} items={PERIODS} />
      <label className="sr-only" htmlFor="dash-date">
        Date
      </label>
      <Input id="dash-date" type="date" value={c.date} max={today()} onChange={(e) => c.setDate(e.target.value || today())} className="w-[150px]" />
      <Switch label="Compare" checked={c.compare} onChange={c.setCompare} />
      {onExport ? (
        <Button size="sm" onClick={onExport}>
          Export
        </Button>
      ) : null}
    </>
  );
}

function TrendChart({ data, compare, showPurchases, period }: { data: { label: string; sales: number; purchases?: number; prevSales?: number }[]; compare: boolean; showPurchases: boolean; period: Period }) {
  const [animate] = useState(firstEntrance);
  const fmt = (l: string) => (period === 'day' ? l : period === 'year' ? new Date(`${l}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) : formatDate(l).slice(0, 5));
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke={C.grid} />
          <XAxis dataKey="label" {...axisProps} tickFormatter={fmt} minTickGap={18} />
          <YAxis {...axisProps} tickFormatter={moneyTick} width={56} />
          <Tooltip content={<ChartTooltip labelFormat={fmt} />} />
          <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: C.axis }} />
          {compare ? <Line type="monotone" dataKey="prevSales" name="Previous period" stroke={C.prev} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={animate} animationDuration={600} /> : null}
          {showPurchases ? <Line type="monotone" dataKey="purchases" name="Purchases" stroke={C.brown} strokeWidth={2} dot={false} isAnimationActive={animate} animationDuration={600} /> : null}
          <Line type="monotone" dataKey="sales" name="Sales" stroke={C.tide} strokeWidth={2.25} dot={false} isAnimationActive={animate} animationDuration={600} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function CompanyDashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const admin = me.user.role === 'ADMIN';
  const c = useDashboardControls();
  const q = useQuery({ queryKey: ['overview', c.period, c.date, c.compare], queryFn: () => api.get<Overview>('/analytics/overview', { period: c.period, date: c.date, compare: c.compare }), placeholderData: keepPreviousData });
  const d = q.data;
  const k = d?.kpis;
  const p = d?.prevKpis;
  const range = d ? `?from=${d.range.from}&to=${d.range.to}` : '';
  const exportIt = () =>
    d &&
    void exportExcel(`dashboard-${d.range.label}`, [
      { name: 'Figures', columns: [{ header: 'Figure', key: 'k' }, { header: 'Value', key: 'v' }], rows: Object.entries(k ?? {}).filter(([, v]) => v !== undefined).map(([key, v]) => ({ k: key, v: key === 'bills' ? String(v) : formatINR(v as number) })) },
      { name: 'Trend', columns: [{ header: 'Period', key: 'label' }, { header: 'Sales', key: 'sales', type: 'money' }, { header: 'Purchases', key: 'purchases', type: 'money' }, ...(c.compare ? [{ header: 'Previous sales', key: 'prevSales', type: 'money' as const }] : [])], rows: d.series },
    ]);
  if (q.error && !d) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div>
      <PageHeader title="Dashboard" description={d ? `${d.range.label === d.range.from ? formatDate(d.range.from) : `${formatDate(d.range.from)} to ${formatDate(d.range.to)}`}${c.compare ? `, compared with ${formatDate(d.previous.from)} to ${formatDate(d.previous.to)}` : ''}. Sales are shown at taxable value.` : 'Loading figures'} actions={<Controls c={c} onExport={exportIt} />} />
      <div className="flex flex-wrap border-b border-hairline" aria-busy={q.isFetching || undefined}>
        <Kpi label="Sales" value={k?.sales} prev={p?.sales} onClick={() => navigate(`/explorer${range}`)} />
        <Kpi label="Purchases" value={k?.purchases} prev={p?.purchases} invert onClick={() => navigate('/purchase-bills')} />
        {admin ? <Kpi label="Gross profit" value={k?.grossProfit} prev={p?.grossProfit} onClick={() => navigate('/settlements')} /> : null}
        <Kpi label="Bills" value={k?.bills} prev={p?.bills} money={false} onClick={() => navigate(`/explorer${range}`)} />
        <Kpi label="Average bill" value={k?.avgBill} prev={p?.avgBill} />
        <Kpi label="Collections" value={k?.collections} prev={p?.collections} onClick={admin ? () => navigate('/payments') : undefined} />
        <Kpi label="Outstanding dues" value={k?.dues} hint={k?.overdue ? <span className="text-sm font-medium text-danger">{formatINRCompact(k.overdue)} overdue</span> : undefined} onClick={admin ? () => navigate('/dues') : undefined} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px]">
        <ChartPanel title="Sales and purchases" className="xl:border-r">
          {d ? <TrendChart data={d.series} compare={c.compare} showPurchases period={c.period} /> : <Skeleton className="h-72" />}
        </ChartPanel>
        <LiveFeed />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3">
        {admin ? (
          <ChartPanel title="Sales by worker" className="lg:border-r">
            <RankedBars items={(d?.workers ?? []).map((w) => ({ key: w.id, label: w.name, value: w.value, sub: `${w.bills} ${w.bills === 1 ? 'bill' : 'bills'}` }))} onClick={(id) => navigate(`/explorer?worker=${id}&group=worker${range ? `&${range.slice(1)}` : ''}`)} />
          </ChartPanel>
        ) : (
          <ChartPanel title="Top customers" className="lg:border-r">
            <RankedBars items={(d?.topCustomers ?? []).map((x) => ({ key: x.name, label: x.name, value: x.value }))} />
          </ChartPanel>
        )}
        <ChartPanel title="Sales by hour of day" className="lg:border-r">
          <HourStrip data={d?.salesByHour ?? []} />
        </ChartPanel>
        <ChartPanel title="Top products">
          <RankedBars tone="brown" items={(d?.topProducts ?? []).map((x) => ({ key: x.id, label: x.name, value: x.value, sub: `${formatQty(x.qty)} sold` }))} onClick={(id) => navigate(`/inventory/sales/${id}`)} />
        </ChartPanel>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3">
        <Section title="Inventory health" className="lg:border-r">
          {d?.lowStock.length ? (
            <ul className="divide-y divide-hairline text-sm">
              {d.lowStock.slice(0, 8).map((s) => (
                <li key={`${s.kind}-${s.id}`}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-mist" onClick={() => navigate(`/inventory/${s.kind}/${s.id}`)}>
                    <span className="min-w-0 truncate">{s.code ? `${s.code} ${s.name}` : s.name}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums text-slate">
                        {formatQty(s.closing)} of {formatQty(s.reorderLevel)}
                      </span>
                      <StatusText status={s.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate">{d ? 'Every item is above its reorder level.' : ''}</p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-sm">
            <div>
              <dt className="text-meta text-slate">Finished stock value</dt>
              <dd className="font-medium tabular-nums">{k ? formatINRCompact(k.finishedStockValue) : '—'}</dd>
            </div>
            <div>
              <dt className="text-meta text-slate">Raw stock value</dt>
              <dd className="font-medium tabular-nums">{k ? formatINRCompact(k.rawStockValue) : '—'}</dd>
            </div>
          </dl>
        </Section>
        <Section title="Outstanding by age" className="lg:border-r">
          <RankedBars
            items={d ? [
              { key: '0', label: '0 to 15 days', value: d.duesAgeing.b0_15 },
              { key: '16', label: '16 to 30 days', value: d.duesAgeing.b16_30 },
              { key: '31', label: '31 days or more', value: d.duesAgeing.b31 },
            ] : []}
            onClick={admin ? () => navigate('/dues') : undefined}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-sm">
            {d?.paymentModes.map((m) => (
              <div key={m.mode}>
                <dt className="text-meta text-slate">Collected by {m.mode === 'BANK' ? 'bank' : m.mode === 'CASH' ? 'cash' : m.mode === 'CARD' ? 'card' : 'UPI'}</dt>
                <dd className="font-medium tabular-nums">{formatINRCompact(m.value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="Pending approvals">
          {d?.pendingApprovals.length ? (
            <ul className="divide-y divide-hairline text-sm">
              {d.pendingApprovals.map((a) => (
                <li key={a.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-mist" onClick={() => navigate(`/indents/${a.id}`)}>
                    <span>
                      <span className="font-medium">{a.number}</span> <span className="text-slate">{a.supplier}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums">{formatINRCompact(a.total)}</span>
                      <StatusText status="PENDING_S1" label="Waiting" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate">{d ? 'No indent is waiting for approval.' : ''}</p>
          )}
        </Section>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3">
        <Section title="Funds" className="lg:border-r">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Received', k?.fundReceived],
              ['Used', k?.fundUtilised],
              ['Balance', k?.fundBalance],
              ...(admin ? [['Loan outstanding', k?.loanOutstanding] as [string, number | undefined]] : []),
              ['Other expenses', k?.expenses],
            ].map(([l, v]) => (
              <div key={l as string}>
                <dt className="text-meta text-slate">{l}</dt>
                <dd className="font-medium tabular-nums">{v !== undefined ? formatINRCompact(v as number) : '—'}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="Production and wastage" className="lg:border-r">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-meta text-slate">Batches</dt>
              <dd className="font-medium">{d?.production.batches ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-meta text-slate">Output</dt>
              <dd className="font-medium tabular-nums">{d ? formatQty(d.production.outputQty) : '—'}</dd>
            </div>
            <div>
              <dt className="text-meta text-slate">Wastage</dt>
              <dd className="font-medium tabular-nums">{d ? `${formatQty(d.production.wastage)} (${d.production.wastagePct}%)` : '—'}</dd>
            </div>
            {d?.categoryShare.map((cat) => (
              <div key={cat.name}>
                <dt className="text-meta text-slate">{cat.name} sales</dt>
                <dd className="font-medium tabular-nums">{formatINRCompact(cat.value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title={admin ? 'Attendance today' : 'Top customers'}>
          {admin ? (
            <p className="text-sm">
              <span className="text-kpi font-semibold">{d?.attendance?.presentToday ?? '—'}</span>
              <span className="text-slate"> of {d?.attendance?.activeWorkers ?? '—'} workers present</span>
              <Button size="sm" variant="ghost" className="ml-2" onClick={() => navigate('/attendance')}>
                Open attendance
              </Button>
            </p>
          ) : (
            <RankedBars items={(d?.topCustomers ?? []).slice(0, 4).map((x) => ({ key: x.name, label: x.name, value: x.value }))} />
          )}
        </Section>
      </div>
    </div>
  );
}

function HourStrip({ data }: { data: { hour: number; value: number }[] }) {
  const hours = data.filter((d) => d.hour >= 7 && d.hour <= 21);
  const max = Math.max(1, ...hours.map((h) => h.value));
  return (
    <div>
      <div className="flex h-32 items-end gap-1 px-2" role="img" aria-label="Sales by hour of day">
        {hours.map((h) => (
          <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end" title={`${h.hour}:00 to ${h.hour + 1}:00, ${formatINR(h.value)}`}>
            <div className="w-full origin-bottom rounded-t-[2px] bg-tide transition-transform duration-240 ease-std" style={{ height: '100%', transform: `scaleY(${h.value / max})`, opacity: h.value ? 1 : 0.15 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between px-2 text-meta text-slate">
        <span>7 AM</span>
        <span>2 PM</span>
        <span>9 PM</span>
      </div>
    </div>
  );
}

function WorkerDashboard() {
  const me = useMe();
  const navigate = useNavigate();
  const c = useDashboardControls();
  const q = useQuery({ queryKey: ['my-overview', c.period, c.date, c.compare], queryFn: () => api.get<MyOverview>('/my/analytics', { period: c.period, date: c.date, compare: c.compare }), placeholderData: keepPreviousData });
  const d = q.data;
  const k = d?.kpis;
  const p = d?.prevKpis;
  if (q.error && !d) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div>
      <PageHeader title={`Welcome, ${me.user.name}`} description="Your own work only. Company totals and other workers are not shown." actions={<Controls c={c} />} />
      <div className="flex flex-wrap border-b border-hairline">
        <Kpi label="Bills I created" value={k?.bills} prev={p?.bills} money={false} onClick={() => navigate('/bills')} />
        <Kpi label="Sales I billed" value={k?.salesValue} prev={p?.salesValue} onClick={() => navigate('/bills')} />
        <Kpi label="Items sold" value={k ? Math.round(k.itemsSold) : undefined} prev={p ? Math.round(p.itemsSold) : null} money={false} />
        <Kpi label="Receipts recorded" value={k?.receipts} prev={p?.receipts} money={false} onClick={() => navigate('/payments')} />
        {me.user.role === 'OPERATING' ? <Kpi label="Batches recorded" value={k?.batches} prev={p?.batches} money={false} onClick={() => navigate('/production')} /> : null}
        <Kpi label="Days worked" value={k?.daysWorked} money={false} hint={k ? <span className="text-sm text-slate">{k.hoursWorked} paid hours</span> : undefined} />
        <Kpi label="Paid to me" value={k?.paid} onClick={() => navigate('/my/pay')} />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px]">
        <ChartPanel title="My sales" className="xl:border-r">
          {d ? <TrendChart data={d.series} compare={c.compare} showPurchases={false} period={c.period} /> : <Skeleton className="h-72" />}
        </ChartPanel>
        <Section title="My recent bills" flush>
          <ul className="divide-y divide-hairline">
            {d?.recentBills.map((b) => (
              <li key={b.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-6 py-2.5 text-left text-sm hover:bg-mist" onClick={() => navigate(`/bills/${b.id}`)}>
                  <span className="min-w-0">
                    <span className="block font-medium">{b.number ?? 'Draft'}</span>
                    <span className="block truncate text-meta text-slate">
                      {b.customer}, {formatDate(b.date)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="tabular-nums">{formatINR(b.total)}</span>
                    <StatusText status={b.status} />
                  </span>
                </button>
              </li>
            ))}
            {d && !d.recentBills.length ? <li className="px-6 py-4 text-sm text-slate">Bills you create will appear here.</li> : null}
          </ul>
          <div className="px-6 py-4">
            <Button variant="primary" onClick={() => navigate('/bills/new')}>
              New bill
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}

export function HomeDashboard() {
  const me = useMe();
  if (me.user.role === 'DISTRIBUTOR') return null;
  if (me.user.role === 'STAFF' || me.user.role === 'OPERATING') return <WorkerDashboard />;
  return <CompanyDashboard />;
}
