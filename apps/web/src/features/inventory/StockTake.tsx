import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatQty, type StockCount } from '@app/contract';
import { api } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { InlineError, SkeletonRows } from '../../ui/feedback';
import { Input, QtyInput } from '../../ui/form';
import { PageHeader, Section } from '../../ui/layout';
import { Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { formatDate } from '../common';
import type { TrackerRow } from './Tracker';

type Count = StockCount & { by: string };

export function StockTake() {
  const [kind, setKind] = useState<'SALES' | 'PURCHASE'>('SALES');
  const [counted, setCounted] = useState<Record<string, number | undefined>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const tracker = useQuery({ queryKey: ['inventory', kind === 'SALES' ? 'sales' : 'purchase', 'all'], queryFn: () => api.get<{ items: TrackerRow[] }>(`/inventory/${kind === 'SALES' ? 'sales' : 'purchase'}`) });
  const counts = useQuery({ queryKey: ['stock-counts'], queryFn: () => api.get<{ items: Count[] }>('/stock-counts') });
  const draft = counts.data?.items.find((c) => c.status === 'DRAFT' && c.kind === kind);
  const create = useAction(
    () =>
      api.post<StockCount>('/stock-counts', {
        kind,
        lines: Object.entries(counted)
          .filter(([, v]) => v !== undefined)
          .map(([itemId, v]) => ({ itemId, countedQty: v ?? 0, reason: reasons[itemId] ?? '' })),
      }),
    { success: (c) => `Saved stock take ${c.number}. Review the variance, then confirm.`, onDone: () => (setCounted({}), setReasons({})) },
  );
  const confirm = useAction((id: string) => api.post<StockCount>(`/stock-counts/${id}/confirm`), { success: (c) => `Confirmed stock take ${c.number}. Variances were posted as adjustments.` });
  const name = (id: string) => {
    const r = tracker.data?.items.find((x) => x.id === id);
    return r ? (r.code ? `${r.code} ${r.name}` : r.name) : id;
  };
  const entered = Object.values(counted).filter((v) => v !== undefined).length;
  return (
    <div>
      <PageHeader title="Stock take" description="Enter physical counts, see the variance against the system, and confirm. Confirmed variances post as adjustments with your reason." />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Stock"
          value={kind}
          onChange={(v) => {
            setKind(v);
            setCounted({});
            setReasons({});
          }}
          items={[
            { value: 'SALES', label: 'Sales stock' },
            { value: 'PURCHASE', label: 'Purchase stock' },
          ]}
        />
      </div>
      {draft ? (
        <Section title={`Stock take ${draft.number} waiting for confirmation`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-th text-slate">
                <th className="py-2 text-left font-semibold">Item</th>
                <th className="py-2 text-right font-semibold">System</th>
                <th className="py-2 text-right font-semibold">Counted</th>
                <th className="py-2 text-right font-semibold">Variance</th>
                <th className="py-2 pl-4 text-left font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {draft.lines.map((l) => (
                <tr key={l.itemId} className="border-b border-hairline">
                  <td className="py-2">{name(l.itemId)}</td>
                  <td className="py-2 text-right tabular-nums">{formatQty(l.systemQty)}</td>
                  <td className="py-2 text-right tabular-nums">{formatQty(l.countedQty)}</td>
                  <td className={`py-2 text-right font-medium tabular-nums ${l.variance < 0 ? 'text-danger' : l.variance > 0 ? 'text-success' : 'text-slate'}`}>{l.variance ? `${l.variance > 0 ? '+' : '−'}${formatQty(Math.abs(l.variance))}` : 'None'}</td>
                  <td className="py-2 pl-4">{l.reason || (l.variance ? <span className="text-danger">Reason missing</span> : '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4">
            <InlineError error={confirm.error} />
          </div>
          <Button className="mt-4" variant="primary" loading={confirm.busy} onClick={() => void confirm.run(draft.id)}>
            Confirm stock take
          </Button>
        </Section>
      ) : (
        <Section title="Enter counts" flush>
          {tracker.isLoading ? (
            <SkeletonRows />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-mist">
                  <tr className="border-y border-hairline text-th text-slate">
                    <th className="h-9 px-4 text-left font-semibold">Item</th>
                    <th className="h-9 px-4 text-right font-semibold">System</th>
                    <th className="h-9 px-4 text-right font-semibold">Counted</th>
                    <th className="h-9 px-4 text-right font-semibold">Variance</th>
                    <th className="h-9 px-4 text-left font-semibold">Reason for a variance</th>
                  </tr>
                </thead>
                <tbody>
                  {tracker.data?.items.map((r) => {
                    const c = counted[r.id];
                    const v = c === undefined ? 0 : c - r.closing;
                    return (
                      <tr key={r.id} className="border-b border-hairline">
                        <td className="px-4 py-2">{r.code ? `${r.code} ${r.name}` : r.name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatQty(r.closing)} {r.unit}
                        </td>
                        <td className="w-36 px-2 py-2">
                          <QtyInput ariaLabel={`Counted ${r.name}`} value={c} onChange={(x) => setCounted((m) => ({ ...m, [r.id]: x }))} />
                        </td>
                        <td className={`px-4 py-2 text-right tabular-nums ${v < 0 ? 'text-danger' : v > 0 ? 'text-success' : 'text-slate'}`}>{c === undefined ? '' : v ? `${v > 0 ? '+' : '−'}${formatQty(Math.abs(v))}` : 'None'}</td>
                        <td className="px-2 py-2">
                          <Input aria-label={`Reason for ${r.name}`} value={reasons[r.id] ?? ''} disabled={!v} invalid={!!v && (reasons[r.id] ?? '').trim().length < 3} placeholder={v ? 'Required' : ''} onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-center gap-4 px-6 py-4">
            <Button variant="primary" disabled={!entered} loading={create.busy} onClick={() => void create.run()}>
              Save counts
            </Button>
            <span className="text-sm text-slate">{entered ? `${entered} items counted` : 'Enter a count for the items you checked'}</span>
          </div>
        </Section>
      )}
      <Section title="Previous stock takes" flush>
        <DataTable
          caption="Stock takes"
          toolbar={false}
          rows={counts.data?.items}
          loading={counts.isLoading}
          rowId={(r) => r.id}
          empty={{ title: 'No stock takes yet', body: 'Confirmed stock takes are listed here.' }}
          columns={[
            { id: 'n', header: 'Number', cell: (r) => r.number },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date) },
            { id: 'k', header: 'Stock', cell: (r) => (r.kind === 'SALES' ? 'Sales' : 'Purchase') },
            { id: 'l', header: 'Items', align: 'right', cell: (r) => r.lines.length },
            { id: 'v', header: 'With variance', align: 'right', cell: (r) => r.lines.filter((l) => l.variance !== 0).length },
            { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
            { id: 'by', header: 'By', cell: (r) => r.by },
          ]}
        />
      </Section>
    </div>
  );
}
