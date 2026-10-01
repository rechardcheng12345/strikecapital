import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { scanZeroDte } from '../services/zeroDteService.js';

// 0DTE credit-spread scan (SPY / QQQ) — admin only. Suggestions only; trades go through /api/sim.
const router = Router();
router.use(authenticate, requireAdmin);

const scanSchema = z.object({
    ticker: z.enum(['SPY', 'QQQ']),
    width: z.number().positive().max(20).optional(),
    target_credit: z.number().min(0).max(1000).optional(),
    percentile: z.number().int().min(50).max(99).optional(),
});

router.post('/scan', validate(scanSchema), async (req, res, next) => {
    try {
        res.json(await scanZeroDte({
            ticker: req.body.ticker,
            width: req.body.width ?? 2,
            targetCredit: req.body.target_credit ?? 10,
            percentileUsed: req.body.percentile ?? 95,
        }));
    } catch (err) {
        next(err.status && err.status !== 500 ? new AppError(err.message, err.status) : err);
    }
});

export default router;
