import { describe, expect, it } from 'vitest';
import { istTimestamp } from '@app/contract';
import { makeCtx } from '../../server/src/ctx.js';
import { loginFailed, loginGate } from '../../server/src/middleware/ratelimit.js';
import { closeSessions, startSession, summarize, sweepSessions } from '../../server/src/services/attendance.js';
import { emptyState } from '../../server/src/state.js';
import { MemoryStore } from '../../server/src/store/index.js';
import type { Staff } from '@app/contract';

describe('login lockout', () => {
  it('locks for 15 minutes after 10 failures', async () => {
    const s = new MemoryStore();
    const t0 = Date.UTC(2026, 10, 12, 4, 0, 0);
    for (let i = 0; i < 10; i++) await loginFailed(s, 'someone', t0 + i * 15000);
    await expect(loginGate(s, 'someone', 5, t0 + 200000)).rejects.toMatchObject({ code: 'LOCKED' });
    await expect(loginGate(s, 'someone', 5, t0 + 150000 + 15 * 60000 + 1000)).resolves.toBeUndefined();
  });
});

function setup() {
  const s = emptyState('2026-11-12', '2026-11-12T00:00:00Z', 1);
  const staff: Staff = { id: 'w1', code: 'W001', name: 'Worker A', phone: '', payType: 'HOURLY', hourlyRate: 9000, reduceByAbsence: false, joinDate: '2026-01-01', active: true };
  s.staff.push(staff);
  const actor = { id: 'u1', name: 'Worker A', role: 'STAFF' as const, staffId: 'w1' };
  const at = (date: string, min: number) => makeCtx(actor, { now: istTimestamp(date, min) });
  return { s, staff, at };
}

describe('attendance automation', () => {
  it('login creates PRESENT, two sessions add up and round to the nearest hour', () => {
    const { s, staff, at } = setup();
    startSession(s, at('2026-11-10', 540), staff);
    closeSessions(s, 'w1', istTimestamp('2026-11-10', 610), 'LOGOUT');
    startSession(s, at('2026-11-10', 700), staff);
    closeSessions(s, 'w1', istTimestamp('2026-11-10', 740), 'LOGOUT');
    const row = s.attendance.find((a) => a.date === '2026-11-10')!;
    expect(row.status).toBe('PRESENT');
    expect(row.rawMinutes).toBe(110);
    expect(row.paidHours).toBe(2);
  });

  it('idle timeout closes at the last heartbeat so idle time is not paid', () => {
    const { s, staff, at } = setup();
    startSession(s, at('2026-11-12', 540), staff);
    const presence = { w1: istTimestamp('2026-11-12', 600) };
    sweepSessions(s, istTimestamp('2026-11-12', 640), presence);
    const sess = s.sessions[0]!;
    expect(sess.endReason).toBe('IDLE_TIMEOUT');
    expect(sess.logoutAt).toBe(presence.w1);
    expect(s.attendance[0]!.paidHours).toBe(1);
  });

  it('a session still open from an earlier day is auto-closed at its last heartbeat', () => {
    const { s, staff, at } = setup();
    startSession(s, at('2026-11-11', 540), staff);
    sweepSessions(s, istTimestamp('2026-11-12', 5), { w1: istTimestamp('2026-11-11', 1000) });
    expect(s.sessions[0]!.endReason).toBe('AUTO_CLOSE');
    expect(s.attendance[0]!.rawMinutes).toBe(460);
  });

  it('no login on a working day counts as ABSENT; Sundays are off', () => {
    const { s } = setup();
    s.settings.weeklyOffs = [0];
    const sum = summarize(s, 'w1', '2026-11-08', '2026-11-11', '2026-11-12');
    expect(sum.days[0]!.status).toBe('OFF');
    expect(sum.absentDays).toBe(3);
  });
});
