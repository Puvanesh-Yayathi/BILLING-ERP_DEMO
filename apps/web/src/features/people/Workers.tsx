import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { formatINR, type PublicUser, type Staff } from '@app/contract';
import { api } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { InlineError } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select, Switch } from '../../ui/form';
import { PageHeader } from '../../ui/layout';
import { Dialog, DropMenu, Drawer } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { PAYTYPE_LABEL, today, useDebounced } from '../common';

type Worker = Staff & { login: PublicUser | null; outstandingAdvance: number };

function generatePassword() {
  const a = 'abcdefghjkmnpqrstuvwxyz';
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const n = '23456789';
  const pick = (s: string) => s[Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % s.length)] ?? '';
  return [pick(A), pick(a), pick(a), pick(a), pick(n), pick(n), pick(A), pick(a), pick(n), pick(a)].join('');
}

function strength(pw: string): { label: string; tone: 'danger' | 'caution' | 'success' } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s <= 2 ? { label: 'Weak', tone: 'danger' } : s === 3 ? { label: 'Fair', tone: 'caution' } : { label: 'Strong', tone: 'success' };
}

export function PasswordField({ value, onChange, error, id }: { value: string; onChange: (v: string) => void; error?: string; id: string }) {
  const st = value ? strength(value) : null;
  return (
    <Field label="Password" htmlFor={id} error={error} helper={st ? <span>Strength: <span className={`font-medium ${st.tone === 'danger' ? 'text-danger' : st.tone === 'caution' ? 'text-brown' : 'text-success'}`}>{st.label}</span>. Share it with the worker in person.</span> : 'At least 8 characters with a letter and a number'}>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} invalid={!!error} autoComplete="new-password" />
        <Button icon={<RefreshCw className="h-4 w-4" strokeWidth={1.5} />} onClick={() => onChange(generatePassword())}>
          Generate
        </Button>
      </div>
    </Field>
  );
}

const blank = { name: '', phone: '', role: 'STAFF' as 'STAFF' | 'OPERATING', withLogin: true, loginId: '', password: '', payType: 'FIXED' as 'FIXED' | 'HOURLY' | 'SHARE', basePay: undefined as number | undefined, hourlyRate: undefined as number | undefined, sharePercent: undefined as number | undefined, reduceByAbsence: false, joinDate: today(), active: true };

function WorkerForm({ open, onOpenChange, worker, capReached }: { open: boolean; onOpenChange: (v: boolean) => void; worker?: Worker; capReached: boolean }) {
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setV(worker ? { ...blank, ...worker, role: (worker.login?.role as 'STAFF' | 'OPERATING') ?? 'STAFF', withLogin: !!worker.login, loginId: worker.login?.username ?? '', password: '', reduceByAbsence: worker.reduceByAbsence } : { ...blank, withLogin: !capReached });
  }, [open, worker, capReached]);
  const dLogin = useDebounced(v.loginId, 300);
  const check = useQuery({ queryKey: ['check-login', dLogin], queryFn: () => api.get<{ available: boolean }>('/workers/check-login', { loginId: dLogin }), enabled: !worker && v.withLogin && dLogin.length >= 4 });
  const save = useAction(
    () => {
      const pay = { payType: v.payType, basePay: v.basePay, hourlyRate: v.hourlyRate, sharePercent: v.sharePercent, reduceByAbsence: v.reduceByAbsence };
      return worker
        ? api.patch<Worker>(`/workers/${worker.id}`, { name: v.name, phone: v.phone, role: worker.login ? v.role : undefined, active: v.active, ...pay })
        : api.post<Worker>('/workers', { name: v.name, phone: v.phone, role: v.withLogin ? v.role : undefined, withLogin: v.withLogin, loginId: v.withLogin ? v.loginId : undefined, password: v.withLogin ? v.password : undefined, joinDate: v.joinDate, ...pay });
    },
    { success: (w) => (worker ? `Updated worker ${w.name}` : `Added worker ${w.name}${w.login ? `. They can sign in now as ${w.login.username}.` : ''}`), onDone: () => onOpenChange(false) },
  );
  const f = save.fields;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const loginMsg = check.data ? (check.data.available ? 'This login ID is free' : 'This login ID is already taken') : 'Unique, 4 to 20 characters';
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={worker ? `Edit ${worker.name}` : 'Add worker'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            {worker ? 'Save changes' : 'Add worker'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <FormGrid>
          <Field label="Name" htmlFor="w-name" error={f.name}>
            <Input id="w-name" value={v.name} invalid={!!f.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          <Field label="Phone" htmlFor="w-phone" error={f.phone}>
            <Input id="w-phone" inputMode="tel" value={v.phone} invalid={!!f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          {!worker ? (
            <Field label="Join date" htmlFor="w-join">
              <Input id="w-join" type="date" value={v.joinDate} onChange={(e) => set('joinDate', e.target.value)} />
            </Field>
          ) : null}
        </FormGrid>
        <div className="border-t border-hairline pt-5">
          <h3 className="text-base font-semibold">Pay</h3>
          <FormGrid>
            <Field label="Pay type" htmlFor="w-pay" helper={v.payType === 'SHARE' ? 'Paid only through the monthly profit settlement' : v.payType === 'FIXED' ? 'Base pay ÷ working days of the month, absent days unpaid' : 'Rounded hours worked, no overtime'}>
              <Select id="w-pay" value={v.payType} onChange={(e) => set('payType', e.target.value as typeof v.payType)}>
                <option value="FIXED">Fixed monthly base pay</option>
                <option value="HOURLY">Hourly rate</option>
                <option value="SHARE">Share of profit</option>
              </Select>
            </Field>
            {v.payType === 'FIXED' ? (
              <Field label="Base pay a month" htmlFor="w-base" error={f.basePay}>
                <MoneyInput id="w-base" value={v.basePay} invalid={!!f.basePay} onChange={(x) => set('basePay', x)} />
              </Field>
            ) : v.payType === 'HOURLY' ? (
              <Field label="Rate per hour" htmlFor="w-rate" error={f.hourlyRate}>
                <MoneyInput id="w-rate" value={v.hourlyRate} invalid={!!f.hourlyRate} onChange={(x) => set('hourlyRate', x)} />
              </Field>
            ) : (
              <Field label="Share of profit (%)" htmlFor="w-share" error={f.sharePercent} helper="Of the profit after the loan, before expenses">
                <Input id="w-share" inputMode="decimal" align="right" value={v.sharePercent ?? ''} invalid={!!f.sharePercent} onChange={(e) => set('sharePercent', e.target.value === '' ? undefined : Number(e.target.value.replace(/[^0-9.]/g, '')))} />
              </Field>
            )}
          </FormGrid>
          {v.payType === 'SHARE' ? (
            <div className="mt-4">
              <Switch label="Reduce the share by absences" checked={v.reduceByAbsence} onChange={(x) => set('reduceByAbsence', x)} />
            </div>
          ) : null}
        </div>
        <div className="border-t border-hairline pt-5">
          <h3 className="text-base font-semibold">Login</h3>
          {worker ? (
            <p className="mt-1 text-sm text-slate">{worker.login ? `Signs in as ${worker.login.username}. Use Reset password to set a new password.` : 'This worker has no login. Admin enters their attendance and pays them through payroll.'}</p>
          ) : (
            <>
              <div className="mt-2">
                <Switch label="Give this worker a billing login" checked={v.withLogin} onChange={(x) => set('withLogin', x)} />
              </div>
              {capReached && v.withLogin ? <p className="mt-2 text-sm text-danger">The worker login limit is reached. Add the worker without a login, or raise the limit in Settings.</p> : null}
              {v.withLogin ? (
                <div className="mt-4 flex flex-col gap-5">
                  <FormGrid>
                    <Field label="Login ID" htmlFor="w-login" error={f.loginId ?? (check.data && !check.data.available ? 'This login ID is already taken' : undefined)} helper={loginMsg}>
                      <Input id="w-login" value={v.loginId} autoComplete="off" invalid={!!f.loginId || (check.data && !check.data.available)} onChange={(e) => set('loginId', e.target.value.toLowerCase())} />
                    </Field>
                  </FormGrid>
                  <PasswordField id="w-pw" value={v.password} onChange={(x) => set('password', x)} error={f.password} />
                </div>
              ) : null}
            </>
          )}
        </div>
        {worker ? <Switch label="Active" checked={v.active} onChange={(x) => set('active', x)} /> : null}
        <InlineError error={Object.keys(f).length ? null : save.error} />
      </div>
    </Drawer>
  );
}

function ResetPassword({ worker, onOpenChange }: { worker: Worker | null; onOpenChange: (v: boolean) => void }) {
  const [pw, setPw] = useState('');
  const save = useAction(() => api.post(`/workers/${worker?.id}/reset-password`, { password: pw }), { success: `Reset the password. ${worker?.name ?? 'The worker'} was signed out everywhere.`, onDone: () => (setPw(''), onOpenChange(false)) });
  return (
    <Dialog
      open={!!worker}
      onOpenChange={onOpenChange}
      title={`Reset password for ${worker?.name ?? ''}`}
      description="The worker is signed out of every open session and must use the new password."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            Reset password
          </Button>
        </>
      }
    >
      <PasswordField id="reset-pw" value={pw} onChange={setPw} error={save.fields.password} />
    </Dialog>
  );
}

export function Workers() {
  const q = useQuery({ queryKey: ['workers'], queryFn: () => api.get<{ items: Worker[]; loginsUsed: number; maxWorkerLogins: number }>('/workers') });
  const [form, setForm] = useState<{ open: boolean; worker?: Worker }>({ open: false });
  const [resetting, setResetting] = useState<Worker | null>(null);
  const deactivate = useAction((w: Worker) => api.post(`/workers/${w.id}/deactivate`), { success: 'Deactivated worker' });
  const used = q.data?.loginsUsed ?? 0;
  const max = q.data?.maxWorkerLogins ?? 10;
  const capReached = used >= max;
  return (
    <div>
      <PageHeader
        title="Workers and logins"
        description="Pay type and rate for every worker. Billing staff get a login and are clocked in automatically. Other workers have no login: Admin marks their attendance and pays them."
        meta={
          <span className={`text-sm font-medium ${capReached ? 'text-danger' : 'text-deep'}`}>
            {used} of {max} worker logins used
          </span>
        }
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setForm({ open: true })}>
            Add worker
          </Button>
        }
      />
      {capReached ? <p className="border-b border-hairline px-6 py-3 text-sm text-danger">Limit of {max} worker logins reached. Ask your administrator to raise the limit. Workers without a login can still be added.</p> : null}
      <DataTable
        caption="Workers"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => r.id}
        onRowClick={(r) => setForm({ open: true, worker: r })}
        empty={{ title: 'No workers yet', body: 'Add a worker with their pay type. Give them a login if they bill or manage stock.' }}
        columns={[
          { id: 'code', header: 'Code', cell: (r) => r.code, width: 80 },
          { id: 'name', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name, hideable: false },
          { id: 'login', header: 'Login', cell: (r) => (r.login ? r.login.username : <span className="text-slate">No login</span>) },
          { id: 'pay', header: 'Pay type', cell: (r) => PAYTYPE_LABEL[r.payType] },
          { id: 'rate', header: 'Rate', align: 'right', cell: (r) => (r.payType === 'FIXED' ? `${formatINR(r.basePay ?? 0)} a month` : r.payType === 'HOURLY' ? `${formatINR(r.hourlyRate ?? 0)} an hour` : `${r.sharePercent}%${r.reduceByAbsence ? ', reduced by absences' : ''}`) },
          { id: 'adv', header: 'Advance due', align: 'right', cell: (r) => (r.outstandingAdvance ? formatINR(r.outstandingAdvance) : '') },
          { id: 'st', header: 'Status', cell: (r) => (r.active ? <StatusText status="ACTIVE" label="Active" tone="success" /> : <StatusText status="INACTIVE" label="Inactive" />) },
          {
            id: 'act',
            header: '',
            align: 'right',
            hideable: false,
            cell: (r) => (
              <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                <DropMenu
                  trigger={
                    <Button size="sm" variant="quiet">
                      Actions
                    </Button>
                  }
                  items={[
                    { label: 'Edit details and pay', onSelect: () => setForm({ open: true, worker: r }) },
                    ...(r.login ? [{ label: 'Reset password', onSelect: () => setResetting(r) }] : []),
                    ...(r.active ? ['sep' as const, { label: 'Deactivate', danger: true, onSelect: () => void deactivate.run(r) }] : []),
                  ]}
                />
              </span>
            ),
          },
        ]}
      />
      <WorkerForm open={form.open} onOpenChange={(o) => setForm((s) => ({ ...s, open: o }))} worker={form.worker} capReached={capReached} />
      <ResetPassword worker={resetting} onOpenChange={(o) => !o && setResetting(null)} />
    </div>
  );
}
