import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, formatQty, type Customer, type Invoice } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { KeyValue, Money, PageHeader, Section } from '../../ui/layout';
import { ReasonDialog } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { MODE_LABEL, TYPE_LABEL, formatDate } from '../common';

interface Detail {
  invoice: Invoice & { displayStatus: string; balance: number };
  customer: Customer | null;
  createdBy: string;
  payments: { id: string; receiptNo: string; date: string; mode: string; amount: number; reference?: string }[];
}

export function BillDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { role } = useSession();
  const [cancelOpen, setCancelOpen] = useState(false);
  const q = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<Detail>(`/invoices/${id}`) });
  const finalize = useAction(() => api.post<Invoice>(`/invoices/${id}/finalize`), { success: (r) => `Finalized bill ${r.number}` });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { invoice: inv, customer, payments } = q.data;
  const sell = role === 'ADMIN' || role === 'STAFF' || role === 'OPERATING';
  return (
    <div>
      <PageHeader
        title={inv.number ? `Bill ${inv.number}` : 'Draft bill'}
        meta={<StatusText status={inv.displayStatus} />}
        description={`${TYPE_LABEL[inv.type]} bill for ${customer?.name ?? inv.walkInName ?? 'a walk-in customer'}, created by ${q.data.createdBy}`}
        actions={
          <>
            {inv.status === 'DRAFT' && sell ? (
              <>
                <Button onClick={() => navigate(`/bills/${inv.id}/edit`)}>Edit draft</Button>
                <Button variant="primary" loading={finalize.busy} onClick={() => void finalize.run()}>
                  Finalize bill
                </Button>
              </>
            ) : null}
            {inv.status !== 'DRAFT' ? (
              <Button variant="primary" onClick={() => navigate(`/bills/${inv.id}/print`)}>
                Print or download
              </Button>
            ) : null}
            {inv.balance > 0 && sell && inv.customerId ? <Button onClick={() => navigate(`/payments/new?customer=${inv.customerId}&invoice=${inv.id}`)}>Record payment</Button> : null}
            {role === 'ADMIN' && inv.status !== 'CANCELLED' ? (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel bill
              </Button>
            ) : null}
          </>
        }
      />
      <Section title="Details">
        <KeyValue
          cols={4}
          items={[
            { label: 'Date', value: formatDate(inv.date) },
            { label: 'Due date', value: inv.dueDate ? formatDate(inv.dueDate) : 'Paid at sale' },
            { label: 'Place of supply', value: `${inv.placeOfSupply} (${inv.placeOfSupplyCode})` },
            { label: 'Tax', value: inv.intraState ? 'CGST and SGST' : 'IGST' },
            { label: 'Customer', value: customer ? <Link className="link" to={`/customers/${customer.id}`}>{customer.name}</Link> : inv.walkInName ?? 'Walk-in customer' },
            { label: 'GSTIN', value: customer?.gstin ?? 'Unregistered' },
            { label: 'Grand total', value: <Money value={inv.grandTotal} strong /> },
            { label: 'Balance', value: inv.balance ? <Money value={inv.balance} strong className={inv.displayStatus === 'OVERDUE' ? 'text-danger' : ''} /> : 'Nil' },
          ]}
        />
        {inv.status === 'CANCELLED' ? <p className="mt-4 border-l-2 border-danger pl-3 text-sm">Cancelled on {formatDate(inv.cancelledAt)}: {inv.cancelReason}</p> : null}
      </Section>
      <Section title="Items" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-mist">
              <tr className="border-y border-hairline text-th text-slate">
                {['Product', 'HSN', 'Quantity', 'Rate', 'Discount', 'Taxable', 'GST', 'Amount'].map((h, i) => (
                  <th key={h} className={`h-9 px-4 font-semibold ${i < 2 ? 'text-left' : 'text-right'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it) => (
                <tr key={it.productId} className="h-10 border-b border-hairline">
                  <td className="px-4">
                    <span className="font-medium">{it.code}</span> {it.name}
                  </td>
                  <td className="px-4">{it.hsn}</td>
                  <td className="px-4 text-right tabular-nums">
                    {formatQty(it.qty)} {it.unit}
                  </td>
                  <td className="px-4 text-right tabular-nums">{formatINR(it.rate)}</td>
                  <td className="px-4 text-right tabular-nums">{it.discount ? `${formatINR(it.discount)} (${it.discountPct}%)` : ''}</td>
                  <td className="px-4 text-right tabular-nums">{formatINR(it.taxableValue)}</td>
                  <td className="px-4 text-right tabular-nums">
                    {formatINR(it.cgst + it.sgst + it.igst)} <span className="text-meta text-slate">{it.gstRate}%</span>
                  </td>
                  <td className="px-4 text-right font-medium tabular-nums">{formatINR(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {[
                ['Taxable value', inv.taxableTotal],
                ...(inv.intraState
                  ? [
                      ['CGST', inv.cgst],
                      ['SGST', inv.sgst],
                    ]
                  : [['IGST', inv.igst]]),
                ['Round-off', inv.roundOff],
                ['Grand total', inv.grandTotal],
              ].map(([k, v]) => (
                <tr key={k as string} className={k === 'Grand total' ? 'border-t border-hairline' : ''}>
                  <td colSpan={7} className={`px-4 py-1.5 text-right ${k === 'Grand total' ? 'font-semibold' : 'text-slate'}`}>
                    {k}
                  </td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${k === 'Grand total' ? 'font-semibold' : ''}`}>
                    <Money value={v as number} />
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      </Section>
      <Section title="Payments">
        {payments.length ? (
          <ul className="divide-y divide-hairline">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{p.receiptNo}</span> on {formatDate(p.date)}, {MODE_LABEL[p.mode]}
                  {p.reference ? `, ${p.reference}` : ''}
                </span>
                <span className="flex items-center gap-4">
                  <Money value={p.amount} />
                  {sell || role === 'DISTRIBUTOR' ? (
                    <Link className="link" to={`/payments/${p.id}/print`}>
                      Receipt
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate">{inv.status === 'DRAFT' ? 'Payments can be recorded after the bill is finalized.' : 'No payment recorded for this bill yet.'}</p>
        )}
      </Section>
      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel bill ${inv.number ?? ''}`}
        description="Stock returns to the Sales Inventory. Payments on this bill stay with the customer as credit. This is recorded in the audit log."
        actionLabel="Cancel bill"
        successText={`Cancelled bill ${inv.number ?? 'draft'}`}
        danger
        onConfirm={async (reason) => {
          await api.post(`/invoices/${inv.id}/cancel`, { reason });
          await q.refetch();
        }}
      />
    </div>
  );
}
