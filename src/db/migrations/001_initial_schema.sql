CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- accounts table
CREATE TYPE account_type AS ENUM ('CHECKING', 'SAVINGS');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ,
    type account_type NOT NULL,
    status account_status NOT NULL,
    balance BIGINT DEFAULT 0 NOT NULL CHECK (balance >= 0),
    version BIGINT DEFAULT 0 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_user_id ON accounts (user_id);

-- transactions table
CREATE TYPE transaction_type AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER');
CREATE TYPE transaction_status AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'FLAGGED');

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account_id UUID REFERENCES accounts(id),
    to_account_id UUID REFERENCES accounts(id),
    type transaction_type NOT NULL,
    status transaction_status NOT NULL DEFAULT 'PENDING',
    amount BIGINT NOT NULL CHECK(amount > 0),
    idempotency_key VARCHAR(36) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transactions_from_account ON transactions (from_account_id);
CREATE INDEX idx_transactions_to_account ON transactions (to_account_id);
CREATE INDEX idx_transactions_idempotency_key ON transactions (idempotency_key);

-- ledgers table
CREATE TYPE ledger_direction AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    direction ledger_direction NOT NULL,
    amount BIGINT NOT NULL CHECK(amount > 0),
    balance_after BIGINT NOT NULL CHECK(balance_after >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ledger_entries_account_id ON ledger_entries (account_id);
CREATE INDEX idx_ledger_entries_transaction_id ON ledger_entries (transaction_id);


-- auto updates accounts.updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();