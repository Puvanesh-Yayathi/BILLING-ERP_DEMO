import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ROLE_LABEL, type CompanyHoliday, type CompanyProfile, type PublicUser, type Settings } from '@app/contract';
import { api } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button, IconButton } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { InlineError, Skeleton, useToast } from '../../ui/feedback';
import { Checkbox, Field, FormGrid, Input, Select, Switch, Textarea } from '../../ui/form';
import { KeyValue, PageHeader, Section } from '../../ui/layout';
import { Dialog, Drawer, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { STATES } from '../customers/CustomerForm';
import { formatDate } from '../common';
import { PasswordField } from '../people/Workers';

type Tab = 'company' | 'calendar' | 'settings' | 'users' | 'data';

/** Resize to 512 px and make a 64 px favicon in the browser; the server checks type, size and dimensions. */
async function processLogo(file: File): Promise<{ dataUrl: string; faviconDataUrl: string; width: number; height: number }> {
  if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) throw new Error('Upload a PNG, JPG or SVG image');
  if (file.size > 2 * 1024 * 1024) throw new Error('The logo must be 2 MB or smaller');
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('The file could not be read'));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('This image could not be opened'));
    i.src = src;
  });
  const draw = (max: number) => {
    const w0 = img.naturalWidth || 512;
    const h0 = img.naturalHeight || 512;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  };
  const big = draw(512);
  const fav = document.createElement('canvas');
  fav.width = 64;
  fav.height = 64;
  const s = Math.min(64 / big.width, 64 / big.height);
  fav.getContext('2d')?.drawImage(big, (64 - big.width * s) / 2, (64 - big.height * s) / 2, big.width * s, big.height * s);
  return { dataUrl: big.toDataURL('image/png'), faviconDataUrl: fav.toDataURL('image/png'), width: big.width, height: big.height };
}

function CompanyTab() {
  const q = useQuery({ queryKey: ['company-profile'], queryFn: () => api.get<{ profile: CompanyProfile }>('/company-profile') });
  const versions = useQuery({ queryKey: ['company-versions'], queryFn: () => api.get<{ items: (CompanyProfile & { createdBy: string })[] }>('/company-profile/versions') });
  const [v, setV] = useState<CompanyProfile | null>(null);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (q.data) setV(q.data.profile);
  }, [q.data]);
  const save = useAction(() => {
    if (!v) throw new Error('Not loaded');
    const { id: _i, versionNo: _n, effectiveFrom: _e, createdById: _c, ...body } = v;
    return api.put<CompanyProfile>('/company-profile', { ...body, gstin: body.gstin ?? '', website: body.website ?? '', legalName: body.legalName ?? '', addressLine2: body.addressLine2 ?? '' });
  }, { success: (p) => `Saved company profile version ${p.versionNo}. New documents use it from now on.` });
  if (!v) return <Skeleton className="m-6 h-96" />;
  const f = save.fields;
  const set = <K extends keyof CompanyProfile>(k: K, val: CompanyProfile[K]) => setV({ ...v, [k]: val });
  return (
    <>
      <Section title="Identity">
        <p className="mb-4 max-w-2xl text-sm text-slate">Changes show at once on the login page, header and browser tab. Printed documents keep the details in force when they were finalized, so old invoices reprint exactly as issued.</p>
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex w-56 shrink-0 flex-col items-start gap-3">
            <img src={v.logoAssetId ? `/api/v1/assets/${v.logoAssetId}` : '/mark.svg'} alt="Current logo" className="h-24 w-24 rounded-panel border border-hairline object-contain p-2" />
            <label className="inline-flex h-9 cursor-pointer items-center rounded-ctl border border-hairline px-4 text-base font-medium text-deep hover:bg-mist">
              {uploading ? 'Uploading' : 'Upload logo'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setLogoErr(null);
                  setUploading(true);
                  try {
                    const out = await processLogo(file);
                    const r = await api.post<{ logoAssetId: string; faviconAssetId: string }>('/assets/logo', out);
                    setV((cur) => (cur ? { ...cur, logoAssetId: r.logoAssetId, faviconAssetId: r.faviconAssetId } : cur));
                  } catch (err) {
                    setLogoErr(err instanceof Error ? err.message : 'The logo could not be uploaded');
                  } finally {
                    setUploading(false);
                  }
                }}
              />
            </label>
            <p className="helper">PNG, JPG or SVG up to 2 MB. Save the profile to apply it.</p>
            {logoErr ? <p className="text-meta text-danger">{logoErr}</p> : null}
          </div>
          <div className="flex-1">
            <FormGrid>
              <Field label="Brand name" htmlFor="cp-brand" error={f.brandName}>
                <Input id="cp-brand" value={v.brandName} invalid={!!f.brandName} onChange={(e) => set('brandName', e.target.value)} />
              </Field>
              <Field label="Legal name" htmlFor="cp-legal" helper="Optional">
                <Input id="cp-legal" value={v.legalName ?? ''} onChange={(e) => set('legalName', e.target.value)} />
              </Field>
              <Field label="Address line 1" htmlFor="cp-a1" error={f.addressLine1}>
                <Input id="cp-a1" value={v.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} />
              </Field>
              <Field label="Address line 2" htmlFor="cp-a2" helper="Optional">
                <Input id="cp-a2" value={v.addressLine2 ?? ''} onChange={(e) => set('addressLine2', e.target.value)} />
              </Field>
              <Field label="City" htmlFor="cp-city" error={f.city}>
                <Input id="cp-city" value={v.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="State" htmlFor="cp-state" helper={`State code ${v.stateCode}`}>
                <Select
                  id="cp-state"
                  value={v.state}
                  onChange={(e) => {
                    const s = STATES.find((x) => x[0] === e.target.value);
                    setV({ ...v, state: e.target.value, stateCode: s?.[1] ?? v.stateCode });
                  }}
                >
                  {STATES.map(([s]) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Pincode" htmlFor="cp-pin" error={f.pincode}>
                <Input id="cp-pin" inputMode="numeric" value={v.pincode} invalid={!!f.pincode} onChange={(e) => set('pincode', e.target.value)} />
              </Field>
              <Field label="Phone" htmlFor="cp-phone" error={f.phone}>
                <Input id="cp-phone" value={v.phone} invalid={!!f.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field label="Email" htmlFor="cp-email" error={f.email}>
                <Input id="cp-email" type="email" value={v.email} invalid={!!f.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Website" htmlFor="cp-web" helper="Optional">
                <Input id="cp-web" value={v.website ?? ''} onChange={(e) => set('website', e.target.value)} />
              </Field>
              <Field label="GSTIN" htmlFor="cp-gstin" error={f.gstin} helper="15 characters. The first two digits must match the state code.">
                <Input id="cp-gstin" value={v.gstin ?? ''} maxLength={15} invalid={!!f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Signatory label" htmlFor="cp-sig" error={f.signatoryLabel}>
                <Input id="cp-sig" value={v.signatoryLabel} onChange={(e) => set('signatoryLabel', e.target.value)} />
              </Field>
            </FormGrid>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Invoice terms" htmlFor="cp-terms" error={f.invoiceTerms}>
                <Textarea id="cp-terms" value={v.invoiceTerms} onChange={(e) => set('invoiceTerms', e.target.value)} />
              </Field>
              <Field label="Footer note" htmlFor="cp-foot" helper="Printed in the footer of every page">
                <Textarea id="cp-foot" value={v.footerNote} onChange={(e) => set('footerNote', e.target.value)} />
              </Field>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <Button variant="primary" loading={save.busy} done={save.done} onClick={() => void save.run()}>
                Save company profile
              </Button>
              <InlineError error={Object.keys(f).length ? null : save.error} />
            </div>
          </div>
        </div>
      </Section>
      <Section title="History" flush>
        <DataTable
          caption="Company profile versions"
          toolbar={false}
          rows={versions.data?.items}
          loading={versions.isLoading}
          rowId={(r) => r.id}
          empty={{ title: 'No history', body: 'Each save creates a new version.' }}
          columns={[
            { id: 'v', header: 'Version', cell: (r) => r.versionNo },
            { id: 'f', header: 'From', cell: (r) => new Date(r.effectiveFrom).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) },
            { id: 'b', header: 'Brand name', cell: (r) => r.brandName },
            { id: 'g', header: 'GSTIN', cell: (r) => r.gstin ?? 'None' },
            { id: 'by', header: 'Changed by', cell: (r) => r.createdBy },
          ]}
        />
      </Section>
    </>
  );
}

function CalendarTab() {
  const q = useQuery({ queryKey: ['calendar'], queryFn: () => api.get<{ weeklyOffs: number[]; holidays: CompanyHoliday[]; months: { month: string; workingDays: number }[] }>('/calendar') });
  const [offs, setOffs] = useState<number[] | null>(null);
  const [h, setH] = useState({ date: '', name: '' });
  useEffect(() => {
    if (q.data) setOffs(q.data.weeklyOffs);
  }, [q.data]);
  const saveOffs = useAction(() => api.put('/calendar', { weeklyOffs: offs }), { success: 'Saved weekly off days' });
  const addH = useAction(() => api.post('/calendar/holidays', h), { success: 'Added holiday', onDone: () => setH({ date: '', name: '' }) });
  const delH = useAction((id: string) => api.del(`/calendar/holidays/${id}`), { success: 'Removed holiday' });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <>
      <Section title="Working days">
        <p className="mb-3 text-sm text-slate">Working days in a month = days in the month, less weekly off days, less extra holidays. Fixed pay divides the base pay by this number.</p>
        <KeyValue cols={3} items={(q.data?.months ?? []).map((m) => ({ label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }), value: <span className="text-section font-semibold">{m.workingDays} working days</span> }))} />
      </Section>
      <Section title="Weekly off days">
        <div className="flex flex-wrap gap-4">
          {days.map((d, i) => (
            <Checkbox key={d} label={d} checked={!!offs?.includes(i)} onChange={(on) => setOffs((o) => (on ? [...(o ?? []), i] : (o ?? []).filter((x) => x !== i)))} />
          ))}
        </div>
        <Button className="mt-4" loading={saveOffs.busy} onClick={() => void saveOffs.run()}>
          Save weekly off days
        </Button>
      </Section>
      <Section title="Extra holidays">
        <ul className="mb-4 divide-y divide-hairline border-y border-hairline text-sm">
          {q.data?.holidays.map((x) => (
            <li key={x.id} className="flex items-center justify-between py-2">
              <span>
                {formatDate(x.date)}, {x.name}
              </span>
              <IconButton label={`Remove ${x.name}`} onClick={() => void delH.run(x.id)}>
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </IconButton>
            </li>
          ))}
          {!q.data?.holidays.length ? <li className="py-2 text-slate">No extra holidays.</li> : null}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Date" htmlFor="h-date" error={addH.fields.date}>
            <Input id="h-date" type="date" value={h.date} onChange={(e) => setH({ ...h, date: e.target.value })} />
          </Field>
          <Field label="Name" htmlFor="h-name" error={addH.fields.name}>
            <Input id="h-name" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
          </Field>
          <Button icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} loading={addH.busy} onClick={() => void addH.run()}>
            Add holiday
          </Button>
        </div>
      </Section>
    </>
  );
}

function SettingsTab() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
  const [v, setV] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useAction(() => {
    if (!v) throw new Error('Not loaded');
    const { weeklyOffs: _w, ...body } = v;
    return api.put<Settings>('/settings', body);
  }, { success: 'Saved settings' });
  if (!v) return <Skeleton className="m-6 h-72" />;
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 });
  const f = save.fields;
  return (
    <Section>
      <div className="max-w-3xl pt-5">
        <FormGrid>
          <Field label="Worker login limit" htmlFor="s-max" error={f.maxWorkerLogins} helper="Active Staff and Operating logins. Workers without a login do not count.">
            <Input id="s-max" inputMode="numeric" align="right" value={v.maxWorkerLogins} onChange={num('maxWorkerLogins')} />
          </Field>
          <Field label="Hours rounding" htmlFor="s-round" helper="Applied to each day’s total">
            <Select id="s-round" value={v.hoursRounding} onChange={(e) => setV({ ...v, hoursRounding: e.target.value as Settings['hoursRounding'] })}>
              <option value="NEAREST">Nearest hour (30 minutes rounds up)</option>
              <option value="UP">Round up to the next hour</option>
              <option value="EXACT">Exact minutes</option>
            </Select>
          </Field>
          <Field label="Credit period (days)" htmlFor="s-credit">
            <Input id="s-credit" inputMode="numeric" align="right" value={v.creditDays} onChange={num('creditDays')} />
          </Field>
          <Field label="Idle sign-out (minutes)" htmlFor="s-idle" helper="Idle time is not counted as worked time">
            <Input id="s-idle" inputMode="numeric" align="right" value={v.idleTimeoutMinutes} onChange={num('idleTimeoutMinutes')} />
          </Field>
          <Field label="Share is calculated on" htmlFor="s-basis">
            <Select id="s-basis" value={v.shareBasis} onChange={(e) => setV({ ...v, shareBasis: e.target.value as Settings['shareBasis'] })}>
              <option value="POOL">Profit after the loan, before expenses</option>
              <option value="NET">Profit after the loan and expenses</option>
            </Select>
          </Field>
          <Field label="Half day below (paid hours)" htmlFor="s-half" helper="Only when the half-day rule is on">
            <Input id="s-half" inputMode="numeric" align="right" value={v.halfDayMinHours} onChange={num('halfDayMinHours')} disabled={!v.halfDayRuleEnabled} />
          </Field>
          <Field label="Sign-in attempts per minute" htmlFor="s-rl" helper="Per username. Ten failures lock the account for 15 minutes.">
            <Input id="s-rl" inputMode="numeric" align="right" value={v.rateLimitLoginPerMinute} onChange={num('rateLimitLoginPerMinute')} />
          </Field>
          <Field label="API requests per minute" htmlFor="s-api" helper="Per user">
            <Input id="s-api" inputMode="numeric" align="right" value={v.rateLimitApiPerMinute} onChange={num('rateLimitApiPerMinute')} />
          </Field>
        </FormGrid>
        <div className="mt-5 flex flex-col gap-3">
          <Switch label="Count short days as half days for Fixed pay" checked={v.halfDayRuleEnabled} onChange={(x) => setV({ ...v, halfDayRuleEnabled: x })} />
          <Switch label="New share workers are reduced by absences" checked={v.reduceByAbsenceDefault} onChange={(x) => setV({ ...v, reduceByAbsenceDefault: x })} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" loading={save.busy} done={save.done} onClick={() => void save.run()}>
            Save settings
          </Button>
          <InlineError error={Object.keys(f).length ? null : save.error} />
        </div>
      </div>
    </Section>
  );
}

function UsersTab() {
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ items: PublicUser[] }>('/users') });
  const dists = useQuery({ queryKey: ['customers', 'DISTRIBUTOR'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/customers', { type: 'DISTRIBUTOR' }) });
  const [form, setForm] = useState<{ open: boolean; user?: PublicUser }>({ open: false });
  const [v, setV] = useState({ name: '', username: '', password: '', role: 'DISTRIBUTOR', customerId: '', active: true });
  useEffect(() => {
    if (form.open) setV(form.user ? { name: form.user.name, username: form.user.username, password: '', role: form.user.role, customerId: form.user.customerId ?? '', active: form.user.active } : { name: '', username: '', password: '', role: 'DISTRIBUTOR', customerId: '', active: true });
  }, [form]);
  const save = useAction(
    () => (form.user ? api.patch(`/users/${form.user.id}`, { name: v.name, active: v.active, password: v.password }) : api.post('/users', { name: v.name, username: v.username, password: v.password, role: v.role, customerId: v.role === 'DISTRIBUTOR' ? v.customerId : undefined })),
    { success: form.user ? 'Saved account' : 'Created account', onDone: () => setForm({ open: false }) },
  );
  const f = save.fields;
  return (
    <>
      <div className="flex justify-end px-6 py-3">
        <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setForm({ open: true })}>
          Add account
        </Button>
      </div>
      <DataTable
        caption="Accounts"
        rows={q.data?.items}
        loading={q.isLoading}
        error={q.error}
        rowId={(r) => r.id}
        onRowClick={(r) => setForm({ open: true, user: r })}
        empty={{ title: 'No accounts', body: 'Add Admin, Monitor, Collector and Distributor accounts here. Worker logins are managed in Workers and logins.' }}
        columns={[
          { id: 'n', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
          { id: 'u', header: 'Login', cell: (r) => r.username },
          { id: 'r', header: 'Role', cell: (r) => ROLE_LABEL[r.role] },
          { id: 'c', header: 'Linked distributor', cell: (r) => dists.data?.items.find((d) => d.id === r.customerId)?.name ?? '' },
          { id: 's', header: 'Status', cell: (r) => (r.active ? <StatusText status="A" label="Active" tone="success" /> : <StatusText status="I" label="Inactive" />) },
        ]}
      />
      <Drawer
        open={form.open}
        onOpenChange={(o) => setForm((s) => ({ ...s, open: o }))}
        title={form.user ? `Edit ${form.user.username}` : 'Add account'}
        footer={
          <>
            <Button onClick={() => setForm({ open: false })}>Cancel</Button>
            <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
              {form.user ? 'Save changes' : 'Create account'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <FormGrid>
            <Field label="Name" htmlFor="u-name" error={f.name}>
              <Input id="u-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <Field label="Login" htmlFor="u-login" error={f.username}>
              <Input id="u-login" value={v.username} disabled={!!form.user} onChange={(e) => setV({ ...v, username: e.target.value.toLowerCase() })} />
            </Field>
            <Field label="Role" htmlFor="u-role">
              <Select id="u-role" value={v.role} disabled={!!form.user} onChange={(e) => setV({ ...v, role: e.target.value })}>
                <option value="MONITOR">Monitor (read only)</option>
                <option value="COLLECTOR">Collector (read only)</option>
                <option value="DISTRIBUTOR">Distributor</option>
                <option value="ADMIN">Admin</option>
              </Select>
            </Field>
            {v.role === 'DISTRIBUTOR' ? (
              <Field label="Distributor" htmlFor="u-dist" error={f.customerId}>
                <Select id="u-dist" value={v.customerId} disabled={!!form.user} onChange={(e) => setV({ ...v, customerId: e.target.value })}>
                  <option value="">Choose</option>
                  {dists.data?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </FormGrid>
          <PasswordField id="u-pw" value={v.password} onChange={(x) => setV({ ...v, password: x })} error={f.password} />
          {form.user ? <p className="helper">Leave the password empty to keep the current one. Only Admin can set passwords.</p> : null}
          {form.user ? <Switch label="Active" checked={v.active} onChange={(x) => setV({ ...v, active: x })} /> : null}
        </div>
      </Drawer>
    </>
  );
}

function DataTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const reset = useAction(() => api.post('/admin/reset'), { success: 'Restored the demo data', onDone: () => setConfirm(false) });
  const exportIt = async () => {
    const data = await api.get<unknown>('/admin/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `demo-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  return (
    <Section title="Data tools">
      <ul className="flex max-w-2xl flex-col divide-y divide-hairline border-y border-hairline">
        <li className="flex flex-wrap items-center justify-between gap-3 py-4">
          <span>
            <span className="block font-medium">Export data</span>
            <span className="block text-sm text-slate">Download all demo data as a JSON file.</span>
          </span>
          <Button onClick={() => void exportIt()}>Export data</Button>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 py-4">
          <span>
            <span className="block font-medium">Import data</span>
            <span className="block text-sm text-slate">Replace the demo data with a file made by Export data.</span>
          </span>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-ctl border border-hairline px-4 text-base font-medium hover:bg-mist">
            Import data
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const json = JSON.parse(await file.text()) as { state?: unknown };
                  await api.post('/admin/import', { state: json.state ?? json });
                  toast.success('Imported the demo data');
                  await qc.invalidateQueries();
                } catch (err) {
                  toast.error(err);
                }
              }}
            />
          </label>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 py-4">
          <span>
            <span className="block font-medium">Reset demo data</span>
            <span className="block text-sm text-slate">Restore the original generic demo data. Everything created since is removed.</span>
          </span>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Reset demo data
          </Button>
        </li>
      </ul>
      <p className="mt-4 text-sm text-slate">In production these become nightly database backups with the last seven kept.</p>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Reset demo data"
        description="Every record created during the demo is removed and the original demo data is restored. Everyone stays signed in."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Keep the data</Button>
            <Button variant="danger" loading={reset.busy} onClick={() => void reset.run()}>
              Reset demo data
            </Button>
          </>
        }
      >
        <p className="text-sm">This cannot be undone. Export the data first if you want to keep it.</p>
      </Dialog>
    </Section>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('company');
  return (
    <div>
      <PageHeader title="Settings" description="Company identity, calendar, rules and accounts. Only Admin can change these." />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Settings"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'company', label: 'Company profile' },
            { value: 'calendar', label: 'Calendar' },
            { value: 'settings', label: 'Rules' },
            { value: 'users', label: 'Other accounts' },
            { value: 'data', label: 'Data tools' },
          ]}
        />
      </div>
      {tab === 'company' ? <CompanyTab /> : tab === 'calendar' ? <CalendarTab /> : tab === 'settings' ? <SettingsTab /> : tab === 'users' ? <UsersTab /> : <DataTab />}
    </div>
  );
}
