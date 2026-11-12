import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Customer } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Money, PageHeader, Toolbar } from '../../ui/layout';
import { Segmented } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { SearchBox, useDebounced } from '../common';
import { CustomerForm } from './CustomerForm';

type Row = Customer & { outstanding: number };

export function Customers() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [type, setType] = useState<'' | 'RETAIL' | 'DISTRIBUTOR'>('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const dq = useDebounced(q);
  const query = useQuery({ queryKey: ['customers', type, dq], queryFn: () => api.get<{ items: Row[] }>('/customers', { type, q: dq }) });
  const canAdd = role === 'ADMIN' || role === 'STAFF' || role === 'OPERATING';
  return (
    <div>
      <PageHeader
        title="Customers and distributors"
        description="Contact details, state for GST, and what each customer owes."
        actions={
          canAdd ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setAdding(true)}>
              Add customer
            </Button>
          ) : null
        }
      />
      <Toolbar>
        <Segmented
          label="Customer type"
          value={type}
          onChange={setType}
          items={[
            { value: '', label: 'All' },
            { value: 'RETAIL', label: 'Retail' },
            { value: 'DISTRIBUTOR', label: 'Distributors' },
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Name, code, phone or GSTIN" />
      </Toolbar>
      <DataTable
        caption="Customers"
        rows={query.data?.items}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        empty={{ title: 'No customers found', body: 'Add a customer to bill them on credit. Cash bills can still use a walk-in customer.', action: canAdd ? <Button onClick={() => setAdding(true)}>Add customer</Button> : undefined }}
        columns={[
          { id: 'code', header: 'Code', cell: (r) => r.code, sortValue: (r) => r.code, width: 90 },
          { id: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name, hideable: false },
          { id: 'type', header: 'Type', cell: (r) => (r.type === 'DISTRIBUTOR' ? 'Distributor' : 'Retail') },
          { id: 'state', header: 'State', cell: (r) => r.state, sortValue: (r) => r.state },
          { id: 'gstin', header: 'GSTIN', cell: (r) => r.gstin ?? <span className="text-slate">Unregistered</span> },
          { id: 'phone', header: 'Phone', cell: (r) => r.phone, defaultHidden: true },
          { id: 'active', header: 'Status', cell: (r) => (r.active ? <StatusText status="ACTIVE" label="Active" tone="success" /> : <StatusText status="INACTIVE" label="Inactive" />), defaultHidden: true },
          { id: 'out', header: 'Outstanding', align: 'right', cell: (r) => (r.outstanding ? <Money value={r.outstanding} /> : <span className="text-slate">Nil</span>), sortValue: (r) => r.outstanding },
        ]}
      />
      <CustomerForm open={adding} onOpenChange={setAdding} />
    </div>
  );
}
