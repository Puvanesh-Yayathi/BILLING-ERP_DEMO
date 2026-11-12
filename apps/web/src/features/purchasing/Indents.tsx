import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Money, PageHeader, Toolbar } from '../../ui/layout';
import { Segmented } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { SearchBox, formatDate, useDebounced } from '../common';

interface Row {
  id: string;
  number: string;
  poNumber?: string;
  date: string;
  status: string;
  total: number;
  supplier: string;
  items: number;
  receivedValue: number;
  paid: number;
}

export function Indents() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const query = useQuery({ queryKey: ['indents', status, dq], queryFn: () => api.get<{ items: Row[] }>('/indents', { status, q: dq }) });
  return (
    <div>
      <PageHeader
        title="Purchase indents"
        description="Every purchase is approved by Admin. A purchase order prints after approval."
        actions={
          role === 'ADMIN' ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/indents/new')}>
              Raise indent
            </Button>
          ) : null
        }
      />
      <Toolbar>
        <Segmented
          label="Status"
          value={status}
          onChange={setStatus}
          items={[
            { value: '', label: 'All' },
            { value: 'PENDING', label: 'Waiting' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'RECEIVED', label: 'Received' },
            { value: 'PAID', label: 'Paid' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'DRAFT', label: 'Draft' },
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Indent, PO or supplier" />
      </Toolbar>
      <DataTable
        caption="Purchase indents"
        rows={query.data?.items}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/indents/${r.id}`)}
        empty={{ title: 'No indents', body: 'Raise an indent to start a purchase. Items come from the Purchase List.', action: role === 'ADMIN' ? <Button onClick={() => navigate('/indents/new')}>Raise indent</Button> : undefined }}
        columns={[
          { id: 'n', header: 'Indent', cell: (r) => <span className="font-medium">{r.number}</span>, sortValue: (r) => r.number, hideable: false },
          { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { id: 's', header: 'Supplier', cell: (r) => r.supplier, sortValue: (r) => r.supplier },
          { id: 'st', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
          { id: 'po', header: 'PO', cell: (r) => r.poNumber ?? '' },
          { id: 't', header: 'Value', align: 'right', cell: (r) => <Money value={r.total} />, sortValue: (r) => r.total },
          { id: 'rv', header: 'Received', align: 'right', cell: (r) => <Money value={r.receivedValue} />, defaultHidden: true },
          { id: 'p', header: 'Paid', align: 'right', cell: (r) => <Money value={r.paid} /> },
        ]}
      />
    </div>
  );
}
