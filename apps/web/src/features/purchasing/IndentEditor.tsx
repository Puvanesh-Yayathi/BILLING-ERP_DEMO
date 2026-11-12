import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { divRound, formatINR, formatQty, qtyMilli } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button, IconButton } from '../../ui/Button';
import { InlineError, Skeleton } from '../../ui/feedback';
import { Field, FormGrid, MoneyInput, QtyInput, Select, Textarea } from '../../ui/form';
import { Money, PageHeader, Section } from '../../ui/layout';
import type { IndentView, PickItem } from './types';

interface Line {
  key: string;
  rawMaterialId: string;
  qty: number | undefined;
  rate: number | undefined;
}

export function IndentEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const picker = useQuery({ queryKey: ['purchase-picker'], queryFn: () => api.get<{ items: PickItem[] }>('/purchase-items/picker') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ items: { id: string; name: string; active: boolean }[] }>('/suppliers') });
  const existing = useQuery({ queryKey: ['indent', id], queryFn: () => api.get<IndentView>(`/indents/${id}`), enabled: !!id });
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 'l0', rawMaterialId: '', qty: undefined, rate: undefined }]);
  const [touched, setTouched] = useState(false);
  const key = useRef(newIdempotencyKey());
  const loaded = useRef(false);
  useEffect(() => {
    const e = existing.data;
    if (!e || loaded.current) return;
    loaded.current = true;
    setSupplierId(e.supplierId);
    setNote(e.note);
    setLines(e.lines.map((l, i) => ({ key: `l${i}`, rawMaterialId: l.rawMaterialId, qty: l.qty, rate: l.rate })));
  }, [existing.data]);

  const items = picker.data?.items ?? [];
  const amount = (l: Line) => (l.qty && l.rate ? divRound(qtyMilli(l.qty) * l.rate, 1000) : 0);
  const total = lines.reduce((a, l) => a + amount(l), 0);
  const errs = {
    supplier: !supplierId ? 'Choose a supplier' : undefined,
    lines: lines.some((l) => !l.rawMaterialId || !l.qty || !l.rate) ? 'Choose an item and enter quantity and rate on every line' : undefined,
  };
  const body = () => ({ supplierId, note, items: lines.map((l) => ({ rawMaterialId: l.rawMaterialId, qty: l.qty ?? 0, rate: l.rate ?? 0 })) });
  const save = useAction(
    async (submit: boolean) => {
      const ind = id ? await api.patch<IndentView>(`/indents/${id}`, body(), existing.data ? `"${existing.data.rev}"` : undefined) : await api.post<IndentView>('/indents', body(), { idempotencyKey: key.current });
      let warning: string | null = null;
      if (submit) warning = (await api.post<{ warning: string | null }>(`/indents/${ind.id}/submit`)).warning;
      return { ind, submit, warning };
    },
    {
      success: (r) => (r.submit ? `Submitted indent ${r.ind.number}${r.warning ? `. ${r.warning}` : ''}` : `Saved indent ${r.ind.number}`),
      onDone: (r) => navigate(`/indents/${r.ind.id}`, { replace: true }),
    },
  );
  const go = (submit: boolean) => {
    setTouched(true);
    if (errs.supplier || errs.lines) return;
    void save.run(submit);
  };
  if (id && existing.isLoading) return <Skeleton className="m-6 h-96" />;
  return (
    <div>
      <PageHeader title={id ? `Edit indent ${existing.data?.number ?? ''}` : 'Raise purchase indent'} description="Items come only from the Purchase List. The last purchase rate is filled in and can be changed." />
      <Section>
        <div className="max-w-3xl pt-5">
          <FormGrid>
            <Field label="Supplier" htmlFor="sup" error={touched ? errs.supplier : undefined}>
              <Select id="sup" value={supplierId} invalid={touched && !!errs.supplier} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Choose</option>
                {suppliers.data?.items.filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </FormGrid>
        </div>
      </Section>
      <Section title="Items" flush>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="bg-mist">
              <tr className="border-y border-hairline text-th text-slate">
                <th className="h-9 px-4 text-left font-semibold">Item</th>
                <th className="h-9 px-4 text-right font-semibold">Quantity</th>
                <th className="h-9 px-4 text-right font-semibold">Rate</th>
                <th className="h-9 px-4 text-right font-semibold">Amount</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const it = items.find((x) => x.id === l.rawMaterialId);
                return (
                  <tr key={l.key} className="border-b border-hairline align-top">
                    <td className="px-4 py-2">
                      <Select
                        aria-label="Item"
                        value={l.rawMaterialId}
                        invalid={touched && !l.rawMaterialId}
                        onChange={(e) => {
                          const pick = items.find((x) => x.id === e.target.value);
                          setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, rawMaterialId: e.target.value, rate: x.rate ?? pick?.lastRate } : x)));
                          if (pick?.supplierId && !supplierId) setSupplierId(pick.supplierId);
                        }}
                      >
                        <option value="">Choose from the Purchase List</option>
                        {items.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}, last {formatINR(x.lastRate)}/{x.unit}, stock {formatQty(x.stock)}
                          </option>
                        ))}
                      </Select>
                      {it ? <span className="mt-1 block text-meta text-slate">Preferred supplier: {it.supplier ?? 'none'}</span> : null}
                    </td>
                    <td className="w-36 px-2 py-2">
                      <QtyInput ariaLabel="Quantity" value={l.qty} invalid={touched && !l.qty} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} />
                    </td>
                    <td className="w-40 px-2 py-2">
                      <MoneyInput value={l.rate} invalid={touched && !l.rate} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, rate: v } : x)))} />
                    </td>
                    <td className="px-4 pt-4 text-right tabular-nums">{formatINR(amount(l))}</td>
                    <td className="px-2 py-2">
                      <IconButton label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                        <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-4 py-3">
                  <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setLines((ls) => [...ls, { key: `l${Date.now()}`, rawMaterialId: '', qty: undefined, rate: undefined }])}>
                    Add line
                  </Button>
                </td>
                <td colSpan={2} className="px-4 py-3 text-right font-semibold">
                  Indent total
                </td>
                <td className="px-4 py-3 text-right">
                  <Money value={total} strong />
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        {touched && errs.lines ? <p className="px-6 pb-2 text-sm text-danger">{errs.lines}</p> : null}
      </Section>
      <Section>
        <div className="max-w-3xl pt-5">
          <Field label="Note" htmlFor="note" helper="Optional, printed on the purchase order">
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-4">
            <InlineError error={save.error} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={save.busy} onClick={() => go(false)}>
              Save draft
            </Button>
            <Button variant="primary" loading={save.busy} onClick={() => go(true)}>
              Submit for approval
            </Button>
          </div>
          <p className="mt-3 text-meta text-slate">If the indent is more than the fund available after committed indents, you will see a warning. It is not blocked.</p>
        </div>
      </Section>
    </div>
  );
}
