import type { ErrorCode } from '@app/contract';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE: 409,
  RATE_LIMITED: 429,
  LOCKED: 429,
  INSUFFICIENT_STOCK: 409,
  LIMIT_REACHED: 409,
  INVALID_STATE: 409,
  STORE_FULL: 507,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Record') => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (msg = 'You do not have access to this action') => new AppError('FORBIDDEN', msg);
export const invalidState = (msg: string) => new AppError('INVALID_STATE', msg);
export const validation = (msg: string, details?: unknown) => new AppError('VALIDATION', msg, details);
