import { useNavigate, type NavigateFunction } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatINR, formatQty, type CompanyProfile } from '@app/contract';
import { api } from '../api/client';
import { Button } from '../ui/Button';
import { EmptyState, Skeleton } from '../ui/feedback';
import { DOC_CSS, PagedDocument, type DocColumn } from './engine';
import { CompactHeader, DocHeader, d } from './parts';

export type PrintColType = 'text' | 'money' | 'qty' | 'date' | 'number' | 'pct';
export interface PrintSection {
  title: string;
  columns: { key: string; label: string; type: PrintColType }[];
  rows: Record<string, string | number | null | undefined>[];
  totals?: Record<string, string | number | null | undefined>;
}
export interface TablePrintPayload {
  title: string;
  subtitle: string;
  sections: PrintSection[];
}

const KEY = 'table-print';

/** Report, explorer and ledger prints go through one A4 template with repeating headers. */
export function openTablePrint(navigate: NavigateFunction, payload: TablePrintPayload) {
  sessionStorage.setItem(KEY, JSON.stringify(payload));
  navigate('/print/table');
}

function fmt(v: string | number | null | undefined, type: PrintColType): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'string' && type !== 'date') return v;
  switch (type) {
    case 'money':
      return formatINR(Number(v), { symbol: false });
    case 'qty':
      return formatQty(Number(v));
    case 'pct':
      return `${v}%`;
    case 'date':
      return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? d(String(v)) : String(v);
    default:
      return String(v);
  }
}

/** Column widths that always add up to the 190 mm grid. Wide reports shrink, they never rotate. */
function widths(cols: PrintSection['columns']): DocColumn[] {
  const weight = (t: PrintColType) => (t === 'text' ? 2.2 : t === 'money' ? 1.35 : t === 'date' ? 1.05 : 0.9);
  const total = cols.reduce((a, c) => a + weight(c.type), 0);
  let used = 0;
  return cols.map((c, i) => {
    const w = i === cols.length - 1 ? Math.round((190 - used) * 100) / 100 : Math.round(((weight(c.type) / total) * 190) * 100) / 100;
    used += w;
    return { label: c.label, width: w, align: c.type === 'text' || c.type === 'date' ? 'left' : 'right' };
  });
}

export function TablePrintPage() {
  const navigate = useNavigate();
  const company = useQuery({ queryKey: ['company-profile'], queryFn: () => api.get<{ profile: CompanyProfile }>('/company-profile') });
  const raw = sessionStorage.getItem(KEY);
  const payload = raw ? (JSON.parse(raw) as TablePrintPayload) : null;
  const c = company.data?.profile;
  return (
    <div>
      <style>{DOC_CSS}</style>
      <div className="no-print sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b border-hairline bg-white px-6 py-3">
        <Button variant="quiet" icon={<ArrowLeft className="h-4 w-4" strokeWidth={1.5} />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <h1 className="mr-auto text-section font-semibold text-deep">{payload?.title ?? 'Print'}</h1>
        <Button onClick={() => window.print()} title="In the print dialog choose Save as PDF">
          Download PDF
        </Button>
        <Button variant="primary" icon={<Printer className="h-4 w-4" strokeWidth={1.5} />} onClick={() => window.print()}>
          Print
        </Button>
      </div>
      {!payload ? (
        <EmptyState title="Nothing to print" body="Open a report or a list and choose Download PDF." />
      ) : !c ? (
        <Skeleton className="m-6 h-[297mm] w-[210mm]" />
      ) : (
        <div className="print-root">
          {payload.sections.map((s, i) => {
            const fields: [string, string][] = [
              ['Period', payload.subtitle],
              ['Printed', d(new Date().toISOString().slice(0, 10))],
            ];
            const title = `${payload.title.toUpperCase()}`;
            return (
              <PagedDocument
                key={i}
                header={() => <DocHeader company={c} title={title} fields={fields} party={<div className="doc-value" style={{ fontWeight: 600 }}>{s.title}</div>} />}
                compactHeader={(p, n) => <CompactHeader company={c} title={title} fields={[['Section', s.title]]} page={p} pages={n} />}
                columns={widths(s.columns)}
                rows={s.rows.map((r) => s.columns.map((col) => fmt(r[col.key], col.type)))}
                tail={
                  s.totals ? (
                    <table className="doc-table" style={{ width: '190mm', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
                      <colgroup>
                        {widths(s.columns).map((w, k) => (
                          <col key={k} style={{ width: `${w.width}mm` }} />
                        ))}
                      </colgroup>
                      <tbody>
                        <tr>
                          {s.columns.map((col, k) => (
                            <td key={k} style={{ textAlign: col.type === 'text' || col.type === 'date' ? 'left' : 'right', fontWeight: 700, borderTop: '0.4mm solid #0F2A47' }}>
                              {fmt(s.totals?.[col.key], col.type)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <div />
                  )
                }
                footerNote={c.footerNote}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
