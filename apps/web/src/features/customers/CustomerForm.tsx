import { useEffect, useState } from 'react';
import type { Customer } from '@app/contract';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select, Switch, Textarea } from '../../ui/form';
import { Drawer } from '../../ui/overlay';

export const STATES: [string, string][] = [
  ['Tamil Nadu', '33'],
  ['Kerala', '32'],
  ['Karnataka', '29'],
  ['Andhra Pradesh', '37'],
  ['Telangana', '36'],
  ['Puducherry', '34'],
  ['Maharashtra', '27'],
];

const blank = { name: '', type: 'RETAIL' as Customer['type'], phone: '', email: '', address: '', gstin: '', state: 'Tamil Nadu', stateCode: '33', openingBalance: 0, active: true };

export function CustomerForm({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (v: boolean) => void; customer?: Customer }) {
  const { role } = useSession();
  const admin = role === 'ADMIN';
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (open) setV(customer ? { ...blank, ...customer, email: customer.email ?? '', gstin: customer.gstin ?? '' } : blank);
  }, [open, customer]);
  const save = useAction((body: typeof v) => (customer ? api.patch<Customer>(`/customers/${customer.id}`, body) : api.post<Customer>('/customers', body)), {
    success: (c) => (customer ? `Updated ${c.name}` : `Added ${c.type === 'DISTRIBUTOR' ? 'distributor' : 'customer'} ${c.name}`),
    onDone: () => onOpenChange(false),
  });
  const f = save.fields;
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={customer ? `Edit ${customer.name}` : 'Add customer'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run(v)}>
            {customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Name" htmlFor="c-name" error={f.name}>
            <Input id="c-name" value={v.name} onChange={(e) => set('name', e.target.value)} invalid={!!f.name} autoFocus />
          </Field>
          <Field label="Type" htmlFor="c-type" helper={!admin ? 'Only Admin can add distributors' : undefined}>
            <Select id="c-type" value={v.type} disabled={!admin} onChange={(e) => set('type', e.target.value as Customer['type'])}>
              <option value="RETAIL">Retail customer</option>
              <option value="DISTRIBUTOR">Distributor</option>
            </Select>
          </Field>
          <Field label="Phone" htmlFor="c-phone" error={f.phone}>
            <Input id="c-phone" inputMode="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} invalid={!!f.phone} />
          </Field>
          <Field label="Email" htmlFor="c-email" error={f.email} helper="Optional">
            <Input id="c-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} invalid={!!f.email} />
          </Field>
        </FormGrid>
        <Field label="Address" htmlFor="c-address" error={f.address}>
          <Textarea id="c-address" value={v.address} onChange={(e) => set('address', e.target.value)} invalid={!!f.address} />
        </Field>
        <FormGrid>
          <Field label="State" htmlFor="c-state" helper={`State code ${v.stateCode}. Tamil Nadu bills use CGST and SGST, other states IGST.`}>
            <Select
              id="c-state"
              value={v.state}
              onChange={(e) => {
                const s = STATES.find((x) => x[0] === e.target.value);
                setV((x) => ({ ...x, state: e.target.value, stateCode: s?.[1] ?? x.stateCode }));
              }}
            >
              {STATES.map(([s]) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="GSTIN" htmlFor="c-gstin" error={f.gstin} helper="Optional, 15 characters">
            <Input id="c-gstin" value={v.gstin} maxLength={15} onChange={(e) => set('gstin', e.target.value.toUpperCase())} invalid={!!f.gstin} />
          </Field>
          {admin ? (
            <Field label="Opening balance" htmlFor="c-ob" helper="Amount the customer owed before using this system">
              <MoneyInput id="c-ob" value={v.openingBalance} allowNegative onChange={(x) => set('openingBalance', x ?? 0)} />
            </Field>
          ) : null}
          {customer ? (
            <div className="pt-6">
              <Switch label="Active" checked={v.active} onChange={(x) => set('active', x)} />
            </div>
          ) : null}
        </FormGrid>
        <InlineError error={Object.keys(f).length ? null : save.error} />
      </div>
    </Drawer>
  );
}
