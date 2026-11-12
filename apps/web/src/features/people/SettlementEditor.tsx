import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, monthEnd, monthStart, type ProfitSettlement, type SettlementLine } from '@app/contract';
import { api, ApiError } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { InlineError, Skeleton } from '../../ui/feedback';
import { Field, FormGrid, Input, MoneyInput, Select } from '../../ui/form';
import { FigureBand, Money, PageHeader, Section } from '../../ui/layout';
import { PAYTYPE_LABEL, today, useDebounced } from '../common';
import { Waterfall } from './Waterfall';

type Line = SettlementLine & { name: string };
type Preview = Omit<ProfitSettlement, 'lines'> & { lines: Line[] };

export function SettlementEditor() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [month, setMonth] = useState(params.get('month') ?? today().slice(0, 7));
  const [loanId, setLoanId] = useState('');
  const [loanAmount, setLoanAmount] = useState<number | undefined>(0);
  const [adj, setAdj] = useState<Record<string, { amount?: number; reason: string }>>({});
  const [rec, setRec] = useState<Record<string, number | undefined>>({});
  const fig = useQuery({ queryKey: ['settlement-figures', month], queryFn: () => api.get<{ sales: number; purchases: number; otherExpenses: number; loans: { id: string; lender: string; amount: number; outstanding: number }[] }>('/settlements/figures', { month }) });
  const body = {
    month,
    loanTrancheId: loanId || undefined,
    loanRepayment: loanAmount ?? 0,
    adjustments: Object.entries(adj)
      .filter(([, v]) => v.amount && v.reason.trim().length > 0)
      .map(([staffId, v]) => ({ staffId, amount: v.amount ?? 0, reason: v.reason })),
    advanceRecoveries: Object.entries(rec)
      .filter(([, v]) => v !== undefined)
      .map(([staffId, v]) => ({ staffId, amount: v ?? 0 })),
  };
  const dBody = useDebounced(body, 300);
  const prev = useQuery({ queryKey: ['settlement-preview', dBody], queryFn: () => api.post<Preview>('/settlements/preview', dBody), retry: false, placeholderData: (p) => p });
  const save = useAction(
    async (finalize: boolean) => {
      const draft = await api.post<ProfitSettlement>('/settlements', body);
      if (finalize) await api.post(`/settlements/${draft.id}/finalize`);
      return { draft, finalize };
    },
    { success: (r) => (r.finalize ? `Finalized the ${month} settlement. Pay the workers from the next screen.` : `Saved the ${month} settlement as a draft`), onDone: (r) => (r.finalize ? navigate(`/settlements/${r.draft.id}`) : undefined) },
  );
  const p = prev.data;
  const loan = fig.data?.loans.find((l) => l.id === loanId);
  const err = prev.error instanceof ApiError ? prev.error : null;
  return (
    <div>
      <PageHeader title="New settlement" description="Sales, purchases and other expenses for the month come from the system. Enter the loan repayment, check the worker table, add any adjustment, then finalize." />
      <Section>
        <div className="max-w-4xl pt-5">
          <FormGrid cols={3}>
            <Field label="Month" htmlFor="st-m">
              <Input id="st-m" type="month" value={month} max={today().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="Loan to repay" htmlFor="st-loan" helper={loan ? `Outstanding ${formatINR(loan.outstanding)}` : 'Optional'}>
              <Select id="st-loan" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
                <option value="">No loan repayment</option>
                {fig.data?.loans.filter((l) => l.outstanding > 0).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.lender}, outstanding {formatINR(l.outstanding)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Loan repayment" htmlFor="st-amt" helper="Capped at the month’s profit. Any part that cannot be paid stays outstanding.">
              <MoneyInput id="st-amt" value={loanAmount} disabled={!loanId} onChange={setLoanAmount} />
            </Field>
          </FormGrid>
        </div>
      </Section>
      <FigureBand
        items={[
          { label: 'Sales (taxable value)', value: <Money value={fig.data?.sales} compact />, sub: <Link className="link text-sm" to={`/explorer?from=${monthStart(month)}&to=${monthEnd(month)}`}>Open the bills</Link> },
          { label: 'Purchases', value: <Money value={fig.data?.purchases} compact />, sub: <Link className="link text-sm" to="/purchase-bills">Open the purchase bills</Link> },
          { label: 'Gross profit', value: <Money value={fig.data ? fig.data.sales - fig.data.purchases : undefined} compact /> },
          { label: 'Other expenses', value: <Money value={fig.data?.otherExpenses} compact />, sub: <Link className="link text-sm" to="/expenses">Open the expenses</Link> },
        ]}
      />
      {err ? (
        <p className="m-6 border-l-2 border-danger pl-3 text-base" role="alert">
          {err.message}
        </p>
      ) : !p ? (
        <Skeleton className="m-6 h-72" />
      ) : (
        <>
          <Section title="Waterfall">
            <div className="max-w-4xl">
              <Waterfall s={p} />
              {p.scaleFactor < 1 ? <p className="mt-4 border-l-2 border-caution pl-3 text-sm">The profit after the loan is smaller than the worker total, so every worker receives {(p.scaleFactor * 100).toFixed(2)}% of their amount.</p> : null}
              {p.loanRepaymentUnpaid > 0 ? <p className="mt-2 border-l-2 border-caution pl-3 text-sm">{formatINR(p.loanRepaymentUnpaid)} of the loan repayment cannot be paid from this month’s profit and stays outstanding.</p> : null}
            </div>
          </Section>
          <Section title="Workers" flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-sm">
                <thead className="bg-mist">
                  <tr className="border-y border-hairline text-th text-slate">
                    {['Worker', 'Pay type', 'Rate or %', 'Present', 'Half', 'Absent', 'Leave', 'Hours', 'Earned or share', 'Scale', 'Adjustment', 'Advance recovery', 'Already paid', 'Net payable'].map((h, i) => (
                      <th key={h} className={`h-9 px-3 font-semibold ${i < 2 ? 'text-left' : 'text-right'}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.lines.map((l) => (
                    <tr key={l.staffId} className="border-b border-hairline align-top">
                      <td className="px-3 py-2 font-medium">{l.name}</td>
                      <td className="px-3 py-2">{PAYTYPE_LABEL[l.payType]}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {l.payType === 'SHARE' ? `${l.sharePercent}%` : formatINR(l.rate ?? 0)}
                        {l.payType === 'SHARE' && l.reduceByAbsence ? <span className="block text-meta text-slate">Effective {(l.effectivePercent ?? 0).toFixed(2)}%</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.presentDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.halfDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.absentDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.leaveDays}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.paidHours}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatINR(l.earned)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.scaleFactor < 1 ? `${(p.scaleFactor * 100).toFixed(1)}%` : 'None'}</td>
                      <td className="w-56 px-2 py-2">
                        <MoneyInput allowNegative value={adj[l.staffId]?.amount} placeholder="0.00" onChange={(v) => setAdj((a) => ({ ...a, [l.staffId]: { reason: a[l.staffId]?.reason ?? '', amount: v } }))} />
                        {adj[l.staffId]?.amount ? <Input className="mt-1" placeholder="Reason (required)" aria-label={`Reason for ${l.name}`} invalid={!adj[l.staffId]?.reason.trim()} value={adj[l.staffId]?.reason ?? ''} onChange={(e) => setAdj((a) => ({ ...a, [l.staffId]: { amount: a[l.staffId]?.amount, reason: e.target.value } }))} /> : null}
                      </td>
                      <td className="w-40 px-2 py-2">
                        <MoneyInput value={rec[l.staffId] ?? l.advanceRecovery} onChange={(v) => setRec((r) => ({ ...r, [l.staffId]: v }))} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{l.alreadyPaid ? formatINR(l.alreadyPaid) : ''}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {formatINR(l.balancePayable)}
                        {l.carryAdvance ? <span className="block text-meta font-normal text-brown">{formatINR(l.carryAdvance)} carried as advance</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={8} className="px-3 py-2 text-right font-semibold">
                      Worker total payable
                    </td>
                    <td colSpan={6} className="px-3 py-2 text-right">
                      <Money value={p.payableTotal} strong />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Section>
          <Section>
            <div className="flex flex-wrap items-center gap-3 pt-5">
              <InlineError error={save.error} />
              <Button loading={save.busy} onClick={() => void save.run(false)}>
                Save as draft
              </Button>
              <Button variant="primary" loading={save.busy} onClick={() => void save.run(true)}>
                Finalize settlement
              </Button>
              <span className="text-sm text-slate">Finalizing records the loan repayment and creates a payslip for every worker with these amounts.</span>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
