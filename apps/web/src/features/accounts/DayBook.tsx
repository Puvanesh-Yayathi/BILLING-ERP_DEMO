import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { FigureBand, Money, PageHeader, Toolbar } from '../../ui/layout';
import { Tabs } from '../../ui/overlay';
import { DateRange, daysAgo, formatDate, today } from '../common';

interface DayRow {
  date: string;
  at: string;
  kind: string;
  ref: string;
  refType: string;
  refId: string;
  particulars: string;
  debit: number;
  credit: number;
}
interface Flow {
  cashOpening: number;
  bankOpening: number;
  cashClosing: number;
  bankClosing: number;
  days: { date: string; cashIn: number; cashOut: number; cashClosing: number; bankIn: number; bankOut: number; bankClosing: number }[];
}

export function DayBook() {
  const [tab, setTab] = useState<'day' | 'flow'>('day');
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(today());
  const day = useQuery({ queryKey: ['daybook', from, to], queryFn: () => api.get<{ items: DayRow[]; totalDebit: number; totalCredit: number }>('/daybook', { from, to }), enabled: tab === 'day' });
  const flow = useQuery({ queryKey: ['cashflow', from, to], queryFn: () => api.get<Flow>('/cashflow', { from, to }), enabled: tab === 'flow' });
  return (
    <div>
      <PageHeader title="Day book and cash flow" description="Every transaction in date order, and cash and bank movement with closing balances." />
      <div className="border-b border-hairline px-6 pt-3">
        <Tabs
          label="Book"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'day', label: 'Day book' },
            { value: 'flow', label: 'Cash flow book' },
          ]}
        />
      </div>
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <Button
          size="sm"
          onClick={() =>
            tab === 'day'
              ? void exportExcel(`day-book-${from}-${to}`, [{ name: 'Day book', columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Type', key: 'kind' }, { header: 'Reference', key: 'ref' }, { header: 'Particulars', key: 'particulars', width: 44 }, { header: 'Debit', key: 'debit', type: 'money' }, { header: 'Credit', key: 'credit', type: 'money' }], rows: day.data?.items ?? [] }])
              : void exportExcel(`cash-flow-${from}-${to}`, [{ name: 'Cash flow', columns: [{ header: 'Date', key: 'date', type: 'date' }, { header: 'Cash in', key: 'cashIn', type: 'money' }, { header: 'Cash out', key: 'cashOut', type: 'money' }, { header: 'Cash closing', key: 'cashClosing', type: 'money' }, { header: 'Bank in', key: 'bankIn', type: 'money' }, { header: 'Bank out', key: 'bankOut', type: 'money' }, { header: 'Bank closing', key: 'bankClosing', type: 'money' }], rows: flow.data?.days ?? [] }])
          }
        >
          Export to Excel
        </Button>
      </Toolbar>
      {tab === 'day' ? (
        <DataTable
          caption="Day book"
          rows={day.data?.items}
          loading={day.isLoading}
          error={day.error}
          onRetry={() => void day.refetch()}
          rowId={(r) => `${r.refType}-${r.refId}-${r.kind}`}
          empty={{ title: 'No transactions in this period', body: 'Sales, purchases, receipts, payments and expenses for the chosen dates appear here.' }}
          columns={[
            { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), width: 110 },
            { id: 'k', header: 'Type', cell: (r) => r.kind },
            { id: 'r', header: 'Reference', cell: (r) => r.ref },
            { id: 'p', header: 'Particulars', cell: (r) => r.particulars, hideable: false },
            { id: 'dr', header: 'Debit', align: 'right', cell: (r) => (r.debit ? <Money value={r.debit} /> : ''), total: <Money value={day.data?.totalDebit} /> },
            { id: 'cr', header: 'Credit', align: 'right', cell: (r) => (r.credit ? <Money value={r.credit} /> : ''), total: <Money value={day.data?.totalCredit} /> },
          ]}
        />
      ) : (
        <>
          <FigureBand
            items={[
              { label: 'Cash opening', value: <Money value={flow.data?.cashOpening} compact /> },
              { label: 'Cash closing', value: <Money value={flow.data?.cashClosing} compact /> },
              { label: 'Bank opening', value: <Money value={flow.data?.bankOpening} compact /> },
              { label: 'Bank closing', value: <Money value={flow.data?.bankClosing} compact /> },
            ]}
          />
          <DataTable
            caption="Cash flow book"
            rows={flow.data?.days}
            loading={flow.isLoading}
            error={flow.error}
            onRetry={() => void flow.refetch()}
            rowId={(r) => r.date}
            empty={{ title: 'No cash or bank movement', body: 'Choose a wider date range.' }}
            columns={[
              { id: 'd', header: 'Date', cell: (r) => formatDate(r.date), hideable: false },
              { id: 'ci', header: 'Cash in', align: 'right', cell: (r) => <Money value={r.cashIn} /> },
              { id: 'co', header: 'Cash out', align: 'right', cell: (r) => <Money value={r.cashOut} /> },
              { id: 'cc', header: 'Cash closing', align: 'right', cell: (r) => <Money value={r.cashClosing} strong /> },
              { id: 'bi', header: 'Bank in', align: 'right', cell: (r) => <Money value={r.bankIn} /> },
              { id: 'bo', header: 'Bank out', align: 'right', cell: (r) => <Money value={r.bankOut} /> },
              { id: 'bc', header: 'Bank closing', align: 'right', cell: (r) => <Money value={r.bankClosing} strong /> },
            ]}
          />
        </>
      )}
    </div>
  );
}
