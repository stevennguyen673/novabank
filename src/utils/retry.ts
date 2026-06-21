import { AppError } from "./errors";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function retry<T>(
    fn: () => Promise<T>,
    options: {
        maxAttempts: number;
        baseDelayMs: number;
    }
): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
            // attempt the function
            return await fn();
        } catch (err) {
            lastError = err as Error;

            // don't retry business logic errors
            if (err instanceof AppError && err.statusCode < 500) {
                throw err;
            }

            // no attempts left
            if (attempt === options.maxAttempts) {
                throw err;
            }

            // exponential backoff with jitter, each retry waits longer plus a random offset
            const delay = options.baseDelayMs * Math.pow(2, attempt) + Math.random() * options.baseDelayMs;
            await sleep(delay);
        }
    }

    throw lastError!;
}