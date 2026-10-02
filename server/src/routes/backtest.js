import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { dataStatus, startHistoryLoad, recordChains, runAndSave, listRuns, getRun, deleteRun } from '../services/backtestService.js';

// Backtesting long-dated cash-secured puts — admin only.
const router = Router();
router.use(authenticate, requireAdmin);

const toggle = z.object({ enabled: z.boolean().optional() }).passthrough();
const runSchema = z.object({
    name: z.string().max(120).optional(),
    ticker: z.string().min(1),
    params: z.object({
        start: z.string().optional(),
        end: z.string().optional(),
        starting_cash: z.number().positive().optional(),
        contracts: z.number().int().min(1).max(100).optional(),
        size_mode: z.enum(['equity_pct', 'contracts']).optional(),
        size_pct: z.number().min(0.5).max(100).optional(),
        entry: z.object({
            ladder: toggle.extend({ day: z.number().int().min(1).max(28).optional() }).optional(),
            listing: toggle.optional(),
            dip: toggle.extend({ pct: z.number().min(1).max(95).optional(), cooldown_days: z.number().int().min(1).max(365).optional() }).optional(),
            continuous: toggle.optional(),
        }).optional(),
        limits: z.object({ max_open_puts: z.number().int().min(1).max(100).nullable().optional(), max_units: z.number().int().min(1).max(1000).nullable().optional() }).optional(),
        expiry: z.object({ min_dte: z.number().int().min(30).max(1200).optional(), max_dte: z.number().int().min(30).max(1300).optional(), calendar: z.enum(['january', 'monthly', 'weekly']).optional() }).optional(),
        strike: z.object({ mode: z.enum(['delta', 'pct']).optional(), delta: z.number().min(0.01).max(0.9).optional(), pct: z.number().min(0).max(95).optional(), min_discount_pct: z.number().min(0).max(95).optional() }).optional(),
        covered_calls: z.object({
            enabled: z.boolean().optional(),
            dte: z.number().int().min(1).max(400).optional(),
            mode: z.enum(['delta', 'pct', 'cost_pct']).optional(),
            delta: z.number().min(0.01).max(0.9).optional(),
            pct: z.number().min(0).max(300).optional(),
            floor_at_cost: z.boolean().optional(),
            take_profit_pct: z.number().min(1).max(100).nullable().optional(),
            min_premium: z.number().min(0).max(100).optional(),
        }).optional(),
        min_annual_return_pct: z.number().min(0).max(200).optional(),
        min_put_premium: z.number().min(0).max(100).optional(),
        max_capital_pct: z.number().min(1).max(100).optional(),
        exit: z.object({
            take_profit_pct: z.number().min(1).max(100).nullable().optional(),
            reenter_after_tp: z.boolean().optional(),
            after_tp: z.enum(['roll', 'reenter', 'none']).optional(),
            roll_discount_pct: z.number().min(1).max(95).optional(),
            after_expiry: z.enum(['reenter', 'none']).optional(),
            early_close: toggle.extend({ remaining_pct: z.number().min(0).max(100).optional(), min_days_left: z.number().int().min(0).max(1300).optional() }).optional(),
            roll_when_tested: toggle.extend({ buffer_pct: z.number().min(0).max(50).optional() }).optional(),
        }).optional(),
        fee_per_contract: z.number().min(0).max(50).optional(),
        slippage_pct: z.number().min(0).max(50).optional(),
    }),
});

const wrap = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (err) {
        next(err.status && err.status !== 500 ? new AppError(err.message, err.status) : err);
    }
};

router.get('/data/:ticker', wrap(async (req, res) => res.json(await dataStatus(req.params.ticker))));
// Load Yahoo's daily history of every listed long-dated put (runs in the background; poll GET /data/:ticker)
router.post('/data/:ticker/load', wrap(async (req, res) => res.status(202).json(await startHistoryLoad(req.params.ticker))));
// Record today's real chain now (the server also does this daily after the close)
router.post('/data/:ticker/record', wrap(async (req, res) => res.json(await recordChains(req.params.ticker))));
router.post('/run', validate(runSchema), wrap(async (req, res) => res.status(201).json(await runAndSave(req.body, req.user.id))));
router.get('/runs', wrap(async (req, res) => res.json({ runs: await listRuns() })));
router.get('/runs/:id', wrap(async (req, res) => res.json(await getRun(Number(req.params.id)))));
router.delete('/runs/:id', wrap(async (req, res) => {
    await deleteRun(Number(req.params.id));
    res.json({ ok: true });
}));

export default router;
