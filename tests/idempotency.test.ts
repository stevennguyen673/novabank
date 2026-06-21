import { idempotencyMiddleware } from '../src/api/middleware/idempotency';
import { get, set } from '../src/db/redis';
import { query } from '../src/db/pool';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  }));
});

// jest fakes
jest.mock('../src/db/pool');
jest.mock('../src/db/redis');


let req: any;   // fake express req
let res: any;   // fake express res
let next: jest.Mock;    // fake next()


beforeEach(() => {
    req = { headers: { 'idempotency-key': 'test-key-123' } };
    res = { json: jest.fn() };
    next = jest.fn();
    jest.clearAllMocks();
});


test('missing idempotency key', async () => {
    req = { headers: { 'idempotency-key': undefined } };

    await expect(idempotencyMiddleware(req, res, next))
        .rejects.toThrow('Missing Idempotency Key');
});

test('redis cache hit', async () => {
    jest.mocked(get).mockResolvedValue(JSON.stringify({ data: 'cached' }));

    await idempotencyMiddleware(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ data: 'cached'});
    expect(next).not.toHaveBeenCalled();
});


test('postgress fallback', async () => {
    jest.mocked(get).mockResolvedValue(null);
    jest.mocked(query).mockResolvedValue([{ id: 'tx-123', status: 'COMPLETED' }]);

    await idempotencyMiddleware(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ id: 'tx-123', status: 'COMPLETED' });
    expect(set).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
});

test('new request calls next and caches response', async () => {
    jest.mocked(get).mockResolvedValue(null);
    jest.mocked(query).mockResolvedValue([]);
    next.mockImplementation(() => {
        res.json({ transaction_id: 'tx-123' });
    });

    await idempotencyMiddleware(req, res, next);

    expect(set).toHaveBeenCalledWith('test-key-123', JSON.stringify({ transaction_id: 'tx-123' }), 86400);
    expect(next).toHaveBeenCalled();
});
