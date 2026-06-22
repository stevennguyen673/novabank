import { Queue } from 'bullmq';

// BullMQ job queue backed by Redis — Transfer Service drops fraud check jobs here
// after committing a transaction as PENDING. Worker picks them up asynchronously
// so the API never blocks waiting for fraud checks to complete.
const queue = new Queue('fraud-check', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  }
});

export default queue;