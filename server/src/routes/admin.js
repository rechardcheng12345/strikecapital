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
import { getAccountFunds, getAccList } from '../services/moomooService.js';
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
        // Total active investors (includes admin with allocation)
        const [investorCount] = await db('investor_allocations')
            .where({ is_active: true })
            .countDistinct('user_id as count');
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

        // Unrealized P&L from open option positions with current_price
        const openOptionPositions = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .whereNotNull('current_price')
            .select('premium_received', 'commission', 'platform_fee', 'current_price', 'contracts', 'position_type', 'shares', 'cost_basis');
        let total_unrealized_pnl = 0;
        for (const pos of openOptionPositions) {
            if (pos.position_type === 'stock' && pos.shares) {
                total_unrealized_pnl += (parseFloat(pos.current_price) - parseFloat(pos.cost_basis)) * pos.shares;
            } else if (pos.contracts > 0) {
                const fees = (parseFloat(pos.commission) || 0) + (parseFloat(pos.platform_fee) || 0);
                total_unrealized_pnl += parseFloat(pos.premium_received) - fees - (parseFloat(pos.current_price) * pos.contracts * 100);
            }
        }

        // Last price update timestamp
        const [latestUpdate] = await db('positions')
            .whereNotNull('last_price_update')
            .orderBy('last_price_update', 'desc')
            .limit(1)
            .select('last_price_update');

        res.json({
            total_positions,
            open_positions,
            total_premium: Math.round(total_premium * 100) / 100,
            total_collateral: Math.round(total_collateral * 100) / 100,
            total_investors,
            total_realized_pnl: Math.round(total_realized_pnl * 100) / 100,
            total_unrealized_pnl: Math.round(total_unrealized_pnl * 100) / 100,
            capital_utilization: Math.round(capital_utilization * 100) / 100,
            positions_expiring_soon,
            last_price_update: latestUpdate?.last_price_update || null,
        });
    }
    catch (error) {
        next(error);
    }
});
// ─── Investor Dashboard (admin preview) ─────────────────────────
router.get('/dashboard/investor-view', async (req, res, next) => {
    try {
        // Fund settings
        const settings = await db('fund_settings').first();
        const totalCapital = parseFloat(settings?.total_fund_capital || '0');

        // Total invested across all active allocations
        const [allocResult] = await db('investor_allocations')
            .where({ is_active: true })
            .sum('invested_amount as total')
            .count('* as count');
        const totalInvested = parseFloat(allocResult?.total || '0');
        const investorCount = parseInt(allocResult?.count || '0');
        const totalAllocationPct = totalCapital > 0
            ? Math.round((totalInvested / totalCapital) * 100 * 100) / 100
            : 0;

        // Active positions count
        const [activeResult] = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .count('* as count');

        // Total realized P&L
        const [pnlResult] = await db('pnl_records').sum('pnl_amount as total');
        const totalPnl = parseFloat(pnlResult?.total || '0');

        // Win rate from resolved positions
        const [resolvedCount] = await db('positions').where('status', 'RESOLVED').count('* as count');
        const [wonCount] = await db('positions')
            .where('status', 'RESOLVED')
            .whereIn('resolution_type', ['expired_worthless', 'rolled'])
            .count('* as count');
        const resolved = parseInt(resolvedCount?.count || '0');
        const won = parseInt(wonCount?.count || '0');
        const winRate = resolved > 0 ? Math.round((won / resolved) * 100) : 0;

        // Unrealized P&L from open positions
        const openPositions = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .whereNotNull('current_price')
            .select('premium_received', 'commission', 'platform_fee', 'current_price', 'contracts', 'position_type', 'shares', 'cost_basis');
        let totalUnrealizedPnl = 0;
        for (const pos of openPositions) {
            if (pos.position_type === 'stock' && pos.shares) {
                totalUnrealizedPnl += (parseFloat(pos.current_price) - parseFloat(pos.cost_basis)) * pos.shares;
            } else if (pos.contracts > 0) {
                const fees = (parseFloat(pos.commission) || 0) + (parseFloat(pos.platform_fee) || 0);
                totalUnrealizedPnl += parseFloat(pos.premium_received) - fees - (parseFloat(pos.current_price) * pos.contracts * 100);
            }
        }

        // Last price update
        const [latestUpdate] = await db('positions')
            .whereNotNull('last_price_update')
            .orderBy('last_price_update', 'desc')
            .limit(1)
            .select('last_price_update');

        res.json({
            allocation: {
                allocation_amount: totalInvested,
                allocation_pct: totalAllocationPct,
            },
            total_pnl: Math.round(totalPnl * 100) / 100,
            unrealized_pnl: Math.round(totalUnrealizedPnl * 100) / 100,
            active_positions: parseInt(activeResult?.count || '0'),
            win_rate: winRate,
            investor_count: investorCount,
            total_fund_capital: totalCapital,
            last_price_update: latestUpdate?.last_price_update || null,
        });
    } catch (error) {
        next(error);
    }
});

// ─── Investor Management ─────────────────────────────────────
// Helper: auto-calculate allocation percentage
async function calcAllocationPct(investedAmount) {
    const settings = await db('fund_settings').first();
    const totalCapital = parseFloat(settings?.total_fund_capital || '0');
    return totalCapital > 0 ? Math.round((investedAmount / totalCapital) * 100 * 100) / 100 : 0;
}

const createInvestorSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    full_name: z.string().min(2),
    phone: z.string().optional(),
    allocation_amount: z.number().min(0).optional(),
});
const updateInvestorSchema = z.object({
    full_name: z.string().min(2).optional(),
    phone: z.string().optional(),
    is_active: z.boolean().optional(),
    invested_amount: z.number().min(0).optional(),
    role: z.enum(['investor', 'admin']).optional(),
});
const resetPasswordSchema = z.object({
    password: z.string().min(6, 'Password must be at least 6 characters'),
});

// GET /investors/fund-summary — Fund overview for investor management page
router.get('/investors/fund-summary', async (req, res, next) => {
    try {
        const settings = await db('fund_settings').first();
        const totalCapital = parseFloat(settings?.total_fund_capital || '0');
        const [allocResult] = await db('investor_allocations')
            .where({ is_active: true })
            .sum('invested_amount as total');
        const totalAllocated = parseFloat(allocResult?.total || '0');
        const [countResult] = await db('investor_allocations')
            .where({ is_active: true })
            .countDistinct('user_id as count');
        const investorCount = parseInt(countResult?.count || '0');
        res.json({
            total_fund_capital: totalCapital,
            total_allocated: Math.round(totalAllocated * 100) / 100,
            remaining_capacity: Math.round((totalCapital - totalAllocated) * 100) / 100,
            investor_count: investorCount,
            allocation_pct_used: totalCapital > 0 ? Math.round((totalAllocated / totalCapital) * 100 * 100) / 100 : 0,
        });
    }
    catch (error) {
        next(error);
    }
});

// GET /investors — List investors (includes admin with allocation)
router.get('/investors', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search;

        let baseQuery = db('users')
            .leftJoin('investor_allocations', function () {
                this.on('users.id', '=', 'investor_allocations.user_id')
                    .andOn('investor_allocations.is_active', '=', db.raw('true'));
            })
            .where(function () {
                this.where('users.role', 'investor')
                    .orWhereNotNull('investor_allocations.id');
            });

        if (search) {
            baseQuery = baseQuery.andWhere(function () {
                this.where('users.full_name', 'like', `%${search}%`)
                    .orWhere('users.email', 'like', `%${search}%`);
            });
        }

        const [{ count }] = await baseQuery.clone().count('users.id as count');
        const total = parseInt(count);

        const investors = await baseQuery.clone()
            .select(
                'users.id', 'users.email', 'users.full_name', 'users.phone',
                'users.role', 'users.is_active', 'users.created_at',
                'investor_allocations.invested_amount', 'investor_allocations.allocation_pct',
                'investor_allocations.start_date as allocation_start_date'
            )
            .orderByRaw('COALESCE(investor_allocations.allocation_pct, 0) DESC, users.created_at DESC')
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

// GET /investors/:id — Get single investor detail
router.get('/investors/:id', async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id }).first();
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

// POST /investors — Create new investor (admin sets password)
router.post('/investors', validate(createInvestorSchema), async (req, res, next) => {
    try {
        const { email, password, full_name, phone, allocation_amount } = req.body;
        const existing = await db('users').where({ email }).first();
        if (existing)
            throw new AppError('Email already exists', 400);
        const password_hash = await bcrypt.hash(password, 10);
        const user = await insertAndFetch('users', { email, password_hash, full_name, phone: phone || null, role: 'investor' });
        if (allocation_amount && allocation_amount > 0) {
            const pct = await calcAllocationPct(allocation_amount);
            await db('investor_allocations').insert({
                user_id: user.id,
                invested_amount: allocation_amount,
                allocation_pct: pct,
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
        res.status(201).json({ user, message: 'Investor created' });
    }
    catch (error) {
        next(error);
    }
});

// PUT /investors/:id — Update investor profile and allocation
router.put('/investors/:id', validate(updateInvestorSchema), async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id }).first();
        if (!user)
            throw new AppError('Investor not found', 404);
        const { full_name, phone, is_active, invested_amount, role } = req.body;
        const userUpdates = {};
        if (full_name !== undefined)
            userUpdates.full_name = full_name;
        if (phone !== undefined)
            userUpdates.phone = phone;
        if (is_active !== undefined)
            userUpdates.is_active = is_active;
        if (role !== undefined)
            userUpdates.role = role;
        if (Object.keys(userUpdates).length > 0) {
            userUpdates.updated_at = new Date();
            await db('users').where({ id: user.id }).update(userUpdates);
        }
        if (invested_amount !== undefined) {
            const allocation_pct = await calcAllocationPct(invested_amount);
            const existing = await db('investor_allocations').where({ user_id: user.id, is_active: true }).first();
            if (existing) {
                await db('investor_allocations').where({ id: existing.id }).update({
                    invested_amount,
                    allocation_pct,
                    updated_at: new Date(),
                });
            }
            else {
                await db('investor_allocations').insert({
                    user_id: user.id,
                    invested_amount,
                    allocation_pct,
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
        const allocation = await db('investor_allocations').where({ user_id: user.id, is_active: true }).first();
        res.json({ ...updated, invested_amount: allocation?.invested_amount, allocation_pct: allocation?.allocation_pct });
    }
    catch (error) {
        next(error);
    }
});

// POST /investors/:id/reset-password — Admin sets new password
router.post('/investors/:id/reset-password', validate(resetPasswordSchema), async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id }).first();
        if (!user)
            throw new AppError('Investor not found', 404);
        const password_hash = await bcrypt.hash(req.body.password, 10);
        await db('users').where({ id: user.id }).update({ password_hash, updated_at: new Date() });
        await logAudit({
            userId: req.user.id,
            action: 'investor.password_reset',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip,
        });
        res.json({ message: 'Password updated successfully' });
    }
    catch (error) {
        next(error);
    }
});

// DELETE /investors/:id — Soft-delete investor
router.delete('/investors/:id', async (req, res, next) => {
    try {
        const user = await db('users').where({ id: req.params.id }).first();
        if (!user)
            throw new AppError('Investor not found', 404);
        if (user.id === req.user.id)
            throw new AppError('Cannot delete your own account', 400);
        await db('users').where({ id: user.id }).update({ is_active: false, updated_at: new Date() });
        await db('investor_allocations').where({ user_id: user.id, is_active: true }).update({ is_active: false, updated_at: new Date() });
        await logAudit({
            userId: req.user.id,
            action: 'investor.delete',
            entityType: 'user',
            entityId: user.id,
            oldValues: { full_name: user.full_name, email: user.email },
            ipAddress: req.ip,
        });
        res.json({ message: 'Investor deactivated' });
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

// ─── Moomoo Account Funds ────────────────────────────────────
function fundsToDbRow(funds) {
    return {
        acc_id: funds.accID || '',
        trd_market: funds.trdMarket ?? null,
        power: funds.power ?? 0,
        total_assets: funds.totalAssets ?? 0,
        cash: funds.cash ?? 0,
        market_val: funds.marketVal ?? 0,
        frozen_cash: funds.frozenCash ?? 0,
        debt_cash: funds.debtCash ?? 0,
        avl_withdrawal_cash: funds.avlWithdrawalCash ?? 0,
        max_power_short: funds.maxPowerShort ?? null,
        net_cash_power: funds.netCashPower ?? null,
        long_mv: funds.longMv ?? null,
        short_mv: funds.shortMv ?? null,
        pending_asset: funds.pendingAsset ?? null,
        max_withdrawal: funds.maxWithdrawal ?? null,
        risk_level: funds.riskLevel ?? null,
        risk_status: funds.riskStatus ?? null,
        margin_call_margin: funds.marginCallMargin ?? null,
        unrealized_pl: funds.unrealizedPL ?? null,
        realized_pl: funds.realizedPL ?? null,
        initial_margin: funds.initialMargin ?? null,
        maintenance_margin: funds.maintenanceMargin ?? null,
        is_pdt: funds.isPdt ?? false,
        pdt_seq: funds.pdtSeq ?? null,
        beginning_dtbp: funds.beginningDTBP ?? null,
        remaining_dtbp: funds.remainingDTBP ?? null,
        dt_call_amount: funds.dtCallAmount ?? null,
        dt_status: funds.dtStatus ?? null,
        securities_assets: funds.securitiesAssets ?? null,
        fund_assets: funds.fundAssets ?? null,
        bond_assets: funds.bondAssets ?? null,
        currency: funds.currency ?? null,
        fetched_at: new Date(funds.fetchedAt || Date.now()),
    };
}

function dbRowToFunds(row) {
    return {
        accID: row.acc_id,
        trdMarket: row.trd_market,
        power: parseFloat(row.power) || 0,
        totalAssets: parseFloat(row.total_assets) || 0,
        cash: parseFloat(row.cash) || 0,
        marketVal: parseFloat(row.market_val) || 0,
        frozenCash: parseFloat(row.frozen_cash) || 0,
        debtCash: parseFloat(row.debt_cash) || 0,
        avlWithdrawalCash: parseFloat(row.avl_withdrawal_cash) || 0,
        maxPowerShort: row.max_power_short != null ? parseFloat(row.max_power_short) : null,
        netCashPower: row.net_cash_power != null ? parseFloat(row.net_cash_power) : null,
        longMv: row.long_mv != null ? parseFloat(row.long_mv) : null,
        shortMv: row.short_mv != null ? parseFloat(row.short_mv) : null,
        pendingAsset: row.pending_asset != null ? parseFloat(row.pending_asset) : null,
        maxWithdrawal: row.max_withdrawal != null ? parseFloat(row.max_withdrawal) : null,
        riskLevel: row.risk_level,
        riskStatus: row.risk_status,
        marginCallMargin: row.margin_call_margin != null ? parseFloat(row.margin_call_margin) : null,
        unrealizedPL: row.unrealized_pl != null ? parseFloat(row.unrealized_pl) : null,
        realizedPL: row.realized_pl != null ? parseFloat(row.realized_pl) : null,
        initialMargin: row.initial_margin != null ? parseFloat(row.initial_margin) : null,
        maintenanceMargin: row.maintenance_margin != null ? parseFloat(row.maintenance_margin) : null,
        isPdt: !!row.is_pdt,
        pdtSeq: row.pdt_seq,
        beginningDTBP: row.beginning_dtbp != null ? parseFloat(row.beginning_dtbp) : null,
        remainingDTBP: row.remaining_dtbp != null ? parseFloat(row.remaining_dtbp) : null,
        dtCallAmount: row.dt_call_amount != null ? parseFloat(row.dt_call_amount) : null,
        dtStatus: row.dt_status,
        securitiesAssets: row.securities_assets != null ? parseFloat(row.securities_assets) : null,
        fundAssets: row.fund_assets != null ? parseFloat(row.fund_assets) : null,
        bondAssets: row.bond_assets != null ? parseFloat(row.bond_assets) : null,
        currency: row.currency,
        fetchedAt: row.fetched_at ? new Date(row.fetched_at).toISOString() : null,
        source: 'cached',
    };
}

router.get('/moomoo/funds', async (req, res, next) => {
    try {
        // Try live API first
        const funds = await getAccountFunds();
        if (funds) {
            // Save to DB
            const dbRow = fundsToDbRow(funds);
            try {
                const existing = await db('account_funds_cache').where('acc_id', funds.accID).first();
                if (existing) {
                    await db('account_funds_cache').where('acc_id', funds.accID).update(dbRow);
                } else {
                    await db('account_funds_cache').insert(dbRow);
                }
            } catch (err) {
                console.warn('[Admin] Failed to cache account funds:', err.message);
            }
            return res.json({ ...funds, source: 'live' });
        }

        // Fallback: read from DB cache
        const cached = await db('account_funds_cache').orderBy('fetched_at', 'desc').first();
        if (cached) {
            console.log('[Admin] Returning cached account funds');
            return res.json(dbRowToFunds(cached));
        }

        throw new AppError('Could not fetch account funds. Moomoo OpenD unavailable and no cached data.', 503);
    } catch (error) {
        next(error);
    }
});

router.get('/moomoo/accounts', async (req, res, next) => {
    try {
        const accounts = await getAccList();
        res.json({ accounts });
    } catch (error) {
        next(error);
    }
});

export default router;
