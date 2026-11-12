import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { ProfitSettlement } from '@app/contract';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Money, PageHeader } from '../../ui/layout';
import { StatusText } from '../../ui/status';

export function Settlements() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['settlements'], queryFn: () => api.get<{ items: ProfitSettlement[] }>('/settlements') });
  return (
    <div>
      <PageHeader
        title="Profit settlement"
        description="Once a month: gross profit, then loan repayment, then workers, then other expenses. The owner receives what is left. Visible to Admin only."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/settlements/new')}>
            New settlement
          </Button>
        }
      />
      <DataTable
        caption="Settlements"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => navigate(r.status === 'DRAFT' ? `/settlements/new?month=${r.month}` : `/settlements/${r.id}`)}
        empty={{ title: 'No settlements yet', body: 'Run the settlement for a month to pay profit share workers and work out the owner amount.' }}
        columns={[
          { id: 'm', header: 'Month', cell: (r) => <span className="font-medium">{r.month}</span>, sortValue: (r) => r.month, hideable: false },
          { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
          { id: 'gp', header: 'Gross profit', align: 'right', cell: (r) => <Money value={r.grossProfit} /> },
          { id: 'loan', header: 'Loan repaid', align: 'right', cell: (r) => <Money value={r.loanRepayment} /> },
          { id: 'w', header: 'Workers', align: 'right', cell: (r) => <Money value={r.payableTotal} /> },
          { id: 'e', header: 'Expenses', align: 'right', cell: (r) => <Money value={r.otherExpenses} /> },
          { id: 'o', header: 'Owner amount', align: 'right', cell: (r) => <Money value={r.ownerAmount} strong /> },
        ]}
      />
    </div>
  );
}
