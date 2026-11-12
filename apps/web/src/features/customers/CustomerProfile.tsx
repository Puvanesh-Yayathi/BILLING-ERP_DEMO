import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Customer, Payment } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { FigureBand, KeyValue, Money, PageHeader, Section } from '../../ui/layout';
import { Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { LedgerView } from '../accounts/LedgerView';
import { MODE_LABEL, TYPE_LABEL, formatDate } from '../common';
import { CustomerForm } from './CustomerForm';

interface Profile {
  customer: Customer;
  outstanding: number;
  invoices: { id: string; number: string; date: string; type: string; total: number; paid: number; balance: number; status: string; dueDate?: string }[];
  payments: Payment[];
}

export function CustomerProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { role } = useSession();
  const [tab, setTab] = useState<'bills' | 'payments' | 'ledger'>('bills');
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Profile>(`/customers/${id}`) });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { customer: c, invoices, payments } = q.data;
  const overdue = invoices.filter((i) => i.status === 'OVERDUE');
  const sell = role === 'ADMIN' || role === 'STAFF' || role === 'OPERATING';
  const ledgerAllowed = role === 'ADMIN' || role === 'MONITOR' || role === 'COLLECTOR';
  return (
    <div>
      <PageHeader
        title={c.name}
        description={`${c.type === 'DISTRIBUTOR' ? 'Distributor' : 'Retail customer'} ${c.code}`}
        actions={
          <>
            {sell ? <Button onClick={() => navigate(`/payments/new?customer=${c.id}`)}>Record payment</Button> : null}
            {role === 'ADMIN' ? <Button onClick={() => setEditing(true)}>Edit</Button> : null}
          </>
        }
      />
      <FigureBand
        items={[
          { label: 'Outstanding', value: <Money value={q.data.outstanding} compact /> },
          { label: 'Overdue bills', value: <span className={overdue.length ? 'text-danger' : ''}>{overdue.length}</span>, sub: overdue.length ? <Money value={overdue.reduce((a, i) => a + i.balance, 0)} className="text-danger" /> : undefined },
          { label: 'Bills', value: invoices.length },
          { label: 'Billed to date', value: <Money value={invoices.filter((i) => i.status !== 'CANCELLED').reduce((a, i) => a + i.total, 0)} compact /> },
        ]}
      />
      <Section title="Contact">
        <KeyValue
          cols={4}
          items={[
            { label: 'Phone', value: c.phone },
            { label: 'Email', value: c.email ?? 'Not given' },
            { label: 'State', value: `${c.state} (${c.stateCode})` },
            { label: 'GSTIN', value: c.gstin ?? 'Unregistered' },
            { label: 'Address', value: c.address },
          ]}
        />
      </Section>
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Customer records"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'bills', label: 'Billing history', count: invoices.length },
            { value: 'payments', label: 'Payments', count: payments.length },
            ...(ledgerAllowed ? [{ value: 'ledger' as const, label: 'Ledger' }] : []),
          ]}
        />
      </div>
      {tab === 'bills' ? (
        <DataTable
          caption="Billing history"
          rows={invoices}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/bills/${r.id}`)}
          rowTone={(r) => (r.status === 'OVERDUE' ? 'danger' : undefined)}
          empty={{ title: 'No bills yet', body: 'Bills for this customer appear here once finalized.' }}
          columns={[
            { id: 'n', header: 'Bill', cell: (r) => <span className="font-medium">{r.number}</span>, sortValue: (r) => r.number },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
            { id: 't', header: 'Type', cell: (r) => TYPE_LABEL[r.type] },
            { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
            { id: 'due', header: 'Due', cell: (r) => (r.dueDate ? formatDate(r.dueDate) : '') },
            { id: 'total', header: 'Total', align: 'right', cell: (r) => <Money value={r.total} />, sortValue: (r) => r.total },
            { id: 'bal', header: 'Balance', align: 'right', cell: (r) => <Money value={r.balance} strong={r.status === 'OVERDUE'} className={r.status === 'OVERDUE' ? 'text-danger' : ''} />, sortValue: (r) => r.balance },
          ]}
        />
      ) : tab === 'payments' ? (
        <DataTable
          caption="Payments"
          rows={payments}
          rowId={(r) => r.id}
          onRowClick={sell ? (r) => navigate(`/payments/${r.id}/print`) : undefined}
          empty={{ title: 'No payments yet', body: 'Payments received from this customer appear here.' }}
          columns={[
            { id: 'n', header: 'Receipt', cell: (r) => <span className="font-medium">{r.receiptNo}</span> },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
            { id: 'm', header: 'Mode', cell: (r) => MODE_LABEL[r.mode] },
            { id: 'ref', header: 'Reference', cell: (r) => r.reference ?? '' },
            { id: 'a', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} />, sortValue: (r) => r.amount },
          ]}
        />
      ) : (
        <LedgerView type="customer" id={c.id} />
      )}
      {role === 'ADMIN' ? <CustomerForm open={editing} onOpenChange={setEditing} customer={c} /> : null}
    </div>
  );
}
