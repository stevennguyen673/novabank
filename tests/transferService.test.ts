import { transfer } from '../src/services/transferService';
import { withTransaction } from '../src/db/pool';

// Tell Jest to replace the real pool module with a fake version
// so no real DB connections are made during tests
jest.mock('../src/db/pool');

// Fake database client — instead of real Postgres, query() is a Jest mock
// function we can control and tell what to return for each call
const mockClient = {
    query: jest.fn(),
};

// Whenever withTransaction is called, skip the real DB and just run
// the callback with our fake client instead
jest.mocked(withTransaction).mockImplementation(async (callback) => {
    return callback(mockClient as any);
});

// Reset all mock state before each test so previous test results
// don't bleed into the next one
beforeEach(() => {
    jest.clearAllMocks();
});

// ─── Fake Data ───────────────────────────────────────────────────────────────
// These objects mimic exactly what Postgres would return as raw rows.
// pg returns BIGINT columns as strings — so balance and version are strings here.

const fromAccount = {
    id: 'uuid-1',
    user_id: 'user-1',
    type: 'CHECKING',
    status: 'ACTIVE',
    balance: '10000',  // $100.00 in cents
    version: '0',
    created_at: new Date(),
    updated_at: new Date(),
};

const toAccount = {
    id: 'uuid-2',
    user_id: 'user-2',
    type: 'CHECKING',
    status: 'ACTIVE',
    balance: '50000',  // $500.00 in cents
    version: '1',
    created_at: new Date(),
    updated_at: new Date(),
};

const frozenAccount = {
    ...fromAccount,
    status: 'FROZEN',
};

const closedAccount = {
    ...toAccount,
    status: 'CLOSED',
};

const completedTransaction = {
    id: 'tx-uuid-1',
    idempotency_key: 'idempotency-uuid-1',
    from_account_id: 'uuid-1',
    to_account_id: 'uuid-2',
    amount: '1000',  // $10.00 in cents
    type: 'TRANSFER',
    status: 'COMPLETED',
    created_at: new Date(),
};

// Tests 

test('successfully transfers between two accounts', async () => {
    // mockResolvedValueOnce sets what query() returns for each call in order.
    // Each call to client.query() inside transfer() consumes the next value in the chain.
    mockClient.query
        .mockResolvedValueOnce({ rows: [] })                        // 1. idempotency check — no existing transaction
        .mockResolvedValueOnce({ rows: [fromAccount, toAccount] })  // 2. lock both accounts
        .mockResolvedValueOnce({ rows: [] })                        // 3. insert transaction as PENDING
        .mockResolvedValueOnce({ rows: [] })                        // 4. update from account balance
        .mockResolvedValueOnce({ rows: [] })                        // 5. update to account balance
        .mockResolvedValueOnce({ rows: [] })                        // 6. insert debit ledger entry
        .mockResolvedValueOnce({ rows: [] })                        // 7. insert credit ledger entry
        .mockResolvedValueOnce({ rows: [completedTransaction] });   // 8. mark transaction COMPLETED

    const result = await transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-2',
        amount: BigInt(1000),
        idempotencyKey: 'idempotency-uuid-1',
    });

    expect(result.transaction.status).toBe('COMPLETED');
    expect(result.from_balance_after).toBe(BigInt(9000));   // 10000 - 1000
    expect(result.to_balance_after).toBe(BigInt(51000));    // 50000 + 1000
});

test('throws on insufficient funds', async () => {
    mockClient.query
        .mockResolvedValueOnce({ rows: [] })                        // 1. idempotency check
        .mockResolvedValueOnce({ rows: [fromAccount, toAccount] }); // 2. lock both accounts
        // throws before any further queries

    await expect(transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-2',
        amount: BigInt(1000000),  // more than fromAccount's balance of 10000
        idempotencyKey: 'idempotency-uuid-1',
    })).rejects.toThrow();
});

test('throws when transferring to the same account', async () => {
    // sameAccountTransfer check happens before any DB queries
    await expect(transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-1',
        amount: BigInt(1000),
        idempotencyKey: 'idempotency-uuid-1',
    })).rejects.toThrow();
});

test('returns cached result on duplicate idempotency key', async () => {
    mockClient.query
        .mockResolvedValueOnce({ rows: [completedTransaction] })    // 1. idempotency check — already processed
        .mockResolvedValueOnce({ rows: [                            // 2. fetch ledger entries for cached balances
            { direction: 'DEBIT', balance_after: '9000' },
            { direction: 'CREDIT', balance_after: '51000' },
        ] });

    const result = await transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-2',
        amount: BigInt(1000),
        idempotencyKey: 'idempotency-uuid-1',
    });

    // should return the original result, not process again
    expect(result.transaction.status).toBe('COMPLETED');
    expect(result.from_balance_after).toBe(BigInt(9000));
    expect(result.to_balance_after).toBe(BigInt(51000));
});

test('throws when account is not found', async () => {
    mockClient.query
        .mockResolvedValueOnce({ rows: [] })         // 1. idempotency check
        .mockResolvedValueOnce({ rows: [fromAccount] }); // 2. only one account returned — toAccount missing

    await expect(transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-999',  // non-existent
        amount: BigInt(1000),
        idempotencyKey: 'idempotency-uuid-1',
    })).rejects.toThrow();
});

test('throws when from account is frozen', async () => {
    mockClient.query
        .mockResolvedValueOnce({ rows: [] })                          // 1. idempotency check
        .mockResolvedValueOnce({ rows: [frozenAccount, toAccount] }); // 2. lock both accounts

    await expect(transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-2',
        amount: BigInt(1000),
        idempotencyKey: 'idempotency-uuid-1',
    })).rejects.toThrow();
});

test('throws when to account is closed', async () => {
    mockClient.query
        .mockResolvedValueOnce({ rows: [] })                          // 1. idempotency check
        .mockResolvedValueOnce({ rows: [fromAccount, closedAccount] }); // 2. lock both accounts

    await expect(transfer({
        fromAccountId: 'uuid-1',
        toAccountId: 'uuid-2',
        amount: BigInt(1000),
        idempotencyKey: 'idempotency-uuid-1',
    })).rejects.toThrow();
});