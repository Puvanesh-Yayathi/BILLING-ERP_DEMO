import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, type Customer, type Payment } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { InlineError, SkeletonRows } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select } from '../../ui/form';
import { Money, PageHeader, Section } from '../../ui/layout';
import { StatusText } from '../../ui/status';
import { MODE_LABEL, formatDate, today } from '../common';

interface Open {
  id: string;
  number: string;
  date: string;
  dueDate?: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

export function ReceivePayment() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [customerId, setCustomerId] = useState(params.get('customer') ?? '');
  const [invoiceId, setInvoiceId] = useState(params.get('invoice') ?? '');
  const [mode, setMode] = useState<'CASH' | 'UPI' | 'BANK' | 'CARD'>('CASH');
  const [amount, setAmount] = useState<number | undefined>();
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [touched, setTouched] = useState(false);
  const key = useRef(newIdempotencyKey());
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ items: (Customer & { outstanding: number })[] }>('/customers') });
  const open = useQuery({ queryKey: ['open-invoices', customerId], queryFn: () => api.get<{ items: Open[] }>(`/customers/${customerId}/open-invoices`), enabled: !!customerId });
  const totalDue = open.data?.items.reduce((a, x) => a + x.balance, 0) ?? 0;
  const target = invoiceId ? open.data?.items.find((x) => x.id === invoiceId) : undefined;
  const max = target ? target.balance : totalDue;

  useEffect(() => {
    if (target && amount === undefined) setAmount(target.balance);
  }, [target, amount]);

  // Preview the allocation the server will apply (bill-wise, or oldest first).
  const preview: { id: string; number: string; amount: number }[] = [];
  if (amount && open.data) {
    if (target) preview.push({ id: target.id, number: target.number, amount: Math.min(amount, target.balance) });
    else {
      let left = amount;
      for (const o of open.data.items) {
        if (left <= 0) break;
        const take = Math.min(left, o.balance);
        preview.push({ id: o.id, number: o.number, amount: take });
        left -= take;
      }
    }
  }

  const save = useAction(() => api.post<Payment>('/payments', { customerId, invoiceId: invoiceId || undefined, mode, amount, reference: reference || undefined, date }, { idempotencyKey: key.current }), {
    success: (p) => `Recorded payment ${p.receiptNo}`,
    onDone: (p) => navigate(`/payments/${p.id}/print`),
  });
  const errs = {
    customerId: !customerId ? 'Choose a customer' : undefined,
    amount: !amount ? 'Enter an amount greater than zero' : amount > max ? `At most ${formatINR(max)}` : undefined,
    reference: mode !== 'CASH' && !reference.trim() ? 'Enter the UPI, bank or card reference' : undefined,
  };
  const invalid = Object.values(errs).some(Boolean);
  const withDue = (customers.data?.items ?? []).filter((c) => c.outstanding > 0 || c.id === customerId);

  return (
    <div>
      <PageHeader title="Receive payment" description="Link the payment to a bill, or leave it on account and it is applied to the oldest unpaid bills first." />
      <Section>
        <div className="max-w-3xl pt-5">
          <FormGrid>
            <Field label="Customer" htmlFor="customer" required error={touched ? errs.customerId : undefined} helper={customerId ? `Total outstanding ${formatINR(totalDue)}` : 'Only customers with dues are listed'}>
              <Select
                id="customer"
                value={customerId}
                invalid={touched && !!errs.customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setInvoiceId('');
                  setAmount(undefined);
                }}
              >
                <option value="">Choose</option>
                {withDue.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}, due {formatINR(c.outstanding)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Against bill" htmlFor="invoice" helper="Optional">
              <Select id="invoice" value={invoiceId} disabled={!customerId} onChange={(e) => setInvoiceId(e.target.value)}>
                <option value="">On account (oldest bills first)</option>
                {open.data?.items.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.number}, balance {formatINR(o.balance)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Amount" htmlFor="amount" required error={touched ? errs.amount : undefined}>
              <MoneyInput id="amount" value={amount} invalid={touched && !!errs.amount} onChange={setAmount} />
            </Field>
            <Field label="Mode" htmlFor="mode">
              <Select id="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                {Object.entries(MODE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reference" htmlFor="ref" error={touched ? errs.reference : undefined} helper={mode === 'CASH' ? 'Optional for cash' : undefined}>
              <Input id="ref" value={reference} maxLength={60} invalid={touched && !!errs.reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor="date">
              <Input id="date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </FormGrid>
          <div className="mt-6">
            <InlineError error={save.error} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              loading={save.busy}
              onClick={() => {
                setTouched(true);
                if (!invalid) void save.run();
              }}
            >
              Record payment
            </Button>
            <Button variant="quiet" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </div>
      </Section>
      {customerId ? (
        <Section title="Outstanding bills" flush>
          {open.isLoading ? (
            <SkeletonRows rows={3} />
          ) : open.data?.items.length ? (
            <table className="w-full border-collapse text-sm">
              <thead className="bg-mist">
                <tr className="border-y border-hairline text-th text-slate">
                  {['Bill', 'Date', 'Due', 'Status', 'Total', 'Paid', 'Balance', 'This payment'].map((h, i) => (
                    <th key={h} className={`h-9 px-4 font-semibold ${i < 4 ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.data.items.map((o) => {
                  const alloc = preview.find((p) => p.id === o.id);
                  return (
                    <tr key={o.id} className="h-10 border-b border-hairline">
                      <td className="relative px-4 font-medium">
                        {o.status === 'OVERDUE' ? <span className="absolute inset-y-0 left-0 w-0.5 bg-danger" /> : null}
                        {o.number}
                      </td>
                      <td className="px-4">{formatDate(o.date)}</td>
                      <td className="px-4">{o.dueDate ? formatDate(o.dueDate) : ''}</td>
                      <td className="px-4">
                        <StatusText status={o.status} />
                      </td>
                      <td className="px-4 text-right">
                        <Money value={o.total} />
                      </td>
                      <td className="px-4 text-right">
                        <Money value={o.paid} />
                      </td>
                      <td className="px-4 text-right font-medium">
                        <Money value={o.balance} />
                      </td>
                      <td className="px-4 text-right">{alloc ? <Money value={alloc.amount} strong className="text-tide" /> : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="px-6 pb-6 text-sm text-slate">This customer has no unpaid bills.</p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
