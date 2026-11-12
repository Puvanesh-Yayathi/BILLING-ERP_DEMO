import { jwtVerify, SignJWT } from 'jose';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Role } from '@app/contract';
import { config } from '../config.js';
import type { Actor } from '../ctx.js';
import type { State } from '../state.js';

export const COOKIE = 'session';
const TTL_SECONDS = 30 * 60;

export interface SessionClaims {
  sub: string;
  tv: number;
  role: Role;
  iat: number;
}

export async function issueSession(c: Context, userId: string, tokenVersion: number, role: Role): Promise<void> {
  const token = await new SignJWT({ tv: tokenVersion, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(config().jwtSecret);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: config().secureCookies,
    sameSite: 'Strict',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function readSession(c: Context): Promise<SessionClaims | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, config().jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number' || typeof payload.iat !== 'number') return null;
    return { sub: payload.sub, tv: payload.tv, role: payload.role as Role, iat: payload.iat };
  } catch {
    return null;
  }
}

/** The session is valid only while the user is active and the token version matches (password reset signs out everywhere). */
export function actorFromState(s: State, claims: SessionClaims): Actor | null {
  const u = s.users.find((x) => x.id === claims.sub);
  if (!u || !u.active || u.tokenVersion !== claims.tv) return null;
  return { id: u.id, name: u.name, role: u.role, staffId: u.staffId, customerId: u.customerId };
}

/** Sliding expiry: re-issue the cookie when it is more than a minute old. */
export function shouldRefresh(claims: SessionClaims): boolean {
  return Date.now() / 1000 - claims.iat > 60;
}
