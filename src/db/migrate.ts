import 'dotenv/config'; // loads .env file into process.env before anything else
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

/**
 * Migration Runner
 * 
 * Applies SQL migration files in order and tracks which ones have already run.
 * Safe to run multiple times — already applied migrations are skipped.
 * Run with: npm run migrate
 */

// Standalone pool just for migrations — separate from the app pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://novabanc:novabanc_dev@localhost:5433/novabanc'
});

async function migrate() {
  // Grab a dedicated client — we need one connection for the whole migration run
  const client = await pool.connect();

  try {
    const migrationsDir = path.join(__dirname, 'migrations');

    // Read all .sql files in the migrations folder, sorted by filename (001_, 002_, ...)
    const files = fs
      .readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    // Create the tracking table if this is the first time migrations have run.
    // IF NOT EXISTS means this is safe to run every time.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const file of files) {
      // Check if this migration has already been applied
      const result = await client.query(
        'SELECT * FROM schema_migrations WHERE filename = $1',
        [file]
      );

      // Already applied — skip it
      if (result.rows.length > 0) {
        console.log(`Skipping ${file}`);
        continue;
      }

      console.log(`Running ${file}`);

      const filePath = path.join(migrationsDir, file);
      // Read the raw SQL from disk
      const sql = fs.readFileSync(filePath, 'utf8');

      try {
        await client.query('BEGIN'); // start transaction

        // Execute the migration SQL
        await client.query(sql);

        // Record it in schema_migrations so it never runs again
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );

        await client.query('COMMIT'); // persist both the schema change and the record
        console.log(`Completed ${file}`);
      } catch (err) {
        // Something went wrong — roll back so we don't leave a partial schema
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    // Always release the client and shut down the pool when the script is done
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  // Exit with code 1 so CI/CD knows the migration failed
  process.exit(1);
});