import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logAudit } from '../services/auditLogger.js';
import { insertAndFetch, updateAndFetch } from '../utils/dbHelpers.js';
const router = Router();
const updateSettingsSchema = z.object({
    fund_name: z.string().min(1).optional(),
    total_fund_capital: z.number().min(0).optional(),
    max_capital_per_position: z.number().min(0).optional(),
    max_positions: z.number().int().min(1).optional(),
    default_alert_threshold: z.number().min(0).max(100).optional(),
    // Keep old ones too for backward compat
    max_capital_utilization: z.number().min(0).max(100).optional(),
    max_single_position: z.number().min(0).max(100).optional(),
    max_ticker_concentration: z.number().min(0).max(100).optional(),
    risk_free_rate: z.number().min(0).optional(),
});
// GET /settings
router.get('/settings', authenticate, async (req, res, next) => {
    try {
        const settings = await db('fund_settings').first();
        res.json(settings || {});
    }
    catch (error) {
        next(error);
    }
});
// PUT /settings (admin only)
router.put('/settings', authenticate, requireAdmin, validate(updateSettingsSchema), async (req, res, next) => {
    try {
        const existing = await db('fund_settings').first();
        const updates = { ...req.body, updated_by: req.user.id, updated_at: new Date() };
        let settings;
        if (existing) {
            settings = await updateAndFetch('fund_settings', { id: existing.id }, updates);
        }
        else {
            settings = await insertAndFetch('fund_settings', { ...updates });
        }
        await logAudit({
            userId: req.user.id,
            action: 'fund.update',
            entityType: 'fund_settings',
            entityId: settings.id,
            oldValues: existing || null,
            newValues: updates,
            ipAddress: req.ip,
        });
        res.json(settings);
    }
    catch (error) {
        next(error);
    }
});
// GET /capacity
router.get('/capacity', authenticate, async (req, res, next) => {
    try {
        const settings = await db('fund_settings').first();
        const totalCapital = parseFloat(settings?.total_fund_capital || '0');
        const result = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .sum('collateral as total')
            .first();
        const utilized = parseFloat(result?.total || '0');
        res.json({
            total_fund_capital: totalCapital,
            capital_at_risk: utilized,
            available_capital: totalCapital - utilized,
            utilization_pct: totalCapital > 0 ? Math.round((utilized / totalCapital) * 10000) / 100 : 0,
        });
    }
    catch (error) {
        next(error);
    }
});
export default router;
