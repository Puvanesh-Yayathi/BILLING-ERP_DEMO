import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Payment } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Money, PageHeader, Toolbar } from '../../ui/layout';
import { DateRange, MODE_LABEL, SearchBox, daysAgo, formatDate, today, useDebounced } from '../common';

type Row = Payment & { customer: string; receivedBy: string; invoices: string[] };

export function Receipts() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const query = useQuery({ queryKey: ['payments', from, to, dq], queryFn: () => api.get<{ items: Row[] }>('/payments', { from, to, q: dq, limit: 500 }) });
  const sell = role !== 'DISTRIBUTOR';
  return (
    <div>
      <PageHeader
        title="Receipts"
        description={role === 'STAFF' || role === 'OPERATING' ? 'Payments you recorded.' : 'Payments received from customers and distributors.'}
        actions={
          sell ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/payments/new')}>
              Receive payment
            </Button>
          ) : null
        }
      />
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <SearchBox value={q} onChange={setQ} placeholder="Receipt, customer or reference" />
      </Toolbar>
      <DataTable
        caption="Receipts"
        rows={query.data?.items}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/payments/${r.id}/print`)}
        empty={{ title: 'No receipts in this period', body: 'Recorded payments and cash bills appear here with a printable receipt.' }}
        columns={[
          { id: 'no', header: 'Receipt', cell: (r) => <span className="font-medium">{r.receiptNo}</span>, sortValue: (r) => r.receiptNo, hideable: false, total: `${query.data?.items.length ?? 0} receipts` },
          { id: 'date', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { id: 'customer', header: 'Customer', cell: (r) => r.customer, sortValue: (r) => r.customer },
          { id: 'bills', header: 'Applied to', cell: (r) => (r.invoices.length ? r.invoices.join(', ') : <span className="text-slate">Credit</span>) },
          { id: 'mode', header: 'Mode', cell: (r) => `${MODE_LABEL[r.mode]}${r.auto ? ' (cash bill)' : ''}` },
          { id: 'ref', header: 'Reference', cell: (r) => r.reference ?? '', defaultHidden: true },
          { id: 'by', header: 'Received by', cell: (r) => r.receivedBy, defaultHidden: role !== 'ADMIN' },
          { id: 'amount', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} />, sortValue: (r) => r.amount, total: <Money value={query.data?.items.reduce((a, r) => a + r.amount, 0)} /> },
        ]}
      />
    </div>
  );
}
