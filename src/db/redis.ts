import Redis from "ioredis";

// Single shared Redis client instance for the entire app
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
});


// Log unexpected errors on idle connections
redis.on('error', (err) => {
  console.error('Unexpected Redis error', err);
});

// Fetch a value by key — returns null if the key doesn't exist or has expired
export async function get(key: string): Promise<string | null> {
  const value = await redis.get(key);
  return value;
}

// Store a value with a TTL in seconds — key auto-expires after ttlSeconds
export async function set(key: string, val: string, ttl: number): Promise<void> {
    await redis.set(key, val, 'EX', ttl);
}

// Delete a key — used when a request fails and we need to invalidate the cache
export async function del(key: string): Promise<void> {
    await redis.del(key);
}

export default redis;

