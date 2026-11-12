import { m } from 'framer-motion';
import { formatINR, type ProfitSettlement } from '@app/contract';

/** Profit waterfall: each step starts where the previous one ended. Deficits are shown in red with a minus sign. */
export function Waterfall({ s }: { s: Pick<ProfitSettlement, 'sales' | 'purchases' | 'grossProfit' | 'loanRepayment' | 'poolAfterLoan' | 'payableTotal' | 'otherExpenses' | 'ownerAmount'> }) {
  const steps: { label: string; value: number; kind: 'total' | 'minus'; from: number; to: number }[] = [];
  let level = s.sales;
  steps.push({ label: 'Sales', value: s.sales, kind: 'total', from: 0, to: s.sales });
  steps.push({ label: 'Purchases', value: -s.purchases, kind: 'minus', from: level - s.purchases, to: level });
  level -= s.purchases;
  steps.push({ label: 'Gross profit', value: s.grossProfit, kind: 'total', from: Math.min(0, level), to: Math.max(0, level) });
  steps.push({ label: 'Loan repayment', value: -s.loanRepayment, kind: 'minus', from: s.poolAfterLoan, to: s.poolAfterLoan + s.loanRepayment });
  steps.push({ label: 'Pool after loan', value: s.poolAfterLoan, kind: 'total', from: 0, to: s.poolAfterLoan });
  steps.push({ label: 'Workers', value: -s.payableTotal, kind: 'minus', from: s.poolAfterLoan - s.payableTotal, to: s.poolAfterLoan });
  steps.push({ label: 'Other expenses', value: -s.otherExpenses, kind: 'minus', from: s.ownerAmount, to: s.ownerAmount + s.otherExpenses });
  steps.push({ label: 'Owner amount', value: s.ownerAmount, kind: 'total', from: Math.min(0, s.ownerAmount), to: Math.max(0, s.ownerAmount) });
  const lo = Math.min(0, ...steps.map((x) => x.from));
  const hi = Math.max(1, ...steps.map((x) => x.to));
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <ol className="flex flex-col gap-2" aria-label="Profit waterfall">
      {steps.map((st, i) => {
        const neg = st.kind === 'total' && st.value < 0;
        return (
          <li key={st.label} className="grid grid-cols-[140px_1fr_130px] items-center gap-3 text-sm sm:grid-cols-[170px_1fr_150px]">
            <span className={st.kind === 'total' ? 'font-semibold text-deep' : 'text-slate'}>{st.label}</span>
            <span className="relative h-5 rounded-[3px] bg-mist">
              <m.span
                className={`absolute inset-y-0 rounded-[3px] ${neg ? 'bg-danger' : st.kind === 'total' ? (i === steps.length - 1 ? 'bg-brown' : 'bg-tide') : 'bg-slate/40'}`}
                style={{ left: `${pct(st.from)}%`, width: `${Math.max(0.4, pct(st.to) - pct(st.from))}%`, transformOrigin: 'left' }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.24, delay: i * 0.03, ease: [0.2, 0, 0, 1] }}
              />
            </span>
            <span className={`text-right tabular-nums ${st.kind === 'total' ? 'font-semibold' : ''} ${neg || (st.kind === 'total' && st.value < 0) ? 'text-danger' : 'text-deep'}`}>
              {st.value < 0 ? `−${formatINR(-st.value)}` : formatINR(st.value)}
              {neg && i === steps.length - 1 ? ' deficit' : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
