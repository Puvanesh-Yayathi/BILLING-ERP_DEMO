import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useSession } from '../../lib/session';
import { Field, Select } from '../../ui/form';
import { PageHeader, Toolbar } from '../../ui/layout';
import { LedgerView } from './LedgerView';

type Kind = 'customer' | 'distributor' | 'supplier' | 'cash' | 'bank' | 'expense-head' | 'staff';

export function Ledgers() {
  const { role } = useSession();
  const [kind, setKind] = useState<Kind>('cash');
  const [id, setId] = useState('cash');
  const customers = useQuery({ queryKey: ['customers'], queryFn: () => api.get<{ items: { id: string; name: string; type: string }[] }>('/customers') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/suppliers') });
  const heads = useQuery({ queryKey: ['expense-heads'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/expense-heads') });
  const banks = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<{ items: { id: string; bankName: string; accountNo: string }[] }>('/bank-accounts') });
  const workers = useQuery({ queryKey: ['workers'], queryFn: () => api.get<{ items: { id: string; name: string }[] }>('/workers'), enabled: role === 'ADMIN' });
  const options: Record<Kind, { id: string; name: string }[]> = {
    customer: (customers.data?.items ?? []).filter((c) => c.type === 'RETAIL'),
    distributor: (customers.data?.items ?? []).filter((c) => c.type === 'DISTRIBUTOR'),
    supplier: suppliers.data?.items ?? [],
    cash: [{ id: 'cash', name: 'Cash in hand' }],
    bank: (banks.data?.items ?? []).map((b) => ({ id: b.id, name: `${b.bankName} ${b.accountNo.slice(-4)}` })),
    'expense-head': heads.data?.items ?? [],
    staff: workers.data?.items ?? [],
  };
  const kinds: [Kind, string][] = [
    ['cash', 'Cash'],
    ['bank', 'Bank'],
    ['customer', 'Customer'],
    ['distributor', 'Distributor'],
    ['supplier', 'Supplier'],
    ['expense-head', 'Expense head'],
    ...(role === 'ADMIN' ? ([['staff', 'Staff (advances and pay)']] as [Kind, string][]) : []),
  ];
  return (
    <div>
      <PageHeader title="Ledgers" description="Opening balance, dated debits and credits, and a running balance. Click a row to open its document." />
      <Toolbar>
        <Field label="Ledger" htmlFor="kind">
          <Select
            id="kind"
            value={kind}
            className="w-[220px]"
            onChange={(e) => {
              const k = e.target.value as Kind;
              setKind(k);
              setId(k === 'cash' ? 'cash' : (options[k][0]?.id ?? ''));
            }}
          >
            {kinds.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== 'cash' ? (
          <Field label="Account" htmlFor="acct">
            <Select id="acct" value={id} className="w-[260px]" onChange={(e) => setId(e.target.value)}>
              <option value="">Choose</option>
              {options[kind].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </Toolbar>
      {id ? <LedgerView key={`${kind}-${id}`} type={kind} id={id} /> : <p className="px-6 py-8 text-base text-slate">Choose an account to see its ledger.</p>}
    </div>
  );
}
