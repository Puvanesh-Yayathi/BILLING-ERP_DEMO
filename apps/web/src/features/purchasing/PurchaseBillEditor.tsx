import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { divRound, formatINR, formatQty, qtyMilli, roundQty, type GoodsReceipt } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { EmptyState, InlineError, Skeleton } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, QtyInput, Select } from '../../ui/form';
import { Money, PageHeader, Section } from '../../ui/layout';
import { today } from '../common';
import type { IndentView } from './types';

interface Line {
  rawMaterialId: string;
  qty: number | undefined;
  rate: number | undefined;
}

export function PurchaseBillEditor() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [indentId, setIndentId] = useState(params.get('indent') ?? '');
  const approved = useQuery({ queryKey: ['indents', 'APPROVED'], queryFn: () => api.get<{ items: { id: string; number: string; supplier: string; total: number }[] }>('/indents', { status: 'APPROVED' }) });
  const ind = useQuery({ queryKey: ['indent', indentId], queryFn: () => api.get<IndentView>(`/indents/${indentId}`), enabled: !!indentId });
  const [lines, setLines] = useState<Line[]>([]);
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(today());
  const [billAmount, setBillAmount] = useState<number | undefined>();
  const [amountTouched, setAmountTouched] = useState(false);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!ind.data) return;
    setLines(ind.data.lines.map((l) => ({ rawMaterialId: l.rawMaterialId, qty: roundQty(Math.max(0, l.qty - l.received)), rate: l.rate })));
    setAmountTouched(false);
  }, [ind.data]);

  const computed = lines.reduce((a, l) => a + (l.qty && l.rate ? divRound(qtyMilli(l.qty) * l.rate, 1000) : 0), 0);
  useEffect(() => {
    if (!amountTouched) setBillAmount(computed || undefined);
  }, [computed, amountTouched]);

  const save = useAction(
    () =>
      api.post<GoodsReceipt>(
        '/purchase-bills',
        { indentId, supplierBillNo: billNo, supplierBillDate: billDate, billAmount, note: '', items: lines.map((l) => ({ rawMaterialId: l.rawMaterialId, qty: l.qty ?? 0, rate: l.rate ?? 0 })) },
        { idempotencyKey: key.current },
      ),
    { success: (g) => `Recorded purchase bill ${g.supplierBillNo}`, onDone: (g) => navigate(`/indents/${g.indentId}`) },
  );
  const f = save.fields;
  return (
    <div>
      <PageHeader title="Record goods receipt" description="Enter the supplier’s bill and the quantity received. Partial receipts keep the indent open until everything arrives. Rate changes against the indent are shown and logged." />
      <Section>
        <div className="max-w-3xl pt-5">
          <Field label="Approved indent" htmlFor="ind" error={f.indentId}>
            <Select id="ind" value={indentId} onChange={(e) => setIndentId(e.target.value)}>
              <option value="">Choose</option>
              {approved.data?.items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number}, {i.supplier}, {formatINR(i.total)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>
      {!indentId ? (
        approved.data && !approved.data.items.length ? <EmptyState title="No approved indents" body="Goods can be received once an indent is approved." /> : null
      ) : ind.isLoading ? (
        <Skeleton className="m-6 h-48" />
      ) : ind.data ? (
        <>
          <Section title="Items received" flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead className="bg-mist">
                  <tr className="border-y border-hairline text-th text-slate">
                    {['Item', 'Still to receive', 'Received now', 'Indent rate', 'Bill rate', 'Variance', 'Amount'].map((h, i) => (
                      <th key={h} className={`h-9 px-4 font-semibold ${i === 0 ? 'text-left' : 'text-right'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ind.data.lines.map((l) => {
                    const line = lines.find((x) => x.rawMaterialId === l.rawMaterialId);
                    const pending = roundQty(l.qty - l.received);
                    const amt = line?.qty && line.rate ? divRound(qtyMilli(line.qty) * line.rate, 1000) : 0;
                    const variance = line?.qty && line.rate ? amt - divRound(qtyMilli(line.qty) * l.rate, 1000) : 0;
                    const pct = l.rate && line?.rate ? ((line.rate - l.rate) / l.rate) * 100 : 0;
                    return (
                      <tr key={l.rawMaterialId} className="border-b border-hairline align-top">
                        <td className="px-4 pt-4">{l.name}</td>
                        <td className="px-4 pt-4 text-right tabular-nums">
                          {formatQty(pending)} {l.unit}
                        </td>
                        <td className="w-32 px-2 py-2">
                          <QtyInput ariaLabel={`Received ${l.name}`} value={line?.qty} disabled={pending <= 0} onChange={(v) => setLines((ls) => ls.map((x) => (x.rawMaterialId === l.rawMaterialId ? { ...x, qty: v } : x)))} />
                        </td>
                        <td className="px-4 pt-4 text-right tabular-nums">{formatINR(l.rate)}</td>
                        <td className="w-40 px-2 py-2">
                          <MoneyInput value={line?.rate} onChange={(v) => setLines((ls) => ls.map((x) => (x.rawMaterialId === l.rawMaterialId ? { ...x, rate: v } : x)))} />
                        </td>
                        <td className={`px-4 pt-4 text-right tabular-nums ${variance > 0 ? 'text-danger' : variance < 0 ? 'text-success' : 'text-slate'}`}>
                          {variance ? `${variance > 0 ? '+' : '−'}${formatINR(Math.abs(variance))} (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : 'None'}
                        </td>
                        <td className="px-4 pt-4 text-right tabular-nums">{formatINR(amt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} className="px-4 py-2 text-right font-semibold">
                      Calculated amount
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money value={computed} strong />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>
          <Section title="Supplier bill">
            <div className="max-w-3xl">
              <FormGrid cols={3}>
                <Field label="Bill number" htmlFor="bn" error={f.supplierBillNo}>
                  <Input id="bn" value={billNo} invalid={!!f.supplierBillNo} onChange={(e) => setBillNo(e.target.value)} />
                </Field>
                <Field label="Bill date" htmlFor="bd" error={f.supplierBillDate}>
                  <Input id="bd" type="date" max={today()} value={billDate} onChange={(e) => setBillDate(e.target.value)} />
                </Field>
                <Field label="Bill amount" htmlFor="ba" error={f.billAmount} helper={billAmount !== computed ? `Calculated ${formatINR(computed)}` : 'As calculated'}>
                  <MoneyInput
                    id="ba"
                    value={billAmount}
                    invalid={!!f.billAmount}
                    onChange={(v) => {
                      setAmountTouched(true);
                      setBillAmount(v);
                    }}
                  />
                </Field>
              </FormGrid>
              <div className="mt-4">
                <InlineError error={Object.keys(f).length ? null : save.error} />
              </div>
              <div className="mt-4">
                <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
                  Record goods receipt
                </Button>
              </div>
            </div>
          </Section>
        </>
      ) : null}
    </div>
  );
}
