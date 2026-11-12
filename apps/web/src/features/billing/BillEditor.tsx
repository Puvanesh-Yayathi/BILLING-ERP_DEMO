import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { calcInvoice, formatINR, formatQty, type Customer, type Invoice } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useMe } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button, IconButton } from '../../ui/Button';
import { ErrorState, InlineError, Skeleton } from '../../ui/feedback';
import { Field, Input, MoneyInput, QtyInput, Select } from '../../ui/form';
import { Money, PageHeader } from '../../ui/layout';
import { Segmented } from '../../ui/overlay';
import { StatusText } from '../../ui/status';

interface Avail {
  id: string;
  code: string;
  name: string;
  unit: string;
  gstRate: number;
  taxInclusive: boolean;
  price: number;
  stock: number;
  reorderLevel: number;
  status: 'IN_STOCK' | 'LOW' | 'OUT';
}

interface Line {
  key: string;
  productId: string;
  qty: number | undefined;
  discountPct: number;
  rate?: number;
}

type BillType = 'CASH' | 'CREDIT' | 'DISTRIBUTOR';

function ProductPicker({ products, onPick, inputRef }: { products: Avail[]; onPick: (p: Avail) => void; inputRef: React.RefObject<HTMLInputElement> }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products;
    const exact = products.filter((p) => p.code.toLowerCase() === s);
    const rest = products.filter((p) => p.code.toLowerCase() !== s && (p.code.toLowerCase().includes(s) || p.name.toLowerCase().includes(s)));
    return [...exact, ...rest];
  }, [q, products]);
  const pick = (p: Avail | undefined) => {
    if (!p || p.stock <= 0) return;
    onPick(p);
    setQ('');
    setOpen(false);
    setActive(0);
  };
  return (
    <div className="relative">
      <Field label="Add product" htmlFor="product-search" helper="Type a product code such as PRD-A and press Enter, or search by name">
        <Input
          ref={inputRef}
          id="product-search"
          role="combobox"
          aria-expanded={open}
          aria-controls="product-list"
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Code or name"
          value={q}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(matches[active]);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
      </Field>
      {open ? (
        <ul id="product-list" role="listbox" className="absolute left-0 right-0 top-[66px] z-20 max-h-80 overflow-y-auto rounded-panel border border-hairline bg-white py-1 shadow-float">
          {matches.length ? (
            matches.map((p, i) => {
              const out = p.stock <= 0;
              return (
                <li key={p.id} role="option" aria-selected={i === active} aria-disabled={out}>
                  <button
                    type="button"
                    disabled={out}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(p)}
                    className={`grid w-full grid-cols-[72px_1fr_auto_auto] items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? 'bg-mist' : ''} ${out ? 'cursor-not-allowed text-slate' : 'text-deep'}`}
                  >
                    <span className="font-medium">{p.code}</span>
                    <span className="truncate">{p.name}</span>
                    <span className="tabular-nums">{formatINR(p.price)}</span>
                    <span className="w-28 text-right">
                      {out ? <StatusText status="OUT" /> : p.status === 'LOW' ? <StatusText status="LOW" label={`${formatQty(p.stock)} left`} /> : <span className="text-slate">{formatQty(p.stock)} {p.unit}</span>}
                    </span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-4 py-3 text-sm text-slate">No product matches “{q}”.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function BillEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const isAdmin = me.user.role === 'ADMIN';
  const existing = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<{ invoice: Invoice }>(`/invoices/${id}`), enabled: !!id });
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ items: (Customer & { outstanding: number })[] }>('/customers') });
  const company = useQuery({ queryKey: ['company-profile'], queryFn: () => api.get<{ profile: { stateCode: string } }>('/company-profile') });
  const [type, setType] = useState<BillType>('CASH');
  const [customerId, setCustomerId] = useState('');
  const [walkIn, setWalkIn] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [rev, setRev] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const idemKey = useRef(newIdempotencyKey());
  const searchRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef(new Map<string, HTMLInputElement | null>());
  const customer = customers.data?.items.find((c) => c.id === customerId);
  const customerType = type === 'DISTRIBUTOR' ? 'DISTRIBUTOR' : 'RETAIL';
  const avail = useQuery({ queryKey: ['products-available', customerType], queryFn: () => api.get<{ items: Avail[] }>('/products/available', { customerType }), refetchInterval: 10_000 });

  useEffect(() => {
    const inv = existing.data?.invoice;
    if (!inv || rev !== null) return;
    setType(inv.type);
    setCustomerId(inv.customerId ?? '');
    setWalkIn(inv.walkInName && inv.walkInName !== 'Walk-in customer' ? inv.walkInName : '');
    setLines(inv.items.map((it, i) => ({ key: `l${i}`, productId: it.productId, qty: it.qty, discountPct: it.discountPct, rate: isAdmin ? it.rate : undefined })));
    setRev(inv.rev);
  }, [existing.data, rev, isAdmin]);

  const productOf = (pid: string) => avail.data?.items.find((p) => p.id === pid);
  const intraState = !customer || customer.stateCode === (company.data?.profile.stateCode ?? '33');
  const priced = lines
    .map((l) => ({ l, p: productOf(l.productId) }))
    .filter((x): x is { l: Line; p: Avail } => !!x.p);
  const totals = calcInvoice(
    priced.map(({ l, p }) => ({ qty: l.qty ?? 0, rate: l.rate ?? p.price, discountPct: l.discountPct, gstRate: p.gstRate, taxInclusive: p.taxInclusive })),
    intraState,
  );

  const eligibleCustomers = (customers.data?.items ?? []).filter((c) => c.active && (type === 'DISTRIBUTOR' ? c.type === 'DISTRIBUTOR' : c.type === 'RETAIL'));
  const lineErrors = new Map<string, string>();
  for (const { l, p } of priced) {
    if (!l.qty || l.qty <= 0) lineErrors.set(l.key, 'Enter a quantity greater than zero');
    else if (l.qty > p.stock) lineErrors.set(l.key, `Only ${formatQty(p.stock)} ${p.unit} in stock`);
  }
  const customerError = type !== 'CASH' && !customerId ? (type === 'DISTRIBUTOR' ? 'Choose a distributor' : 'Choose a customer') : undefined;
  const noLines = lines.length === 0 ? 'Add at least one product' : undefined;
  const invalid = !!customerError || !!noLines || [...lineErrors.values()].some((e) => !e.startsWith('Only'));

  const body = () => ({
    type,
    customerId: customerId || undefined,
    walkInName: type === 'CASH' && !customerId ? walkIn || undefined : undefined,
    items: lines.map((l) => ({ productId: l.productId, qty: l.qty ?? 0, discountPct: l.discountPct, rate: isAdmin ? l.rate : undefined })),
  });

  const save = useAction(
    async (finalize: boolean) => {
      let inv: Invoice;
      if (id) inv = await api.patch<Invoice>(`/invoices/${id}`, body(), rev !== null ? `"${rev}"` : undefined);
      else inv = await api.post<Invoice>('/invoices', body(), { idempotencyKey: idemKey.current });
      if (finalize) inv = await api.post<Invoice>(`/invoices/${inv.id}/finalize`, undefined, { idempotencyKey: `${idemKey.current}-fin` });
      return { inv, finalize };
    },
    {
      success: (r) => (r.finalize ? `Finalized bill ${r.inv.number}` : 'Saved draft bill'),
      onDone: (r) => navigate(`/bills/${r.inv.id}`, { replace: true }),
    },
  );

  const addProduct = (p: Avail) => {
    const exists = lines.find((l) => l.productId === p.id);
    if (exists) {
      setLines((ls) => ls.map((l) => (l.productId === p.id ? { ...l, qty: (l.qty ?? 0) + 1 } : l)));
      window.setTimeout(() => qtyRefs.current.get(exists.key)?.focus(), 0);
      return;
    }
    const key = `l${Date.now()}`;
    setLines((ls) => [...ls, { key, productId: p.id, qty: 1, discountPct: 0 }]);
    window.setTimeout(() => qtyRefs.current.get(key)?.select(), 0);
  };

  if (id && existing.isLoading) return <Skeleton className="m-6 h-96" />;
  if (id && existing.error) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  if (existing.data && existing.data.invoice.status !== 'DRAFT') return <ErrorState error={new Error('Only draft bills can be edited')} />;

  const submit = (finalize: boolean) => {
    setTouched(true);
    if (invalid) return;
    void save.run(finalize);
  };

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col">
      <PageHeader title={id ? 'Edit draft bill' : 'New bill'} description="Products come from the Sales Inventory with live stock. Totals and GST are recalculated on the server when you save." />
      <div className="grid flex-1 grid-cols-1 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 border-hairline xl:border-r">
          <div className="grid grid-cols-1 gap-5 border-b border-hairline px-6 py-5 md:grid-cols-[auto_1fr]">
            <Field label="Bill type">
              <Segmented
                label="Bill type"
                value={type}
                onChange={(v) => {
                  setType(v);
                  setCustomerId('');
                }}
                items={[
                  { value: 'CASH', label: 'Cash' },
                  { value: 'CREDIT', label: 'Credit' },
                  { value: 'DISTRIBUTOR', label: 'Distributor' },
                ]}
              />
            </Field>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label={type === 'DISTRIBUTOR' ? 'Distributor' : 'Customer'} htmlFor="customer" error={touched ? customerError : undefined} helper={customer ? `${customer.state}, ${intraState ? 'CGST and SGST' : 'IGST'}${customer.outstanding > 0 ? `, outstanding ${formatINR(customer.outstanding)}` : ''}` : type === 'CASH' ? 'Leave empty for a walk-in customer' : undefined}>
                <Select id="customer" value={customerId} invalid={touched && !!customerError} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">{type === 'CASH' ? 'Walk-in customer' : 'Choose'}</option>
                  {eligibleCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </Select>
              </Field>
              {type === 'CASH' && !customerId ? (
                <Field label="Walk-in name" htmlFor="walkin" helper="Optional, printed on the bill">
                  <Input id="walkin" value={walkIn} maxLength={80} onChange={(e) => setWalkIn(e.target.value)} />
                </Field>
              ) : null}
            </div>
          </div>
          <div className="border-b border-hairline px-6 py-5">{avail.isLoading ? <Skeleton className="h-16" /> : <ProductPicker products={avail.data?.items ?? []} onPick={addProduct} inputRef={searchRef} />}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <caption className="sr-only">Bill lines</caption>
              <thead className="bg-mist">
                <tr className="border-b border-hairline">
                  {['Product', 'Quantity', 'Rate', 'Discount %', 'Taxable', 'GST', 'Amount', ''].map((h, i) => (
                    <th key={i} scope="col" className={`h-9 px-4 text-th font-semibold text-slate ${i === 0 ? 'text-left' : 'text-right'}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {priced.map(({ l, p }, idx) => {
                  const r = totals.lines[idx];
                  const err = lineErrors.get(l.key);
                  return (
                    <tr key={l.key} className="border-b border-hairline align-top">
                      <td className="px-4 py-2 text-sm">
                        <span className="font-medium text-deep">{p.code}</span> {p.name}
                        <span className="block text-meta text-slate">
                          {formatQty(p.stock)} {p.unit} in stock{p.status === 'LOW' ? ', low' : ''}
                        </span>
                        {err ? <span className={`block text-meta ${err.startsWith('Only') ? 'text-brown' : 'text-danger'}`}>{err}</span> : null}
                      </td>
                      <td className="w-28 px-2 py-2">
                        <QtyInput inputRef={(el) => qtyRefs.current.set(l.key, el)} ariaLabel={`Quantity of ${p.name}`} value={l.qty} invalid={touched && !!err && !err.startsWith('Only')} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} />
                      </td>
                      <td className="w-36 px-2 py-2 text-right text-sm">{isAdmin ? <MoneyInput value={l.rate ?? p.price} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, rate: v } : x)))} /> : <span className="inline-block pt-2 tabular-nums">{formatINR(p.price)}</span>}</td>
                      <td className="w-24 px-2 py-2">
                        <Input aria-label={`Discount for ${p.name}`} inputMode="decimal" align="right" value={l.discountPct || ''} placeholder="0" onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, discountPct: Math.min(100, Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)) } : x)))} />
                      </td>
                      <td className="px-4 py-2 pt-4 text-right text-sm tabular-nums">{r ? formatINR(r.taxableValue) : ''}</td>
                      <td className="px-4 py-2 pt-4 text-right text-sm tabular-nums">
                        {r ? formatINR(r.tax) : ''}
                        <span className="block text-meta text-slate">{p.gstRate}%</span>
                      </td>
                      <td className="px-4 py-2 pt-4 text-right text-sm font-medium tabular-nums">{r ? formatINR(r.lineTotal) : ''}</td>
                      <td className="w-12 px-2 py-2 text-right">
                        <IconButton label={`Remove ${p.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lines.length === 0 ? (
              <div className="px-6 py-10">
                <p className="text-section font-semibold text-deep">No products yet</p>
                <p className="mt-1 text-base text-slate">Type a product code above and press Enter. Out-of-stock products are shown but cannot be added.</p>
                {touched && noLines ? <p className="mt-2 text-sm text-danger">{noLines}</p> : null}
              </div>
            ) : null}
          </div>
        </div>
        <aside className="flex flex-col bg-white">
          <div className="flex-1 px-6 py-5">
            <h2 className="text-section font-semibold text-deep">Totals</h2>
            <dl className="mt-4 flex flex-col gap-2 text-sm">
              {[
                ['Gross', totals.subtotal],
                ['Discount', -totals.discountTotal],
                ['Taxable value', totals.taxableTotal],
                ...(intraState
                  ? [
                      ['CGST', totals.cgst],
                      ['SGST', totals.sgst],
                    ]
                  : [['IGST', totals.igst]]),
                ['Round-off', totals.roundOff],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between">
                  <dt className="text-slate">{k}</dt>
                  <dd className="tabular-nums">
                    <Money value={v as number} />
                  </dd>
                </div>
              ))}
              <div className="mt-2 flex items-baseline justify-between border-t border-hairline pt-3">
                <dt className="text-base font-semibold">Grand total</dt>
                <dd className="text-[22px] font-semibold text-deep tabular-nums">{formatINR(totals.grandTotal)}</dd>
              </div>
            </dl>
            {totals.taxSummary.length ? (
              <table className="mt-6 w-full text-sm">
                <caption className="pb-2 text-left text-meta text-slate">Tax summary by rate</caption>
                <thead>
                  <tr className="border-b border-hairline text-th text-slate">
                    <th className="py-1 text-left font-semibold">Rate</th>
                    <th className="py-1 text-right font-semibold">Taxable</th>
                    <th className="py-1 text-right font-semibold">Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.taxSummary.map((t) => (
                    <tr key={t.gstRate} className="border-b border-hairline">
                      <td className="py-1.5">{t.gstRate}%</td>
                      <td className="py-1.5 text-right tabular-nums">{formatINR(t.taxableValue)}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatINR(t.totalTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {type === 'CASH' ? <p className="mt-6 text-meta text-slate">A cash bill is recorded as paid in cash when you finalize it.</p> : <p className="mt-6 text-meta text-slate">Due date is set by the credit period when you finalize.</p>}
            <div className="mt-4">
              <InlineError error={save.error} />
            </div>
          </div>
          <div className="sticky bottom-0 flex gap-2 border-t border-hairline bg-white px-6 py-3">
            <Button className="flex-1" loading={save.busy} onClick={() => submit(false)}>
              Save as draft
            </Button>
            <Button className="flex-1" variant="primary" loading={save.busy} done={save.done} onClick={() => submit(true)} disabled={[...lineErrors.values()].some((e) => e.startsWith('Only'))}>
              Finalize bill
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
