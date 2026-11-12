import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { Money, Toolbar } from '../../ui/layout';
import { DateRange, daysAgo, formatDate, today } from '../common';

export interface LedgerData {
  title: string;
  opening: number;
  rows: { date: string; at: string; ref: string; refType: string; refId: string; particulars: string; debit: number; credit: number; balance: number }[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
  nature: 'DEBIT' | 'CREDIT';
}

const LINK: Record<string, (id: string) => string> = {
  invoice: (id) => `/bills/${id}`,
  payment: (id) => `/payments/${id}/print`,
  'purchase-bill': (id) => `/purchase-bills/${id}/print`,
  'supplier-payment': (id) => `/supplier-payments/${id}/print`,
  payslip: (id) => `/payslips/${id}/print`,
};

/** Opening balance, dated debit and credit rows, running balance, date filters and export. */
export function LedgerView({ type, id, defaultFrom }: { type: string; id: string; defaultFrom?: string }) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(defaultFrom ?? daysAgo(89));
  const [to, setTo] = useState(today());
  const q = useQuery({ queryKey: ['ledger', type, id, from, to], queryFn: () => api.get<LedgerData>(`/ledgers/${type}/${id}`, { from, to }), enabled: !!id });
  const l = q.data;
  const rows = l ? [{ date: from, at: '', ref: '', refType: 'opening', refId: 'opening', particulars: 'Opening balance', debit: 0, credit: 0, balance: l.opening }, ...l.rows] : undefined;
  return (
    <div>
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
        <Button
          size="sm"
          disabled={!l}
          onClick={() =>
            l &&
            void exportExcel(`ledger-${l.title}`, [
              {
                name: l.title,
                columns: [
                  { header: 'Date', key: 'date', type: 'date' },
                  { header: 'Reference', key: 'ref' },
                  { header: 'Particulars', key: 'particulars', width: 40 },
                  { header: 'Debit', key: 'debit', type: 'money' },
                  { header: 'Credit', key: 'credit', type: 'money' },
                  { header: 'Balance', key: 'balance', type: 'money' },
                ],
                rows: rows ?? [],
                totals: { particulars: 'Closing balance', debit: l.totalDebit, credit: l.totalCredit, balance: l.closing },
              },
            ])
          }
        >
          Export to Excel
        </Button>
      </Toolbar>
      <DataTable
        caption={l ? `Ledger of ${l.title}` : 'Ledger'}
        rows={rows}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        rowId={(r) => `${r.refType}-${r.refId}-${r.at}-${r.particulars}`}
        onRowClick={(r) => {
          const f = LINK[r.refType];
          if (f) navigate(f(r.refId));
        }}
        empty={{ title: 'No entries', body: 'Choose a wider date range.' }}
        columns={[
          { id: 'date', header: 'Date', cell: (r) => formatDate(r.date), width: 110 },
          { id: 'ref', header: 'Reference', cell: (r) => r.ref },
          { id: 'p', header: 'Particulars', cell: (r) => (r.refType === 'opening' ? <span className="font-medium">{r.particulars}</span> : r.particulars), hideable: false },
          { id: 'dr', header: 'Debit', align: 'right', cell: (r) => (r.debit ? <Money value={r.debit} /> : ''), total: <Money value={l?.totalDebit} /> },
          { id: 'cr', header: 'Credit', align: 'right', cell: (r) => (r.credit ? <Money value={r.credit} /> : ''), total: <Money value={l?.totalCredit} /> },
          { id: 'bal', header: 'Balance', align: 'right', cell: (r) => <Money value={r.balance} strong={r.refType === 'opening'} />, total: <Money value={l?.closing} strong /> },
        ]}
      />
    </div>
  );
}
