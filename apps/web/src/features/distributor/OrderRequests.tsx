import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { formatINR, formatQty, type Invoice, type OrderRequest } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button, IconButton } from '../../ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/feedback';
import { Field, QtyInput, Select, Textarea } from '../../ui/form';
import { PageHeader } from '../../ui/layout';
import { Drawer, ReasonDialog } from '../../ui/overlay';
import { StatusText } from '../../ui/status';

type Row = OrderRequest & { distributor: string; lines: { productId: string; qty: number; code: string; name: string; price: number }[]; invoiceNumber: string | null; invoiceStatus: string | null };

function NewRequest({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const products = useQuery({ queryKey: ['products-available', 'DISTRIBUTOR'], queryFn: () => api.get<{ items: { id: string; code: string; name: string; unit: string; price: number; stock: number }[] }>('/products/available', { customerType: 'DISTRIBUTOR' }) });
  const [lines, setLines] = useState<{ key: string; productId: string; qty: number | undefined }[]>([{ key: 'l0', productId: '', qty: undefined }]);
  const [note, setNote] = useState('');
  const key = useRef(newIdempotencyKey());
  const save = useAction(() => api.post<OrderRequest>('/order-requests', { items: lines.filter((l) => l.productId && l.qty).map((l) => ({ productId: l.productId, qty: l.qty ?? 0 })), note }, { idempotencyKey: key.current }), {
    success: (o) => `Submitted order request ${o.number}`,
    onDone: () => {
      key.current = newIdempotencyKey();
      setLines([{ key: 'l0', productId: '', qty: undefined }]);
      setNote('');
      onOpenChange(false);
    },
  });
  const total = lines.reduce((a, l) => a + (l.qty ?? 0) * (products.data?.items.find((p) => p.id === l.productId)?.price ?? 0), 0);
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Request order"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate">The company reviews your request and turns it into a bill. Prices are your distributor prices.</p>
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.key} className="grid grid-cols-[1fr_110px_36px] gap-2">
              <Select aria-label="Product" value={l.productId} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, productId: e.target.value } : x)))}>
                <option value="">Choose a product</option>
                {products.data?.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} {p.name}, {formatINR(p.price)}/{p.unit}
                  </option>
                ))}
              </Select>
              <QtyInput ariaLabel="Quantity" value={l.qty} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} />
              <IconButton label="Remove" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </IconButton>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" className="self-start" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setLines((ls) => [...ls, { key: `l${Date.now()}`, productId: '', qty: undefined }])}>
          Add product
        </Button>
        <p className="text-sm">
          Approximate value before tax: <span className="font-semibold tabular-nums">{formatINR(Math.round(total))}</span>
        </p>
        <Field label="Note" htmlFor="or-note" helper="Optional, for example delivery timing">
          <Textarea id="or-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {save.fields.items ? <p className="text-sm text-danger">{save.fields.items}</p> : null}
      </div>
    </Drawer>
  );
}

function RequestRow({ o, admin }: { o: Row; admin: boolean }) {
  const navigate = useNavigate();
  const [rejecting, setRejecting] = useState(false);
  const convert = useAction(() => api.post<Invoice>(`/order-requests/${o.id}/convert`), { success: 'Converted to a draft bill. Check it and finalize.', onDone: (inv) => navigate(`/bills/${inv.id}`) });
  return (
    <li className="border-b border-hairline px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-section font-semibold text-deep">
            {o.number} {admin ? <span className="font-normal text-slate">from {o.distributor}</span> : null}
          </p>
          <p className="text-meta text-slate">{new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
          <ul className="mt-2 text-sm">
            {o.lines.map((l) => (
              <li key={l.productId}>
                {l.code} {l.name}: {formatQty(l.qty)}
              </li>
            ))}
          </ul>
          {o.note ? <p className="mt-1 text-sm text-slate">{o.note}</p> : null}
          {o.remark ? <p className="mt-1 text-sm text-danger">Remark: {o.remark}</p> : null}
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <StatusText status={o.status} />
          {o.invoiceNumber || o.invoiceId ? (
            <button type="button" className="link text-sm" onClick={() => navigate(`/bills/${o.invoiceId}`)}>
              {o.invoiceNumber ? `Bill ${o.invoiceNumber}` : 'Draft bill'}
            </button>
          ) : null}
          {admin && o.status === 'NEW' ? (
            <div className="flex gap-2">
              <Button variant="danger" onClick={() => setRejecting(true)}>
                Reject
              </Button>
              <Button variant="primary" loading={convert.busy} onClick={() => void convert.run()}>
                Convert to draft bill
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${o.number}`}
        label="Remark"
        description="The distributor sees your remark."
        actionLabel="Reject request"
        successText={`Rejected ${o.number}`}
        danger
        onConfirm={async (remark) => {
          await api.post(`/order-requests/${o.id}/reject`, { remark });
        }}
      />
    </li>
  );
}

export function OrderRequests() {
  const { role } = useSession();
  const [sp, setSp] = useSearchParams();
  const admin = role === 'ADMIN';
  const q = useQuery({ queryKey: ['order-requests'], queryFn: () => api.get<{ items: Row[] }>('/order-requests') });
  const open = sp.get('new') === '1';
  return (
    <div>
      <PageHeader
        title={admin ? 'Order requests' : 'My order requests'}
        description={admin ? 'Requests from distributors. Convert one into a draft distributor bill, check it, and finalize.' : 'Request products. The company turns your request into a bill.'}
        actions={
          !admin ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setSp({ new: '1' })}>
              Request order
            </Button>
          ) : null
        }
      />
      {q.isLoading ? (
        <SkeletonRows rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data?.items.length ? (
        <ul>
          {q.data.items.map((o) => (
            <RequestRow key={o.id} o={o} admin={admin} />
          ))}
        </ul>
      ) : (
        <EmptyState title="No order requests" body={admin ? 'Requests from distributors appear here with a notification.' : 'Use Request order to ask for products.'} />
      )}
      {!admin ? <NewRequest open={open} onOpenChange={(v) => setSp(v ? { new: '1' } : {})} /> : null}
    </div>
  );
}
