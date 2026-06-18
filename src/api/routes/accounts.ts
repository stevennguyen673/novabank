import { Router, Request, Response, NextFunction } from 'express';
import { createAccount, getAccount, getAccountTransactions } from '../../services/accountService';
import { deposit, withdrawal } from '../../services/transferService';
import { idempotencyMiddleware } from '../middleware/idempotency';

const router = Router();

// POST /accounts — create a new checking or savings account for a user
router.post('/', idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id, type } = req.body;

    const account = await createAccount({ user_id, type });

    res.status(201).json({
      data: {
        id: account.id,
        user_id: account.user_id,
        type: account.type,
        status: account.status,
        balance: Number(account.balance),
        created_at: account.created_at,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /accounts/:id — fetch account details and current balance
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await getAccount(req.params.id);

    res.status(200).json({
      data: {
        id: account.id,
        user_id: account.user_id,
        type: account.type,
        status: account.status,
        balance: Number(account.balance),
        created_at: account.created_at,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /accounts/:id/transactions — fetch transaction history for an account
router.get('/:id/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transactions = await getAccountTransactions(req.params.id);

    res.status(200).json({
      data: transactions
    });
  } catch (err) {
    next(err);
  }
});

// POST /accounts/:id/deposits — deposit funds into an account
// Requires Idempotency-Key header to prevent duplicate deposits
router.post('/:id/deposits', idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.params.id;
    const amount = req.body.amount;
    const idempotencyKey = req.headers['idempotency-key'] as string;

    const result = await deposit({ accountId, amount, idempotencyKey });

    res.status(201).json({
      data: {
        transaction_id: result.transaction.id,
        status: result.transaction.status,
        amount: Number(result.transaction.amount),
        balance_after: Number(result.balance_after),
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /accounts/:id/withdrawals — withdraw funds from an account
// Requires Idempotency-Key header to prevent duplicate withdrawals
router.post('/:id/withdrawals', idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = req.params.id;
    const amount = req.body.amount;
    const idempotencyKey = req.headers['idempotency-key'] as string;

    const result = await withdrawal({ accountId, amount, idempotencyKey });

    res.status(201).json({
      data: {
        transaction_id: result.transaction.id,
        status: result.transaction.status,
        amount: Number(result.transaction.amount),
        balance_after: Number(result.balance_after),
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;