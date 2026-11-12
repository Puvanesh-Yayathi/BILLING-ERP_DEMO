import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatQty } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { ChartPanel, C, ChartTooltip, axisProps } from '../../ui/charts';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { PageHeader } from '../../ui/layout';
import { formatDate } from '../common';
import { AdjustDrawer } from './Tracker';

interface Move {
  id: string;
  date: string;
  at: string;
  qty: number;
  reason: string;
  refType: string;
  refId: string;
  note: string;
  by: string;
  balance: number;
}

const REASON: Record<string, string> = { OPENING: 'Opening stock', PURCHASE: 'Received', PRODUCTION: 'Production', SALE: 'Sold', CANCEL: 'Bill cancelled', ADJUSTMENT: 'Adjustment' };
const DOC: Record<string, (id: string) => string> = { invoice: (id) => `/bills/${id}`, 'goods-receipt': (id) => `/purchase-bills/${id}/print`, batch: (id) => `/production/${id}/print` };

export function ItemDetail() {
  const { kind = 'sales', id = '' } = useParams();
  const navigate = useNavigate();
  const { role } = useSession();
  const [adjusting, setAdjusting] = useState(false);
  const q = useQuery({ queryKey: ['movements', kind, id], queryFn: () => api.get<{ item: { id: string; name: string; code?: string; reorderLevel: number }; movements: Move[] }>(`/inventory/items/${kind}/${id}/movements`) });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { item, movements } = q.data;
  const byDay = new Map<string, number>();
  for (const m of movements) byDay.set(m.date, m.balance);
  const series = [...byDay].map(([date, balance]) => ({ date, balance }));
  const current = movements.at(-1)?.balance ?? 0;
  return (
    <div>
      <PageHeader
        title={item.code ? `${item.code} ${item.name}` : item.name}
        description={`${kind === 'sales' ? 'Sales Inventory' : 'Purchase List'} item. Current stock ${formatQty(current)}, reorder level ${formatQty(item.reorderLevel)}.`}
        actions={role === 'ADMIN' || role === 'OPERATING' ? <Button onClick={() => setAdjusting(true)}>Adjust stock</Button> : null}
      />
      <ChartPanel title="Stock over time">
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={C.grid} />
              <XAxis dataKey="date" {...axisProps} tickFormatter={(v: string) => formatDate(v).slice(0, 5)} minTickGap={24} />
              <YAxis {...axisProps} width={48} />
              <Tooltip content={<ChartTooltip labelFormat={formatDate} valueFormat={(v) => formatQty(v)} />} />
              <Line type="stepAfter" dataKey="balance" name="Stock" stroke={C.tide} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </ChartPanel>
      <DataTable
        caption="Movement timeline and running balance"
        rows={[...movements].reverse()}
        rowId={(r) => r.id}
        onRowClick={(r) => {
          const f = DOC[r.refType];
          if (f) navigate(f(r.refId));
        }}
        empty={{ title: 'No movements yet', body: 'Purchases, production, sales and adjustments of this item appear here.' }}
        columns={[
          { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), width: 110 },
          { id: 'r', header: 'Movement', cell: (r) => REASON[r.reason] ?? r.reason },
          { id: 'n', header: 'Document or reason', cell: (r) => r.note },
          { id: 'by', header: 'By', cell: (r) => r.by },
          { id: 'q', header: 'Quantity', align: 'right', cell: (r) => <span className={r.qty < 0 ? 'text-danger' : 'text-success'}>{r.qty > 0 ? '+' : '−'}{formatQty(Math.abs(r.qty))}</span> },
          { id: 'b', header: 'Balance', align: 'right', cell: (r) => <span className="font-medium">{formatQty(r.balance)}</span> },
        ]}
      />
      <AdjustDrawer open={adjusting} onOpenChange={setAdjusting} kind={kind === 'sales' ? 'SALES' : 'PURCHASE'} items={[{ id: item.id, name: item.code ? `${item.code} ${item.name}` : item.name }]} initialId={item.id} />
    </div>
  );
}
