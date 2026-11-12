import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { prevMonth, type Payslip, type StaffAdvance } from '@app/contract';
import { api, newIdempotencyKey } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Checkbox, Field, FormGrid, Input, MoneyInput, Select } from '../../ui/form';
import { Money, PageHeader, Toolbar } from '../../ui/layout';
import { Dialog, Drawer, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { MODE_LABEL, PAYTYPE_LABEL, formatDate, today } from '../common';

type Row = Payslip & { staff: string };

export function PayDialog({ open, onOpenChange, title, description, onPay, successText }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string; onPay: (b: { date: string; mode: string; reference?: string }) => Promise<unknown>; successText?: string }) {
  const [date, setDate] = useState(today());
  const [mode, setMode] = useState('CASH');
  const [reference, setReference] = useState('');
  const pay = useAction(() => onPay({ date, mode, reference: reference || undefined }), { success: successText, onDone: () => onOpenChange(false) });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={pay.busy} onClick={() => void pay.run()}>
            Pay now
          </Button>
        </>
      }
    >
      <FormGrid>
        <Field label="Pay date" htmlFor="pd-date">
          <Input id="pd-date" type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Mode" htmlFor="pd-mode">
          <Select id="pd-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="BANK">Bank transfer</option>
          </Select>
        </Field>
        <Field label="Reference" htmlFor="pd-ref" helper="Optional">
          <Input id="pd-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </FormGrid>
    </Dialog>
  );
}

function Advances() {
  const q = useQuery({ queryKey: ['advances'], queryFn: () => api.get<{ items: (StaffAdvance & { staff: string; outstanding: number })[] }>('/advances') });
  const workers = useQuery({ queryKey: ['workers'], queryFn: () => api.get<{ items: { id: string; name: string; active: boolean }[] }>('/workers') });
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ staffId: '', date: today(), amount: undefined as number | undefined, mode: 'CASH', note: '' });
  const key = useRef(newIdempotencyKey());
  const save = useAction(() => api.post('/advances', v, { idempotencyKey: key.current }), { success: 'Recorded advance', onDone: () => ((key.current = newIdempotencyKey()), setOpen(false)) });
  return (
    <>
      <Toolbar>
        <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setOpen(true)}>
          Give advance
        </Button>
        <p className="self-center text-sm text-slate">Outstanding advances are prefilled as recovery on the next payslip or in the settlement.</p>
      </Toolbar>
      <DataTable
        caption="Advances"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        rowId={(r) => r.id}
        empty={{ title: 'No advances', body: 'Money given to a worker before pay day is recorded here and recovered later.' }}
        columns={[
          { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
          { id: 's', header: 'Worker', cell: (r) => r.staff, sortValue: (r) => r.staff },
          { id: 'n', header: 'Note', cell: (r) => r.note },
          { id: 'a', header: 'Given', align: 'right', cell: (r) => <Money value={r.amount} /> },
          { id: 'r', header: 'Recovered', align: 'right', cell: (r) => <Money value={r.recoveredAmount} /> },
          { id: 'o', header: 'Outstanding', align: 'right', cell: (r) => <Money value={r.outstanding} strong />, total: <Money value={q.data?.items.reduce((a, r) => a + r.outstanding, 0)} /> },
        ]}
      />
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Give advance"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
              Record advance
            </Button>
          </>
        }
      >
        <FormGrid>
          <Field label="Worker" htmlFor="adv-w" error={save.fields.staffId}>
            <Select id="adv-w" value={v.staffId} onChange={(e) => setV({ ...v, staffId: e.target.value })}>
              <option value="">Choose</option>
              {workers.data?.items.filter((w) => w.active).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="adv-a" error={save.fields.amount}>
            <MoneyInput id="adv-a" value={v.amount} onChange={(x) => setV({ ...v, amount: x })} />
          </Field>
          <Field label="Date" htmlFor="adv-d">
            <Input id="adv-d" type="date" max={today()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          </Field>
          <Field label="Mode" htmlFor="adv-m">
            <Select id="adv-m" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}>
              {Object.entries(MODE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note" htmlFor="adv-n" helper="Optional">
            <Input id="adv-n" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
        </FormGrid>
      </Drawer>
    </>
  );
}

export function Payroll() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'payslips' | 'advances'>('payslips');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const q = useQuery({ queryKey: ['payslips', month, status], queryFn: () => api.get<{ items: Row[]; totals: { gross: number; net: number } }>('/payslips', { month, status }), enabled: tab === 'payslips' });
  const bulk = useAction(() => api.post<{ created: number }>('/payslips/bulk-drafts', { month }), { success: (r) => (r.created ? `Created ${r.created} draft payslips for ${month}` : 'Every Fixed and Hourly worker already has a payslip for this period') });
  const drafts = (q.data?.items ?? []).filter((p) => p.status === 'DRAFT' && p.source === 'PAYROLL');
  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Pay Fixed and Hourly workers at month end or any time inside a month. Profit share workers are paid through the profit settlement."
        actions={
          <>
            <Button loading={bulk.busy} onClick={() => void bulk.run()}>
              Generate drafts for all active workers
            </Button>
            <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate('/payroll/new')}>
              Generate payslip
            </Button>
          </>
        }
      />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Payroll"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'payslips', label: 'Payslips' },
            { value: 'advances', label: 'Advances' },
          ]}
        />
      </div>
      {tab === 'advances' ? (
        <Advances />
      ) : (
        <>
          <Toolbar>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-slate">Month</span>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[170px]" />
            </label>
            <Button size="sm" variant="quiet" onClick={() => setMonth(prevMonth(today().slice(0, 7)))}>
              Last month
            </Button>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-slate">Status</span>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[140px]">
                <option value="">All</option>
                <option value="DRAFT">Draft</option>
                <option value="PAID">Paid</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </label>
            {selected.size ? (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Pay {selected.size} selected
              </Button>
            ) : null}
          </Toolbar>
          <DataTable
            caption="Payslips"
            rows={q.data?.items}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            rowId={(r) => r.id}
            onRowClick={(r) => navigate(r.source === 'SETTLEMENT' && r.settlementId ? `/settlements/${r.settlementId}` : `/payroll/${r.id}`)}
            empty={{ title: 'No payslips for this month', body: 'Generate a payslip for one worker, or drafts for everyone, then review and pay.' }}
            columns={[
              {
                id: 'sel',
                header: '',
                hideable: false,
                width: 44,
                cell: (r) =>
                  r.status === 'DRAFT' && r.source === 'PAYROLL' ? (
                    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Checkbox
                        label={<span className="sr-only">Select {r.staff}</span>}
                        checked={selected.has(r.id)}
                        onChange={(on) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (on) n.add(r.id);
                            else n.delete(r.id);
                            return n;
                          })
                        }
                      />
                    </span>
                  ) : null,
              },
              { id: 'n', header: 'Payslip', cell: (r) => <span className="font-medium">{r.number ?? 'Draft'}</span> },
              { id: 'w', header: 'Worker', cell: (r) => r.staff, sortValue: (r) => r.staff },
              { id: 't', header: 'Pay type', cell: (r) => PAYTYPE_LABEL[r.payType] },
              { id: 'p', header: 'Period', cell: (r) => `${formatDate(r.periodFrom)} to ${formatDate(r.periodTo)}` },
              { id: 'src', header: 'Source', cell: (r) => (r.source === 'SETTLEMENT' ? 'Settlement' : 'Payroll'), defaultHidden: true },
              { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
              { id: 'g', header: 'Gross', align: 'right', cell: (r) => <Money value={r.gross} />, total: <Money value={q.data?.totals.gross} /> },
              { id: 'net', header: 'Net pay', align: 'right', cell: (r) => <Money value={r.net} strong />, sortValue: (r) => r.net, total: <Money value={q.data?.totals.net} /> },
            ]}
          />
          {drafts.length && !selected.size ? <p className="px-6 py-3 text-sm text-slate">Tick drafts to pay several at once.</p> : null}
        </>
      )}
      <PayDialog
        open={paying}
        onOpenChange={setPaying}
        title={`Pay ${selected.size} payslips`}
        successText={`Paid ${selected.size} payslips`}
        description="Each payslip is numbered, its attendance is locked, advances are recovered and the worker is notified."
        onPay={async (b) => {
          await api.post('/payslips/pay-selected', { ...b, ids: [...selected] });
          setSelected(new Set());
        }}
      />
    </div>
  );
}
