import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../utils/errors';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
        error: {
            code: err.code,
            message: err.message,
        }
    });
  } else {
    // for unexpected errors - dont leak internals to client
    console.error('Unexpected Error', err);
    res.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occured',
        }
    })
  }
}