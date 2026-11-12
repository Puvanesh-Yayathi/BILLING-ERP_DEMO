import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, formatTime } from '@app/contract';
import { api } from '../../api/client';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { ErrorState, SkeletonRows } from '../../ui/feedback';
import { Field, FormGrid, Input, Select, Textarea } from '../../ui/form';
import { PageHeader, Toolbar } from '../../ui/layout';
import { Dialog } from '../../ui/overlay';
import { DateRange, PAYTYPE_LABEL, formatDate, today } from '../common';

interface Day {
  date: string;
  status: string;
  offDay: boolean;
  firstIn?: string;
  lastOut?: string;
  rawMinutes: number;
  paidHours: number;
  edited: boolean;
  offDayWork: boolean;
  locked: boolean;
  attendanceId?: string;
  editReason?: string;
}
interface Row {
  staff: { id: string; name: string; code: string; payType: string; hasLogin: boolean };
  summary: { presentDays: number; halfDays: number; absentDays: number; leaveDays: number; paidHours: number };
  days: Day[];
  today: { clockedInAt: string | null; minutesToday: number } | null;
}

const CELL: Record<string, string> = { PRESENT: 'P', HALF: 'H', ABSENT: 'A', LEAVE: 'L', OFF: '', UPCOMING: '' };

function EditDay({ target, onClose }: { target: { row: Row; day: Day } | null; onClose: () => void }) {
  const [status, setStatus] = useState('PRESENT');
  const [hours, setHours] = useState('8');
  const [reason, setReason] = useState('');
  const day = target?.day;
  const save = useAction(
    () =>
      day?.attendanceId
        ? api.put(`/attendance/${day.attendanceId}`, { status, paidHours: Number(hours) || 0, reason })
        : api.post('/attendance/manual', { staffId: target?.row.staff.id, date: day?.date, status, paidHours: Number(hours) || 0, reason: reason || 'Manual entry' }),
    { success: 'Saved attendance', onDone: () => (setReason(''), onClose()) },
  );
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={target ? `${target.row.staff.name}, ${formatDate(day?.date)}` : ''}
      description={day?.locked ? 'This day is on a paid payslip. Cancel the payslip before editing it.' : day?.attendanceId ? `Recorded ${day.firstIn ? `from ${formatTime(day.firstIn)}` : ''}${day.lastOut ? ` to ${formatTime(day.lastOut)}` : ''}, ${Math.floor(day.rawMinutes / 60)} h ${day.rawMinutes % 60} m. The row is marked as edited.` : 'No attendance recorded for this day.'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.busy} disabled={day?.locked} onClick={() => void save.run()}>
            Save attendance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <FormGrid>
          <Field label="Status" htmlFor="a-status">
            <Select id="a-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={day?.locked}>
              <option value="PRESENT">Present</option>
              <option value="HALF">Half day</option>
              <option value="ABSENT">Absent</option>
              <option value="LEAVE">Leave (unpaid)</option>
            </Select>
          </Field>
          <Field label="Paid hours" htmlFor="a-hours" helper="Whole hours after rounding">
            <Input id="a-hours" inputMode="numeric" align="right" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9.]/g, ''))} disabled={day?.locked || status === 'ABSENT'} />
          </Field>
        </FormGrid>
        <Field label="Reason" htmlFor="a-reason" error={save.fields.reason} helper={day?.attendanceId ? 'Required, for example "Forgot to log out"' : 'Optional'}>
          <Textarea id="a-reason" value={reason} onChange={(e) => setReason(e.target.value)} disabled={day?.locked} />
        </Field>
      </div>
    </Dialog>
  );
}

export function Attendance() {
  const [from, setFrom] = useState(addDays(today(), -13));
  const [to, setTo] = useState(today());
  const [staffId, setStaffId] = useState('');
  const [editing, setEditing] = useState<{ row: Row; day: Day } | null>(null);
  const q = useQuery({ queryKey: ['attendance', from, to, staffId], queryFn: () => api.get<{ from: string; to: string; rows: Row[]; workers: { id: string; name: string }[] }>('/attendance', { from, to, staffId }) });
  const days = q.data?.rows[0]?.days ?? [];
  return (
    <div>
      <PageHeader title="Attendance" description="Login workers are marked present when they sign in, and their hours come from their sessions. Click a day to correct it or to mark a worker without a login." />
      <Toolbar>
        <DateRange from={from} to={to} onChange={(f, t) => (setFrom(f), setTo(t))} presets={false} />
        <label className="flex flex-col gap-1">
          <span className="text-meta text-slate">Worker</span>
          <Select value={staffId} onChange={(e) => setStaffId(e.target.value)} className="w-[200px]">
            <option value="">All workers</option>
            {q.data?.workers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </label>
        <p className="ml-auto self-center text-meta text-slate">P present, H half day, A absent, L leave. Small dot: edited.</p>
      </Toolbar>
      {q.isLoading ? (
        <SkeletonRows rows={8} cols={8} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <caption className="sr-only">Attendance grid</caption>
            <thead className="sticky top-0 bg-mist">
              <tr className="border-y border-hairline">
                <th scope="col" className="sticky left-0 z-10 h-10 min-w-[200px] bg-mist px-4 text-left text-th font-semibold text-slate">
                  Worker
                </th>
                <th scope="col" className="h-10 px-3 text-left text-th font-semibold text-slate">
                  Today
                </th>
                {days.map((d) => (
                  <th key={d.date} scope="col" className={`h-10 w-10 px-1 text-center text-meta font-semibold ${d.offDay ? 'text-slate/70' : 'text-slate'}`}>
                    {d.date.slice(8)}
                    <span className="block font-normal">{new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'narrow', timeZone: 'UTC' })}</span>
                  </th>
                ))}
                {['Present', 'Half', 'Absent', 'Hours'].map((h) => (
                  <th key={h} scope="col" className="h-10 px-3 text-right text-th font-semibold text-slate">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {q.data?.rows.map((r) => (
                <tr key={r.staff.id} className="border-b border-hairline">
                  <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-normal">
                    <span className="font-medium text-deep">{r.staff.name}</span>
                    <span className="block text-meta text-slate">
                      {PAYTYPE_LABEL[r.staff.payType]}, {r.staff.hasLogin ? 'login' : 'no login'}
                    </span>
                  </th>
                  <td className="whitespace-nowrap px-3 text-meta">{r.today?.clockedInAt ? <span className="text-success">In since {formatTime(r.today.clockedInAt)}, {Math.floor(r.today.minutesToday / 60)} h {r.today.minutesToday % 60} m</span> : r.staff.hasLogin ? <span className="text-slate">Not signed in</span> : ''}</td>
                  {r.days.map((d) => {
                    const label = CELL[d.status] ?? '';
                    const tone = d.status === 'ABSENT' ? 'text-danger' : d.status === 'HALF' ? 'text-brown' : d.status === 'PRESENT' ? 'text-success' : 'text-slate';
                    return (
                      <td key={d.date} className={`h-10 w-10 p-0 text-center ${d.offDay ? 'bg-mist' : ''}`}>
                        {d.status === 'UPCOMING' ? null : (
                          <button
                            type="button"
                            onClick={() => setEditing({ row: r, day: d })}
                            title={`${formatDate(d.date)}: ${d.status.toLowerCase()}${d.paidHours ? `, ${d.paidHours} h` : ''}${d.edited ? `, edited (${d.editReason ?? ''})` : ''}${d.locked ? ', paid' : ''}`}
                            aria-label={`${r.staff.name} ${formatDate(d.date)} ${d.status.toLowerCase()}`}
                            className={`relative h-10 w-10 text-sm font-medium hover:bg-mist ${tone}`}
                          >
                            {label}
                            {d.paidHours && r.staff.payType === 'HOURLY' ? <span className="block text-[10px] font-normal text-slate">{d.paidHours}h</span> : null}
                            {d.edited ? <span className="absolute right-1 top-1 h-1 w-1 rounded-full bg-brown" /> : null}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 text-right tabular-nums">{r.summary.presentDays}</td>
                  <td className="px-3 text-right tabular-nums">{r.summary.halfDays}</td>
                  <td className="px-3 text-right tabular-nums">{r.summary.absentDays ? <span className="text-danger">{r.summary.absentDays}</span> : 0}</td>
                  <td className="px-3 text-right font-medium tabular-nums">{r.summary.paidHours}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!q.data?.rows.length ? <p className="px-6 py-8 text-slate">No active workers. Add workers in Workers and logins.</p> : null}
        </div>
      )}
      <EditDay target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
