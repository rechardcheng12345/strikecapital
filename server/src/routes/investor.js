import { Router } from 'express';
import { db } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
const router = Router();
// All investor routes require authentication
router.use(authenticate);
// ─── Dashboard (UF-01) ──────────────────────────────────────
router.get('/dashboard', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const allocation = await db('investor_allocations')
            .where({ user_id: userId, is_active: true })
            .first();
        const allocationPct = parseFloat(allocation?.allocation_pct || '0') / 100;
        // Active positions count
        const [activeResult] = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .count('* as count');
        // Total P&L (investor's share)
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
        // Unread notifications
        const [unreadResult] = await db('notifications')
            .where({ user_id: userId, is_read: false })
            .count('* as count');
        res.json({
            allocation: {
                allocation_amount: parseFloat(allocation?.allocation_amount || '0'),
                allocation_pct: parseFloat(allocation?.allocation_pct || '0'),
            },
            total_pnl_share: Math.round(totalPnl * allocationPct * 100) / 100,
            active_positions: parseInt(activeResult?.count || '0'),
            win_rate: winRate,
            unread_notifications: parseInt(unreadResult?.count || '0'),
        });
    }
    catch (error) {
        next(error);
    }
});
// ─── Positions (UF-02) ──────────────────────────────────────
router.get('/positions', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status;
        let query = db('positions');
        let countQuery = db('positions');
        if (status) {
            query = query.where('status', status);
            countQuery = countQuery.where('status', status);
        }
        const [{ count }] = await countQuery.count('* as count');
        const positions = await query.orderBy('created_at', 'desc').limit(limit).offset(offset);
        res.json({
            positions,
            pagination: {
                page, limit,
                total: parseInt(count),
                pages: Math.ceil(parseInt(count) / limit),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/positions/:id', async (req, res, next) => {
    try {
        const position = await db('positions').where({ id: req.params.id }).first();
        if (!position)
            throw new AppError('Position not found', 404);
        res.json(position);
    }
    catch (error) {
        next(error);
    }
});
// ─── P&L (UF-04) ────────────────────────────────────────────
router.get('/pnl', async (req, res, next) => {
    try {
        const userId = req.user.id;
        const period = req.query.period || 'all';
        const allocation = await db('investor_allocations')
            .where({ user_id: userId, is_active: true })
            .first();
        const allocationPct = parseFloat(allocation?.allocation_pct || '0') / 100;
        let startDate = null;
        const now = new Date();
        if (period === '1m')
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split('T')[0];
        else if (period === '3m')
            startDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).toISOString().split('T')[0];
        else if (period === 'ytd')
            startDate = `${now.getFullYear()}-01-01`;
        let pnlQuery = db('pnl_records').join('positions', 'pnl_records.position_id', 'positions.id');
        if (startDate)
            pnlQuery = pnlQuery.where('pnl_records.record_date', '>=', startDate);
        const records = await pnlQuery
            .select('pnl_records.*', 'positions.ticker', 'positions.strike_price')
            .orderBy('pnl_records.record_date', 'desc');
        const totalRealized = records.reduce((sum, r) => sum + parseFloat(r.pnl_amount), 0);
        res.json({
            total_pnl_share: Math.round(totalRealized * allocationPct * 100) / 100,
            allocation_pct: parseFloat(allocation?.allocation_pct || '0'),
            records: records.map((r) => ({
                position_id: r.position_id,
                ticker: r.ticker,
                pnl_share: Math.round(parseFloat(r.pnl_amount) * allocationPct * 100) / 100,
                record_date: r.record_date,
            })),
        });
    }
    catch (error) {
        next(error);
    }
});
// ─── History (UF-05) ─────────────────────────────────────────
router.get('/history', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const [{ count }] = await db('positions').where('status', 'RESOLVED').count('* as count');
        const positions = await db('positions')
            .where('status', 'RESOLVED')
            .orderBy('close_date', 'desc')
            .limit(limit)
            .offset(offset);
        // Summary stats
        const resolved = parseInt(count);
        const [wonCount] = await db('positions')
            .where('status', 'RESOLVED')
            .whereIn('resolution_type', ['expired_worthless', 'rolled'])
            .count('* as count');
        const [pnlSum] = await db('positions').where('status', 'RESOLVED').sum('realized_pnl as total');
        res.json({
            positions,
            stats: {
                total_resolved: resolved,
                total_realized_pnl: parseFloat(pnlSum?.total || '0'),
                win_rate: resolved > 0 ? Math.round((parseInt(wonCount?.count || '0') / resolved) * 100) : 0,
            },
            pagination: {
                page, limit,
                total: resolved,
                pages: Math.ceil(resolved / limit),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// ─── Announcements (UF-06) ──────────────────────────────────
router.get('/announcements', async (req, res, next) => {
    try {
        const announcements = await db('announcements')
            .where('is_active', true)
            .where('published_at', '<=', new Date())
            .orderBy('published_at', 'desc');
        res.json({ announcements });
    }
    catch (error) {
        next(error);
    }
});
// ─── Notifications (UF-10) ──────────────────────────────────
router.get('/notifications', async (req, res, next) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const userId = req.user.id;
        const [{ count }] = await db('notifications').where({ user_id: userId }).count('* as count');
        const notifications = await db('notifications')
            .where({ user_id: userId })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);
        const [unreadResult] = await db('notifications')
            .where({ user_id: userId, is_read: false })
            .count('* as count');
        res.json({
            notifications,
            unread_count: parseInt(unreadResult?.count || '0'),
            pagination: {
                page, limit,
                total: parseInt(count),
                pages: Math.ceil(parseInt(count) / limit),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.put('/notifications/:id/read', async (req, res, next) => {
    try {
        const updated = await db('notifications')
            .where({ id: req.params.id, user_id: req.user.id })
            .update({ is_read: true });
        if (!updated)
            throw new AppError('Notification not found', 404);
        res.json({ message: 'Marked as read' });
    }
    catch (error) {
        next(error);
    }
});
router.put('/notifications/read-all', async (req, res, next) => {
    try {
        await db('notifications')
            .where({ user_id: req.user.id, is_read: false })
            .update({ is_read: true });
        res.json({ message: 'All notifications marked as read' });
    }
    catch (error) {
        next(error);
    }
});
export default router;
