import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { formatINR, formatTime, monthEnd, prevMonth, type Payslip, type Staff } from '@app/contract';
import { api, ApiError, newIdempotencyKey } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button, IconButton } from '../../ui/Button';
import { ErrorState, InlineError, Skeleton, useToast } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select } from '../../ui/form';
import { KeyValue, Money, PageHeader, Section } from '../../ui/layout';
import { ReasonDialog, Segmented } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { MODE_LABEL, PAYTYPE_LABEL, formatDate, today, useDebounced } from '../common';
import { PayDialog } from './Payroll';

interface Day {
  date: string;
  status: string;
  firstIn?: string;
  lastOut?: string;
  rawMinutes: number;
  paidHours: number;
  edited: boolean;
  offDayWork: boolean;
  offDay: boolean;
}
interface Preview {
  staff: Staff;
  periodFrom: string;
  periodTo: string;
  workingDaysInMonth: number;
  summary: { days: Day[]; presentDays: number; halfDays: number; absentDays: number; leaveDays: number; paidHours: number; offDayWorkDays: number };
  outstandingAdvance: number;
  result: { perDayRate: number | null; basePayEarned: number; allowancesTotal: number; deductionsTotal: number; advanceRecovery: number; gross: number; netExact: number; net: number; roundOff: number; advanceRemaining: number };
}
interface LineItem {
  key: string;
  label: string;
  amount: number | undefined;
}

function Lines({ title, items, setItems }: { title: string; items: LineItem[]; setItems: (f: (x: LineItem[]) => LineItem[]) => void }) {
  return (
    <div>
      <p className="label">{title}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {items.map((l) => (
          <li key={l.key} className="grid grid-cols-[1fr_150px_36px] gap-2">
            <Input aria-label={`${title} label`} placeholder="Label, for example Bonus" value={l.label} onChange={(e) => setItems((x) => x.map((y) => (y.key === l.key ? { ...y, label: e.target.value } : y)))} />
            <MoneyInput value={l.amount} onChange={(v) => setItems((x) => x.map((y) => (y.key === l.key ? { ...y, amount: v } : y)))} />
            <IconButton label="Remove" onClick={() => setItems((x) => x.filter((y) => y.key !== l.key))}>
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
            </IconButton>
          </li>
        ))}
      </ul>
      <Button className="mt-2" size="sm" variant="ghost" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setItems((x) => [...x, { key: `k${Date.now()}`, label: '', amount: undefined }])}>
        Add line
      </Button>
    </div>
  );
}

function PaidView({ p, staff }: { p: Payslip; staff: Staff }) {
  const navigate = useNavigate();
  const [cancel, setCancel] = useState(false);
  return (
    <div>
      <PageHeader
        title={`Payslip ${p.number ?? ''}`}
        meta={<StatusText status={p.status} />}
        description={`${staff.name}, ${formatDate(p.periodFrom)} to ${formatDate(p.periodTo)}`}
        actions={
          <>
            <Button variant="primary" onClick={() => navigate(`/payslips/${p.id}/print`)}>
              Payslip PDF
            </Button>
            {p.status === 'PAID' && p.source === 'PAYROLL' ? (
              <Button variant="danger" onClick={() => setCancel(true)}>
                Cancel payslip
              </Button>
            ) : null}
          </>
        }
      />
      <Section>
        <div className="pt-5">
          <KeyValue
            cols={4}
            items={[
              { label: 'Pay type', value: PAYTYPE_LABEL[p.payType] },
              { label: 'Days present', value: `${p.daysPresent} of ${p.workingDaysInMonth} working days` },
              { label: 'Paid hours', value: p.paidHours },
              { label: 'Gross', value: <Money value={p.gross} /> },
              { label: 'Advance recovery', value: <Money value={p.advanceRecovery} /> },
              { label: 'Net pay', value: <Money value={p.net} strong /> },
              { label: 'Paid', value: p.paidOn ? `${MODE_LABEL[p.mode ?? 'CASH']} on ${formatDate(p.paidOn)}` : 'Not paid' },
              { label: 'Reference', value: p.reference ?? 'None' },
            ]}
          />
          {p.status === 'CANCELLED' ? <p className="mt-4 border-l-2 border-danger pl-3 text-sm">Cancelled: {p.cancelReason}</p> : null}
        </div>
      </Section>
      <ReasonDialog
        open={cancel}
        onOpenChange={setCancel}
        title={`Cancel payslip ${p.number}`}
        description="The payout is reversed, the attendance days are unlocked and the advance recovered is restored. This is logged."
        actionLabel="Cancel payslip"
        successText={`Cancelled payslip ${p.number}`}
        danger
        onConfirm={async (reason) => {
          await api.post(`/payslips/${p.id}/cancel`, { reason });
        }}
      />
    </div>
  );
}

export function PayslipEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const workers = useQuery({ queryKey: ['workers'], queryFn: () => api.get<{ items: (Staff & { login: { username: string } | null })[] }>('/workers') });
  const existing = useQuery({ queryKey: ['payslip', id], queryFn: () => api.get<{ payslip: Payslip; staff: Staff }>(`/payslips/${id}`), enabled: !!id });
  const thisMonth = today().slice(0, 7);
  const [staffId, setStaffId] = useState('');
  const [preset, setPreset] = useState<'mtd' | 'last' | 'custom'>('mtd');
  const [from, setFrom] = useState(`${thisMonth}-01`);
  const [to, setTo] = useState(today());
  const [allowances, setAllowances] = useState<LineItem[]>([]);
  const [deductions, setDeductions] = useState<LineItem[]>([]);
  const [recovery, setRecovery] = useState<number | undefined>();
  const [paying, setPaying] = useState(false);
  const loaded = useRef(false);
  const key = useRef(newIdempotencyKey());

  useEffect(() => {
    const e = existing.data?.payslip;
    if (!e || loaded.current) return;
    loaded.current = true;
    setStaffId(e.staffId);
    setPreset('custom');
    setFrom(e.periodFrom);
    setTo(e.periodTo);
    setAllowances(e.lines.filter((l) => l.kind === 'ALLOWANCE').map((l, i) => ({ key: `a${i}`, label: l.label, amount: l.amount })));
    setDeductions(e.lines.filter((l) => l.kind === 'DEDUCTION').map((l, i) => ({ key: `d${i}`, label: l.label, amount: l.amount })));
    setRecovery(e.advanceRecovery);
  }, [existing.data]);

  const body = {
    staffId,
    periodFrom: from,
    periodTo: to,
    allowances: allowances.filter((l) => l.label && l.amount).map((l) => ({ label: l.label, amount: l.amount ?? 0 })),
    deductions: deductions.filter((l) => l.label && l.amount).map((l) => ({ label: l.label, amount: l.amount ?? 0 })),
    advanceRecovery: recovery,
  };
  const dBody = useDebounced(body, 250);
  const preview = useQuery({ queryKey: ['payslip-preview', dBody, id], queryFn: () => api.post<Preview>('/payslips/preview', dBody), enabled: !!dBody.staffId && !(existing.data && existing.data.payslip.status !== 'DRAFT'), retry: false, placeholderData: (p) => p });

  useEffect(() => {
    if (preview.data && recovery === undefined) setRecovery(preview.data.result.advanceRecovery);
  }, [preview.data, recovery]);

  const saveDraft = useAction(() => (id ? api.patch<Payslip>(`/payslips/${id}`, body) : api.post<Payslip>('/payslips', body, { idempotencyKey: key.current })), { success: 'Saved draft payslip', onDone: (p) => navigate(`/payroll/${p.id}`, { replace: true }) });

  if (id && existing.isLoading) return <Skeleton className="m-6 h-96" />;
  if (id && existing.error) return <ErrorState error={existing.error} />;
  if (existing.data && existing.data.payslip.status !== 'DRAFT') return <PaidView p={existing.data.payslip} staff={existing.data.staff} />;
  if (existing.data?.payslip.source === 'SETTLEMENT') return <PaidView p={existing.data.payslip} staff={existing.data.staff} />;

  const eligible = (workers.data?.items ?? []).filter((w) => w.active && w.payType !== 'SHARE');
  const p = preview.data;
  const r = p?.result;
  const previewError = preview.error instanceof ApiError ? preview.error : null;
  const applyPreset = (v: 'mtd' | 'last' | 'custom') => {
    setPreset(v);
    if (v === 'mtd') {
      setFrom(`${thisMonth}-01`);
      setTo(today());
    } else if (v === 'last') {
      const m = prevMonth(thisMonth);
      setFrom(`${m}-01`);
      setTo(monthEnd(m));
    }
  };
  return (
    <div>
      <PageHeader title={id ? 'Draft payslip' : 'Generate payslip'} description="Fixed pay uses the full month’s working days for the day rate. Hourly pay uses the rounded hours. There is no overtime." />
      <Section>
        <div className="grid max-w-4xl grid-cols-1 gap-5 pt-5 md:grid-cols-[1fr_auto]">
          <Field label="Worker" htmlFor="ps-w">
            <Select
              id="ps-w"
              value={staffId}
              disabled={!!id}
              onChange={(e) => {
                setStaffId(e.target.value);
                setRecovery(undefined);
              }}
            >
              <option value="">Choose a Fixed or Hourly worker</option>
              {eligible.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}, {PAYTYPE_LABEL[w.payType]} {w.payType === 'FIXED' ? formatINR(w.basePay ?? 0) : `${formatINR(w.hourlyRate ?? 0)} an hour`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period">
            <Segmented
              label="Period"
              value={preset}
              onChange={applyPreset}
              items={[
                { value: 'mtd', label: 'This month so far' },
                { value: 'last', label: 'Last month' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </Field>
        </div>
        {preset === 'custom' ? (
          <div className="mt-4 max-w-md">
            <FormGrid>
              <Field label="From" htmlFor="ps-from">
                <Input id="ps-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To" htmlFor="ps-to" helper="Inside the same calendar month">
                <Input id="ps-to" type="date" value={to} min={from} max={monthEnd(from.slice(0, 7))} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </FormGrid>
          </div>
        ) : null}
      </Section>
      {!staffId ? (
        <p className="px-6 py-8 text-base text-slate">Choose a worker to see the overview.</p>
      ) : previewError ? (
        <div className="px-6 py-6">
          <p className="border-l-2 border-danger pl-3 text-base text-deep" role="alert">
            {previewError.message}
          </p>
        </div>
      ) : !p || !r ? (
        <Skeleton className="m-6 h-72" />
      ) : (
        <>
          <Section title="Overview">
            <KeyValue
              cols={4}
              items={[
                { label: 'Worker', value: p.staff.name },
                { label: 'Pay type', value: PAYTYPE_LABEL[p.staff.payType] },
                { label: p.staff.payType === 'FIXED' ? 'Base pay' : 'Hourly rate', value: p.staff.payType === 'FIXED' ? <Money value={p.staff.basePay} /> : <Money value={p.staff.hourlyRate} /> },
                { label: 'Period', value: `${formatDate(p.periodFrom)} to ${formatDate(p.periodTo)}` },
                ...(p.staff.payType === 'FIXED'
                  ? [
                      { label: 'Working days in the month', value: p.workingDaysInMonth },
                      { label: 'Per-day rate', value: `${formatINR(p.staff.basePay ?? 0)} ÷ ${p.workingDaysInMonth} = ${formatINR(r.perDayRate ?? 0)}` },
                      { label: 'Present, half, absent', value: `${p.summary.presentDays}, ${p.summary.halfDays}, ${p.summary.absentDays}${p.summary.leaveDays ? `, leave ${p.summary.leaveDays}` : ''}` },
                    ]
                  : [
                      { label: 'Days worked', value: p.summary.presentDays + p.summary.halfDays + p.summary.offDayWorkDays },
                      { label: 'Total paid hours', value: `${p.summary.paidHours} h` },
                    ]),
                { label: 'Base pay earned', value: <Money value={r.basePayEarned} strong /> },
              ]}
            />
          </Section>
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px]">
            <Section title="Day by day" flush className="xl:border-r">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-mist">
                    <tr className="border-y border-hairline text-th text-slate">
                      {['Date', 'Status', 'First in', 'Last out', 'Time', 'Paid hours', 'Day amount', 'Flags'].map((h, i) => (
                        <th key={h} className={`h-9 px-3 font-semibold ${i >= 4 && i <= 6 ? 'text-right' : 'text-left'}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.summary.days.map((d) => {
                      const dayAmt = p.staff.payType === 'FIXED' ? (d.status === 'PRESENT' && !d.offDay ? r.perDayRate ?? 0 : d.status === 'HALF' && !d.offDay ? Math.round((r.perDayRate ?? 0) / 2) : 0) : Math.round(d.paidHours * (p.staff.hourlyRate ?? 0));
                      return (
                        <tr key={d.date} className={`h-9 border-b border-hairline ${d.offDay ? 'bg-mist' : ''}`}>
                          <td className="px-3">{formatDate(d.date)}</td>
                          <td className="px-3">
                            <StatusText status={d.status} />
                          </td>
                          <td className="px-3">{formatTime(d.firstIn)}</td>
                          <td className="px-3">{formatTime(d.lastOut)}</td>
                          <td className="px-3 text-right tabular-nums">{d.rawMinutes ? `${Math.floor(d.rawMinutes / 60)} h ${d.rawMinutes % 60} m` : ''}</td>
                          <td className="px-3 text-right tabular-nums">{d.paidHours || ''}</td>
                          <td className="px-3 text-right tabular-nums">{dayAmt ? formatINR(dayAmt) : ''}</td>
                          <td className="px-3 text-meta text-slate">{[d.edited ? 'Edited' : '', d.offDayWork ? (p.staff.payType === 'FIXED' ? 'Worked on off day, no extra pay' : 'Worked on off day') : ''].filter(Boolean).join(', ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
            <aside>
              <Section title="Earnings and deductions">
                <div className="flex flex-col gap-5">
                  <Lines title="Allowances and bonus" items={allowances} setItems={setAllowances} />
                  <Lines title="Other deductions" items={deductions} setItems={setDeductions} />
                  <Field label="Advance recovery" htmlFor="ps-rec" helper={`Outstanding advance ${formatINR(p.outstandingAdvance)}. Recovery never makes the net negative.`}>
                    <MoneyInput id="ps-rec" value={recovery} onChange={setRecovery} />
                  </Field>
                  <dl className="flex flex-col gap-1.5 border-t border-hairline pt-4 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-slate">Gross</dt>
                      <dd>
                        <Money value={r.gross} />
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate">Total deductions</dt>
                      <dd>
                        <Money value={r.deductionsTotal + r.advanceRecovery} />
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate">Round-off</dt>
                      <dd>
                        <Money value={r.roundOff} />
                      </dd>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between border-t border-hairline pt-2">
                      <dt className="text-base font-semibold">Net payable</dt>
                      <dd className="text-[22px] font-semibold tabular-nums">{formatINR(r.net)}</dd>
                    </div>
                  </dl>
                  <InlineError error={saveDraft.error} />
                  <div className="flex gap-2">
                    <Button className="flex-1" loading={saveDraft.busy} onClick={() => void saveDraft.run()}>
                      Save as draft
                    </Button>
                    <Button className="flex-1" variant="primary" onClick={() => setPaying(true)}>
                      Pay now
                    </Button>
                  </div>
                </div>
              </Section>
            </aside>
          </div>
        </>
      )}
      <PayDialog
        open={paying}
        onOpenChange={setPaying}
        title={`Pay ${p?.staff.name ?? ''} ${r ? formatINR(r.net) : ''}`}
        description="The payslip is numbered, its attendance is locked, advances are recovered, cash or bank is paid out and the worker is notified."
        onPay={async (b) => {
          const draft = id ? await api.patch<Payslip>(`/payslips/${id}`, body) : await api.post<Payslip>('/payslips', body, { idempotencyKey: key.current });
          const paid = await api.post<Payslip>(`/payslips/${draft.id}/pay`, b, { idempotencyKey: `${key.current}-pay` });
          toast.success(`Paid payslip ${paid.number}`);
          await qc.invalidateQueries();
          navigate(`/payslips/${paid.id}/print`, { replace: true });
        }}
      />
    </div>
  );
}
