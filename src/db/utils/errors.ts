import { ErrorCode } from '../types';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode: number) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor); //points to where error was actualy thrown
  }
}

export const Errors = {
  accountNotFound: (id: string) => new AppError(ErrorCode.ACCOUNT_NOT_FOUND, `Account Not Found: ${id}`, 404),
  accountFrozen: (id: string) => new AppError(ErrorCode.ACCOUNT_FROZEN, `Account Is Frozen: ${id}`, 422),
  accountClosed: (id: string) => new AppError(ErrorCode.ACCOUNT_CLOSED, `Account Is Closed: ${id}`, 422),
  insufficientFunds: (available: bigint, requested: bigint) => new AppError(ErrorCode.INSUFFICIENT_FUNDS, `Insufficient Funds: \nAvailable: ${available}\nRequested: ${requested}`, 422),
  invalidAmount: () => new AppError(ErrorCode.INVALID_AMOUNT, 'Invalid Amount', 400),
  sameAccountTransfer: () => new AppError(ErrorCode.SAME_ACCOUNT_TRANSFER, `Can't Transfer To Same Account`, 400),
  duplicateIdempotencyKey: (key: string) => new AppError(ErrorCode.DUPLICATE_IDEMPOTENCY_KEY, `Duplicate Idempotency Key: ${key}`, 409),
  missingIdempotencyKey: () => new AppError(ErrorCode.MISSING_IDEMPOTENCY_KEY, `Missing Idempotency Key`, 400),
  invalidIdempotencyKey: () => new AppError(ErrorCode.INVALID_IDEMPOTENCY_KEY, `Invalid Idempotency Key`, 400),
  transactionNotFound: (id: string) => new AppError(ErrorCode.TRANSACTION_NOT_FOUND, `Transaction Not Found: ${id}`, 404),
  internal: (msg: string) => new AppError(ErrorCode.INTERNAL_ERROR, msg, 500),
};