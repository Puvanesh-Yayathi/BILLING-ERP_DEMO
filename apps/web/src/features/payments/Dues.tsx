import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { DataTable } from '../../ui/DataTable';
import { FigureBand, Money, PageHeader } from '../../ui/layout';
import { formatDate } from '../common';

interface Row {
  customerId: string;
  code: string;
  name: string;
  type: string;
  phone: string;
  balance: number;
  b0_15: number;
  b16_30: number;
  b31: number;
  overdue: number;
  overdueCount: number;
  oldestDue?: string;
}

export function Dues() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['dues'], queryFn: () => api.get<{ items: Row[]; totals: { balance: number; overdue: number; b0_15: number; b16_30: number; b31: number } }>('/dues') });
  const t = q.data?.totals;
  return (
    <div>
      <PageHeader title="Dues" description="Customer balances by age of the bill. Overdue customers are marked in red and listed first." />
      <FigureBand
        items={[
          { label: 'Total outstanding', value: <Money value={t?.balance} compact /> },
          { label: 'Overdue', value: <Money value={t?.overdue} compact className={t?.overdue ? 'text-danger' : ''} /> },
          { label: '0 to 15 days', value: <Money value={t?.b0_15} compact /> },
          { label: '16 to 30 days', value: <Money value={t?.b16_30} compact /> },
          { label: '31 days or more', value: <Money value={t?.b31} compact /> },
        ]}
      />
      <DataTable
        caption="Dues by customer"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => r.customerId}
        onRowClick={(r) => navigate(`/customers/${r.customerId}`)}
        rowTone={(r) => (r.overdue > 0 ? 'danger' : undefined)}
        empty={{ title: 'Nothing is due', body: 'Every customer has paid in full. Credit and distributor bills will appear here until they are paid.' }}
        columns={[
          { id: 'name', header: 'Customer', cell: (r) => <span className={r.overdue ? 'font-medium text-danger' : 'font-medium'}>{r.name}</span>, sortValue: (r) => r.name, hideable: false },
          { id: 'type', header: 'Type', cell: (r) => (r.type === 'DISTRIBUTOR' ? 'Distributor' : 'Retail') },
          { id: 'phone', header: 'Phone', cell: (r) => r.phone, defaultHidden: true },
          { id: 'b0', header: '0 to 15 days', align: 'right', cell: (r) => <Money value={r.b0_15} />, sortValue: (r) => r.b0_15 },
          { id: 'b16', header: '16 to 30 days', align: 'right', cell: (r) => <Money value={r.b16_30} />, sortValue: (r) => r.b16_30 },
          { id: 'b31', header: '31+ days', align: 'right', cell: (r) => <Money value={r.b31} />, sortValue: (r) => r.b31 },
          {
            id: 'overdue',
            header: 'Overdue',
            align: 'right',
            cell: (r) => (r.overdue ? <span className="font-semibold text-danger">{`${r.overdueCount} overdue, `}<Money value={r.overdue} /></span> : <span className="text-slate">None</span>),
            sortValue: (r) => r.overdue,
          },
          { id: 'oldest', header: 'Oldest due date', cell: (r) => (r.oldestDue ? formatDate(r.oldestDue) : ''), defaultHidden: true },
          { id: 'balance', header: 'Balance', align: 'right', cell: (r) => <Money value={r.balance} strong />, sortValue: (r) => r.balance, total: <Money value={t?.balance} /> },
        ]}
      />
    </div>
  );
}
