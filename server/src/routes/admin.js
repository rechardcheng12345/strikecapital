import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../config/database.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../services/auditLogger.js';
import { getCapitalUtilization, getTickerConcentration, getDistanceToStrikeDistribution } from '../services/riskMetrics.js';
import { notifyAllInvestors } from '../services/notificationEngine.js';
import { insertAndFetch, updateAndFetch } from '../utils/dbHelpers.js';
const router = Router();
// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);
// ─── Dashboard ───────────────────────────────────────────────
router.get('/dashboard/stats', async (req, res, next) => {
    try {
        // Total positions count
        const [totalPosResult] = await db('positions').count('* as count');
        const total_positions = parseInt(totalPosResult?.count || '0');
        // Open positions (OPEN + MONITORING)
        const [openPosResult] = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .count('* as count');
        const open_positions = parseInt(openPosResult?.count || '0');
        // Total premium received from all positions
        const [premiumResult] = await db('positions').sum('premium_received as total');
        const total_premium = parseFloat(premiumResult?.total || '0');
        // Total collateral from OPEN/MONITORING positions
        const [collateralResult] = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .sum('collateral as total');
        const total_collateral = parseFloat(collateralResult?.total || '0');
        // Total active investors
        const [investorCount] = await db('users').where({ role: 'investor', is_active: true }).count('* as count');
        const total_investors = parseInt(investorCount?.count || '0');
        // Total realized P&L
        const [pnlResult] = await db('pnl_records').sum('pnl_amount as total');
        const total_realized_pnl = parseFloat(pnlResult?.total || '0');
        // Capital utilization
        const settings = await db('fund_settings').first();
        const totalCapital = parseFloat(settings?.total_fund_capital || '0');
        const capital_utilization = totalCapital > 0 ? (total_collateral / totalCapital) * 100 : 0;
        // Positions expiring within 7 days
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const [expiringResult] = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .where('expiration_date', '>=', now.toISOString().split('T')[0])
            .where('expiration_date', '<=', sevenDaysFromNow.toISOString().split('T')[0])
            .count('* as count');
        const positions_expiring_soon = parseInt(expiringResult?.count || '0');
        res.json({
            total_positions,
            open_positions,
            total_premium: Math.round(total_premium * 100) / 100,
            total_collateral: Math.round(total_collateral * 100) / 100,
            total_investors,
            total_realized_pnl: Math.round(total_realized_pnl * 100) / 100,
            capital_utilization: Math.round(capital_utilization * 100) / 100,
            positions_expiring_soon,
        });
    }
    catch (error) {
        next(error);
    }
});
// ─── Investor Management ─────────────────────────────────────
const createInvestorSchema = z.object({
    email: z.string().email(),
    full_name: z.string().min(2),
    phone: z.string().optional(),
    allocation_amount: z.number().min(0).optional(),
});
const updateInvestorSchema = z.object({
    full_name: z.string().min(2).optional(),
    phone: z.string().optional(),
    is_active: z.boolean().optional(),
    invested_amount: z.number().min(0).optional(),
    allocation_pct: z.number().min(0).max(100).optional(),
});
router.get('/investors', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const [{ count }] = await db('users').where({ role: 'investor' }).count('* as count');
        const total = parseInt(count);
        const investors = await db('users')
            .where({ role: 'investor' })
            .leftJoin('investor_allocations', function () {
            this.on('users.id', '=', 'investor_allocations.user_id')
                .andOn('investor_allocations.is_active', '=', db.raw('true'));
        })
            .select('users.id', 'users.email', 'users.full_name', 'users.phone', 'users.is_active', 'users.created_at', 'investor_allocations.invested_amount', 'investor_allocations.allocation_pct')
            .orderBy('users.created_at', 'desc')
            .limit(limit)
            .offset(offset);
        res.json({
            investors,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/investors/:id', async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id, role: 'investor' }).first();
        if (!user)
            throw new AppError('Investor not found', 404);
        const allocation = await db('investor_allocations')
            .where({ user_id: user.id, is_active: true })
            .first();
        res.json({ ...user, allocation });
    }
    catch (error) {
        next(error);
    }
});
router.post('/investors', validate(createInvestorSchema), async (req, res, next) => {
    try {
        const { email, full_name, phone, allocation_amount } = req.body;
        const existing = await db('users').where({ email }).first();
        if (existing)
            throw new AppError('Email already exists', 400);
        const tempPassword = crypto.randomBytes(4).toString('hex');
        const password_hash = await bcrypt.hash(tempPassword, 10);
        const user = await insertAndFetch('users', { email, password_hash, full_name, phone: phone || null, role: 'investor' });
        if (allocation_amount && allocation_amount > 0) {
            const settings = await db('fund_settings').first();
            const totalCapital = parseFloat(settings?.total_fund_capital || '0');
            const pct = totalCapital > 0 ? (allocation_amount / totalCapital) * 100 : 0;
            await db('investor_allocations').insert({
                user_id: user.id,
                invested_amount: allocation_amount,
                allocation_pct: Math.round(pct * 100) / 100,
                start_date: new Date().toISOString().split('T')[0],
                is_active: true,
                created_by: req.user.id,
            });
        }
        await logAudit({
            userId: req.user.id,
            action: 'investor.create',
            entityType: 'user',
            entityId: user.id,
            newValues: { email, full_name, allocation_amount },
            ipAddress: req.ip,
        });
        res.status(201).json({ user, temporary_password: tempPassword, message: 'Investor created' });
    }
    catch (error) {
        next(error);
    }
});
router.put('/investors/:id', validate(updateInvestorSchema), async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id, role: 'investor' }).first();
        if (!user)
            throw new AppError('Investor not found', 404);
        const { full_name, phone, is_active, invested_amount, allocation_pct } = req.body;
        const userUpdates = {};
        if (full_name !== undefined)
            userUpdates.full_name = full_name;
        if (phone !== undefined)
            userUpdates.phone = phone;
        if (is_active !== undefined)
            userUpdates.is_active = is_active;
        if (Object.keys(userUpdates).length > 0) {
            userUpdates.updated_at = new Date();
            await db('users').where({ id: user.id }).update(userUpdates);
        }
        if (invested_amount !== undefined || allocation_pct !== undefined) {
            const existing = await db('investor_allocations').where({ user_id: user.id, is_active: true }).first();
            const allocUpdates = {};
            if (invested_amount !== undefined)
                allocUpdates.invested_amount = invested_amount;
            if (allocation_pct !== undefined)
                allocUpdates.allocation_pct = allocation_pct;
            allocUpdates.updated_at = new Date();
            if (existing) {
                await db('investor_allocations').where({ id: existing.id }).update(allocUpdates);
            }
            else {
                await db('investor_allocations').insert({
                    user_id: user.id,
                    invested_amount: invested_amount || 0,
                    allocation_pct: allocation_pct || 0,
                    start_date: new Date().toISOString().split('T')[0],
                    is_active: true,
                    created_by: req.user.id,
                });
            }
        }
        await logAudit({
            userId: req.user.id,
            action: 'investor.update',
            entityType: 'user',
            entityId: user.id,
            oldValues: { full_name: user.full_name, is_active: user.is_active },
            newValues: req.body,
            ipAddress: req.ip,
        });
        const updated = await db('users').where({ id: user.id }).first();
        res.json(updated);
    }
    catch (error) {
        next(error);
    }
});
router.post('/investors/:id/reset-password', async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id, role: 'investor' }).first();
        if (!user)
            throw new AppError('Investor not found', 404);
        const tempPassword = crypto.randomBytes(4).toString('hex');
        const password_hash = await bcrypt.hash(tempPassword, 10);
        await db('users').where({ id: user.id }).update({ password_hash, updated_at: new Date() });
        await logAudit({
            userId: req.user.id,
            action: 'investor.password_reset',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip,
        });
        res.json({ message: 'Password reset', temporary_password: tempPassword });
    }
    catch (error) {
        next(error);
    }
});
// ─── P&L ─────────────────────────────────────────────────────
router.get('/pnl', async (req, res, next) => {
    try {
        const period = req.query.period || 'all';
        let startDate = null;
        const now = new Date();
        if (period === '1m') {
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split('T')[0];
        }
        else if (period === '3m') {
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().split('T')[0];
        }
        else if (period === 'ytd') {
            startDate = `${now.getFullYear()}-01-01`;
        }
        let pnlQuery = db('pnl_records');
        if (startDate)
            pnlQuery = pnlQuery.where('record_date', '>=', startDate);
        const records = await pnlQuery.orderBy('record_date', 'desc');
        // Map DB field names to frontend field names
        const mappedRecords = records.map((r) => ({
            id: r.id,
            position_id: r.position_id,
            record_type: r.pnl_type,
            amount: parseFloat(r.pnl_amount),
            description: r.description,
            record_date: r.record_date,
            created_by: r.created_by,
        }));
        const total_realized_pnl = records.reduce((sum, r) => sum + parseFloat(r.pnl_amount), 0);
        // Fetch positions for the period
        let posQuery = db('positions');
        if (startDate)
            posQuery = posQuery.where('created_at', '>=', startDate);
        const positions = await posQuery.orderBy('created_at', 'desc');
        // Total premium from positions in period
        const total_premium = positions.reduce((sum, p) => sum + parseFloat(p.premium_received || '0'), 0);
        res.json({
            total_premium: Math.round(total_premium * 100) / 100,
            total_realized_pnl: Math.round(total_realized_pnl * 100) / 100,
            records: mappedRecords,
            positions,
        });
    }
    catch (error) {
        next(error);
    }
});
const createPnlSchema = z.object({
    position_id: z.number().int(),
    amount: z.number(),
    record_type: z.string(),
    description: z.string().optional(),
    record_date: z.string().optional(),
});
router.post('/pnl', validate(createPnlSchema), async (req, res, next) => {
    try {
        const { position_id, amount, record_type, description, record_date } = req.body;
        const position = await db('positions').where({ id: position_id }).first();
        if (!position)
            throw new AppError('Position not found', 404);
        const record = await insertAndFetch('pnl_records', {
            position_id,
            record_date: record_date || new Date().toISOString().split('T')[0],
            pnl_amount: amount,
            pnl_type: record_type,
            description: description || null,
            created_by: req.user.id,
        });
        res.status(201).json(record);
    }
    catch (error) {
        next(error);
    }
});
// ─── Announcements ───────────────────────────────────────────
const announcementSchema = z.object({
    title: z.string().min(1),
    content: z.string().min(1),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    is_active: z.boolean().optional(),
});
router.get('/announcements', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const [{ count }] = await db('announcements').count('* as count');
        const total = parseInt(count);
        const announcements = await db('announcements')
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);
        res.json({
            announcements,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/announcements', validate(announcementSchema), async (req, res, next) => {
    try {
        const { title, content, priority, is_active } = req.body;
        const announcement = await insertAndFetch('announcements', {
            title,
            content,
            priority: priority || 'normal',
            is_active: is_active !== undefined ? is_active : true,
            published_at: new Date(),
            created_by: req.user.id,
        });
        await notifyAllInvestors('announcement', title, content.substring(0, 200), { announcement_id: announcement.id });
        await logAudit({
            userId: req.user.id,
            action: 'announcement.create',
            entityType: 'announcement',
            entityId: announcement.id,
            newValues: { title, priority },
            ipAddress: req.ip,
        });
        res.status(201).json(announcement);
    }
    catch (error) {
        next(error);
    }
});
router.put('/announcements/:id', validate(announcementSchema.partial()), async (req, res, next) => {
    try {
        const existing = await db('announcements').where({ id: req.params.id }).first();
        if (!existing)
            throw new AppError('Announcement not found', 404);
        const updated = await updateAndFetch('announcements', { id: req.params.id }, { ...req.body, updated_at: new Date() });
        res.json(updated);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/announcements/:id', async (req, res, next) => {
    try {
        const deleted = await db('announcements').where({ id: req.params.id }).del();
        if (!deleted)
            throw new AppError('Announcement not found', 404);
        res.json({ message: 'Announcement deleted' });
    }
    catch (error) {
        next(error);
    }
});
// ─── Risk Dashboard ──────────────────────────────────────────
router.get('/risk/dashboard', async (req, res, next) => {
    try {
        const utilization = await getCapitalUtilization();
        const concentration = await getTickerConcentration();
        const distanceToStrike = await getDistanceToStrikeDistribution();
        // Map capital utilization fields
        const capital_utilization = {
            total_capital: utilization.totalCapital,
            deployed_capital: utilization.utilizedCapital,
            utilization_pct: utilization.utilizationPct,
        };
        // Map ticker concentration fields
        const ticker_concentration = concentration.map((c) => ({
            ticker: c.ticker,
            collateral: c.collateral,
            pct: c.pct,
        }));
        // Aggregate distance to strike into range buckets
        const rangeBuckets = {
            '0-3%': 0,
            '3-5%': 0,
            '5-10%': 0,
            '10-20%': 0,
            '20%+': 0,
        };
        distanceToStrike.forEach((pos) => {
            const dist = parseFloat(pos.distance_pct || pos.distancePct || pos.distance || '0');
            if (dist < 3)
                rangeBuckets['0-3%']++;
            else if (dist < 5)
                rangeBuckets['3-5%']++;
            else if (dist < 10)
                rangeBuckets['5-10%']++;
            else if (dist < 20)
                rangeBuckets['10-20%']++;
            else
                rangeBuckets['20%+']++;
        });
        const distance_distribution = Object.entries(rangeBuckets).map(([range, count]) => ({
            range,
            count,
        }));
        res.json({ capital_utilization, ticker_concentration, distance_distribution });
    }
    catch (error) {
        next(error);
    }
});
// ─── Audit Trail ─────────────────────────────────────────────
router.get('/audit', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        let query = db('audit_logs').leftJoin('users', 'audit_logs.user_id', 'users.id');
        let countQuery = db('audit_logs');
        const { action, entity_type, start_date, end_date } = req.query;
        if (action) {
            query = query.where('audit_logs.action', action);
            countQuery = countQuery.where('action', action);
        }
        if (entity_type) {
            query = query.where('audit_logs.entity_type', entity_type);
            countQuery = countQuery.where('entity_type', entity_type);
        }
        if (start_date) {
            query = query.where('audit_logs.created_at', '>=', start_date);
            countQuery = countQuery.where('created_at', '>=', start_date);
        }
        if (end_date) {
            query = query.where('audit_logs.created_at', '<=', end_date + ' 23:59:59');
            countQuery = countQuery.where('created_at', '<=', end_date + ' 23:59:59');
        }
        const [{ count }] = await countQuery.count('* as count');
        const total = parseInt(count);
        const logs = await query
            .select('audit_logs.*', 'users.full_name as user_name', 'users.email as user_email')
            .orderBy('audit_logs.created_at', 'desc')
            .limit(limit)
            .offset(offset);
        res.json({
            logs,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    }
    catch (error) {
        next(error);
    }
});
// ─── Export ──────────────────────────────────────────────────
router.get('/export/positions', async (req, res, next) => {
    try {
        const positions = await db('positions').orderBy('created_at', 'desc');
        res.json({ positions });
    }
    catch (error) {
        next(error);
    }
});
export default router;
