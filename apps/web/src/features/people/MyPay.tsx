import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatINR, formatTime, prevMonth } from '@app/contract';
import { api } from '../../api/client';
import { Button } from '../../ui/Button';
import { DataTable } from '../../ui/DataTable';
import { ErrorState, Skeleton } from '../../ui/feedback';
import { FigureBand, Money, PageHeader, Section } from '../../ui/layout';
import { MODE_LABEL, PAYTYPE_LABEL, formatDate, today } from '../common';

interface Day {
  date: string;
  status: string;
  offDay: boolean;
  firstIn?: string;
  lastOut?: string;
  paidHours: number;
  edited: boolean;
}
interface MyAttendance {
  month: string;
  staff: { name: string; payType: string; basePay?: number; hourlyRate?: number; sharePercent?: number; reduceByAbsence: boolean };
  workingDays: number;
  days: Day[];
  soFar: { presentDays: number; halfDays: number; absentDays: number; leaveDays: number; paidHours: number; offDayWorkDays: number };
  estimate: number | null;
  outstandingAdvance: number;
  today: { clockedInAt: string | null; minutesToday: number };
}

const TONE: Record<string, string> = { PRESENT: 'text-success', HALF: 'text-brown', ABSENT: 'text-danger', LEAVE: 'text-slate', OFF: 'text-slate', UPCOMING: 'text-slate' };
const SHORT: Record<string, string> = { PRESENT: 'Present', HALF: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave', OFF: 'Off', UPCOMING: '' };

/** Worker view: own attendance and own pay only. Read-only. */
export function MyPay() {
  const navigate = useNavigate();
  const [month, setMonth] = useState(today().slice(0, 7));
  const q = useQuery({ queryKey: ['my-attendance', month], queryFn: () => api.get<MyAttendance>('/my/attendance', { month }) });
  const slips = useQuery({ queryKey: ['my-payslips'], queryFn: () => api.get<{ items: { id: string; number: string; periodFrom: string; periodTo: string; payType: string; net: number; paidOn: string; mode: string }[] }>('/my/payslips') });
  if (q.isLoading) return <Skeleton className="m-6 h-96" />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const first = a.days[0]?.date ?? `${month}-01`;
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const isCurrent = month === today().slice(0, 7);
  return (
    <div>
      <PageHeader
        title="My pay"
        description={`${PAYTYPE_LABEL[a.staff.payType]} pay${a.staff.payType === 'FIXED' ? `, ${formatINR(a.staff.basePay ?? 0)} a month` : a.staff.payType === 'HOURLY' ? `, ${formatINR(a.staff.hourlyRate ?? 0)} an hour` : `, ${a.staff.sharePercent}% share`}. Attendance is recorded when you sign in and out.`}
        actions={
          <>
            <Button size="sm" variant="quiet" onClick={() => setMonth(prevMonth(month))}>
              Previous month
            </Button>
            {!isCurrent ? (
              <Button size="sm" variant="quiet" onClick={() => setMonth(today().slice(0, 7))}>
                This month
              </Button>
            ) : null}
          </>
        }
      />
      <FigureBand
        items={[
          ...(isCurrent ? [{ label: 'Today', value: a.today.clockedInAt ? `${Math.floor(a.today.minutesToday / 60)} h ${a.today.minutesToday % 60} m` : 'Not in', sub: a.today.clockedInAt ? <span className="text-slate">Since {formatTime(a.today.clockedInAt)}</span> : undefined }] : []),
          { label: `Days present in ${a.month}`, value: a.soFar.presentDays + a.soFar.halfDays * 0.5, sub: <span className="text-slate">of {a.workingDays} working days</span> },
          { label: 'Paid hours', value: a.soFar.paidHours },
          {
            label: a.staff.payType === 'SHARE' ? 'Share' : isCurrent ? 'Estimated so far' : 'Earned, not yet paid',
            value: a.staff.payType === 'SHARE' ? 'After settlement' : <Money value={a.estimate} compact />,
            sub: a.staff.payType === 'SHARE' ? <span className="text-slate">Shown once the month is settled</span> : <span className="text-slate">Before any deductions</span>,
          },
          ...(a.outstandingAdvance ? [{ label: 'Advance to be recovered', value: <Money value={a.outstandingAdvance} compact /> }] : []),
        ]}
      />
      <Section title={`Attendance, ${new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`}>
        <div className="grid max-w-3xl grid-cols-7 gap-px overflow-hidden rounded-panel border border-hairline bg-hairline text-sm">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="bg-mist px-2 py-1.5 text-center text-meta font-semibold text-slate">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`b${i}`} className="bg-white" />
          ))}
          {a.days.map((d) => (
            <div key={d.date} className={`min-h-[64px] px-2 py-1.5 ${d.offDay ? 'bg-mist' : 'bg-white'}`} title={d.firstIn ? `${formatTime(d.firstIn)} to ${d.lastOut ? formatTime(d.lastOut) : 'now'}` : undefined}>
              <span className="text-meta text-slate">{Number(d.date.slice(8))}</span>
              <span className={`block text-meta font-medium ${TONE[d.status] ?? 'text-slate'}`}>{SHORT[d.status] ?? d.status}</span>
              {d.paidHours ? <span className="block text-meta text-slate">{d.paidHours} h</span> : null}
            </div>
          ))}
        </div>
      </Section>
      <Section title="My payslips" flush>
        <DataTable
          caption="My payslips"
          toolbar={false}
          rows={slips.data?.items}
          loading={slips.isLoading}
          error={slips.error}
          rowId={(r) => r.id}
          onRowClick={(r) => navigate(`/payslips/${r.id}/print`)}
          empty={{ title: 'No payslips yet', body: 'Your paid payslips appear here with a PDF you can download.' }}
          columns={[
            { id: 'n', header: 'Payslip', cell: (r) => <span className="font-medium">{r.number}</span> },
            { id: 'p', header: 'Period', cell: (r) => `${formatDate(r.periodFrom)} to ${formatDate(r.periodTo)}` },
            { id: 'd', header: 'Paid on', cell: (r) => `${formatDate(r.paidOn)}, ${MODE_LABEL[r.mode] ?? r.mode}` },
            { id: 'net', header: 'Net pay', align: 'right', cell: (r) => <Money value={r.net} strong /> },
          ]}
        />
      </Section>
    </div>
  );
}
