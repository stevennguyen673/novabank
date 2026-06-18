import { Request, Response, NextFunction } from 'express';
import { Errors } from '../../utils/errors';
import { get, set } from '../../db/redis';
import { query } from '../../db/pool';

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Reject if idempotency key is missing — required on all mutation endpoints
  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    throw Errors.missingIdempotencyKey();
  }

  // 2. Check Redis first — fastest path, returns cached result if key was seen recently
  const cached = await get(idempotencyKey);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }

  // 3. Redis miss — fall back to Postgres in case Redis was restarted and lost state
  //    If found, backfill Redis so the next request hits cache instead
  const existing = await query<Record<string, unknown>>(
    'SELECT * FROM transactions WHERE idempotency_key = $1',
    [idempotencyKey]
  );
  if (existing.length > 0) {
    await set(idempotencyKey, JSON.stringify(existing[0]), 86400);
    res.json(existing[0]);
    return;
  }

  // 4. New request — intercept res.json so we can cache the response after it's built,
  //    then hand off to the route handler via next()
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // store the response in Redis with 24hr TTL before sending it
    set(idempotencyKey, JSON.stringify(body), 86400);
    return originalJson(body);
  };

  next();
}