import type { CompanyBranding, PublicUser } from './types.js';

/** Response envelope types shared by the server and the typed web client. */

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface ListResponse<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface MeResponse {
  user: PublicUser;
  branding: CompanyBranding;
  staff?: { id: string; name: string; payType: string };
  clock?: { clockedInAt: string | null; minutesToday: number };
  idleTimeoutMinutes: number;
}

export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'STALE',
  'RATE_LIMITED',
  'LOCKED',
  'INSUFFICIENT_STOCK',
  'LIMIT_REACHED',
  'INVALID_STATE',
  'STORE_FULL',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
