import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Select } from '../../ui/form';
import { Money, PageHeader, Toolbar } from '../../ui/layout';
import { StatusText } from '../../ui/status';
import { DateRange, SearchBox, TYPE_LABEL, daysAgo, formatDate, today, useDebounced } from '../common';

export interface BillRow {
  id: string;
  number: string | null;
  date: string;
  type: string;
  status: string;
  dueDate: string | null;
  customer: string;
  createdBy: string;
  createdById: string;
  items: number;
  total: number;
  paid: number;
  balance: number;
}

export function BillsList() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [from, setFrom] = useState(daysAgo(59));
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const query = useQuery({ queryKey: ['invoices', from, to, status, type, dq], queryFn: () => api.get<{ items: BillRow[]; total: number }>('/invoices', { from, to, status, type, q: dq, limit: 500 }) });
  const rows = query.data?.items;
  const sell = role === 'ADMIN' || role === 'STAFF' || role === 'OPERATING';
  const own = role === 'STAFF' || role === 'OPERATING';
  const live = rows?.filter((r) => r.status !== 'DRAFT' && r.status !== 'CANCELLED') ?? [];
  return (
    <div>
      <PageHeader
        title={own ? 'My bills' : role === 'DISTRIBUTOR' ? 'My bills' : 'Bills'}
        description={own ? 'Bills you created. Drafts can still be edited.' : role === 'DISTRIBUTOR' ? 'Your bills with paid and due amounts.' : 'Every sales bill. Use the Bills explorer for the worker-wise view.'}
        actions={
          sell ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/bills/new')}>
              New bill
            </Button>
          ) : null
        }
      />
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[150px]">
            <option value="">All</option>
            {['DRAFT', 'SENT', 'OVERDUE', 'PAID', 'CANCELLED'].filter((s) => role !== 'DISTRIBUTOR' || s !== 'DRAFT').map((s) => (
              <option key={s} value={s}>
                {s === 'SENT' ? 'Unpaid' : s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Type</span>
          <Select value={type} onChange={(e) => setType(e.target.value)} className="w-[140px]">
            <option value="">All</option>
            <option value="CASH">Cash</option>
            <option value="CREDIT">Credit</option>
            <option value="DISTRIBUTOR">Distributor</option>
          </Select>
        </label>
        <SearchBox value={q} onChange={setQ} placeholder="Bill number or customer" />
      </Toolbar>
      <DataTable
        caption="Bills"
        rows={rows}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/bills/${r.id}`)}
        rowTone={(r) => (r.status === 'OVERDUE' ? 'danger' : undefined)}
        empty={{ title: 'No bills in this period', body: sell ? 'Bills you create appear here as soon as they are saved.' : 'Change the dates or filters to see more bills.', action: sell ? <Button onClick={() => navigate('/bills/new')}>New bill</Button> : undefined }}
        columns={[
          { id: 'number', header: 'Bill', cell: (r) => <span className="font-medium">{r.number ?? 'Draft'}</span>, sortValue: (r) => r.number ?? '', hideable: false, total: `${live.length} bills` },
          { id: 'date', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { id: 'customer', header: 'Customer', cell: (r) => r.customer, sortValue: (r) => r.customer },
          { id: 'type', header: 'Type', cell: (r) => TYPE_LABEL[r.type] },
          { id: 'by', header: 'Created by', cell: (r) => r.createdBy, defaultHidden: own || role === 'DISTRIBUTOR' },
          { id: 'status', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
          { id: 'due', header: 'Due', cell: (r) => (r.dueDate ? formatDate(r.dueDate) : ''), defaultHidden: true },
          { id: 'total', header: 'Total', align: 'right', cell: (r) => <Money value={r.total} />, sortValue: (r) => r.total, total: <Money value={live.reduce((a, r) => a + r.total, 0)} /> },
          { id: 'balance', header: 'Balance', align: 'right', cell: (r) => (r.balance ? <Money value={r.balance} strong={r.status === 'OVERDUE'} className={r.status === 'OVERDUE' ? 'text-danger' : ''} /> : <span className="text-slate">Nil</span>), sortValue: (r) => r.balance, total: <Money value={live.reduce((a, r) => a + r.balance, 0)} /> },
        ]}
      />
    </div>
  );
}
