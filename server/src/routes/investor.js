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
            .where('status', 'OPEN')
            .count('* as count');
        // Total P&L (investor's share, net of commission + platform_fee)
        const pnlResult = await db('pnl_records')
            .join('positions', 'pnl_records.position_id', 'positions.id')
            .select(db.raw('SUM(pnl_records.pnl_amount - COALESCE(positions.commission, 0) - COALESCE(positions.platform_fee, 0)) as total'))
            .first();
        const totalPnl = parseFloat(pnlResult?.total || '0');
        // Win rate: resolved positions where net P&L > 0
        const [resolvedCount] = await db('positions').where('status', 'RESOLVED').count('* as count');
        const wonResult = await db('pnl_records')
            .join('positions', 'pnl_records.position_id', 'positions.id')
            .where('positions.status', 'RESOLVED')
            .whereRaw('(pnl_records.pnl_amount - COALESCE(positions.commission, 0) - COALESCE(positions.platform_fee, 0)) > 0')
            .countDistinct('positions.id as count')
            .first();
        const resolved = parseInt(resolvedCount?.count || '0');
        const won = parseInt(wonResult?.count || '0');
        const winRate = resolved > 0 ? Math.round((won / resolved) * 100) : 0;
        // Unread notifications
        const [unreadResult] = await db('notifications')
            .where({ user_id: userId, is_read: false })
            .count('* as count');

        // Unrealized P&L from open positions with current_price
        const openPositions = await db('positions')
            .where('status', 'OPEN')
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

        const allocationAmount = parseFloat(allocation?.invested_amount || '0');
        const realizedShare = Math.round(totalPnl * allocationPct * 100) / 100;
        const unrealizedShare = Math.round(totalUnrealizedPnl * allocationPct * 100) / 100;
        const total_return_pct = allocationAmount > 0
            ? Math.round(((realizedShare + unrealizedShare) / allocationAmount) * 10000) / 100
            : null;

        res.json({
            allocation: {
                allocation_amount: allocationAmount,
                allocation_pct: parseFloat(allocation?.allocation_pct || '0'),
            },
            total_pnl_share: realizedShare,
            unrealized_pnl_share: unrealizedShare,
            total_return_pct,
            active_positions: parseInt(activeResult?.count || '0'),
            win_rate: winRate,
            unread_notifications: parseInt(unreadResult?.count || '0'),
            last_price_update: latestUpdate?.last_price_update || null,
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
        const rawPositions = await query.orderBy('created_at', 'desc').limit(limit).offset(offset);
        // Load cached stock prices for distance_to_strike
        const symbols = [...new Set(rawPositions.map(p =>
            p.ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase()
        ).filter(s => s))];
        const cachedStocks = symbols.length > 0
            ? await db('market_data_cache').whereIn('ticker', symbols).select('ticker', 'current_price')
            : [];
        const stockPriceMap = new Map(cachedStocks.map(r => [r.ticker, parseFloat(r.current_price)]));

        // Add computed fields
        const positions = rawPositions.map(pos => {
            const p = { ...pos };
            if (p.current_price != null) {
                if (p.position_type === 'stock' && p.shares) {
                    p.unrealized_pnl = Math.round(((parseFloat(p.current_price) - parseFloat(p.cost_basis)) * p.shares) * 100) / 100;
                } else if (p.contracts > 0) {
                    const fees = (parseFloat(p.commission) || 0) + (parseFloat(p.platform_fee) || 0);
                    p.unrealized_pnl = Math.round((parseFloat(p.premium_received) - fees - (parseFloat(p.current_price) * p.contracts * 100)) * 100) / 100;
                } else {
                    p.unrealized_pnl = null;
                }
            } else {
                p.unrealized_pnl = null;
            }
            // Distance to strike from stock price
            if (p.position_type === 'option') {
                const sym = p.ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
                const sp = stockPriceMap.get(sym);
                if (sp && sp > 0) {
                    const strike = parseFloat(p.strike_price);
                    p.distance_to_strike = Math.round(((sp - strike) / sp) * 100 * 100) / 100;
                    p.stock_price = sp;
                }
            }
            return p;
        });
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
        // Add computed fields
        const p = { ...position };
        if (p.current_price != null) {
            if (p.position_type === 'stock' && p.shares) {
                p.unrealized_pnl = Math.round(((parseFloat(p.current_price) - parseFloat(p.cost_basis)) * p.shares) * 100) / 100;
            } else if (p.contracts > 0) {
                const fees = (parseFloat(p.commission) || 0) + (parseFloat(p.platform_fee) || 0);
                p.unrealized_pnl = Math.round((parseFloat(p.premium_received) - fees - (parseFloat(p.current_price) * p.contracts * 100)) * 100) / 100;
            }
        }
        // Distance to strike from cached stock price
        if (p.position_type === 'option') {
            const sym = p.ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
            const cached = await db('market_data_cache').where('ticker', sym).first();
            if (cached) {
                const sp = parseFloat(cached.current_price);
                if (sp > 0) {
                    const strike = parseFloat(p.strike_price);
                    p.distance_to_strike = Math.round(((sp - strike) / sp) * 100 * 100) / 100;
                    p.stock_price = sp;
                }
            }
        }
        res.json(p);
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
            .select('pnl_records.*', 'positions.ticker', 'positions.strike_price', 'positions.commission', 'positions.platform_fee')
            .orderBy('pnl_records.record_date', 'desc');
        const totalRealized = records.reduce((sum, r) => {
            const fees = (parseFloat(r.commission) || 0) + (parseFloat(r.platform_fee) || 0);
            return sum + parseFloat(r.pnl_amount) - fees;
        }, 0);
        res.json({
            total_pnl_share: Math.round(totalRealized * allocationPct * 100) / 100,
            allocation_pct: parseFloat(allocation?.allocation_pct || '0'),
            records: records.map((r) => {
                const fees = (parseFloat(r.commission) || 0) + (parseFloat(r.platform_fee) || 0);
                return {
                    position_id: r.position_id,
                    ticker: r.ticker,
                    pnl_share: Math.round((parseFloat(r.pnl_amount) - fees) * allocationPct * 100) / 100,
                    record_date: r.record_date,
                };
            }),
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
        const wonCount = await db('pnl_records')
            .join('positions', 'pnl_records.position_id', 'positions.id')
            .where('positions.status', 'RESOLVED')
            .whereRaw('(pnl_records.pnl_amount - COALESCE(positions.commission, 0) - COALESCE(positions.platform_fee, 0)) > 0')
            .countDistinct('positions.id as count')
            .first();
        const pnlSum = await db('positions').where('status', 'RESOLVED')
            .select(db.raw('SUM(realized_pnl - COALESCE(commission, 0) - COALESCE(platform_fee, 0)) as total'))
            .first();
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
