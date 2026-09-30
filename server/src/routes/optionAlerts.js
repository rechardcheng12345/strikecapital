import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { listAlerts, getAlert, createAlert, updateAlert, deleteAlert, checkAlert, setDismissed } from '../services/optionAlertService.js';

// Option Alerts — newly listed puts (new expiries / strikes) in a DTE window. Admin only; checked on demand.
const router = Router();
router.use(authenticate, requireAdmin);

const alertSchema = z.object({
    name: z.string().min(1).max(100),
    tickers: z.array(z.string().min(1).max(20)).min(1).max(40),
    min_dte: z.number().int().min(0).max(1500),
    max_dte: z.number().int().min(0).max(1500),
    listed_within_days: z.number().int().min(1).max(365).optional(),
});
const dismissSchema = z.object({ dismissed: z.boolean() });

const wrap = (fn) => async (req, res, next) => {
    try {
        await fn(req, res);
    } catch (err) {
        next(err.status && err.status < 600 && err.status !== 500 ? new AppError(err.message, err.status) : err);
    }
};

router.get('/', wrap(async (req, res) => res.json({ alerts: await listAlerts() })));
router.post('/', validate(alertSchema), wrap(async (req, res) => res.status(201).json(await createAlert(req.body, req.user.id))));
router.get('/:id', wrap(async (req, res) => res.json(await getAlert(Number(req.params.id)))));
router.put('/:id', validate(alertSchema.partial()), wrap(async (req, res) => res.json(await updateAlert(Number(req.params.id), req.body))));
router.delete('/:id', wrap(async (req, res) => {
    await deleteAlert(Number(req.params.id));
    res.json({ message: 'Alert deleted' });
}));
// Pull the window from Moomoo now — can take a minute with many tickers (Moomoo paces option-chain requests)
router.post('/:id/check', wrap(async (req, res) => res.json(await checkAlert(Number(req.params.id)))));
router.put('/contracts/:id/dismiss', validate(dismissSchema), wrap(async (req, res) => {
    await setDismissed(Number(req.params.id), req.body.dismissed);
    res.json({ ok: true });
}));

export default router;
