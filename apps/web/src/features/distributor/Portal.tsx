import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Customer, Payment } from '@app/contract';
import { api } from '../../api/client';
import { useMe } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { FigureBand, Money, PageHeader, Section } from '../../ui/layout';
import { StatusText } from '../../ui/status';
import { LedgerView } from '../accounts/LedgerView';
import { MODE_LABEL, formatDate } from '../common';

interface Portal {
  customer: Customer;
  outstanding: number;
  overdue: number;
  invoices: { id: string; number: string; date: string; total: number; balance: number; status: string; dueDate?: string }[];
  payments: Payment[];
}

/** Distributor home: only their own bills, payments and outstanding. */
export function Portal() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['portal'], queryFn: () => api.get<Portal>('/portal') });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div>
      <PageHeader
        title={d.customer.name}
        description="Your bills, payments and what is due."
        actions={
          <Button variant="primary" onClick={() => navigate('/order-requests?new=1')}>
            Request order
          </Button>
        }
      />
      <FigureBand
        items={[
          { label: 'Outstanding', value: <Money value={d.outstanding} compact /> },
          { label: 'Overdue', value: <Money value={d.overdue} compact className={d.overdue ? 'text-danger' : ''} />, sub: d.overdue ? <span className="text-danger">Please clear the overdue amount</span> : <span className="text-slate">Nothing overdue</span> },
          { label: 'Recent bills', value: d.invoices.length },
        ]}
      />
      <Section title="Recent bills" flush>
        <DataTable
          caption="Recent bills"
          toolbar={false}
          rows={d.invoices}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/bills/${r.id}`)}
          rowTone={(r) => (r.status === 'OVERDUE' ? 'danger' : undefined)}
          empty={{ title: 'No bills yet', body: 'Bills raised for you appear here.' }}
          columns={[
            { id: 'n', header: 'Bill', cell: (r) => <span className="font-medium">{r.number}</span> },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date) },
            { id: 'due', header: 'Due', cell: (r) => (r.dueDate ? formatDate(r.dueDate) : '') },
            { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
            { id: 't', header: 'Total', align: 'right', cell: (r) => <Money value={r.total} /> },
            { id: 'b', header: 'Balance', align: 'right', cell: (r) => <Money value={r.balance} strong={r.status === 'OVERDUE'} className={r.status === 'OVERDUE' ? 'text-danger' : ''} /> },
          ]}
        />
      </Section>
      <Section title="Recent payments" flush>
        <DataTable
          caption="Recent payments"
          toolbar={false}
          rows={d.payments}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/payments/${r.id}/print`)}
          empty={{ title: 'No payments yet', body: 'Payments you make are recorded here with a receipt.' }}
          columns={[
            { id: 'n', header: 'Receipt', cell: (r) => r.receiptNo },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date) },
            { id: 'm', header: 'Mode', cell: (r) => MODE_LABEL[r.mode] },
            { id: 'a', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} /> },
          ]}
        />
      </Section>
    </div>
  );
}

export function MyLedger() {
  const me = useMe();
  return (
    <div>
      <PageHeader title="My ledger" description="Bills are debits and payments are credits. The balance is what you owe." />
      {me.user.customerId ? <LedgerView type="distributor" id={me.user.customerId} /> : <ErrorState error={new Error('Your account is not linked to a distributor')} />}
    </div>
  );
}
