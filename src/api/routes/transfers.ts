import { Router, Request, Response, NextFunction } from 'express';
import { transfer, getTransaction } from '../../services/transferService';
import { idempotencyMiddleware } from '../middleware/idempotency';

const router = Router();

// POST /transfers — initiate a transfer between two accounts
// Requires Idempotency-Key header to prevent duplicate transfers
router.post('/', idempotencyMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { fromAccountId, toAccountId, amount } = req.body;
        const idempotencyKey = req.headers['idempotency-key'] as string;

        const result = await transfer({ fromAccountId, toAccountId, amount, idempotencyKey });

        res.status(201).json({
            data: {
                transaction_id: result.transaction.id,
                status: result.transaction.status,
                amount: Number(result.transaction.amount),
                from_balance_after: Number(result.from_balance_after),
                to_balance_after: Number(result.to_balance_after),
            }
        });
    } catch (err) {
        next(err);
    }
});

// GET /transfers/:id — fetch transfer status by transaction id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id;

        const result = await getTransaction(id);

        res.status(200).json({
            data: {
                transaction_id: result.id,
                status: result.status,
                type: result.type,
                amount: Number(result.amount),
            }
        });
    } catch (err) {
        next(err);
    }
});

export default router;