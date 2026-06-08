import { Pool, PoolClient } from 'pg';

/**
 * DB Connection Pool
 * 
 * Instead of opening a new database connection on every request (expensive ~20ms),
 * the pool keeps a set of connections open and ready. Requests borrow a connection,
 * use it, and return it. One shared pool instance for the entire app.
 */

// Create the single shared pool instance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://novabanc:novabanc_dev@localhost:5433/novabanc',
  min: 2,    // always keep 2 connections open and ready, even when idle
  max: 10,   // never open more than 10 connections — prevents overwhelming Postgres
  idleTimeoutMillis: 30_000,     // close a connection if idle for 30 seconds
  connectionTimeoutMillis: 2_000 // fail fast if we can't get a connection in 2 seconds
});

// Log unexpected errors on idle connections — without this they fail silently
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * For simple single queries that don't need explicit transaction control.
 * Borrows a connection from the pool, runs the query, returns it.
 * Usage: const rows = await query<Account>('SELECT * FROM accounts WHERE id = $1', [id]);
 */
export async function query<T>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/**
 * Get a dedicated client for multi-step operations.
 * Caller must call client.release() when done or the connection leaks.
 */
export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

/**
 * Run multiple queries inside a single atomic transaction.
 * - On success: COMMITs and returns the result
 * - On any error: ROLLBACKs so no partial changes are saved, then rethrows
 * - Always: releases the client back to the pool
 * 
 * This is how transfers stay atomic — debit and credit either both happen or neither does.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();

  try {
    await client.query('BEGIN');           // start the transaction
    const result = await callback(client); // run all the business logic
    await client.query('COMMIT');          // persist everything
    return result;
  } catch (err) {
    await client.query('ROLLBACK');        // undo everything if anything failed
    throw err;                             // rethrow so the caller knows it failed
  } finally {
    client.release();                      // always return client to the pool
  }
}

export default pool;