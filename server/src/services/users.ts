import bcrypt from 'bcryptjs';
import {
  WORKER_ROLES,
  type PublicUser,
  type Staff,
  type User,
  type UserCreateInput,
  type UserUpdateInput,
  type WorkerCreateInput,
  type WorkerUpdateInput,
} from '@app/contract';
import { audit, emit, newId, type Ctx } from '../ctx.js';
import { AppError, validation } from '../errors.js';
import type { State } from '../state.js';
import { closeSessions } from './attendance.js';
import { find, requireRole } from './util.js';

export function publicUser(u: User): PublicUser {
  const { passwordHash: _p, tokenVersion: _t, ...rest } = u;
  return rest;
}

/** Passwords are hashed outside the transaction (bcrypt is slow). */
export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function activeWorkerLogins(s: State): number {
  return s.users.filter((u) => u.active && WORKER_ROLES.includes(u.role)).length;
}

function assertLoginFree(s: State, username: string, exceptId?: string) {
  if (s.users.some((u) => u.username.toLowerCase() === username.toLowerCase() && u.id !== exceptId))
    throw validation('This login ID is already taken', { loginId: 'This login ID is already taken' });
}

function assertCap(s: State) {
  const max = s.settings.maxWorkerLogins;
  if (activeWorkerLogins(s) >= max)
    throw new AppError('LIMIT_REACHED', `Limit of ${max} worker logins reached. Ask your administrator to raise the limit.`);
}

function payFields(i: WorkerCreateInput | WorkerUpdateInput) {
  return {
    payType: i.payType,
    basePay: i.payType === 'FIXED' ? i.basePay : undefined,
    hourlyRate: i.payType === 'HOURLY' ? i.hourlyRate : undefined,
    sharePercent: i.payType === 'SHARE' ? i.sharePercent : undefined,
    reduceByAbsence: i.payType === 'SHARE' ? i.reduceByAbsence : false,
  };
}

function assertSharesTotal(s: State, staffId: string | undefined, pct: number | undefined) {
  const total = s.staff
    .filter((x) => x.active && x.payType === 'SHARE' && x.id !== staffId)
    .reduce((a, x) => a + (x.sharePercent ?? 0), 0);
  if (total + (pct ?? 0) > 100)
    throw validation('Share percentages across all workers must total 100% or less', {
      sharePercent: `Other workers already have ${total}%`,
    });
}

export function createWorker(s: State, ctx: Ctx, i: WorkerCreateInput, passwordHash?: string) {
  requireRole(ctx, 'ADMIN');
  if (i.payType === 'SHARE') assertSharesTotal(s, undefined, i.sharePercent);
  const staffId = newId(s, 'stf');
  const code = `W${String(s.staff.length + 1).padStart(3, '0')}`;
  let user: User | undefined;
  if (i.withLogin && i.loginId && passwordHash && i.role) {
    assertLoginFree(s, i.loginId);
    assertCap(s);
    user = {
      id: newId(s, 'usr'),
      username: i.loginId.toLowerCase(),
      passwordHash,
      name: i.name,
      role: i.role,
      staffId,
      active: true,
      tokenVersion: 1,
      createdAt: ctx.now,
    };
    s.users.push(user);
  }
  const staff: Staff = {
    id: staffId,
    code,
    name: i.name,
    phone: i.phone,
    userId: user?.id,
    ...payFields(i),
    joinDate: i.joinDate,
    active: true,
  };
  s.staff.push(staff);
  audit(ctx, 'worker', staff.id, 'create', `Added worker ${staff.name}${user ? ` with login ${user.username}` : ''}`, undefined, { staff, user: user && publicUser(user) });
  emit(ctx, 'worker.create', 'worker', staff.id, `Admin added worker ${staff.name}`);
  return { staff, user: user && publicUser(user) };
}

export function updateWorker(s: State, ctx: Ctx, id: string, i: WorkerUpdateInput) {
  requireRole(ctx, 'ADMIN');
  const staff = find(s.staff, id, 'Worker');
  if (i.payType === 'SHARE') assertSharesTotal(s, staff.id, i.sharePercent);
  const before = { ...staff };
  const user = staff.userId ? s.users.find((u) => u.id === staff.userId) : undefined;
  if (user) {
    if (i.active && !user.active) assertCap(s);
    if (i.role && i.role !== user.role) user.role = i.role;
    user.name = i.name;
    if (user.active !== i.active) {
      user.active = i.active;
      user.tokenVersion++;
      if (!i.active) closeSessions(s, staff.id, ctx.now, 'MANUAL');
    }
  }
  Object.assign(staff, { name: i.name, phone: i.phone, active: i.active, ...payFields(i) });
  audit(ctx, 'worker', staff.id, 'update', `Updated worker ${staff.name}`, before, staff);
  return staff;
}

export function deactivateWorker(s: State, ctx: Ctx, id: string) {
  requireRole(ctx, 'ADMIN');
  const staff = find(s.staff, id, 'Worker');
  const before = { ...staff };
  staff.active = false;
  const user = staff.userId ? s.users.find((u) => u.id === staff.userId) : undefined;
  if (user) {
    user.active = false;
    user.tokenVersion++;
    closeSessions(s, staff.id, ctx.now, 'MANUAL');
  }
  audit(ctx, 'worker', staff.id, 'deactivate', `Deactivated worker ${staff.name}`, before, staff);
  return staff;
}

/** Only Admin sets passwords. Bumping tokenVersion signs the user out everywhere. */
export function resetPassword(s: State, ctx: Ctx, userId: string, passwordHash: string) {
  requireRole(ctx, 'ADMIN');
  const user = find(s.users, userId, 'User');
  user.passwordHash = passwordHash;
  user.tokenVersion++;
  if (user.staffId) closeSessions(s, user.staffId, ctx.now, 'MANUAL');
  audit(ctx, 'user', user.id, 'reset-password', `Reset the password of ${user.username}`);
  return publicUser(user);
}

export function createUser(s: State, ctx: Ctx, i: UserCreateInput, passwordHash: string) {
  requireRole(ctx, 'ADMIN');
  assertLoginFree(s, i.username);
  if (i.role === 'DISTRIBUTOR') {
    const c = find(s.customers, i.customerId, 'Distributor');
    if (c.type !== 'DISTRIBUTOR') throw validation('Link the account to a distributor', { customerId: 'Choose a distributor' });
  }
  const user: User = {
    id: newId(s, 'usr'),
    username: i.username.toLowerCase(),
    passwordHash,
    name: i.name,
    role: i.role,
    customerId: i.role === 'DISTRIBUTOR' ? i.customerId : undefined,
    active: true,
    tokenVersion: 1,
    createdAt: ctx.now,
  };
  s.users.push(user);
  audit(ctx, 'user', user.id, 'create', `Created ${user.role.toLowerCase()} account ${user.username}`, undefined, publicUser(user));
  return publicUser(user);
}

export function updateUser(s: State, ctx: Ctx, id: string, i: UserUpdateInput, passwordHash?: string) {
  requireRole(ctx, 'ADMIN');
  const user = find(s.users, id, 'User');
  if (WORKER_ROLES.includes(user.role)) throw validation('Edit worker accounts from Workers and logins');
  if (user.id === ctx.actor.id && !i.active) throw validation('You cannot deactivate your own account');
  const before = publicUser(user);
  user.name = i.name;
  if (user.active !== i.active) {
    user.active = i.active;
    user.tokenVersion++;
  }
  if (passwordHash) {
    user.passwordHash = passwordHash;
    if (user.id !== ctx.actor.id) user.tokenVersion++;
  }
  audit(ctx, 'user', user.id, 'update', `Updated account ${user.username}`, before, publicUser(user));
  return publicUser(user);
}
