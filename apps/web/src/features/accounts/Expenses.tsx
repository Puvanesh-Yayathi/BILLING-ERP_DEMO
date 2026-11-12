import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Expense } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Field, FormGrid, Input, MoneyInput, Select, Textarea } from '../../ui/form';
import { Money, PageHeader, Section, Toolbar } from '../../ui/layout';
import { Drawer } from '../../ui/overlay';
import { DateRange, MODE_LABEL, formatDate, monthStartOf, today } from '../common';

type Row = Expense & { head: string; by: string };

function AddExpense({ open, onOpenChange, heads }: { open: boolean; onOpenChange: (v: boolean) => void; heads: { id: string; name: string }[] }) {
  const [v, setV] = useState({ date: today(), headId: '', amount: undefined as number | undefined, mode: 'CASH', description: '' });
  const key = useRef(newIdempotencyKey());
  const save = useAction(() => api.post<Expense>('/expenses', v, { idempotencyKey: key.current }), {
    success: 'Added expense',
    onDone: () => {
      key.current = newIdempotencyKey();
      setV({ date: today(), headId: '', amount: undefined, mode: 'CASH', description: '' });
      onOpenChange(false);
    },
  });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Add expense"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            Add expense
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-slate">For costs without a purchase bill. These are deducted in the monthly profit settlement.</p>
        <FormGrid>
          <Field label="Date" htmlFor="e-date" error={f.date}>
            <Input id="e-date" type="date" max={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="Head" htmlFor="e-head" error={f.headId}>
            <Select id="e-head" value={v.headId} invalid={!!f.headId} onChange={(e) => setV({ ...v, headId: e.target.value })}>
              <option value="">Choose</option>
              {heads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="e-amt" error={f.amount}>
            <MoneyInput id="e-amt" value={v.amount} invalid={!!f.amount} onChange={(x) => setV({ ...v, amount: x })} />
          </Field>
          <Field label="Paid by" htmlFor="e-mode">
            <Select id="e-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
              {Object.entries(MODE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
        <Field label="Description" htmlFor="e-desc" error={f.description} helper="Required. Say what it was for.">
          <Textarea id="e-desc" value={v.description} invalid={!!f.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </div>
    </Drawer>
  );
}

export function Expenses() {
  const { role } = useSession();
  const [from, setFrom] = useState(monthStartOf());
  const [to, setTo] = useState(today());
  const [headId, setHeadId] = useState('');
  const [adding, setAdding] = useState(false);
  const heads = useQuery({ queryKey: ['expense-heads'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/expense-heads') });
  const q = useQuery({ queryKey: ['expenses', from, to, headId], queryFn: () => api.get<{ items: Row[]; byHead: { headId: string; head: string; amount: number }[]; byMonth: { month: string; amount: number }[]; total: number }>('/expenses', { from, to, headId }) });
  const canAdd = role === 'ADMIN' || role === 'OPERATING';
  return (
    <div>
      <PageHeader
        title="Other expenses"
        description="Costs without a purchase bill: electricity, tea, food, travel, diesel and others."
        actions={
          canAdd ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setAdding(true)}>
              Add expense
            </Button>
          ) : null
        }
      />
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Head</span>
          <Select value={headId} onChange={(e) => setHeadId(e.target.value)} className="w-[170px]">
            <option value="">All heads</option>
            {heads.data?.items.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
        </label>
      </Toolbar>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 border-hairline lg:border-r">
          <DataTable
            caption="Expenses"
            rows={q.data?.items}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            rowId={(r) => r.id}
            empty={{ title: 'No expenses in this period', body: 'Add an expense with a description so it is counted in the month’s settlement.', action: canAdd ? <Button onClick={() => setAdding(true)}>Add expense</Button> : undefined }}
            columns={[
              { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date, width: 110 },
              { id: 'h', header: 'Head', cell: (r) => r.head, sortValue: (r) => r.head },
              { id: 'desc', header: 'Description', cell: (r) => r.description, hideable: false },
              { id: 'm', header: 'Mode', cell: (r) => MODE_LABEL[r.mode], defaultHidden: true },
              { id: 'by', header: 'Added by', cell: (r) => r.by, defaultHidden: true },
              { id: 'a', header: 'Amount', align: 'right', cell: (r) => <Money value={r.amount} />, sortValue: (r) => r.amount, total: <Money value={q.data?.total} /> },
            ]}
          />
        </div>
        <aside>
          <Section title="By head">
            <ul className="divide-y divide-hairline text-sm">
              {q.data?.byHead.map((h) => (
                <li key={h.headId} className="flex justify-between py-2">
                  <span>{h.head}</span>
                  <Money value={h.amount} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title="By month">
            <ul className="divide-y divide-hairline text-sm">
              {q.data?.byMonth.map((m) => (
                <li key={m.month} className="flex justify-between py-2">
                  <span>{m.month}</span>
                  <Money value={m.amount} />
                </li>
              ))}
            </ul>
          </Section>
        </aside>
      </div>
      {canAdd ? <AddExpense open={adding} onOpenChange={setAdding} heads={heads.data?.items ?? []} /> : null}
    </div>
  );
}
