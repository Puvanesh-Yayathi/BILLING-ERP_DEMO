import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatQty, type ProductionBatch } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { PageHeader } from '../../ui/layout';
import { formatDate } from '../common';

type Row = ProductionBatch & { by: string; inputLines: { rawMaterialId: string; qty: number; name: string }[]; outputLines: { productId: string; qty: number; name: string; code: string }[] };

export function Production() {
  const navigate = useNavigate();
  const { role } = useSession();
  const q = useQuery({ queryKey: ['batches'], queryFn: () => api.get<{ items: Row[] }>('/production-batches') });
  const canAdd = role === 'ADMIN' || role === 'OPERATING';
  return (
    <div>
      <PageHeader
        title="Production"
        description="Each batch uses purchase stock and makes sales stock in one step, with the wastage recorded."
        actions={
          canAdd ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/production/new')}>
              Record batch
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Production batches"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/production/${r.id}/print`)}
        empty={{ title: 'No batches yet', body: 'Record a batch to turn raw material into products.', action: canAdd ? <Button onClick={() => navigate('/production/new')}>Record batch</Button> : undefined }}
        columns={[
          { id: 'n', header: 'Batch', cell: (r) => <span className="font-medium">{r.batchNo}</span>, sortValue: (r) => r.batchNo, hideable: false },
          { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { id: 'in', header: 'Used', cell: (r) => r.inputLines.map((x) => `${x.name} ${formatQty(x.qty)}`).join(', ') },
          { id: 'out', header: 'Made', cell: (r) => r.outputLines.map((x) => `${x.code} ${formatQty(x.qty)}`).join(', ') },
          { id: 'w', header: 'Wastage', align: 'right', cell: (r) => formatQty(r.wastageQty), sortValue: (r) => r.wastageQty },
          { id: 'by', header: 'Recorded by', cell: (r) => r.by },
        ]}
      />
    </div>
  );
}
