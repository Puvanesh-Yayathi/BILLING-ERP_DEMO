import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { formatQty, roundQty, type ProductionBatch } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button, IconButton } from '../../ui/Button';
import { InlineError } from '../../ui/feedback';
import { Field, FormGrid, Input, QtyInput, Select } from '../../ui/form';
import { PageHeader, Section } from '../../ui/layout';
import { today } from '../common';

interface L {
  key: string;
  id: string;
  qty: number | undefined;
}

function Lines({ title, lines, setLines, options, touched, stockCheck }: { title: string; lines: L[]; setLines: (f: (l: L[]) => L[]) => void; options: { id: string; label: string; stock?: number }[]; touched: boolean; stockCheck?: boolean }) {
  return (
    <Section title={title}>
      <ul className="flex flex-col gap-3">
        {lines.map((l) => {
          const opt = options.find((o) => o.id === l.id);
          const short = stockCheck && opt?.stock !== undefined && l.qty !== undefined && l.qty > opt.stock;
          return (
            <li key={l.key} className="grid grid-cols-[1fr_140px_40px] items-start gap-3">
              <div>
                <Select aria-label={`${title} item`} value={l.id} invalid={touched && !l.id} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, id: e.target.value } : x)))}>
                  <option value="">Choose</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                {short ? <p className="mt-1 text-meta text-danger">Only {formatQty(opt?.stock ?? 0)} in stock</p> : null}
              </div>
              <QtyInput ariaLabel={`${title} quantity`} value={l.qty} invalid={(touched && !l.qty) || short} onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: v } : x)))} />
              <IconButton label="Remove line" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}>
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </IconButton>
            </li>
          );
        })}
      </ul>
      <Button className="mt-3" size="sm" variant="ghost" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setLines((ls) => [...ls, { key: `l${Date.now()}`, id: '', qty: undefined }])}>
        Add line
      </Button>
    </Section>
  );
}

export function ProductionEditor() {
  const navigate = useNavigate();
  const raw = useQuery({ queryKey: ['purchase-picker'], queryFn: () => api.get<{ items: { id: string; name: string; unit: string; stock: number }[] }>('/purchase-items/picker') });
  const prods = useQuery({ queryKey: ['products'], queryFn: () => api.get<{ items: { id: string; code: string; name: string; active: boolean; stock: number }[] }>('/products') });
  const [date, setDate] = useState(today());
  const [inputs, setInputs] = useState<L[]>([{ key: 'i0', id: '', qty: undefined }]);
  const [outputs, setOutputs] = useState<L[]>([{ key: 'o0', id: '', qty: undefined }]);
  const [wastage, setWastage] = useState<number | undefined>(0);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const key = useRef(newIdempotencyKey());
  const save = useAction(
    () =>
      api.post<ProductionBatch>(
        '/production-batches',
        { date, inputs: inputs.map((l) => ({ rawMaterialId: l.id, qty: l.qty ?? 0 })), outputs: outputs.map((l) => ({ productId: l.id, qty: l.qty ?? 0 })), wastageQty: wastage ?? 0, wastageNote: note },
        { idempotencyKey: key.current },
      ),
    { success: (b) => `Recorded batch ${b.batchNo}`, onDone: () => navigate('/production') },
  );
  const inputTotal = roundQty(inputs.reduce((a, l) => a + (l.qty ?? 0), 0));
  const invalid = inputs.some((l) => !l.id || !l.qty) || outputs.some((l) => !l.id || !l.qty);
  return (
    <div>
      <PageHeader title="Record production batch" description="Purchase stock goes down and sales stock goes up together. The batch is refused if raw stock is not enough." />
      <Section>
        <div className="max-w-xs pt-5">
          <Field label="Date" htmlFor="b-date">
            <Input id="b-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="border-hairline lg:border-r">
          <Lines title="Used from purchase stock" lines={inputs} setLines={setInputs} options={(raw.data?.items ?? []).map((r) => ({ id: r.id, label: `${r.name} (${formatQty(r.stock)} ${r.unit} in stock)`, stock: r.stock }))} touched={touched} stockCheck />
        </div>
        <Lines title="Made into products" lines={outputs} setLines={setOutputs} options={(prods.data?.items ?? []).filter((p) => p.active).map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }))} touched={touched} />
      </div>
      <Section title="Wastage">
        <div className="max-w-2xl">
          <FormGrid>
            <Field label="Wastage quantity" htmlFor="w-qty" helper={inputTotal && wastage ? `${((wastage / inputTotal) * 100).toFixed(1)}% of the input` : 'In the same unit as the main input'}>
              <QtyInput id="w-qty" value={wastage} onChange={setWastage} />
            </Field>
            <Field label="Note" htmlFor="w-note" helper="Optional">
              <Input id="w-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </FormGrid>
          <div className="mt-4">
            <InlineError error={save.error} />
          </div>
          {touched && invalid ? <p className="mt-2 text-sm text-danger">Choose an item and enter a quantity on every line.</p> : null}
          <Button
            className="mt-4"
            variant="primary"
            loading={save.busy}
            onClick={() => {
              setTouched(true);
              if (!invalid) void save.run();
            }}
          >
            Record batch
          </Button>
        </div>
      </Section>
    </div>
  );
}
