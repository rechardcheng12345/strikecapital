import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import {
    listPortfolios, getPortfolio, createPortfolio, updatePortfolio, deletePortfolio,
    quotePut, openPut, closePosition, rollPosition, refreshSimulation,
} from '../services/simService.js';

// Paper-trading portfolios — admin only, separate from the live fund.
const router = Router();
router.use(authenticate, requireAdmin);

const portfolioSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    starting_cash: z.number().positive(),
    fee_per_contract: z.number().min(0).optional(),
    fee_per_stock_trade: z.number().min(0).optional(),
});
const updatePortfolioSchema = portfolioSchema.partial().extend({ is_active: z.boolean().optional() });
const quoteSchema = z.object({
    ticker: z.string().min(1),
    strike: z.number().positive(),
    expiration_date: z.string().min(10),
});
const openSchema = quoteSchema.extend({
    contracts: z.number().int().min(1).optional(),
    price: z.number().positive().optional(), // manual fill; omitted → live mid
    fallback_price: z.number().positive().optional(), // used only when no live quote (e.g. the scanner row's mid)
    entry_context: z.record(z.any()).optional(),
    notes: z.string().max(2000).optional(),
});
const closeSchema = z.object({ price: z.number().min(0).optional() });
const rollSchema = z.object({
    close_price: z.number().min(0).optional(),
    strike: z.number().positive(),
    expiration_date: z.string().min(10),
    contracts: z.number().int().min(1).optional(),
    price: z.number().positive().optional(),
    fallback_price: z.number().positive().optional(),
    notes: z.string().max(2000).optional(),
});

const wrap = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (err) {
        next(err.status && err.status < 500 ? new AppError(err.message, err.status) : err);
    }
};

router.get('/portfolios', wrap(async (req, res) => res.json({ portfolios: await listPortfolios() })));
router.post('/portfolios', validate(portfolioSchema), wrap(async (req, res) => res.status(201).json(await createPortfolio(req.body, req.user.id))));
router.get('/portfolios/:id', wrap(async (req, res) => res.json(await getPortfolio(Number(req.params.id)))));
router.put('/portfolios/:id', validate(updatePortfolioSchema), wrap(async (req, res) => res.json(await updatePortfolio(Number(req.params.id), req.body))));
router.delete('/portfolios/:id', wrap(async (req, res) => {
    await deletePortfolio(Number(req.params.id));
    res.json({ message: 'Portfolio deleted' });
}));

// Live bid / ask / mid for a put before trading it
router.post('/quote', validate(quoteSchema), wrap(async (req, res) => {
    const quote = await quotePut(req.body);
    if (!quote) throw new AppError('No quote for that contract — check the strike and expiry exist, and that OpenD / the scanner proxy is running', 404);
    res.json(quote);
}));

router.post('/portfolios/:id/positions', validate(openSchema), wrap(async (req, res) => res.status(201).json(await openPut(Number(req.params.id), req.body))));
router.post('/positions/:id/close', validate(closeSchema), wrap(async (req, res) => res.json(await closePosition(Number(req.params.id), req.body))));
router.post('/positions/:id/roll', validate(rollSchema), wrap(async (req, res) => res.status(201).json(await rollPosition(Number(req.params.id), req.body))));

// Mark every open paper position now (also outside market hours), settle expiries, snapshot
router.post('/refresh', wrap(async (req, res) => res.json(await refreshSimulation({ force: true }))));

export default router;
