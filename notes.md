# NovaBanc — Project Notes

## Package.json — key decisions

### Runtime dependencies (`dependencies`)
- `express` — web server framework
- `pg` — PostgreSQL client for Node. The official driver, connects to our DB pool
- `uuid` — generates UUIDs for transaction IDs and idempotency keys
- `winston` — structured JSON logging. Every log line is machine-parseable
- `express-async-errors` — patches Express so async route handlers can throw 
  errors normally. Without this, unhandled promise rejections crash the server 
  silently instead of hitting the error handler

### Dev-only dependencies (`devDependencies`)
- `typescript` — the compiler. Never runs in production
- `ts-node-dev` — runs TypeScript directly in dev with auto-restart on file changes
- `ts-jest` — lets Jest understand TypeScript files without pre-compiling
- `@types/*` — type definitions. Tell TypeScript the shape of JS libraries 
  that weren't written in TS

### Scripts
- `dev` — `--respawn` restarts on crash, `--transpile-only` skips type checking 
  for speed. Type checking is tsc's job, not the dev server's
- `test --runInBand` — runs tests serially not in parallel. Prevents DB tests 
  from colliding with each other
- `--forceExit` — kills Jest after tests finish even if async handles are still open

## jest.config.json — key decisions

- `preset: ts-jest` — handles TS files
- `testEnironment: node` — testing backend node
- `roots` — only looks for tests inside tests/ folder
- `testMatch` — only treats files ending in .test.ts as test files
- `transform` — when Jest sees .ts file, runs it through ts-jest first to compile
- `verbose` - prints each test name when running, not just a summary

## Docker Compose

Two containers — postgres and redis. Run with `docker compose up -d`, stop with `docker compose down`.

### Why Docker?
Without it you'd install Postgres locally, manage versions manually, and it'd work 
differently on every machine. With Docker anyone can clone the repo and have an 
identical environment in seconds. Also why CI/CD can run your tests reliably.

### Key concepts

**image** — which Docker image to pull. `alpine` variants are stripped-down Linux, 
smaller and faster to download.

**ports** — format is `host:container`. Left side is what your machine connects to, 
right side is the port inside the container.

**volumes** — named volumes persist data when the container restarts. Without this, 
every `docker compose down` would wipe your database.

**healthcheck** — Docker waits until this passes before marking the container ready. 
`pg_isready` is a Postgres built-in that confirms the DB is actually accepting 
connections, not just that the container started.

**environment variables** — credentials passed into the container at runtime. 
In production these come from a secrets manager, never hardcoded.

### .env.example
Committed to the repo as a template. The actual `.env` is gitignored so secrets 
never get pushed. Anyone cloning copies this file and fills in real values.

## Database Schema

### Why 4 tables?
- `accounts` — users can have multiple accounts. Can't store balance on users table.
- `transactions` — records the intent (a transfer happened).
- `ledger_entries` — records the effect (these accounts moved by this amount).
  Append-only, never updated or deleted. The permanent audit trail.
- `accounts.balance` is a derived value — it could be recomputed by replaying 
  all ledger entries. The ledger is the truth, balance is a convenience.

### balance_after on ledger_entries
A snapshot of the balance at the exact moment the entry was written.
Lets an auditor reconstruct account state at any point in time without
replaying every entry from the beginning.

### version on accounts
Optimistic locking counter for non-transfer writes (e.g. status changes).
Pattern: UPDATE accounts SET status = $1, version = version + 1 
WHERE id = $2 AND version = $3
If 0 rows affected — someone else modified it, retry.

### Why BIGINT for balance?
INT maxes at ~$21 million in cents. BIGINT handles 9.2 quintillion.
Never use FLOAT for money — floating point is imprecise.
0.1 + 0.2 = 0.30000000000000004 in IEEE 754.

### Indexes
Added on every foreign key and any column frequently used in WHERE clauses.
Without indexes those queries do full table scans — O(n) instead of O(log n).

## Environment & Ports

Changed Docker PostgreSQL host port from 5432 to 5433 to avoid conflict with a 
local PostgreSQL installation that was already running on 5432.

Docker port mapping format is host:container — so 5433:5432 means:
- Outside the container (your app): connect to localhost:5433
- Inside the container: Postgres still runs on its default 5432


## src/types/index.ts

Central type definitions for the entire application. Three categories:

- **Enums** — mirror the Postgres ENUMs exactly. Constrains values to only what's valid.
- **Domain interfaces** — one per database table, typed representation of a row.
  Use bigint for balance and amount — floats are imprecise for money.
- **Request DTOs** — define the exact shape of data expected from the client,
  like @RequestBody in Spring Boot.
- **ErrorCode enum** — typed error codes for every failure scenario so the API
  layer never has to inspect error messages to decide what status code to return.

Everything is exported and imported where needed. The compiler catches type 
mismatches at build time, not at runtime when real money is moving.

## DB Connection Pool (src/db/pool.ts)

A pool keeps multiple database connections open and ready.
Requests borrow a connection, use it, return it — no handshake overhead.

Three exports:
- query() — for simple single queries
- getClient() — for dedicated client when you need manual control
- withTransaction() — wraps multiple queries in BEGIN/COMMIT. 
  If anything throws, it ROLLBACKs automatically.
  This is what makes transfers atomic — debit and credit are 
  either both committed or both rolled back. Money never vanishes.

  ## Connection Pool Summary

pool.ts — one shared pool instance for the entire app. Stays alive forever.
migrate.ts — standalone pool just for the migration script. Calls pool.end() 
when done because the script exits after running.

Why a pool? A banking API gets hundreds of requests per second. Opening a fresh 
database connection per request costs ~20ms each time. A pool keeps connections 
warm — borrowing one takes microseconds.

## Error Handling (src/utils/errors.ts)

AppError extends Error with two extra fields — ErrorCode and HTTP status code.
The error handler in the API layer checks instanceof AppError and uses these
fields to send the right response. No string inspection needed.

Errors object has one typed constructor per failure scenario.
throw Errors.accountNotFound(id) is cleaner and safer than throw new Error('...')
because the status code is baked in, not guessed at in the handler.

## Parameterized Queries
Always use $1, $2 placeholders instead of string interpolation.
Prevents SQL injection — Postgres treats values as data, never as executable SQL.

## TypeScript / pg Patterns

**rows[0]** — query() always returns an array. rows[0] is the first (and usually only) 
item. Used when querying by a unique field like id — result is either 0 or 1 rows.

**$1, $2, $3** — parameterized query placeholders. Map to the array passed as the 
second argument in order. Never put values directly in the SQL string — prevents 
SQL injection.

**BigInt(row.balance as string)** — pg returns BIGINT columns as strings to avoid 
JavaScript number precision loss. Always convert to bigint explicitly when 
deserializing a row.

**...account** — spread operator. Copies all fields from the raw row, then we 
override specific fields with converted types. Used to satisfy the Account interface 
which expects bigint for balance and version, not strings.

**Record<string, unknown>** — TypeScript type for a raw pg row before deserialization. 
An object with string keys and unknown value types. Gets converted to a typed 
interface (Account, Transaction etc) via rowTo* helper functions.

## API Layer — request data locations
- req.params — URL path values (:id)
- req.body — request payload (amount, type, etc)
- req.headers — request metadata (idempotency-key, auth tokens)
- req.query — URL query string (?limit=20&before=...)

Never return raw DB objects — only the fields the client needs.
Always convert bigint to Number() before sending JSON.

## API Layer — app.ts vs index.ts
- app.ts — creates and configures the Express app. Registers middleware (JSON parsing), mounts routers at their paths (/accounts, /transfers), and registers the error handler. Exported as a module so it can be imported by index.ts and also by tests without starting a server.

- index.ts — the entry point. Imports app and calls app.listen() to actually boot the server on a port. Reads port from process.env.PORT with a fallback to 3000. This is the file Node runs when the app starts.

- Why separate them? If app.listen() lived in app.ts, importing the app in tests would immediately start a server. Keeping them separate means tests can import app cleanly without side effects.

- express-async-errors — without this, errors thrown inside async route handlers become unhandled promise rejections that Express never sees. The error handler middleware never fires. Either install this package (one import at the top of app.ts) or manually wrap every route in try/catch and call next(err) in the catch block.

## Middleware
Middleware in Express are functions that run between the request arriving and the route handler responding. Each middleware receives (req, res, next) — it can read/modify the request, send a response early, or call next() to pass control to the next middleware or route handler. Order matters — middleware runs top to bottom in the order it's registered.

### errorHandler (src/api/middleware/errorHandler.ts)
Sits at the very end of the middleware chain — registered last in app.ts. When any route handler calls next(err), Express skips all remaining routes and middleware and jumps straight to the error handler. Checks if the error is an AppError (business logic error with a known status code) and sends the right response. For unexpected errors, logs them and returns a generic 500 so internals are never leaked to the client.

### idempotencyMiddleware (src/api/middleware/idempotency.ts)
Applied directly on POST routes. Runs before the route handler to catch duplicate requests. Checks Redis first, falls back to Postgres, and if both miss it intercepts res.json before calling next(). The intercept is necessary because by the time the route handler builds the response, the middleware has already handed off control — the only way to see and cache the response is to wrap res.json before next() is called, so when the route handler eventually calls it, the middleware's wrapper fires first.