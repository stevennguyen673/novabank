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