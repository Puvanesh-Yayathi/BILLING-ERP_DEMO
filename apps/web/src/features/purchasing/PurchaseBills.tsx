import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { GoodsReceipt } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Money, PageHeader } from '../../ui/layout';
import { formatDate } from '../common';

type Row = GoodsReceipt & { indentNumber: string; supplier: string; createdBy: string };

export function PurchaseBills() {
  const navigate = useNavigate();
  const { role } = useSession();
  const q = useQuery({ queryKey: ['purchase-bills'], queryFn: () => api.get<{ items: Row[] }>('/purchase-bills') });
  const canAdd = role === 'ADMIN' || role === 'OPERATING';
  return (
    <div>
      <PageHeader
        title="Purchase bills"
        description="Goods received against approved indents, with the supplier’s bill number. Each receipt raises the purchase stock."
        actions={
          canAdd ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/purchase-bills/new')}>
              Record goods receipt
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Purchase bills"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(`/purchase-bills/${r.id}/print`)}
        empty={{ title: 'No purchase bills yet', body: 'Record goods received against an approved indent.' }}
        columns={[
          { id: 'n', header: 'GRN', cell: (r) => <span className="font-medium">{r.number}</span>, sortValue: (r) => r.number, hideable: false },
          { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { id: 'b', header: 'Supplier bill', cell: (r) => r.supplierBillNo },
          { id: 'i', header: 'Indent', cell: (r) => r.indentNumber },
          { id: 's', header: 'Supplier', cell: (r) => r.supplier, sortValue: (r) => r.supplier },
          { id: 'by', header: 'Entered by', cell: (r) => r.createdBy },
          { id: 'a', header: 'Bill amount', align: 'right', cell: (r) => <Money value={r.billAmount} />, sortValue: (r) => r.billAmount, total: <Money value={q.data?.items.reduce((a, r) => a + r.billAmount, 0)} /> },
        ]}
      />
    </div>
  );
}
