import { withTransaction } from '../pool';
import { Transaction, TransactionType, TransactionStatus, DepositResult, WithdrawalResult, TransferResult } from '../types';
import { assertAccountActive } from './accountService';
import { Errors } from '../utils/errors';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../pool';

/**
 * Transfer Service
 * 
 * Handles all money movement — deposits, withdrawals, and transfers.
 * Every operation is atomic (wrapped in withTransaction), idempotent 
 * (checks idempotency key first), and writes double-entry ledger entries.
 * 
 * Transfer specifically uses SELECT FOR UPDATE with ascending lock order
 * to prevent race conditions and deadlocks on concurrent transfers.
 */

// Converts a raw pg row into a typed Transaction object.
// pg returns BIGINT as strings — convert amount to bigint explicitly.
function rowToTransaction(row: Record<string, unknown>): Transaction {
  return {
    id: row.id as string,
    idempotency_key: row.idempotency_key as string,
    from_account_id: row.from_account_id as string | null,
    to_account_id: row.to_account_id as string | null,
    amount: BigInt(row.amount as string),
    type: row.type as TransactionType,
    status: row.status as TransactionStatus,
    created_at: row.created_at as Date,
  };
}

export async function deposit(params: {
  accountId: string;
  amount: bigint;
  idempotencyKey: string;
}): Promise<DepositResult> {
  return withTransaction(async (client) => {
    // 1. Idempotency check — return cached result if already processed
    const existing = await client.query(
      'SELECT * FROM transactions WHERE idempotency_key = $1',
      [params.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      const tx = rowToTransaction(existing.rows[0]);
      const ledger = await client.query(
        `SELECT balance_after FROM ledger_entries 
         WHERE transaction_id = $1 AND direction = 'CREDIT'`,
        [tx.id]
      );
      return {
        transaction: tx,
        balance_after: BigInt(ledger.rows[0].balance_after),
      };
    }

    // 2. Lock the account row — no other transaction can read/write until we commit
    const accountResult = await client.query(
      'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
      [params.accountId]
    );
    if (accountResult.rows.length === 0) {
      throw Errors.accountNotFound(params.accountId);
    }
    const account = accountResult.rows[0];

    // 3. Assert account is ACTIVE — reject frozen/closed before touching balance
    assertAccountActive({
      ...account,
      balance: BigInt(account.balance),
      version: BigInt(account.version),
    });

    // 4. Insert transaction as PENDING — recorded before balance changes
    //    If server crashes mid-operation, the PENDING record signals incomplete work
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions 
         (id, idempotency_key, to_account_id, amount, type, status)
       VALUES ($1, $2, $3, $4, 'DEPOSIT', 'PENDING')`,
      [txId, params.idempotencyKey, params.accountId, params.amount.toString()]
    );

    // 5. Compute new balance and update account
    //    Read balance from the locked row — never from cache
    const currentBalance = BigInt(account.balance);
    const newBalance = currentBalance + params.amount;
    await client.query(
      'UPDATE accounts SET balance = $1, version = version + 1 WHERE id = $2',
      [newBalance.toString(), params.accountId]
    );

    // 6. Write CREDIT ledger entry with balance_after snapshot
    await client.query(
      `INSERT INTO ledger_entries 
         (id, transaction_id, account_id, direction, amount, balance_after)
       VALUES ($1, $2, $3, 'CREDIT', $4, $5)`,
      [uuidv4(), txId, params.accountId, params.amount.toString(), newBalance.toString()]
    );

    // 7. Mark transaction COMPLETED — only after all operations succeed
    const txResult = await client.query(
      'UPDATE transactions SET status = $1 WHERE id = $2 RETURNING *',
      ['COMPLETED', txId]
    );

    return {
      transaction: rowToTransaction(txResult.rows[0]),
      balance_after: newBalance,
    };
  });
}

export async function withdrawal(params: {
  accountId: string;
  amount: bigint;
  idempotencyKey: string;
}): Promise<WithdrawalResult> {
  return withTransaction(async (client) => {
    // 1. Idempotency check
    const existing = await client.query(
      'SELECT * FROM transactions WHERE idempotency_key = $1',
      [params.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      const tx = rowToTransaction(existing.rows[0]);
      const ledger = await client.query(
        `SELECT balance_after FROM ledger_entries 
         WHERE transaction_id = $1 AND direction = 'DEBIT'`,
        [tx.id]
      );
      return {
        transaction: tx,
        balance_after: BigInt(ledger.rows[0].balance_after),
      };
    }

    // 2. Lock the account row
    const accountResult = await client.query(
      'SELECT * FROM accounts WHERE id = $1 FOR UPDATE',
      [params.accountId]
    );
    if (accountResult.rows.length === 0) {
      throw Errors.accountNotFound(params.accountId);
    }
    const account = accountResult.rows[0];

    // 3. Assert account is ACTIVE
    assertAccountActive({
      ...account,
      balance: BigInt(account.balance),
      version: BigInt(account.version),
    });

    // 4. Funds check — MUST happen after lock
    //    Checking before lock allows two concurrent withdrawals to both see sufficient funds
    const balance = BigInt(account.balance);
    if (params.amount > balance) {
      throw Errors.insufficientFunds(balance, params.amount);
    }

    // 5. Insert transaction as PENDING
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions 
         (id, idempotency_key, from_account_id, amount, type, status)
       VALUES ($1, $2, $3, $4, 'WITHDRAWAL', 'PENDING')`,
      [txId, params.idempotencyKey, params.accountId, params.amount.toString()]
    );

    // 6. Compute new balance and update account
    const currentBalance = BigInt(account.balance);
    const newBalance = currentBalance - params.amount;
    await client.query(
      'UPDATE accounts SET balance = $1, version = version + 1 WHERE id = $2',
      [newBalance.toString(), params.accountId]
    );

    // 7. Write DEBIT ledger entry
    await client.query(
      `INSERT INTO ledger_entries 
         (id, transaction_id, account_id, direction, amount, balance_after)
       VALUES ($1, $2, $3, 'DEBIT', $4, $5)`,
      [uuidv4(), txId, params.accountId, params.amount.toString(), newBalance.toString()]
    );

    // 8. Mark transaction COMPLETED
    const txResult = await client.query(
      'UPDATE transactions SET status = $1 WHERE id = $2 RETURNING *',
      ['COMPLETED', txId]
    );

    return {
      transaction: rowToTransaction(txResult.rows[0]),
      balance_after: newBalance,
    };
  });
}

export async function transfer(params: {
  fromAccountId: string;
  toAccountId: string;
  amount: bigint;
  idempotencyKey: string;
}): Promise<TransferResult> {
  // Reject before opening a transaction — no DB needed for this check
  if (params.fromAccountId === params.toAccountId) {
    throw Errors.sameAccountTransfer();
  }

  return withTransaction(async (client) => {
    // 1. Idempotency check
    const existing = await client.query(
      'SELECT * FROM transactions WHERE idempotency_key = $1',
      [params.idempotencyKey]
    );
    if (existing.rows.length > 0) {
      const tx = rowToTransaction(existing.rows[0]);
      const ledger = await client.query(
        `SELECT account_id, direction, balance_after FROM ledger_entries 
         WHERE transaction_id = $1`,
        [tx.id]
      );
      const debitEntry = ledger.rows.find((r: any) => r.direction === 'DEBIT');
      const creditEntry = ledger.rows.find((r: any) => r.direction === 'CREDIT');
      return {
        transaction: tx,
        from_balance_after: BigInt(debitEntry.balance_after),
        to_balance_after: BigInt(creditEntry.balance_after),
      };
    }

    // 2. Lock both accounts in ascending id order — deadlock prevention
    //    ORDER BY id ensures all transfers always compete for the same lock first
    const accountsResult = await client.query(
      'SELECT * FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
      [params.fromAccountId, params.toAccountId]
    );

    if (accountsResult.rows.length !== 2) {
      const foundIds = accountsResult.rows.map((r: any) => r.id);
      const missingId = [params.fromAccountId, params.toAccountId].find(
        id => !foundIds.includes(id)
      );
      throw Errors.accountNotFound(missingId!);
    }

    const fromAccount = accountsResult.rows.find((r: any) => r.id === params.fromAccountId);
    const toAccount = accountsResult.rows.find((r: any) => r.id === params.toAccountId);

    // 3. Assert both accounts are ACTIVE
    assertAccountActive({
      ...fromAccount,
      balance: BigInt(fromAccount.balance),
      version: BigInt(fromAccount.version),
    });
    assertAccountActive({
      ...toAccount,
      balance: BigInt(toAccount.balance),
      version: BigInt(toAccount.version),
    });

    // 4. Funds check on sender only — after lock
    const fromBalance = BigInt(fromAccount.balance);
    if (params.amount > fromBalance) {
      throw Errors.insufficientFunds(fromBalance, params.amount);
    }

    // 5. Insert transaction as PENDING
    const txId = uuidv4();
    await client.query(
      `INSERT INTO transactions 
         (id, idempotency_key, from_account_id, to_account_id, amount, type, status)
       VALUES ($1, $2, $3, $4, $5, 'TRANSFER', 'PENDING')`,
      [txId, params.idempotencyKey, params.fromAccountId, params.toAccountId, params.amount.toString()]
    );

    // 6. Compute and apply both balance updates
    const fromNewBalance = fromBalance - params.amount;
    const toNewBalance = BigInt(toAccount.balance) + params.amount;

    await client.query(
      'UPDATE accounts SET balance = $1, version = version + 1 WHERE id = $2',
      [fromNewBalance.toString(), params.fromAccountId]
    );
    await client.query(
      'UPDATE accounts SET balance = $1, version = version + 1 WHERE id = $2',
      [toNewBalance.toString(), params.toAccountId]
    );

    // 7. Write DEBIT ledger entry for sender
    await client.query(
      `INSERT INTO ledger_entries 
         (id, transaction_id, account_id, direction, amount, balance_after)
       VALUES ($1, $2, $3, 'DEBIT', $4, $5)`,
      [uuidv4(), txId, params.fromAccountId, params.amount.toString(), fromNewBalance.toString()]
    );

    // 8. Write CREDIT ledger entry for receiver
    await client.query(
      `INSERT INTO ledger_entries 
         (id, transaction_id, account_id, direction, amount, balance_after)
       VALUES ($1, $2, $3, 'CREDIT', $4, $5)`,
      [uuidv4(), txId, params.toAccountId, params.amount.toString(), toNewBalance.toString()]
    );

    // 9. Mark transaction COMPLETED
    const txResult = await client.query(
      'UPDATE transactions SET status = $1 WHERE id = $2 RETURNING *',
      ['COMPLETED', txId]
    );

    return {
      transaction: rowToTransaction(txResult.rows[0]),
      from_balance_after: fromNewBalance,
      to_balance_after: toNewBalance,
    };
  });
}

// Fetch a transaction by ID. Throws TRANSACTION_NOT_FOUND if missing.
// Used by GET /transfers/:id to poll transfer status.
export async function getTransaction(id: string): Promise<Transaction> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM transactions WHERE id = $1',
    [id]
  );
  if (rows.length === 0) {
    throw Errors.transactionNotFound(id);
  }
  return rowToTransaction(rows[0]);
}