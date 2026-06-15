// Enums
export enum AccountType {
    CHECKING = 'CHECKING',
    SAVINGS = 'SAVINGS'
}

export enum AccountStatus {
    ACTIVE = 'ACTIVE',
    FROZEN = 'FROZEN',
    CLOSED = 'CLOSED'
}

export enum TransactionType {
    DEPOSIT = 'DEPOSIT',
    WITHDRAWAL = 'WITHDRAWAL',
    TRANSFER = 'TRANSFER'
}

export enum TransactionStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    FLAGGED = 'FLAGGED'
}

export enum LedgerDirection {
    DEBIT = 'DEBIT',
    CREDIT = 'CREDIT'
}

// Interfaces
export interface User {
    id: string;
    email: string;
    password_hash: string;
    created_at: Date;
}

export interface Account {
    id: string;
    user_id: string;
    type: AccountType;
    status: AccountStatus;
    balance: bigint;
    version: bigint;
    created_at: Date;
    updated_at: Date;
}

export interface Transaction {
    id: string;
    from_account_id: string | null;
    to_account_id: string | null;
    type: TransactionType;
    status: TransactionStatus;
    amount: bigint;
    idempotency_key: string;
    created_at: Date;
}

export interface LedgerEntry {
    id: string;
    transaction_id: string;
    account_id: string;
    direction: LedgerDirection;
    amount: bigint;
    balance_after: bigint;
    created_at: Date;
}

// Shape Interfaces (Request DTOs — define the exact shape of data expected from the client)
export interface CreateAccountRequest {
  user_id: string;
  type: AccountType;
}

export interface DepositRequest {
  amount: number; // validated and converted to bigint in service layer
  idempotency_key: string;
}

export interface DepositResult {
  transaction: Transaction;
  balance_after: bigint;
}

export interface WithdrawalRequest {
  amount: number;
  idempotency_key: string;
}

export interface WithdrawalResult {
  transaction: Transaction;
  balance_after: bigint;
}

export interface TransferRequest {
  from_account_id: string;
  to_account_id: string;
  amount: number;
  idempotency_key: string;
}

export interface TransferResult {
  transaction: Transaction;
  from_balance_after: bigint;
  to_balance_after: bigint;
}

//Error Enum
export enum ErrorCode {
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  ACCOUNT_FROZEN = 'ACCOUNT_FROZEN',
  ACCOUNT_CLOSED = 'ACCOUNT_CLOSED',
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  INVALID_AMOUNT = 'INVALID_AMOUNT',
  SAME_ACCOUNT_TRANSFER = 'SAME_ACCOUNT_TRANSFER',
  DUPLICATE_IDEMPOTENCY_KEY = 'DUPLICATE_IDEMPOTENCY_KEY',
  MISSING_IDEMPOTENCY_KEY = 'MISSING_IDEMPOTENCY_KEY',
  INVALID_IDEMPOTENCY_KEY = 'INVALID_IDEMPOTENCY_KEY',
  TRANSACTION_NOT_FOUND = 'TRANSACTION_NOT_FOUND',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}