import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { formatINR, formatQty, type BankAccount, type Product, type RawMaterial, type Supplier } from '@app/contract';
import { api } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { InlineError } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select, Switch, Textarea } from '../../ui/form';
import { Money, PageHeader, Section } from '../../ui/layout';
import { Drawer, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { STATES } from '../customers/CustomerForm';

type Tab = 'products' | 'purchase' | 'suppliers' | 'lists' | 'banks' | 'opening';
type Named = { id: string; name: string };

const CAT: Record<string, string> = { RAW_MATERIAL: 'Raw material', PACKAGING: 'Packaging', CONSUMABLE: 'Consumable', OTHER: 'Other' };

function useNamed(path: string) {
  return useQuery({ queryKey: [path], queryFn: () => api.get<{ items: Named[] }>(`/${path}`) });
}

function ProductForm({ open, onOpenChange, item }: { open: boolean; onOpenChange: (v: boolean) => void; item?: Product }) {
  const units = useNamed('units');
  const cats = useNamed('product-categories');
  const blank = { code: '', name: '', categoryId: '', unitId: '', hsn: '', gstRate: 5, taxInclusive: false, mrp: 0, retailPrice: undefined as number | undefined, distributorPrice: undefined as number | undefined, reorderLevel: 0, active: true };
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (open) setV(item ? { ...blank, ...item, hsn: item.hsn ?? '' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const save = useAction(() => (item ? api.patch<Product>(`/products/${item.id}`, v) : api.post<Product>('/products', v)), { success: (p) => (item ? `Updated product ${p.code}` : `Added product ${p.code}`), onDone: () => onOpenChange(false) });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={item ? `Edit ${item.code}` : 'Add product'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            {item ? 'Save changes' : 'Add product'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Code" htmlFor="p-code" error={f.code} helper="Unique, typed on the billing screen">
            <Input id="p-code" value={v.code} invalid={!!f.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name" htmlFor="p-name" error={f.name}>
            <Input id="p-name" value={v.name} invalid={!!f.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Category" htmlFor="p-cat" error={f.categoryId}>
            <Select id="p-cat" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
              <option value="">Choose</option>
              {cats.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit" htmlFor="p-unit" error={f.unitId}>
            <Select id="p-unit" value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}>
              <option value="">Choose</option>
              {units.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="HSN" htmlFor="p-hsn" helper="Sample value, to be confirmed">
            <Input id="p-hsn" value={v.hsn} onChange={(e) => setV({ ...v, hsn: e.target.value })} />
          </Field>
          <Field label="GST rate" htmlFor="p-gst" helper="Sample rates, editable per product">
            <Select id="p-gst" value={v.gstRate} onChange={(e) => setV({ ...v, gstRate: Number(e.target.value) })}>
              {[0, 5, 12, 18, 28].map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Retail price" htmlFor="p-retail" error={f.retailPrice}>
            <MoneyInput id="p-retail" value={v.retailPrice} invalid={!!f.retailPrice} onChange={(x) => setV({ ...v, retailPrice: x })} />
          </Field>
          <Field label="Distributor price" htmlFor="p-dist" error={f.distributorPrice}>
            <MoneyInput id="p-dist" value={v.distributorPrice} invalid={!!f.distributorPrice} onChange={(x) => setV({ ...v, distributorPrice: x })} />
          </Field>
          <Field label="MRP" htmlFor="p-mrp">
            <MoneyInput id="p-mrp" value={v.mrp} onChange={(x) => setV({ ...v, mrp: x ?? 0 })} />
          </Field>
          <Field label="Reorder level" htmlFor="p-reorder" helper="A low-stock alert fires below this">
            <Input id="p-reorder" inputMode="decimal" align="right" value={v.reorderLevel} onChange={(e) => setV({ ...v, reorderLevel: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} />
          </Field>
        </FormGrid>
        <Switch label="Prices include GST" checked={v.taxInclusive} onChange={(x) => setV({ ...v, taxInclusive: x })} />
        {item ? <Switch label="Active (sold on bills)" checked={v.active} onChange={(x) => setV({ ...v, active: x })} /> : null}
        <InlineError error={Object.keys(f).length ? null : save.error} />
      </div>
    </Drawer>
  );
}

function PurchaseItemForm({ open, onOpenChange, item }: { open: boolean; onOpenChange: (v: boolean) => void; item?: RawMaterial }) {
  const units = useNamed('units');
  const sups = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ items: Supplier[] }>('/suppliers') });
  const blank = { name: '', category: 'RAW_MATERIAL' as RawMaterial['category'], unitId: '', preferredSupplierId: '', lastRate: undefined as number | undefined, reorderLevel: 0, active: true };
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (open) setV(item ? { ...blank, ...item, preferredSupplierId: item.preferredSupplierId ?? '' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const body = { ...v, lastRate: v.lastRate ?? 0, preferredSupplierId: v.preferredSupplierId || undefined };
  const save = useAction(() => (item ? api.patch<RawMaterial>(`/purchase-items/${item.id}`, body) : api.post<RawMaterial>('/purchase-items', body)), { success: (r) => (item ? `Updated ${r.name}` : `Added ${r.name} to the Purchase List`), onDone: () => onOpenChange(false) });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={item ? `Edit ${item.name}` : 'Add purchase item'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Name" htmlFor="r-name" error={f.name}>
            <Input id="r-name" value={v.name} invalid={!!f.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Category" htmlFor="r-cat">
            <Select id="r-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as RawMaterial['category'] })}>
              {Object.entries(CAT).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Unit" htmlFor="r-unit" error={f.unitId}>
            <Select id="r-unit" value={v.unitId} onChange={(e) => setV({ ...v, unitId: e.target.value })}>
              <option value="">Choose</option>
              {units.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Preferred supplier" htmlFor="r-sup" helper="Optional">
            <Select id="r-sup" value={v.preferredSupplierId} onChange={(e) => setV({ ...v, preferredSupplierId: e.target.value })}>
              <option value="">None</option>
              {sups.data?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Last purchase rate" htmlFor="r-rate" helper="Only a default, can be changed on each indent and bill">
            <MoneyInput id="r-rate" value={v.lastRate} onChange={(x) => setV({ ...v, lastRate: x })} />
          </Field>
          <Field label="Reorder level" htmlFor="r-reorder">
            <Input id="r-reorder" inputMode="decimal" align="right" value={v.reorderLevel} onChange={(e) => setV({ ...v, reorderLevel: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} />
          </Field>
        </FormGrid>
        {item ? <Switch label="Active" checked={v.active} onChange={(x) => setV({ ...v, active: x })} /> : null}
      </div>
    </Drawer>
  );
}

function SupplierForm({ open, onOpenChange, item }: { open: boolean; onOpenChange: (v: boolean) => void; item?: Supplier }) {
  const blank = { name: '', phone: '', address: '', gstin: '', state: 'Tamil Nadu', openingBalance: 0, active: true };
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (open) setV(item ? { ...blank, ...item, gstin: item.gstin ?? '' } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const save = useAction(() => (item ? api.patch<Supplier>(`/suppliers/${item.id}`, v) : api.post<Supplier>('/suppliers', v)), { success: (s) => (item ? `Updated ${s.name}` : `Added supplier ${s.name}`), onDone: () => onOpenChange(false) });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={item ? `Edit ${item.name}` : 'Add supplier'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            {item ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Name" htmlFor="s-name" error={f.name}>
            <Input id="s-name" value={v.name} invalid={!!f.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Field>
          <Field label="Phone" htmlFor="s-phone" error={f.phone}>
            <Input id="s-phone" value={v.phone} invalid={!!f.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
          </Field>
          <Field label="State" htmlFor="s-state">
            <Select id="s-state" value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })}>
              {STATES.map(([s]) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="GSTIN" htmlFor="s-gstin" error={f.gstin} helper="Optional">
            <Input id="s-gstin" value={v.gstin} maxLength={15} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} />
          </Field>
        </FormGrid>
        <Field label="Address" htmlFor="s-addr" error={f.address}>
          <Textarea id="s-addr" value={v.address} invalid={!!f.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </Field>
        {item ? <Switch label="Active" checked={v.active} onChange={(x) => setV({ ...v, active: x })} /> : null}
      </div>
    </Drawer>
  );
}

function NamedList({ path, title, help }: { path: string; title: string; help: string }) {
  const q = useNamed(path);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<Named | null>(null);
  const add = useAction(() => (editing ? api.patch<Named>(`/${path}/${editing.id}`, { name }) : api.post<Named>(`/${path}`, { name })), {
    success: (n) => (editing ? `Renamed to ${n.name}` : `Added ${n.name}`),
    onDone: () => (setName(''), setEditing(null)),
  });
  return (
    <Section title={title}>
      <p className="mb-3 text-sm text-slate">{help}</p>
      <ul className="mb-3 divide-y divide-hairline border-y border-hairline text-sm">
        {q.data?.items.map((n) => (
          <li key={n.id} className="flex items-center justify-between py-2">
            <span>{n.name}</span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setEditing(n);
                setName(n.name);
              }}
            >
              Rename
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input aria-label={`${editing ? 'Rename' : 'New'} ${title.toLowerCase()}`} value={name} placeholder={editing ? `Rename ${editing.name}` : 'Name'} invalid={!!add.fields.name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button loading={add.busy} onClick={() => void add.run()}>
          {editing ? 'Save name' : 'Add'}
        </Button>
        {editing ? (
          <Button variant="quiet" onClick={() => (setEditing(null), setName(''))}>
            Cancel
          </Button>
        ) : null}
      </div>
      {add.fields.name ? <p className="mt-1 text-meta text-danger">{add.fields.name}</p> : null}
    </Section>
  );
}

function BankForm({ open, onOpenChange, item }: { open: boolean; onOpenChange: (v: boolean) => void; item?: BankAccount }) {
  const blank = { bankName: '', accountName: '', accountNo: '', ifsc: '', upiId: '', isInvoiceDefault: false, openingBalance: 0 };
  const [v, setV] = useState(blank);
  useEffect(() => {
    if (open) setV(item ? { ...blank, ...item } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);
  const save = useAction(() => (item ? api.patch(`/bank-accounts/${item.id}`, v) : api.post('/bank-accounts', v)), { success: item ? 'Updated bank account' : 'Added bank account', onDone: () => onOpenChange(false) });
  const f = save.fields;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={item ? 'Edit bank account' : 'Add bank account'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
            {item ? 'Save changes' : 'Add bank account'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Bank" htmlFor="b-bank" error={f.bankName}>
            <Input id="b-bank" value={v.bankName} onChange={(e) => setV({ ...v, bankName: e.target.value })} />
          </Field>
          <Field label="Account name" htmlFor="b-name" error={f.accountName}>
            <Input id="b-name" value={v.accountName} onChange={(e) => setV({ ...v, accountName: e.target.value })} />
          </Field>
          <Field label="Account number" htmlFor="b-no" error={f.accountNo}>
            <Input id="b-no" inputMode="numeric" value={v.accountNo} onChange={(e) => setV({ ...v, accountNo: e.target.value })} />
          </Field>
          <Field label="IFSC" htmlFor="b-ifsc" error={f.ifsc}>
            <Input id="b-ifsc" value={v.ifsc} onChange={(e) => setV({ ...v, ifsc: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="UPI ID" htmlFor="b-upi" error={f.upiId} helper="Used in the invoice QR code">
            <Input id="b-upi" value={v.upiId} onChange={(e) => setV({ ...v, upiId: e.target.value })} />
          </Field>
          <Field label="Opening balance" htmlFor="b-ob">
            <MoneyInput id="b-ob" allowNegative value={v.openingBalance} onChange={(x) => setV({ ...v, openingBalance: x ?? 0 })} />
          </Field>
        </FormGrid>
        <Switch label="Print on invoices (default account)" checked={v.isInvoiceDefault} onChange={(x) => setV({ ...v, isInvoiceDefault: x })} />
      </div>
    </Drawer>
  );
}

function OpeningBalances() {
  const q = useQuery({ queryKey: ['opening-balances'], queryFn: () => api.get<{ cash: number; customers: { id: string; name: string; amount: number }[]; suppliers: { id: string; name: string; amount: number }[]; banks: { id: string; name: string; amount: number }[] }>('/opening-balances') });
  const [v, setV] = useState<typeof q.data | null>(null);
  useEffect(() => {
    if (q.data) setV(structuredClone(q.data));
  }, [q.data]);
  const save = useAction(() => api.put('/opening-balances', { cash: v?.cash ?? 0, customers: v?.customers.map(({ id, amount }) => ({ id, amount })) ?? [], suppliers: v?.suppliers.map(({ id, amount }) => ({ id, amount })) ?? [], banks: v?.banks.map(({ id, amount }) => ({ id, amount })) ?? [] }), { success: 'Saved opening balances' });
  if (!v) return <Section>Loading</Section>;
  const group = (title: string, k: 'customers' | 'suppliers' | 'banks') => (
    <Section title={title}>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {v[k].map((x, i) => (
          <li key={x.id} className="grid grid-cols-[1fr_180px] items-center gap-3 text-sm">
            <span>{x.name}</span>
            <MoneyInput
              allowNegative
              value={x.amount}
              onChange={(amt) =>
                setV((cur) => {
                  if (!cur) return cur;
                  const next = structuredClone(cur);
                  (next[k][i] as { amount: number }).amount = amt ?? 0;
                  return next;
                })
              }
            />
          </li>
        ))}
      </ul>
    </Section>
  );
  return (
    <>
      <Section title="Cash in hand">
        <div className="max-w-xs">
          <MoneyInput allowNegative value={v.cash} onChange={(amt) => setV({ ...v, cash: amt ?? 0 })} />
        </div>
      </Section>
      {group('Bank accounts', 'banks')}
      {group('Customers (amount they owed)', 'customers')}
      {group('Suppliers (amount you owed)', 'suppliers')}
      <div className="px-6 py-4">
        <Button variant="primary" loading={save.busy} onClick={() => void save.run()}>
          Save opening balances
        </Button>
      </div>
    </>
  );
}

export function Masters() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('products');
  const [form, setForm] = useState<{ kind: Tab; item?: unknown } | null>(null);
  const products = useQuery({ queryKey: ['products'], queryFn: () => api.get<{ items: (Product & { stock: number })[] }>('/products'), enabled: tab === 'products' });
  const items = useQuery({ queryKey: ['purchase-items'], queryFn: () => api.get<{ items: (RawMaterial & { stock: number })[] }>('/purchase-items'), enabled: tab === 'purchase' });
  const sups = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ items: Supplier[] }>('/suppliers'), enabled: tab === 'suppliers' });
  const banks = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<{ items: BankAccount[] }>('/bank-accounts'), enabled: tab === 'banks' });
  const units = useNamed('units');
  const cats = useNamed('product-categories');
  const name = (list: Named[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? '';
  const addLabel: Partial<Record<Tab, string>> = { products: 'Add product', purchase: 'Add purchase item', suppliers: 'Add supplier', banks: 'Add bank account' };
  return (
    <div>
      <PageHeader
        title="Masters"
        description="Only Admin creates and edits these lists. Workers pick from them on bills, indents and batches."
        actions={
          <>
            <Button onClick={() => navigate('/masters/import')}>Import from Excel</Button>
            {addLabel[tab] ? (
              <Button variant="primary" icon={<Plus className="h-4 w-4" strokeWidth={1.5} />} onClick={() => setForm({ kind: tab })}>
                {addLabel[tab]}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Master lists"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'products', label: 'Sales Inventory' },
            { value: 'purchase', label: 'Purchase List' },
            { value: 'suppliers', label: 'Suppliers' },
            { value: 'lists', label: 'Units, categories, expense heads' },
            { value: 'banks', label: 'Bank accounts' },
            { value: 'opening', label: 'Opening balances' },
          ]}
        />
      </div>
      {tab === 'products' ? (
        <DataTable
          caption="Sales Inventory"
          rows={products.data?.items}
          loading={products.isLoading}
          error={products.error}
          rowId={(r) => r.id}
          onRowClick={(r) => setForm({ kind: 'products', item: r })}
          empty={{ title: 'No products', body: 'Add the finished products you sell, with retail and distributor prices.' }}
          columns={[
            { id: 'c', header: 'Code', cell: (r) => <span className="font-medium">{r.code}</span>, sortValue: (r) => r.code, hideable: false },
            { id: 'n', header: 'Name', cell: (r) => r.name, sortValue: (r) => r.name },
            { id: 'cat', header: 'Category', cell: (r) => name(cats.data?.items, r.categoryId) },
            { id: 'u', header: 'Unit', cell: (r) => name(units.data?.items, r.unitId) },
            { id: 'h', header: 'HSN', cell: (r) => r.hsn ?? '', defaultHidden: true },
            { id: 'g', header: 'GST', align: 'right', cell: (r) => `${r.gstRate}%` },
            { id: 'rp', header: 'Retail', align: 'right', cell: (r) => <Money value={r.retailPrice} /> },
            { id: 'dp', header: 'Distributor', align: 'right', cell: (r) => <Money value={r.distributorPrice} /> },
            { id: 's', header: 'Stock', align: 'right', cell: (r) => formatQty(r.stock), sortValue: (r) => r.stock },
            { id: 'a', header: 'Status', cell: (r) => (r.active ? <StatusText status="A" label="Active" tone="success" /> : <StatusText status="I" label="Inactive" />) },
          ]}
        />
      ) : tab === 'purchase' ? (
        <DataTable
          caption="Purchase List"
          rows={items.data?.items}
          loading={items.isLoading}
          error={items.error}
          rowId={(r) => r.id}
          onRowClick={(r) => setForm({ kind: 'purchase', item: r })}
          empty={{ title: 'No purchase items', body: 'Add raw materials, packaging and consumables you buy.' }}
          columns={[
            { id: 'n', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span>, sortValue: (r) => r.name, hideable: false },
            { id: 'cat', header: 'Category', cell: (r) => CAT[r.category] },
            { id: 'u', header: 'Unit', cell: (r) => name(units.data?.items, r.unitId) },
            { id: 'r', header: 'Last rate', align: 'right', cell: (r) => formatINR(r.lastRate) },
            { id: 'ro', header: 'Reorder level', align: 'right', cell: (r) => formatQty(r.reorderLevel) },
            { id: 's', header: 'Stock', align: 'right', cell: (r) => formatQty(r.stock) },
          ]}
        />
      ) : tab === 'suppliers' ? (
        <DataTable
          caption="Suppliers"
          rows={sups.data?.items}
          loading={sups.isLoading}
          error={sups.error}
          rowId={(r) => r.id}
          onRowClick={(r) => setForm({ kind: 'suppliers', item: r })}
          empty={{ title: 'No suppliers', body: 'Add the suppliers you buy from.' }}
          columns={[
            { id: 'n', header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
            { id: 'p', header: 'Phone', cell: (r) => r.phone },
            { id: 's', header: 'State', cell: (r) => r.state },
            { id: 'g', header: 'GSTIN', cell: (r) => r.gstin ?? <span className="text-slate">Unregistered</span> },
          ]}
        />
      ) : tab === 'lists' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3">
          <NamedList path="units" title="Units" help="Units used for products and purchase items." />
          <NamedList path="product-categories" title="Categories" help="Product categories for reports." />
          <NamedList path="expense-heads" title="Expense heads" help="Heads for other expenses." />
        </div>
      ) : tab === 'banks' ? (
        <DataTable
          caption="Bank accounts"
          rows={banks.data?.items}
          loading={banks.isLoading}
          error={banks.error}
          rowId={(r) => r.id}
          onRowClick={(r) => setForm({ kind: 'banks', item: r })}
          empty={{ title: 'No bank accounts', body: 'The default account prints on invoices with a UPI QR code.' }}
          columns={[
            { id: 'b', header: 'Bank', cell: (r) => <span className="font-medium">{r.bankName}</span> },
            { id: 'a', header: 'Account', cell: (r) => `${r.accountName}, ${r.accountNo}` },
            { id: 'i', header: 'IFSC', cell: (r) => r.ifsc },
            { id: 'u', header: 'UPI ID', cell: (r) => r.upiId },
            { id: 'd', header: 'On invoices', cell: (r) => (r.isInvoiceDefault ? 'Default' : '') },
          ]}
        />
      ) : (
        <OpeningBalances />
      )}
      <ProductForm open={form?.kind === 'products'} onOpenChange={(o) => !o && setForm(null)} item={form?.kind === 'products' ? (form.item as Product | undefined) : undefined} />
      <PurchaseItemForm open={form?.kind === 'purchase'} onOpenChange={(o) => !o && setForm(null)} item={form?.kind === 'purchase' ? (form.item as RawMaterial | undefined) : undefined} />
      <SupplierForm open={form?.kind === 'suppliers'} onOpenChange={(o) => !o && setForm(null)} item={form?.kind === 'suppliers' ? (form.item as Supplier | undefined) : undefined} />
      <BankForm open={form?.kind === 'banks'} onOpenChange={(o) => !o && setForm(null)} item={form?.kind === 'banks' ? (form.item as BankAccount | undefined) : undefined} />
    </div>
  );
}
