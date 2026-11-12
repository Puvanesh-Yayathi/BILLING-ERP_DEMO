import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, type ProfitSettlement, type SettlementLine } from '@app/contract';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { Money, PageHeader, Section } from '../../ui/layout';
import { ReasonDialog } from '../../ui/overlay';
import { StatusText } from '../../ui/status';
import { PAYTYPE_LABEL, formatDate } from '../common';
import { PayDialog } from './Payroll';
import { Waterfall } from './Waterfall';

type Worker = SettlementLine & { name: string; code: string; payslipNumber: string | null; payslipStatus: string | null; paidOn: string | null };

export function SettlementDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [paying, setPaying] = useState(false);
  const [cancel, setCancel] = useState(false);
  const q = useQuery({ queryKey: ['settlement', id], queryFn: () => api.get<{ settlement: ProfitSettlement; workers: Worker[]; loan: { lender?: string } | null }>(`/settlements/${id}`) });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { settlement: s, workers } = q.data;
  const unpaid = workers.filter((w) => w.payslipStatus === 'DRAFT');
  const anyPaid = workers.some((w) => w.payslipStatus === 'PAID');
  return (
    <div>
      <PageHeader
        title={`Settlement ${s.month}`}
        meta={<StatusText status={s.status} />}
        description={s.finalizedAt ? `Finalized on ${formatDate(s.finalizedAt.slice(0, 10))}${q.data.loan?.lender ? `. Loan repayment to ${q.data.loan.lender}.` : '.'}` : undefined}
        actions={
          <>
            {s.status === 'FINALIZED' && unpaid.length ? (
              <Button variant="primary" onClick={() => setPaying(true)}>
                Pay all ({unpaid.length})
              </Button>
            ) : null}
            <Button onClick={() => navigate(`/settlements/${s.id}/print`)}>Consolidated payslip PDF</Button>
            {s.status === 'FINALIZED' && !anyPaid ? (
              <Button variant="danger" onClick={() => setCancel(true)}>
                Cancel settlement
              </Button>
            ) : null}
          </>
        }
      />
      <Section title="Waterfall">
        <div className="max-w-4xl pt-1">
          <Waterfall s={s} />
        </div>
        {s.status === 'CANCELLED' ? <p className="mt-4 border-l-2 border-danger pl-3 text-sm">Cancelled: {s.cancelReason}</p> : null}
      </Section>
      <Section title="Workers" flush>
        <DataTable
          caption="Settlement workers"
          rows={workers}
          rowId={(r) => r.staffId}
          onRowClick={(r) => (r.payslipId && r.payslipStatus === 'PAID' ? navigate(`/payslips/${r.payslipId}/print`) : undefined)}
          empty={{ title: 'No workers', body: 'Active workers are included when the settlement is run.' }}
          columns={[
            { id: 'n', header: 'Worker', cell: (r) => <span className="font-medium">{r.name}</span>, hideable: false },
            { id: 't', header: 'Pay type', cell: (r) => (r.payType === 'SHARE' ? `Share ${r.sharePercent}%${r.reduceByAbsence ? `, eff. ${(r.effectivePercent ?? 0).toFixed(2)}%` : ''}` : PAYTYPE_LABEL[r.payType]) },
            { id: 'd', header: 'Present, half, absent', cell: (r) => `${r.presentDays}, ${r.halfDays}, ${r.absentDays}` },
            { id: 'h', header: 'Hours', align: 'right', cell: (r) => r.paidHours, defaultHidden: true },
            { id: 'e', header: 'Earned or share', align: 'right', cell: (r) => <Money value={r.scaled} /> },
            { id: 'a', header: 'Adjustment', align: 'right', cell: (r) => (r.adjustment ? <span title={r.adjustmentReason}>{formatINR(r.adjustment)}</span> : '') },
            { id: 'r', header: 'Recovered or paid earlier', align: 'right', cell: (r) => (r.advanceRecovery + r.alreadyPaid ? formatINR(r.advanceRecovery + r.alreadyPaid) : '') },
            { id: 'net', header: 'Net payable', align: 'right', cell: (r) => <Money value={r.balancePayable} strong />, total: <Money value={workers.reduce((a, w) => a + w.balancePayable, 0)} /> },
            { id: 's', header: 'Payslip', cell: (r) => (r.payslipStatus ? <span className="flex flex-col"><StatusText status={r.payslipStatus} />{r.payslipNumber ? <span className="text-meta text-slate">{r.payslipNumber}</span> : null}</span> : '') },
          ]}
        />
      </Section>
      <PayDialog
        open={paying}
        onOpenChange={setPaying}
        title={`Pay ${unpaid.length} workers for ${s.month}`}
        description="Each payslip is numbered and paid, attendance is locked, advances are recovered and every worker is notified."
        successText={`Paid the ${s.month} settlement payslips`}
        onPay={(b) => api.post(`/settlements/${s.id}/pay-all`, b)}
      />
      <ReasonDialog
        open={cancel}
        onOpenChange={setCancel}
        title={`Cancel the ${s.month} settlement`}
        description="The loan repayment and the unpaid payslips are removed. The month can then be run again."
        actionLabel="Cancel settlement"
        successText={`Cancelled the ${s.month} settlement`}
        danger
        onConfirm={async (reason) => {
          await api.post(`/settlements/${s.id}/cancel`, { reason });
        }}
      />
    </div>
  );
}
