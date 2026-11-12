import {
  eachDay,
  isOffDay,
  istMinuteOfDay,
  roundHours,
  toISTDate,
  type Attendance,
  type AttendanceEditInput,
  type AttendanceManualInput,
  type AttendanceSession,
  type CalendarConfig,
  type ISODate,
  type Staff,
} from '@app/contract';
import { audit, emit, newId, type Ctx } from '../ctx.js';
import { AppError, invalidState } from '../errors.js';
import type { State } from '../state.js';
import { find, requireRole } from './util.js';

export function calendarOf(s: State): CalendarConfig {
  return { weeklyOffs: s.settings.weeklyOffs, holidays: s.holidays.map((h) => h.date) };
}

function minutesBetween(a: string, b: string): number {
  return Math.max(0, Math.floor((Date.parse(b) - Date.parse(a)) / 60000));
}

export function sessionEnd(sess: AttendanceSession, presence?: string): string {
  if (sess.logoutAt) return sess.logoutAt;
  return presence && presence > sess.lastSeenAt ? presence : sess.lastSeenAt;
}

/** Rebuild one day's attendance from its sessions (unless Admin edited it or it is locked). */
export function recomputeDay(s: State, staffId: string, date: ISODate, liveEnd?: string): Attendance | undefined {
  const sessions = s.sessions.filter((x) => x.staffId === staffId && x.date === date);
  let row = s.attendance.find((a) => a.staffId === staffId && a.date === date);
  if (row && (row.source !== 'AUTO' || row.payslipId)) return row;
  if (!sessions.length) return row;
  const rawMinutes = sessions.reduce((a, x) => a + minutesBetween(x.loginAt, x.logoutAt ?? liveEnd ?? x.lastSeenAt), 0);
  const paidHours = roundHours(rawMinutes, s.settings.hoursRounding);
  const firstIn = sessions.map((x) => x.loginAt).sort()[0];
  const ends = sessions.filter((x) => x.logoutAt).map((x) => x.logoutAt as string).sort();
  const half = s.settings.halfDayRuleEnabled && paidHours < s.settings.halfDayMinHours;
  const next: Attendance = {
    id: row?.id ?? newId(s, 'att'),
    staffId,
    date,
    status: half ? 'HALF' : 'PRESENT',
    firstIn,
    lastOut: ends[ends.length - 1],
    rawMinutes,
    paidHours,
    source: 'AUTO',
  };
  if (row) Object.assign(row, next);
  else {
    s.attendance.push(next);
    row = next;
  }
  return row;
}

/** Login = clock in. Closes stale sessions from earlier days at their last heartbeat. */
export function startSession(s: State, ctx: Ctx, staff: Staff): AttendanceSession {
  for (const open of s.sessions.filter((x) => x.staffId === staff.id && !x.logoutAt && x.date < ctx.today)) {
    open.logoutAt = open.lastSeenAt;
    open.endReason = 'AUTO_CLOSE';
    recomputeDay(s, staff.id, open.date);
  }
  const sess: AttendanceSession = {
    id: newId(s, 'ses'),
    staffId: staff.id,
    date: ctx.today,
    loginAt: ctx.now,
    lastSeenAt: ctx.now,
  };
  s.sessions.push(sess);
  recomputeDay(s, staff.id, ctx.today, ctx.now);
  emit(ctx, 'attendance.clockin', 'attendance', staff.id, `${staff.name} signed in and was clocked in`);
  return sess;
}

/** Logout = clock out. */
export function closeSessions(
  s: State,
  staffId: string,
  at: string,
  reason: NonNullable<AttendanceSession['endReason']>,
  presence?: string,
): number {
  let n = 0;
  for (const sess of s.sessions.filter((x) => x.staffId === staffId && !x.logoutAt)) {
    const end = reason === 'LOGOUT' ? at : sessionEnd(sess, presence);
    sess.lastSeenAt = end > sess.lastSeenAt ? end : sess.lastSeenAt;
    sess.logoutAt = end < sess.loginAt ? sess.loginAt : end;
    sess.endReason = reason;
    recomputeDay(s, staffId, sess.date);
    n++;
  }
  return n;
}

/**
 * Sweeper: closes sessions idle for longer than the timeout at their last heartbeat,
 * and any session still open from an earlier day (midnight auto-close).
 */
export function sweepSessions(s: State, nowIso: string, presence: Record<string, string>): { closed: string[] } {
  const closed: string[] = [];
  const today = toISTDate(nowIso);
  const idleMs = s.settings.idleTimeoutMinutes * 60000;
  for (const sess of s.sessions.filter((x) => !x.logoutAt)) {
    const last = sessionEnd(sess, presence[sess.staffId]);
    if (sess.date < today) {
      sess.lastSeenAt = last;
      sess.logoutAt = last;
      sess.endReason = 'AUTO_CLOSE';
    } else if (Date.parse(nowIso) - Date.parse(last) > idleMs) {
      sess.lastSeenAt = last;
      sess.logoutAt = last;
      sess.endReason = 'IDLE_TIMEOUT';
    } else continue;
    recomputeDay(s, sess.staffId, sess.date);
    closed.push(sess.staffId);
  }
  return { closed };
}

export function editAttendance(s: State, ctx: Ctx, id: string, input: AttendanceEditInput): Attendance {
  requireRole(ctx, 'ADMIN');
  const row = find(s.attendance, id, 'Attendance day');
  if (row.payslipId) throw invalidState('This day is on a paid payslip. Cancel the payslip before editing it.');
  const before = { ...row };
  row.status = input.status;
  row.paidHours = input.status === 'ABSENT' ? 0 : input.paidHours;
  row.rawMinutes = Math.round(row.paidHours * 60);
  row.source = 'EDITED';
  row.editReason = input.reason;
  const staff = find(s.staff, row.staffId, 'Worker');
  audit(ctx, 'attendance', row.id, 'edit', `Edited attendance of ${staff.name} on ${row.date}: ${input.reason}`, before, row);
  emit(ctx, 'attendance.edit', 'attendance', row.id, `Attendance corrected for ${staff.name}`);
  return row;
}

export function manualAttendance(s: State, ctx: Ctx, input: AttendanceManualInput): Attendance {
  requireRole(ctx, 'ADMIN');
  const staff = find(s.staff, input.staffId, 'Worker');
  let row = s.attendance.find((a) => a.staffId === staff.id && a.date === input.date);
  if (row?.payslipId) throw invalidState('This day is on a paid payslip. Cancel the payslip before editing it.');
  if (input.date > ctx.today) throw new AppError('VALIDATION', 'Attendance cannot be entered for a future date');
  const before = row ? { ...row } : undefined;
  const values = {
    status: input.status,
    paidHours: input.status === 'ABSENT' ? 0 : input.paidHours,
    rawMinutes: Math.round((input.status === 'ABSENT' ? 0 : input.paidHours) * 60),
    source: (row ? 'EDITED' : 'MANUAL') as Attendance['source'],
    editReason: input.reason,
  };
  if (row) Object.assign(row, values);
  else {
    row = { id: newId(s, 'att'), staffId: staff.id, date: input.date, ...values };
    s.attendance.push(row);
  }
  audit(ctx, 'attendance', row.id, before ? 'edit' : 'create', `Marked ${staff.name} ${input.status.toLowerCase()} on ${input.date}`, before, row);
  return row;
}

export interface DayRow {
  date: ISODate;
  status: Attendance['status'] | 'OFF' | 'UPCOMING';
  offDay: boolean;
  firstIn?: string;
  lastOut?: string;
  rawMinutes: number;
  paidHours: number;
  source?: Attendance['source'];
  edited: boolean;
  offDayWork: boolean;
  locked: boolean;
  attendanceId?: string;
  editReason?: string;
}

export interface AttendanceSummary {
  days: DayRow[];
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  paidHours: number;
  offDayWorkDays: number;
  attendanceIds: string[];
}

/** Attendance over a period. Working days with no row (and in the past) count as ABSENT. */
export function summarize(s: State, staffId: string, from: ISODate, to: ISODate, today: ISODate): AttendanceSummary {
  const cal = calendarOf(s);
  const rows = new Map(s.attendance.filter((a) => a.staffId === staffId && a.date >= from && a.date <= to).map((a) => [a.date, a]));
  const sum: AttendanceSummary = {
    days: [],
    presentDays: 0,
    halfDays: 0,
    absentDays: 0,
    leaveDays: 0,
    paidHours: 0,
    offDayWorkDays: 0,
    attendanceIds: [],
  };
  for (const d of eachDay(from, to)) {
    const off = isOffDay(d, cal);
    const r = rows.get(d);
    const worked = !!r && (r.status === 'PRESENT' || r.status === 'HALF');
    let status: DayRow['status'];
    if (r) status = r.status;
    else if (d > today) status = 'UPCOMING';
    else status = off ? 'OFF' : 'ABSENT';
    if (r) sum.attendanceIds.push(r.id);
    if (!off) {
      if (status === 'PRESENT') sum.presentDays++;
      else if (status === 'HALF') sum.halfDays++;
      else if (status === 'LEAVE') sum.leaveDays++;
      else if (status === 'ABSENT') sum.absentDays++;
    } else if (worked) sum.offDayWorkDays++;
    if (worked) sum.paidHours += r.paidHours;
    sum.days.push({
      date: d,
      status: off && !r ? 'OFF' : status,
      offDay: off,
      firstIn: r?.firstIn,
      lastOut: r?.lastOut,
      rawMinutes: r?.rawMinutes ?? 0,
      paidHours: worked ? r.paidHours : 0,
      source: r?.source,
      edited: r?.source === 'EDITED',
      offDayWork: off && worked,
      locked: !!r?.payslipId,
      attendanceId: r?.id,
      editReason: r?.editReason,
    });
  }
  sum.paidHours = Math.round(sum.paidHours * 100) / 100;
  return sum;
}

/** Live clock for the header widget: first login today and minutes so far. */
export function clockToday(s: State, staffId: string, nowIso: string, presence?: string) {
  const today = toISTDate(nowIso);
  const sessions = s.sessions.filter((x) => x.staffId === staffId && x.date === today);
  const minutes = sessions.reduce((a, x) => a + minutesBetween(x.loginAt, x.logoutAt ?? (presence && presence > nowIso ? presence : nowIso)), 0);
  const first = sessions.map((x) => x.loginAt).sort()[0] ?? null;
  return { clockedInAt: first, minutesToday: minutes, firstInMinute: first ? istMinuteOfDay(first) : null };
}
