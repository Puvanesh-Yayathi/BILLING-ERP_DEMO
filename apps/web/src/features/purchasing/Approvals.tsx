import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, formatQty } from '@app/contract';
import { api } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { EmptyState, ErrorState, SkeletonRows } from '../../ui/feedback';
import { PageHeader } from '../../ui/layout';
import { ReasonDialog } from '../../ui/overlay';
import { formatDate } from '../common';
import type { IndentView } from './types';

function Row({ ind }: { ind: IndentView }) {
  const [rejecting, setRejecting] = useState(false);
  const approve = useAction(() => api.post<IndentView>(`/indents/${ind.id}/approve`, { remarks: '' }), { success: (r) => `Approved ${r.number}. Purchase order ${r.poNumber} is ready.` });
  return (
    <li className="border-b border-hairline px-4 py-4 sm:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link to={`/indents/${ind.id}`} className="text-section font-semibold text-deep hover:underline">
            {ind.number}
          </Link>
          <p className="text-sm text-slate">
            {ind.supplier}, raised by {ind.raisedBy} on {formatDate(ind.date)}
          </p>
          <ul className="mt-2 text-sm">
            {ind.lines.map((l) => (
              <li key={l.rawMaterialId}>
                {l.name}: {formatQty(l.qty)} {l.unit} at {formatINR(l.rate)}
              </li>
            ))}
          </ul>
          {ind.note ? <p className="mt-1 text-sm text-slate">{ind.note}</p> : null}
        </div>
        <div className="flex flex-col gap-3 md:items-end">
          <span className="text-[22px] font-semibold tabular-nums text-deep">{formatINR(ind.total)}</span>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => setRejecting(true)}>
              Reject
            </Button>
            <Button variant="primary" loading={approve.busy} onClick={() => void approve.run()}>
              Approve
            </Button>
          </div>
        </div>
      </div>
      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={`Reject ${ind.number}`}
        description="The indent can be edited and submitted again."
        label="Remarks"
        actionLabel="Reject indent"
        successText={`Rejected indent ${ind.number}`}
        danger
        onConfirm={async (remarks) => {
          await api.post(`/indents/${ind.id}/reject`, { remarks });
        }}
      />
    </li>
  );
}

export function Approvals() {
  const q = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<{ stage: number; items: IndentView[] }>('/approvals/inbox') });
  return (
    <div>
      <PageHeader title="Approvals" description="Indents waiting for your approval. Approving one makes its purchase order ready." />
      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data?.items.length ? (
        <ul>
          {q.data.items.map((i) => (
            <Row key={i.id} ind={i} />
          ))}
        </ul>
      ) : (
        <EmptyState title="Nothing is waiting for you" body="Indents appear here when they reach your stage. You will also get a notification." />
      )}
    </div>
  );
}
