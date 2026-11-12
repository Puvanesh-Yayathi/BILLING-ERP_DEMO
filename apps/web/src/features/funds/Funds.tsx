import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { FundTranche, LoanRepayment } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Field, FormGrid, Input, MoneyInput, Switch } from '../../ui/form';
import { FigureBand, Money, PageHeader, Section } from '../../ui/layout';
import { Drawer, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { MODE_LABEL, formatDate, today } from '../common';

interface Summary {
  received: number;
  utilised: number;
  committed: number;
  balance: number;
  available: number;
  utilisation: { id: string; number: string; date: string; amount: number; mode: string; indentId: string; indent: string; supplier: string }[];
  committedIndents: { id: string; number: string; total: number; paid: number; status: string }[];
}
type Loan = FundTranche & { repaid: number; outstanding: number; repayments: LoanRepayment[] };

function AddTranche({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [v, setV] = useState({ date: today(), source: '', amount: undefined as number | undefined, note: '', isLoan: false, lender: '' });
  const key = useRef(newIdempotencyKey());
  const save = useAction(() => api.post<FundTranche>('/fund-tranches', { ...v, source: v.isLoan ? v.lender || v.source : v.source }, { idempotencyKey: key.current }), {
    success: 'Added fund tranche',
    onDone: () => {
      key.current = newIdempotencyKey();
      setV({ date: today(), source: '', amount: undefined, note: '', isLoan: false, lender: '' });
      onOpenChange(false);
    },
  });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Add fund tranche"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            Add tranche
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Date" htmlFor="t-date">
            <Input id="t-date" type="date" max={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="Amount" htmlFor="t-amt" error={f.amount}>
            <MoneyInput id="t-amt" value={v.amount} invalid={!!f.amount} onChange={(x) => setV({ ...v, amount: x })} />
          </Field>
        </FormGrid>
        <Switch label="This is a loan" checked={v.isLoan} onChange={(x) => setV({ ...v, isLoan: x })} />
        {v.isLoan ? (
          <Field label="Lender" htmlFor="t-lender" error={f.lender} helper="Loan outstanding is repaid through the monthly profit settlement">
            <Input id="t-lender" value={v.lender} invalid={!!f.lender} onChange={(e) => setV({ ...v, lender: e.target.value })} />
          </Field>
        ) : (
          <Field label="Source" htmlFor="t-source" error={f.source}>
            <Input id="t-source" value={v.source} placeholder="Owner, partner" invalid={!!f.source} onChange={(e) => setV({ ...v, source: e.target.value })} />
          </Field>
        )}
        <Field label="Note" htmlFor="t-note" helper="Optional">
          <Input id="t-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

export function Funds() {
  const navigate = useNavigate();
  const { role } = useSession();
  const admin = role === 'ADMIN';
  const [tab, setTab] = useState<'tranches' | 'utilisation' | 'committed' | 'loans'>('tranches');
  const [adding, setAdding] = useState(false);
  const sum = useQuery({ queryKey: ['funds-summary'], queryFn: () => api.get<Summary>('/funds/summary') });
  const tranches = useQuery({ queryKey: ['tranches'], queryFn: () => api.get<{ items: FundTranche[] }>('/fund-tranches') });
  const loans = useQuery({ queryKey: ['loans'], queryFn: () => api.get<{ items: Loan[] }>('/loans'), enabled: admin });
  const s = sum.data;
  return (
    <div>
      <PageHeader
        title="Funds and loans"
        description="Money received for purchasing, and how much of it supplier payments have used. Committed shows approved indents not yet paid."
        actions={
          admin ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setAdding(true)}>
              Add tranche
            </Button>
          ) : null
        }
      />
      <FigureBand
        items={[
          { label: 'Received', value: <Money value={s?.received} compact /> },
          { label: 'Committed', value: <Money value={s?.committed} compact />, sub: <span className="text-slate">Approved, not paid</span> },
          { label: 'Utilised', value: <Money value={s?.utilised} compact />, sub: <span className="text-slate">Supplier payments</span> },
          { label: 'Balance', value: <Money value={s?.balance} compact /> },
          { label: 'Available after commitments', value: <Money value={s?.available} compact className={s && s.available < 0 ? 'text-danger' : ''} /> },
          ...(admin ? [{ label: 'Loan outstanding', value: <Money value={loans.data?.items.reduce((a, l) => a + l.outstanding, 0)} compact /> }] : []),
        ]}
      />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Fund records"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'tranches', label: 'Tranches' },
            { value: 'utilisation', label: 'Utilisation' },
            { value: 'committed', label: 'Committed indents' },
            ...(admin ? [{ value: 'loans' as const, label: 'Loans' }] : []),
          ]}
        />
      </div>
      {tab === 'tranches' ? (
        <DataTable
          caption="Fund tranches"
          rows={tranches.data?.items}
          loading={tranches.isLoading}
          error={tranches.error}
          rowId={(r) => r.id}
          empty={{ title: 'No tranches yet', body: 'Record the money received for purchasing, and mark loans so they can be repaid in the settlement.' }}
          columns={[
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
            { id: 's', header: 'Source', cell: (r) => r.source },
            { id: 'k', header: 'Kind', cell: (r) => (r.isLoan ? `Loan${r.lender ? ` from ${r.lender}` : ''}` : 'Own fund') },
            { id: 'n', header: 'Note', cell: (r) => r.note },
            { id: 'a', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} />, sortValue: (r) => r.amount, total: <Money value={s?.received} /> },
          ]}
        />
      ) : tab === 'utilisation' ? (
        <DataTable
          caption="Fund utilisation"
          rows={s?.utilisation}
          loading={sum.isLoading}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/indents/${r.indentId}`)}
          empty={{ title: 'No supplier payments yet', body: 'Each supplier payment uses the fund and is listed here with its indent.' }}
          columns={[
            { id: 'n', header: 'Voucher', cell: (r) => r.number },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
            { id: 'i', header: 'Indent', cell: (r) => r.indent },
            { id: 's', header: 'Supplier', cell: (r) => r.supplier },
            { id: 'm', header: 'Mode', cell: (r) => MODE_LABEL[r.mode] },
            { id: 'a', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} />, total: <Money value={s?.utilised} /> },
          ]}
        />
      ) : tab === 'committed' ? (
        <DataTable
          caption="Committed indents"
          rows={s?.committedIndents}
          loading={sum.isLoading}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/indents/${r.id}`)}
          empty={{ title: 'Nothing committed', body: 'Approved indents that are not fully paid appear here.' }}
          columns={[
            { id: 'n', header: 'Indent', cell: (r) => <span className="font-medium">{r.number}</span> },
            { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
            { id: 't', header: 'Value', align: 'right', cell: (r) => <Money value={r.total} /> },
            { id: 'p', header: 'Paid', align: 'right', cell: (r) => <Money value={r.paid} /> },
            { id: 'c', header: 'Committed', align: 'right', cell: (r) => <Money value={r.total - r.paid} strong />, total: <Money value={s?.committed} /> },
          ]}
        />
      ) : (
        <Section flush>
          <DataTable
            caption="Loans"
            rows={loans.data?.items}
            loading={loans.isLoading}
            error={loans.error}
            rowId={(r) => r.id}
            empty={{ title: 'No loans', body: 'Mark a tranche as a loan to track what is still owed.' }}
            columns={[
              { id: 'l', header: 'Lender', cell: (r) => <span className="font-medium">{r.lender}</span> },
              { id: 'd', header: 'Received on', cell: (r) => formatDate(r.date) },
              { id: 'a', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} /> },
              { id: 'r', header: 'Repaid', align: 'right', cell: (r) => <Money value={r.repaid} /> },
              { id: 'reps', header: 'Repayments', cell: (r) => (r.repayments.length ? r.repayments.map((x) => `${formatDate(x.date)} ${x.note}`).join('; ') : <span className="text-slate">None yet</span>) },
              { id: 'o', header: 'Outstanding', align: 'right', cell: (r) => <Money value={r.outstanding} strong /> },
            ]}
          />
        </Section>
      )}
      {admin ? <AddTranche open={adding} onOpenChange={setAdding} /> : null}
    </div>
  );
}
