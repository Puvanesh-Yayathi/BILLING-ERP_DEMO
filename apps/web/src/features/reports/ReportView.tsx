import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatINR, formatQty } from '@app/contract';
import { api } from '../../api/client';
import { exportExcel } from '../../lib/excel';
import { openTablePrint, type PrintColType } from '../../print/table';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, SkeletonRows } from '../../ui/feedback';
import { PageHeader, Section, Toolbar } from '../../ui/layout';
import { DateRange, formatDate, monthStartOf, today } from '../common';

type Cell = string | number | null;
interface Report {
  key: string;
  title: string;
  from: string;
  to: string;
  sections: { title: string; columns: { key: string; label: string; type: PrintColType }[]; rows: Record<string, Cell>[]; totals?: Record<string, Cell> }[];
}

function fyStart() {
  const t = today();
  const y = Number(t.slice(0, 4));
  return `${t.slice(5, 7) >= '04' ? y : y - 1}-04-01`;
}

function show(v: Cell, type: PrintColType) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && type !== 'date') return v;
  if (type === 'money') return <span className={Number(v) < 0 ? 'text-danger' : ''}>{formatINR(Number(v))}</span>;
  if (type === 'qty') return formatQty(Number(v));
  if (type === 'pct') return `${v}%`;
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? formatDate(String(v)) : String(v);
  return String(v);
}

export function ReportView() {
  const { key = '' } = useParams();
  const navigate = useNavigate();
  const [from, setFrom] = useState(key === 'profit' ? fyStart() : monthStartOf());
  const [to, setTo] = useState(today());
  const q = useQuery({ queryKey: ['report', key, from, to], queryFn: () => api.get<Report>(`/reports/${key}`, { from, to }), placeholderData: keepPreviousData });
  const r = q.data;
  return (
    <div>
      <PageHeader
        title={r?.title ?? 'Report'}
        description={`${formatDate(from)} to ${formatDate(to)}`}
        actions={
          <>
            <Button
              disabled={!r}
              onClick={() =>
                r &&
                void exportExcel(
                  `${r.key}-${from}-${to}`,
                  r.sections.map((s) => ({ name: s.title, columns: s.columns.map((c) => ({ header: c.label, key: c.key, type: c.type })), rows: s.rows, totals: s.totals })),
                  r.title,
                )
              }
            >
              Export to Excel
            </Button>
            <Button disabled={!r} onClick={() => r && openTablePrint(navigate, { title: r.title, subtitle: `${formatDate(from)} to ${formatDate(to)}`, sections: r.sections })}>
              Download PDF
            </Button>
          </>
        }
      />
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} />
      </Toolbar>
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        r?.sections.map((s) => (
          <Section key={s.title} title={s.title} flush>
            <DataTable
              caption={s.title}
              rows={s.rows.map((row, i) => ({ ...row, __i: i }))}
              rowId={(row) => String(row.__i)}
              empty={{ title: 'Nothing in this period', body: 'Choose a wider date range.' }}
              columns={s.columns.map((c, i) => ({
                id: c.key,
                header: c.label,
                align: c.type === 'text' || c.type === 'date' ? 'left' : 'right',
                cell: (row: Record<string, Cell>) => show(row[c.key] ?? null, c.type),
                sortValue: (row: Record<string, Cell>) => row[c.key] ?? '',
                hideable: i > 0,
                total: s.totals ? <span>{show(s.totals[c.key] ?? null, c.type)}</span> : undefined,
              }))}
            />
          </Section>
        ))
      )}
    </div>
  );
}
