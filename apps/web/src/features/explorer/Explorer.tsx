import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { useSession } from '../../lib/session';
import { openTablePrint } from '../../print/table';
import { Button } from '../../ui/Button';
import { RankedBars } from '../../ui/charts';
import { DataTable } from '../../ui/DataTable';
import { Select } from '../../ui/form';
import { FigureBand, Money, PageHeader, Section, Toolbar } from '../../ui/layout';
import { Segmented, Tabs } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { DateRange, SearchBox, TYPE_LABEL, daysAgo, formatDate, today, useDebounced } from '../common';

interface SaleRow {
  id: string;
  number: string;
  date: string;
  type: string;
  status: string;
  customer: string;
  createdById: string;
  createdBy: string;
  taxable: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
}
interface PurchaseRow {
  id: string;
  number: string;
  supplierBillNo: string;
  date: string;
  indentId: string;
  indentNumber: string;
  supplier: string;
  createdById: string;
  createdBy: string;
  items: number;
  total: number;
  variance: number;
}
interface Group {
  workerId: string;
  worker: string;
  count: number;
  total: number;
}

/** All sales and purchase bills in one place, overall or worker-wise. Workers see only their own. */
export function Explorer() {
  const navigate = useNavigate();
  const { role } = useSession();
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<'sales' | 'purchases'>('sales');
  const [group, setGroup] = useState<'none' | 'worker'>((sp.get('group') as 'worker') ?? 'none');
  const [from, setFrom] = useState(sp.get('from') ?? daysAgo(29));
  const [to, setTo] = useState(sp.get('to') ?? today());
  const [worker, setWorker] = useState(sp.get('worker') ?? '');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const own = role === 'STAFF' || role === 'OPERATING';
  const canPurchases = role !== 'STAFF';
  const params = { from, to, createdById: worker, type, status, q: dq, groupBy: group, limit: 500 };
  const sales = useQuery({ queryKey: ['explorer-sales', params], queryFn: () => api.get<{ items: SaleRow[]; totals: { count: number; taxable: number; tax: number; total: number; balance: number }; groups: Group[]; workers: { id: string; name: string }[] }>('/explorer/sales', params), enabled: tab === 'sales', placeholderData: keepPreviousData });
  const purchases = useQuery({ queryKey: ['explorer-purchases', params], queryFn: () => api.get<{ items: PurchaseRow[]; totals: { count: number; total: number }; groups: Group[] }>('/explorer/purchases', params), enabled: tab === 'purchases', placeholderData: keepPreviousData });
  const workers = sales.data?.workers ?? [];
  const groups = tab === 'sales' ? sales.data?.groups : purchases.data?.groups;
  const exportIt = () => {
    if (tab === 'sales' && sales.data)
      void exportExcel(`sales-bills-${from}-${to}`, [
        {
          name: 'Sales bills',
          columns: [
            { header: 'Bill', key: 'number' },
            { header: 'Date', key: 'date', type: 'date' },
            { header: 'Customer', key: 'customer' },
            { header: 'Type', key: 'type' },
            { header: 'Created by', key: 'createdBy' },
            { header: 'Status', key: 'status' },
            { header: 'Taxable', key: 'taxable', type: 'money' },
            { header: 'GST', key: 'tax', type: 'money' },
            { header: 'Total', key: 'total', type: 'money' },
            { header: 'Balance', key: 'balance', type: 'money' },
          ],
          rows: sales.data.items,
          totals: { number: 'Total', taxable: sales.data.totals.taxable, tax: sales.data.totals.tax, total: sales.data.totals.total, balance: sales.data.totals.balance },
        },
        ...(group === 'worker' ? [{ name: 'By worker', columns: [{ header: 'Worker', key: 'worker' }, { header: 'Bills', key: 'count', type: 'number' as const }, { header: 'Total', key: 'total', type: 'money' as const }], rows: sales.data.groups }] : []),
      ]);
    if (tab === 'purchases' && purchases.data)
      void exportExcel(`purchase-bills-${from}-${to}`, [
        {
          name: 'Purchase bills',
          columns: [
            { header: 'GRN', key: 'number' },
            { header: 'Supplier bill', key: 'supplierBillNo' },
            { header: 'Date', key: 'date', type: 'date' },
            { header: 'Supplier', key: 'supplier' },
            { header: 'Indent', key: 'indentNumber' },
            { header: 'Entered by', key: 'createdBy' },
            { header: 'Amount', key: 'total', type: 'money' },
          ],
          rows: purchases.data.items,
          totals: { number: 'Total', total: purchases.data.totals.total },
        },
      ]);
  };
  const printIt = () => {
    if (tab === 'sales' && sales.data)
      openTablePrint(navigate, {
        title: 'Sales bills',
        subtitle: `${formatDate(from)} to ${formatDate(to)}`,
        sections: [
          ...(group === 'worker' ? [{ title: 'By worker', columns: [{ key: 'worker', label: 'Worker', type: 'text' as const }, { key: 'count', label: 'Bills', type: 'number' as const }, { key: 'total', label: 'Total', type: 'money' as const }], rows: sales.data.groups.map((g) => ({ ...g })) }] : []),
          {
            title: 'Bills',
            columns: [
              { key: 'number', label: 'Bill', type: 'text' },
              { key: 'date', label: 'Date', type: 'date' },
              { key: 'customer', label: 'Customer', type: 'text' },
              { key: 'createdBy', label: 'By', type: 'text' },
              { key: 'taxable', label: 'Taxable', type: 'money' },
              { key: 'total', label: 'Total', type: 'money' },
              { key: 'balance', label: 'Balance', type: 'money' },
            ],
            rows: sales.data.items.map((r) => ({ ...r })),
            totals: { number: 'Total', taxable: sales.data.totals.taxable, total: sales.data.totals.total, balance: sales.data.totals.balance },
          },
        ],
      });
    if (tab === 'purchases' && purchases.data)
      openTablePrint(navigate, {
        title: 'Purchase bills',
        subtitle: `${formatDate(from)} to ${formatDate(to)}`,
        sections: [{ title: 'Bills', columns: [{ key: 'number', label: 'GRN', type: 'text' }, { key: 'supplierBillNo', label: 'Supplier bill', type: 'text' }, { key: 'date', label: 'Date', type: 'date' }, { key: 'supplier', label: 'Supplier', type: 'text' }, { key: 'total', label: 'Amount', type: 'money' }], rows: purchases.data.items.map((r) => ({ ...r })), totals: { number: 'Total', total: purchases.data.totals.total } }],
      });
  };
  return (
    <div>
      <PageHeader
        title="Bills explorer"
        description={own ? 'Bills you created.' : 'Every sales and purchase bill. Switch to worker-wise to see who created what.'}
        actions={
          <>
            <Button onClick={exportIt}>Export to Excel</Button>
            <Button onClick={printIt}>Download PDF</Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline px-6 pt-3">
        <Tabs
          label="Bills"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'sales', label: 'Sales bills' },
            ...(canPurchases ? [{ value: 'purchases' as const, label: 'Purchase bills' }] : []),
          ]}
        />
        {!own ? (
          <div className="pb-2">
            <Segmented
              label="View"
              value={group}
              onChange={setGroup}
              items={[
                { value: 'none', label: 'Overall' },
                { value: 'worker', label: 'Worker-wise' },
              ]}
            />
          </div>
        ) : null}
      </div>
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        {!own && workers.length ? (
          <label className="flex flex-col gap-1">
            <span className="text-meta text-slate">Worker</span>
            <Select value={worker} onChange={(e) => setWorker(e.target.value)} className="w-[170px]">
              <option value="">Everyone</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        {tab === 'sales' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-slate">Type</span>
              <Select value={type} onChange={(e) => setType(e.target.value)} className="w-[140px]">
                <option value="">All</option>
                <option value="CASH">Cash</option>
                <option value="CREDIT">Credit</option>
                <option value="DISTRIBUTOR">Distributor</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-slate">Status</span>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-[140px]">
                <option value="">All</option>
                <option value="SENT">Unpaid</option>
                <option value="OVERDUE">Overdue</option>
                <option value="PAID">Paid</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </label>
          </>
        ) : null}
        <SearchBox value={q} onChange={setQ} placeholder={tab === 'sales' ? 'Bill, customer or worker' : 'GRN, bill or supplier'} />
      </Toolbar>
      {tab === 'sales' ? (
        <FigureBand
          items={[
            { label: 'Bills', value: sales.data?.totals.count ?? '—' },
            { label: 'Taxable value', value: <Money value={sales.data?.totals.taxable} compact /> },
            { label: 'GST', value: <Money value={sales.data?.totals.tax} compact /> },
            { label: 'Bill value', value: <Money value={sales.data?.totals.total} compact /> },
            { label: 'Unpaid', value: <Money value={sales.data?.totals.balance} compact /> },
          ]}
        />
      ) : (
        <FigureBand
          items={[
            { label: 'Purchase bills', value: purchases.data?.totals.count ?? '—' },
            { label: 'Value', value: <Money value={purchases.data?.totals.total} compact /> },
          ]}
        />
      )}
      {group === 'worker' && groups ? (
        <Section title="By worker">
          <div className="max-w-2xl">
            <RankedBars items={groups.map((g) => ({ key: g.workerId, label: g.worker, value: g.total, sub: `${g.count} ${g.count === 1 ? 'bill' : 'bills'}` }))} onClick={(id) => setWorker((w) => (w === id ? '' : id))} />
            {worker ? <p className="mt-3 text-sm text-slate">Showing the bills of one worker. Click the bar again to show everyone.</p> : null}
          </div>
        </Section>
      ) : null}
      {tab === 'sales' ? (
        <DataTable
          caption="Sales bills"
          rows={sales.data?.items}
          loading={sales.isLoading}
          error={sales.error}
          onRetry={() => void sales.refetch()}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/bills/${r.id}`)}
          rowTone={(r) => (r.status === 'OVERDUE' ? 'danger' : undefined)}
          empty={{ title: 'No bills match', body: 'Change the dates or clear the filters. New bills appear here as soon as they are finalized.' }}
          columns={[
            { id: 'n', header: 'Bill', cell: (r) => <span className="font-medium">{r.number}</span>, sortValue: (r) => r.number, hideable: false },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
            { id: 'c', header: 'Customer', cell: (r) => r.customer, sortValue: (r) => r.customer },
            { id: 't', header: 'Type', cell: (r) => TYPE_LABEL[r.type] },
            { id: 'w', header: 'Created by', cell: (r) => r.createdBy, sortValue: (r) => r.createdBy, defaultHidden: own },
            { id: 's', header: 'Status', cell: (r) => <StatusText status={r.status} /> },
            { id: 'tx', header: 'Taxable', align: 'right', cell: (r) => <Money value={r.taxable} />, defaultHidden: true },
            { id: 'tot', header: 'Total', align: 'right', cell: (r) => <Money value={r.total} />, sortValue: (r) => r.total, total: <Money value={sales.data?.totals.total} /> },
            { id: 'b', header: 'Balance', align: 'right', cell: (r) => (r.balance ? <Money value={r.balance} /> : <span className="text-slate">Nil</span>), sortValue: (r) => r.balance, total: <Money value={sales.data?.totals.balance} /> },
          ]}
        />
      ) : (
        <DataTable
          caption="Purchase bills"
          rows={purchases.data?.items}
          loading={purchases.isLoading}
          error={purchases.error}
          onRetry={() => void purchases.refetch()}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/indents/${r.indentId}`)}
          empty={{ title: 'No purchase bills match', body: 'Change the dates or clear the filters.' }}
          columns={[
            { id: 'n', header: 'GRN', cell: (r) => <span className="font-medium">{r.number}</span>, hideable: false },
            { id: 'b', header: 'Supplier bill', cell: (r) => r.supplierBillNo },
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), sortValue: (r) => r.date },
            { id: 's', header: 'Supplier', cell: (r) => r.supplier, sortValue: (r) => r.supplier },
            { id: 'i', header: 'Indent', cell: (r) => r.indentNumber },
            { id: 'w', header: 'Entered by', cell: (r) => r.createdBy },
            { id: 'v', header: 'Rate variance', align: 'right', cell: (r) => (r.variance ? <Money value={r.variance} className={r.variance > 0 ? 'text-danger' : 'text-success'} /> : ''), defaultHidden: true },
            { id: 't', header: 'Amount', align: 'right', cell: (r) => <Money value={r.total} />, sortValue: (r) => r.total, total: <Money value={purchases.data?.totals.total} /> },
          ]}
        />
      )}
    </div>
  );
}
