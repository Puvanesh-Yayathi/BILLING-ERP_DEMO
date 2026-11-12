import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, formatQty, type SupplierPayment } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select } from '../../ui/form';
import { KeyValue, Money, PageHeader, Section } from '../../ui/layout';
import { Dialog, ReasonDialog } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { MODE_LABEL, formatDate, today } from '../common';
import type { IndentView } from './types';


function PayDialog({ ind, open, onOpenChange }: { ind: IndentView; open: boolean; onOpenChange: (v: boolean) => void }) {
  const due = Math.max(ind.total, ind.receivedValue) - ind.paid;
  const [amount, setAmount] = useState<number | undefined>(due);
  const [mode, setMode] = useState('BANK');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const key = useRef(newIdempotencyKey());
  const pay = useAction(() => api.post<SupplierPayment>('/supplier-payments', { indentId: ind.id, amount, mode, reference: reference || undefined, date }, { idempotencyKey: key.current }), {
    success: (p) => `Paid ${formatINR(p.amount)} to the supplier`,
    onDone: () => onOpenChange(false),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Pay supplier on ${ind.number}`}
      description={`${ind.supplier}. Still due ${formatINR(due)}. This counts toward fund utilisation.`}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={pay.busy} onClick={() => void pay.run()}>
            Record supplier payment
          </Button>
        </>
      }
    >
      <FormGrid>
        <Field label="Amount" htmlFor="p-amt" error={pay.fields.amount}>
          <MoneyInput id="p-amt" value={amount} onChange={setAmount} invalid={!!pay.fields.amount} />
        </Field>
        <Field label="Mode" htmlFor="p-mode">
          <Select id="p-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            {Object.entries(MODE_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reference" htmlFor="p-ref" helper="Optional">
          <Input id="p-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Date" htmlFor="p-date">
          <Input id="p-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </FormGrid>
    </Dialog>
  );
}

export function IndentDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { role } = useSession();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const q = useQuery({ queryKey: ['indent', id], queryFn: () => api.get<IndentView>(`/indents/${id}`) });
  const approve = useAction(() => api.post<IndentView>(`/indents/${id}/approve`, { remarks: '' }), { success: (r) => `Approved ${r.number}. Purchase order ${r.poNumber} is ready.` });
  const submit = useAction(() => api.post<{ warning: string | null; indent: IndentView }>(`/indents/${id}/submit`), { success: (r) => `Submitted indent ${r.indent.number}${r.warning ? `. ${r.warning}` : ''}` });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const ind = q.data;
  const myStage = role === 'ADMIN' && ind.status.startsWith('PENDING');
  const editable = role === 'ADMIN' && (ind.status === 'DRAFT' || ind.status === 'REJECTED');
  const canReceive = (role === 'ADMIN' || role === 'OPERATING') && ind.status === 'APPROVED';
  const canPay = role === 'ADMIN' && (ind.status === 'APPROVED' || ind.status === 'RECEIVED') && Math.max(ind.total, ind.receivedValue) > ind.paid;
  const lastReject = [...ind.trail].reverse().find((t) => t.decision === 'REJECTED');
  return (
    <div>
      <PageHeader
        title={`Indent ${ind.number}`}
        meta={<StatusText status={ind.status} />}
        description={`${ind.supplier}, raised by ${ind.raisedBy} on ${formatDate(ind.date)}`}
        actions={
          <>
            {editable ? <Button onClick={() => navigate(`/indents/${ind.id}/edit`)}>Edit</Button> : null}
            {editable ? (
              <Button variant="primary" loading={submit.busy} onClick={() => void submit.run()}>
                {ind.status === 'REJECTED' ? 'Resubmit for approval' : 'Submit for approval'}
              </Button>
            ) : null}
            {myStage ? (
              <>
                <Button variant="danger" onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
                <Button variant="primary" loading={approve.busy} onClick={() => void approve.run()}>
                  Approve
                </Button>
              </>
            ) : null}
            {ind.poNumber ? <Button onClick={() => navigate(`/indents/${ind.id}/po`)}>Purchase order PDF</Button> : null}
            {canReceive ? (
              <Button variant="primary" onClick={() => navigate(`/purchase-bills/new?indent=${ind.id}`)}>
                Record goods receipt
              </Button>
            ) : null}
            {canPay ? <Button onClick={() => setPayOpen(true)}>Pay supplier</Button> : null}
          </>
        }
      />
      <Section title="Approval">
        {ind.status === 'REJECTED' && lastReject ? (
          <p className="mt-4 border-l-2 border-danger pl-3 text-sm">
            Rejected by {lastReject.by}: {lastReject.remarks}. Edit and resubmit it.
          </p>
        ) : null}
        <ol className="mt-5 divide-y divide-hairline text-sm">
          {ind.trail.map((t, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{t.decision === 'SUBMITTED' ? 'Submitted' : t.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</span> by {t.by}
                {t.remarks ? <span className="text-slate">: {t.remarks}</span> : null}
              </span>
              <span className="text-meta text-slate">{new Date(t.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </li>
          ))}
          {!ind.trail.length ? <li className="py-2 text-slate">Not submitted yet.</li> : null}
        </ol>
      </Section>
      <Section title="Items" flush>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-mist">
            <tr className="border-y border-hairline text-th text-slate">
              {['Item', 'Ordered', 'Received', 'Rate', 'Amount'].map((h, i) => (
                <th key={h} className={`h-9 px-4 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ind.lines.map((l) => (
              <tr key={l.rawMaterialId} className="h-10 border-b border-hairline">
                <td className="px-4">{l.name}</td>
                <td className="px-4 text-right tabular-nums">
                  {formatQty(l.qty)} {l.unit}
                </td>
                <td className="px-4 text-right tabular-nums">{formatQty(l.received)}</td>
                <td className="px-4 text-right tabular-nums">{formatINR(l.rate)}</td>
                <td className="px-4 text-right tabular-nums">{formatINR(l.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="px-4 py-2 text-right font-semibold">
                Indent total
              </td>
              <td className="px-4 py-2 text-right">
                <Money value={ind.total} strong />
              </td>
            </tr>
          </tfoot>
        </table>
      </Section>
      <Section title="Goods receipts and payments">
        <KeyValue
          cols={4}
          items={[
            { label: 'Received value (supplier bills)', value: <Money value={ind.receivedValue} /> },
            { label: 'Paid', value: <Money value={ind.paid} /> },
            { label: 'Due', value: <Money value={Math.max(0, Math.max(ind.total, ind.receivedValue) - ind.paid)} strong /> },
            { label: 'Purchase order', value: ind.poNumber ?? 'After final approval' },
          ]}
        />
        <ul className="mt-5 divide-y divide-hairline text-sm">
          {ind.receipts.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{g.number}</span>, supplier bill {g.supplierBillNo} dated {formatDate(g.supplierBillDate)}
              </span>
              <span className="flex items-center gap-4">
                <Money value={g.billAmount} />
                <Link className="link" to={`/purchase-bills/${g.id}/print`}>
                  Print
                </Link>
              </span>
            </li>
          ))}
          {ind.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{p.number}</span>, paid by {(MODE_LABEL[p.mode] ?? p.mode).toLowerCase()} on {formatDate(p.date)}
              </span>
              <span className="flex items-center gap-4">
                <Money value={p.amount} />
                {role === 'ADMIN' ? (
                  <Link className="link" to={`/supplier-payments/${p.id}/print`}>
                    Voucher
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
          {!ind.receipts.length && !ind.payments.length ? <li className="py-2 text-slate">No goods received or payments yet.</li> : null}
        </ul>
      </Section>
      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={`Reject ${ind.number}`}
        description="The indent can be edited and submitted again."
        label="Remarks"
        actionLabel="Reject indent"
        successText={`Rejected indent ${ind.number}`}
        danger
        onConfirm={async (remarks) => {
          await api.post(`/indents/${ind.id}/reject`, { remarks });
          await q.refetch();
        }}
      />
      {canPay ? <PayDialog ind={ind} open={payOpen} onOpenChange={setPayOpen} /> : null}
    </div>
  );
}
