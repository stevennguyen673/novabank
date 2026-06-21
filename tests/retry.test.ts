import { AppError } from '../src/utils/errors';
import { ErrorCode } from '../src/types';
import { retry } from '../src/utils/retry'



beforeEach(() => {
    jest.clearAllMocks();
});


test('succeeds on first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('success');

    const result = await retry(fn, { maxAttempts: 3, baseDelayMs: 10 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
});


test('fails once then succeeds', async () => {
    const fn = jest.fn()
                    .mockRejectedValueOnce(new Error('network error'))
                    .mockResolvedValue('success')

    const result = await retry(fn, { maxAttempts: 3, baseDelayMs: 10 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
});


test('fails all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('network error'));

    await expect(retry(fn, { maxAttempts: 3, baseDelayMs: 10 }))
        .rejects.toThrow('network error');

    expect(fn).toHaveBeenCalledTimes(3);
});


test('fails immediately on business logic error', async () => {
    const fn = jest.fn().mockRejectedValue(new AppError(ErrorCode.INVALID_AMOUNT, 'business logic error', 400));

    await expect(retry(fn, { maxAttempts: 3, baseDelayMs: 10 }))
        .rejects.toThrow('business logic error');

    expect(fn).toHaveBeenCalledTimes(1);
});