import { query } from '../pool';
import { Account, AccountType, AccountStatus, CreateAccountRequest } from '../types';
import { Errors } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';

/**
 * Account Service
 * 
 * Handles all account-related business logic — creating accounts, fetching them,
 * and checking whether an account is allowed to have money move through it.
 * Called by the Transfer Service and the API route handlers.
 */

// Converts a raw pg row (all unknown types) into a typed Account object.
// pg returns BIGINT columns as strings — we convert balance and version to bigint here.
function rowToAccount(row: Record<string, unknown>): Account {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    type: row.type as AccountType,
    status: row.status as AccountStatus,
    balance: BigInt(row.balance as string),
    version: BigInt(row.version as string),
    created_at: row.created_at as Date,
    updated_at: row.updated_at as Date,
  };
}

// gets account by id, throws ACCOUNT_NOT_FOUND if it doesn't exist
export async function getAccount(id: string): Promise<Account> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM accounts WHERE id = $1',
    [id]
  );

  if (rows.length === 0) {
    throw Errors.accountNotFound(id);
  }

  return rowToAccount(rows[0]);
}

// Inserts a new account row. Status defaults to ACTIVE, balance to 0.
export async function createAccount(req: CreateAccountRequest): Promise<Account> {
  const rows = await query<Record<string, unknown>>(
    `INSERT INTO accounts (id, user_id, type, status, balance, version) 
     VALUES ($1, $2, $3, 'ACTIVE', 0, 0) 
     RETURNING *`,
    [uuidv4(), req.user_id, req.type]
  );

  return rowToAccount(rows[0]);
}

// Guard function — throws if the account is not ACTIVE.
// Called before any money movement so frozen/closed accounts are rejected early.
export function assertAccountActive(account: Account): void {
  if (account.status === AccountStatus.FROZEN) {
    throw Errors.accountFrozen(account.id);
  } else if (account.status === AccountStatus.CLOSED) {
    throw Errors.accountClosed(account.id);
  }
}

// Gets all transactions for an account — both sent and received, newest first.
export async function getAccountTransactions(accountId: string): Promise<Record<string, unknown>[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM transactions 
     WHERE from_account_id = $1 OR to_account_id = $1 
     ORDER BY created_at DESC`,
    [accountId]
  );

  return rows;
}