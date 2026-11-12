import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatQty } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Field, QtyInput, Select, Textarea } from '../../ui/form';
import { FigureBand, Money, PageHeader, Section, Toolbar } from '../../ui/layout';
import { Drawer, Segmented, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { DateRange, formatDate, monthStartOf, today } from '../common';

export interface TrackerRow {
  id: string;
  code?: string;
  name: string;
  category: string;
  unit: string;
  supplier?: string;
  opening: number;
  inQty: number;
  outQty: number;
  adjusted: number;
  closing: number;
  reorderLevel: number;
  status: 'IN_STOCK' | 'LOW' | 'OUT';
  unitValue: number;
  value: number;
  suggestedReorder: number;
  slowMoving: boolean;
}

const CATEGORY: Record<string, string> = { RAW_MATERIAL: 'Raw material', PACKAGING: 'Packaging', CONSUMABLE: 'Consumable', OTHER: 'Other' };

export function AdjustDrawer({ open, onOpenChange, kind, items, initialId }: { open: boolean; onOpenChange: (v: boolean) => void; kind: 'PURCHASE' | 'SALES'; items: { id: string; name: string }[]; initialId?: string }) {
  const [itemId, setItemId] = useState(initialId ?? '');
  const [direction, setDirection] = useState<'add' | 'remove'>('remove');
  const [qty, setQty] = useState<number | undefined>();
  const [reason, setReason] = useState('');
  const key = useRef(newIdempotencyKey());
  const save = useAction(() => api.post('/stock-adjustments', { kind, itemId, qty: (qty ?? 0) * (direction === 'add' ? 1 : -1), reason }, { idempotencyKey: key.current }), {
    success: 'Adjusted stock',
    onDone: () => {
      key.current = newIdempotencyKey();
      setQty(undefined);
      setReason('');
      onOpenChange(false);
    },
  });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Adjust stock"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            Adjust stock
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Item" htmlFor="adj-item" error={f.itemId}>
          <Select id="adj-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Segmented
          label="Direction"
          value={direction}
          onChange={setDirection}
          items={[
            { value: 'remove', label: 'Remove stock' },
            { value: 'add', label: 'Add stock' },
          ]}
        />
        <Field label="Quantity" htmlFor="adj-qty" error={f.qty}>
          <QtyInput id="adj-qty" value={qty} onChange={setQty} invalid={!!f.qty} />
        </Field>
        <Field label="Reason" htmlFor="adj-reason" error={f.reason} helper="Required. It is shown in the item timeline and the audit log.">
          <Textarea id="adj-reason" value={reason} invalid={!!f.reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

export function Tracker() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [tab, setTab] = useState<'purchase' | 'sales'>('sales');
  const [from, setFrom] = useState(monthStartOf());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const q = useQuery({ queryKey: ['inventory', tab, from, to], queryFn: () => api.get<{ items: TrackerRow[]; totalValue: number; wastage?: { id: string; batchNo: string; date: string; wastageQty: number; inputQty: number; note: string }[] }>(`/inventory/${tab}`, { from, to }) });
  const rows = useMemo(() => (q.data?.items ?? []).filter((r) => (!status || r.status === status) && (!category || r.category === category)), [q.data, status, category]);
  const cats = [...new Set((q.data?.items ?? []).map((r) => r.category))];
  const canWrite = role === 'ADMIN' || role === 'OPERATING';
  const low = (q.data?.items ?? []).filter((r) => r.status !== 'IN_STOCK');
  return (
    <div>
      <PageHeader
        title="Inventory tracker"
        description="Purchase stock (what you buy) and sales stock (what you sell). Every figure is derived from stock movements."
        actions={
          <>
            {canWrite ? <Button onClick={() => setAdjusting(true)}>Adjust stock</Button> : null}
            {canWrite ? <Button onClick={() => navigate('/stock-take')}>Stock take</Button> : null}
            <Button
              onClick={() =>
                void exportExcel(`${tab}-stock-${to}`, [
                  {
                    name: tab === 'sales' ? 'Sales stock' : 'Purchase stock',
                    columns: [
                      { header: 'Item', key: 'name' },
                      { header: 'Category', key: 'category' },
                      { header: 'Unit', key: 'unit' },
                      { header: 'Opening', key: 'opening', type: 'qty' },
                      { header: tab === 'sales' ? 'Produced' : 'Received', key: 'inQty', type: 'qty' },
                      { header: tab === 'sales' ? 'Sold' : 'Used', key: 'outQty', type: 'qty' },
                      { header: 'Adjusted', key: 'adjusted', type: 'qty' },
                      { header: 'Closing', key: 'closing', type: 'qty' },
                      { header: 'Reorder level', key: 'reorderLevel', type: 'qty' },
                      { header: tab === 'sales' ? 'Selling price' : 'Average cost', key: 'unitValue', type: 'money' },
                      { header: 'Value', key: 'value', type: 'money' },
                    ],
                    rows: rows.map((r) => ({ ...r, name: r.code ? `${r.code} ${r.name}` : r.name })),
                    totals: { name: 'Total', value: rows.reduce((a, r) => a + r.value, 0) },
                  },
                ])
              }
            >
              Export to Excel
            </Button>
          </>
        }
      />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Stock"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setCategory('');
          }}
          items={[
            { value: 'sales', label: 'Sales stock' },
            { value: 'purchase', label: 'Purchase stock' },
          ]}
        />
      </div>
      <FigureBand
        items={[
          { label: 'Stock value', value: <Money value={q.data?.totalValue} compact />, sub: <span className="text-slate">{tab === 'sales' ? 'At selling price' : 'At average cost'}</span> },
          { label: 'Items', value: q.data?.items.length ?? '—' },
          { label: 'Low stock', value: <span className={low.some((r) => r.status === 'LOW') ? 'text-caution' : ''}>{low.filter((r) => r.status === 'LOW').length}</span>, onClick: () => setStatus('LOW') },
          { label: 'Out of stock', value: <span className={low.some((r) => r.status === 'OUT') ? 'text-danger' : ''}>{low.filter((r) => r.status === 'OUT').length}</span>, onClick: () => setStatus('OUT') },
        ]}
      />
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[150px]">
            <option value="">All</option>
            <option value="IN_STOCK">In stock</option>
            <option value="LOW">Low</option>
            <option value="OUT">Out of stock</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Category</span>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-[170px]">
            <option value="">All</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {CATEGORY[c] ?? c}
              </option>
            ))}
          </Select>
        </label>
      </Toolbar>
      <DataTable
        caption={tab === 'sales' ? 'Sales stock' : 'Purchase stock'}
        rows={q.data ? rows : undefined}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/inventory/${tab}/${r.id}`)}
        rowTone={(r) => (r.status === 'OUT' ? 'danger' : undefined)}
        empty={{ title: 'No items match', body: 'Clear the filters to see every item.' }}
        columns={[
          { id: 'name', header: 'Item', cell: (r) => (r.code ? <span><span className="font-medium">{r.code}</span> {r.name}</span> : <span className="font-medium">{r.name}</span>), sortValue: (r) => r.code ?? r.name, hideable: false, total: 'Total' },
          { id: 'cat', header: 'Category', cell: (r) => CATEGORY[r.category] ?? r.category, defaultHidden: tab === 'sales' },
          { id: 'sup', header: 'Supplier', cell: (r) => r.supplier ?? '', defaultHidden: true },
          { id: 'open', header: 'Opening', align: 'right', cell: (r) => formatQty(r.opening) },
          { id: 'in', header: tab === 'sales' ? 'Produced' : 'Received', align: 'right', cell: (r) => formatQty(r.inQty) },
          { id: 'out', header: tab === 'sales' ? 'Sold' : 'Used', align: 'right', cell: (r) => formatQty(r.outQty) },
          { id: 'adj', header: 'Adjusted', align: 'right', cell: (r) => (r.adjusted ? formatQty(r.adjusted) : '') },
          { id: 'close', header: 'Closing', align: 'right', cell: (r) => <span className="font-semibold">{formatQty(r.closing)} <span className="font-normal text-slate">{r.unit}</span></span>, sortValue: (r) => r.closing },
          { id: 'reorder', header: 'Reorder at', align: 'right', cell: (r) => formatQty(r.reorderLevel) },
          { id: 'status', header: 'Status', cell: (r) => <span className="flex flex-col"><StatusText status={r.status} />{r.suggestedReorder ? <span className="text-meta text-slate">Suggest {tab === 'sales' ? 'making' : 'ordering'} {formatQty(r.suggestedReorder)}</span> : null}{r.slowMoving ? <span className="text-meta text-slate">No sales in 30 days</span> : null}</span> },
          { id: 'unit', header: tab === 'sales' ? 'Selling price' : 'Average cost', align: 'right', cell: (r) => <Money value={r.unitValue} /> },
          { id: 'value', header: 'Value', align: 'right', cell: (r) => <Money value={r.value} />, sortValue: (r) => r.value, total: <Money value={rows.reduce((a, r) => a + r.value, 0)} /> },
        ]}
      />
      {tab === 'sales' && q.data?.wastage?.length ? (
        <Section title="Wastage in this period">
          <ul className="divide-y divide-hairline text-sm">
            {q.data.wastage.map((w) => (
              <li key={w.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{w.batchNo}</span> on {formatDate(w.date)}: {w.note}
                </span>
                <span className="tabular-nums">
                  {formatQty(w.wastageQty)} of {formatQty(w.inputQty)} ({w.inputQty ? ((w.wastageQty / w.inputQty) * 100).toFixed(1) : 0}%)
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {canWrite ? <AdjustDrawer open={adjusting} onOpenChange={setAdjusting} kind={tab === 'sales' ? 'SALES' : 'PURCHASE'} items={(q.data?.items ?? []).map((r) => ({ id: r.id, name: r.code ? `${r.code} ${r.name}` : r.name }))} /> : null}
    </div>
  );
}
