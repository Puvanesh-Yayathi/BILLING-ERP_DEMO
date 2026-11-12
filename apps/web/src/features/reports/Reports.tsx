import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../api/client';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/feedback';
import { PageHeader } from '../../ui/layout';

const ABOUT: Record<string, string> = {
  sales: 'Day-wise and month-wise sales, customer-wise, product-wise and the GST summary',
  top: 'Best customers and best-selling items',
  outstanding: 'What each customer owes, by age, with overdue amounts',
  funds: 'Fund received, utilised and balance, with each supplier payment',
  indents: 'Indents pending, approved, rejected, received and paid',
  purchases: 'Purchase register and supplier-wise purchases',
  stock: 'Raw material and finished product stock with values',
  production: 'Production batches with inputs, outputs and wastage',
  daybook: 'Day book and the cash flow book',
  payroll: 'Attendance and hours, payslip register and staff advances',
  expenses: 'Daily expenses and the head-wise summary',
  profit: 'Month-wise profit with loan, worker pay and owner amount',
};

export function Reports() {
  const q = useQuery({ queryKey: ['reports'], queryFn: () => api.get<{ items: { key: string; title: string }[] }>('/reports') });
  return (
    <div>
      <PageHeader title="Reports" description="Choose a report, set the dates, then export it to Excel or download it as an A4 PDF." />
      {q.isLoading ? (
        <SkeletonRows rows={6} cols={2} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data?.items.length ? (
        <ul className="divide-y divide-hairline border-b border-hairline">
          {q.data.items.map((r, i) => (
            <li key={r.key}>
              <Link to={`/reports/${r.key}`} className="flex items-center gap-4 px-6 py-4 hover:bg-mist">
                <span className="w-6 text-right text-meta tabular-nums text-slate">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium text-deep">{r.title}</span>
                  <span className="block text-sm text-slate">{ABOUT[r.key]}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-slate" strokeWidth={1.5} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No reports for your role" body="Ask your administrator if you need a report." />
      )}
    </div>
  );
}
