import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../middleware/errorHandler.js';
import { logAudit } from '../services/auditLogger.js';
import { calculateCollateral, calculateBreakEven, calculateMaxProfit, calculateStockCollateral, calculateStockBreakEven } from '../services/pnlEngine.js';
import { notifyAllInvestors } from '../services/notificationEngine.js';
import { refreshAllPrices } from '../services/priceService.js';
import { insertAndFetch, updateAndFetch } from '../utils/dbHelpers.js';
const router = Router();

// Helper: compute unrealized P&L and distance_to_strike for a position
// stockPriceMap is optional — if provided, uses it for distance_to_strike
function addComputedFields(pos, stockPriceMap) {
    const p = { ...pos };
    if (p.current_price != null) {
        if (p.position_type === 'stock' && p.shares) {
            p.unrealized_pnl = Math.round(((parseFloat(p.current_price) - parseFloat(p.cost_basis)) * p.shares) * 100) / 100;
        } else if (p.position_type === 'option' && p.contracts > 0) {
            const fees = (parseFloat(p.commission) || 0) + (parseFloat(p.platform_fee) || 0);
            p.unrealized_pnl = Math.round((parseFloat(p.premium_received) - fees - (parseFloat(p.current_price) * p.contracts * 100)) * 100) / 100;
        } else {
            p.unrealized_pnl = null;
        }
    } else {
        p.unrealized_pnl = null;
    }

    // Compute distance_to_strike from cached stock price
    if (stockPriceMap && p.position_type === 'option') {
        const symbol = p.ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
        const stockPrice = stockPriceMap.get(symbol);
        if (stockPrice && stockPrice > 0) {
            const strike = parseFloat(p.strike_price);
            p.distance_to_strike = Math.round(((stockPrice - strike) / stockPrice) * 100 * 100) / 100;
            p.stock_price = stockPrice;
        }
    }

    return p;
}

// Helper: load stock prices from market_data_cache for a list of positions
async function loadStockPrices(positions) {
    const symbols = [...new Set(positions.map(p =>
        p.ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase()
    ).filter(s => s))];

    if (symbols.length === 0) return new Map();

    const cached = await db('market_data_cache')
        .whereIn('ticker', symbols)
        .select('ticker', 'current_price');

    const map = new Map();
    for (const row of cached) {
        map.set(row.ticker, parseFloat(row.current_price));
    }
    return map;
}

// Validation schemas
const createPositionSchema = z.object({
    ticker: z.string().min(1, 'Ticker is required'),
    position_type: z.enum(['option', 'stock']).optional().default('option'),
    strike_price: z.number().positive('Strike price must be positive'),
    premium_received: z.number().min(0, 'Premium must be non-negative'),
    contracts: z.number().int().min(0).optional().default(1),
    expiration_date: z.string().optional(),
    open_date: z.string().optional(),
    implied_volatility: z.number().optional(),
    notes: z.string().optional(),
    shares: z.number().int().min(1).optional(),
    cost_basis: z.number().positive().optional(),
    assigned_from_id: z.number().int().optional(),
    commission: z.number().min(0).optional().default(0),
    platform_fee: z.number().min(0).optional().default(0),
});
const updatePositionSchema = z.object({
    ticker: z.string().min(1).optional(),
    strike_price: z.number().positive().optional(),
    premium_received: z.number().positive().optional(),
    contracts: z.number().int().min(1).optional(),
    expiration_date: z.string().optional(),
    open_date: z.string().optional(),
    implied_volatility: z.number().optional(),
    notes: z.string().optional(),
    status: z.string().optional(),
    current_price: z.number().optional(),
    commission: z.number().min(0).optional(),
    platform_fee: z.number().min(0).optional(),
});
const resolvePositionSchema = z.object({
    resolution_type: z.enum(['expired_worthless', 'assigned', 'bought_to_close', 'rolled', 'sold']),
    close_premium: z.number().optional(),
    realized_pnl: z.number(),
});
const rollPositionSchema = z.object({
    ticker: z.string().optional(),
    strike_price: z.number().positive(),
    premium_received: z.number().positive(),
    contracts: z.number().int().min(1).optional(),
    expiration_date: z.string().min(1),
    notes: z.string().optional(),
    commission: z.number().min(0).optional().default(0),
    platform_fee: z.number().min(0).optional().default(0),
});
// GET / — List positions (paginated)
router.get('/', authenticate, async (req, res, next) => {
    try {
        const { status, ticker, position_type, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;
        let query = db('positions');
        let countQuery = db('positions');
        if (status) {
            query = query.where('status', status);
            countQuery = countQuery.where('status', status);
        }
        if (ticker) {
            query = query.where('ticker', ticker.toUpperCase());
            countQuery = countQuery.where('ticker', ticker.toUpperCase());
        }
        if (position_type) {
            query = query.where('position_type', position_type);
            countQuery = countQuery.where('position_type', position_type);
        }
        const [{ count }] = await countQuery.count('* as count');
        const total = parseInt(count, 10);
        const rawPositions = await query
            .orderBy('created_at', 'desc')
            .limit(limitNum)
            .offset(offset);
        const stockPriceMap = await loadStockPrices(rawPositions);
        const positions = rawPositions.map(p => addComputedFields(p, stockPriceMap));
        res.json({
            positions,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum),
            },
        });
    }
    catch (error) {
        next(error);
    }
});
// POST /refresh-prices — Refresh market prices for all open positions (admin only)
router.post('/refresh-prices', authenticate, requireAdmin, async (req, res, next) => {
    try {
        const result = await refreshAllPrices();
        res.json({
            message: `Refreshed prices for ${result.prices.length} tickers, updated ${result.updated} positions`,
            ...result,
        });
    } catch (error) {
        next(error);
    }
});
// GET /:id — Get position detail with timeline
router.get('/:id', authenticate, async (req, res, next) => {
    try {
        const { id } = req.params;
        const position = await db('positions').where({ id }).first();
        if (!position) {
            throw new AppError('Position not found', 404);
        }
        const stockPriceMap = await loadStockPrices([position]);
        res.json(addComputedFields(position, stockPriceMap));
    }
    catch (error) {
        next(error);
    }
});
// POST / — Create position (admin only)
router.post('/', authenticate, requireAdmin, validate(createPositionSchema), async (req, res, next) => {
    try {
        const { ticker, position_type, strike_price, premium_received, contracts, expiration_date, open_date, implied_volatility, notes, shares, cost_basis, assigned_from_id, commission = 0, platform_fee = 0, } = req.body;
        let collateral, break_even, max_profit;
        if (position_type === 'stock') {
            const stockShares = shares || (contracts * 100);
            const stockCostBasis = cost_basis || strike_price;
            collateral = calculateStockCollateral(stockShares, stockCostBasis);
            break_even = calculateStockBreakEven(stockCostBasis, premium_received || 0, stockShares);
            max_profit = 0; // Unlimited for stocks, stored as 0
            const position = await insertAndFetch('positions', {
                ticker: ticker.toUpperCase(),
                position_type: 'stock',
                strike_price: stockCostBasis,
                premium_received: premium_received || 0,
                commission,
                platform_fee,
                contracts: 0,
                shares: stockShares,
                cost_basis: stockCostBasis,
                expiration_date: null,
                open_date: open_date || new Date().toISOString().split('T')[0],
                notes: notes || null,
                collateral,
                break_even,
                max_profit,
                status: 'OPEN',
                created_by: req.user.id,
                assigned_from_id: assigned_from_id || null,
            });
            await logAudit({
                userId: req.user.id,
                action: 'position_created',
                entityType: 'position',
                entityId: position.id,
                newValues: position,
                ipAddress: req.ip,
            });
            await notifyAllInvestors('position_opened', `New Stock Position: ${ticker.toUpperCase()} (${stockShares} shares)`, `Stock position opened at $${stockCostBasis.toFixed(2)} cost basis.`, { position_id: position.id });
            return res.status(201).json(position);
        }
        // Default: option position
        collateral = calculateCollateral(strike_price, contracts);
        break_even = calculateBreakEven(strike_price, premium_received, contracts, commission, platform_fee);
        max_profit = calculateMaxProfit(premium_received, commission, platform_fee);
        const position = await insertAndFetch('positions', {
            ticker: ticker.toUpperCase(),
            position_type: 'option',
            strike_price,
            premium_received,
            commission,
            platform_fee,
            contracts,
            expiration_date,
            open_date: open_date || new Date().toISOString().split('T')[0],
            implied_volatility: implied_volatility || null,
            notes: notes || null,
            collateral,
            break_even,
            max_profit,
            status: 'OPEN',
            created_by: req.user.id,
        });
        await logAudit({
            userId: req.user.id,
            action: 'position_created',
            entityType: 'position',
            entityId: position.id,
            newValues: position,
            ipAddress: req.ip,
        });
        await notifyAllInvestors('position_opened', `New Position: ${ticker.toUpperCase()} $${strike_price} Put`, `${contracts} contract(s) opened with $${premium_received.toFixed(2)} premium received.`, { position_id: position.id });
        res.status(201).json(position);
    }
    catch (error) {
        next(error);
    }
});
// PUT /:id — Update position (admin only)
router.put('/:id', authenticate, requireAdmin, validate(updatePositionSchema), async (req, res, next) => {
    try {
        const { id } = req.params;
        const existing = await db('positions').where({ id }).first();
        if (!existing) {
            throw new AppError('Position not found', 404);
        }
        const updates = { ...req.body };
        // Recalculate computed fields if relevant fields changed
        const strike = updates.strike_price ?? existing.strike_price;
        const premium = updates.premium_received ?? existing.premium_received;
        const contracts = updates.contracts ?? existing.contracts;
        const comm = updates.commission ?? existing.commission ?? 0;
        const fee = updates.platform_fee ?? existing.platform_fee ?? 0;
        if (updates.strike_price || updates.premium_received || updates.contracts || updates.commission != null || updates.platform_fee != null) {
            updates.collateral = calculateCollateral(strike, contracts);
            updates.break_even = calculateBreakEven(strike, premium, contracts, comm, fee);
            updates.max_profit = calculateMaxProfit(premium, comm, fee);
        }
        const updated = await updateAndFetch('positions', { id }, updates);
        await logAudit({
            userId: req.user.id,
            action: 'position_updated',
            entityType: 'position',
            entityId: parseInt(id, 10),
            oldValues: existing,
            newValues: updated,
            ipAddress: req.ip,
        });
        res.json(updated);
    }
    catch (error) {
        next(error);
    }
});
// DELETE /:id — Delete position (admin only, only if OPEN)
router.delete('/:id', authenticate, requireAdmin, async (req, res, next) => {
    try {
        const { id } = req.params;
        const position = await db('positions').where({ id }).first();
        if (!position) {
            throw new AppError('Position not found', 404);
        }
        if (position.status !== 'OPEN') {
            throw new AppError('Only OPEN positions can be deleted', 400);
        }
        await db('positions').where({ id }).del();
        await logAudit({
            userId: req.user.id,
            action: 'position_deleted',
            entityType: 'position',
            entityId: parseInt(id, 10),
            oldValues: position,
            ipAddress: req.ip,
        });
        res.json({ message: 'Position deleted successfully' });
    }
    catch (error) {
        next(error);
    }
});
// POST /:id/resolve — Resolve position (admin only)
router.post('/:id/resolve', authenticate, requireAdmin, validate(resolvePositionSchema), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { resolution_type, close_premium, realized_pnl } = req.body;
        const position = await db('positions').where({ id }).first();
        if (!position) {
            throw new AppError('Position not found', 404);
        }
        if (position.status === 'RESOLVED') {
            throw new AppError('Position is already resolved', 400);
        }
        const closeDate = new Date().toISOString().split('T')[0];
        const updated = await updateAndFetch('positions', { id }, {
            status: 'RESOLVED',
            resolution_type,
            close_premium: close_premium ?? null,
            close_date: closeDate,
            realized_pnl,
        });
        // Create P&L record
        await db('pnl_records').insert({
            position_id: parseInt(id, 10),
            pnl_amount: realized_pnl,
            pnl_type: 'realized',
            record_date: closeDate,
            description: `Position resolved: ${resolution_type}`,
            created_by: req.user.id,
        });
        await logAudit({
            userId: req.user.id,
            action: 'position_resolved',
            entityType: 'position',
            entityId: parseInt(id, 10),
            oldValues: { status: position.status },
            newValues: { status: 'RESOLVED', resolution_type, realized_pnl, close_date: closeDate },
            ipAddress: req.ip,
        });
        await notifyAllInvestors('position_resolved', `Position Resolved: ${position.ticker} $${position.strike_price} Put`, `Resolution: ${resolution_type}. Realized P&L: $${realized_pnl.toFixed(2)}.`, { position_id: parseInt(id, 10), resolution_type, realized_pnl });
        let stockPosition = null;
        if (resolution_type === 'assigned' && position.position_type !== 'stock') {
            // Auto-create stock position from assignment
            const stockShares = position.contracts * 100;
            const stockCostBasis = parseFloat(position.strike_price);
            const originalPremium = parseFloat(position.premium_received);
            const stockCollateral = calculateStockCollateral(stockShares, stockCostBasis);
            const stockBreakEven = calculateStockBreakEven(stockCostBasis, originalPremium, stockShares);
            stockPosition = await insertAndFetch('positions', {
                ticker: position.ticker,
                position_type: 'stock',
                strike_price: stockCostBasis,
                premium_received: 0,
                contracts: 0,
                shares: stockShares,
                cost_basis: stockCostBasis,
                expiration_date: null,
                open_date: closeDate,
                collateral: stockCollateral,
                break_even: stockBreakEven,
                max_profit: 0,
                status: 'OPEN',
                created_by: req.user.id,
                assigned_from_id: parseInt(id, 10),
            });
            // Link option to stock
            await db('positions')
                .where({ id })
                .update({ assigned_to_id: stockPosition.id });
            await notifyAllInvestors('position_opened', `Assignment: ${position.ticker} Stock (${stockShares} shares)`, `Option assigned. Stock position created at $${stockCostBasis.toFixed(2)} cost basis.`, { position_id: stockPosition.id, assigned_from: parseInt(id, 10) });
        }
        res.json({ position: updated, stock_position: stockPosition });
    }
    catch (error) {
        next(error);
    }
});
// POST /:id/roll — Roll position (admin only)
router.post('/:id/roll', authenticate, requireAdmin, validate(rollPositionSchema), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { ticker, strike_price, premium_received, contracts: newContracts, expiration_date, notes, commission = 0, platform_fee = 0 } = req.body;
        const oldPosition = await db('positions').where({ id }).first();
        if (!oldPosition) {
            throw new AppError('Position not found', 404);
        }
        if (oldPosition.position_type === 'stock') {
            throw new AppError('Stock positions cannot be rolled', 400);
        }
        if (oldPosition.status === 'RESOLVED') {
            throw new AppError('Position is already resolved', 400);
        }
        const contracts = newContracts ?? oldPosition.contracts;
        const collateral = calculateCollateral(strike_price, contracts);
        const break_even = calculateBreakEven(strike_price, premium_received, contracts, commission, platform_fee);
        const max_profit = calculateMaxProfit(premium_received, commission, platform_fee);
        // Create new position
        const newPosition = await insertAndFetch('positions', {
            ticker: (ticker || oldPosition.ticker).toUpperCase(),
            strike_price,
            premium_received,
            commission,
            platform_fee,
            contracts,
            expiration_date,
            open_date: new Date().toISOString().split('T')[0],
            collateral,
            break_even,
            max_profit,
            status: 'OPEN',
            rolled_from_id: parseInt(id, 10),
            notes: notes || null,
            created_by: req.user.id,
        });
        // Resolve old position
        await db('positions')
            .where({ id })
            .update({
            status: 'RESOLVED',
            resolution_type: 'rolled',
            close_date: new Date().toISOString().split('T')[0],
            rolled_to_id: newPosition.id,
        });
        await logAudit({
            userId: req.user.id,
            action: 'position_rolled',
            entityType: 'position',
            entityId: parseInt(id, 10),
            oldValues: { position_id: parseInt(id, 10) },
            newValues: { new_position_id: newPosition.id, strike_price, premium_received, expiration_date },
            ipAddress: req.ip,
        });
        res.status(201).json({
            message: 'Position rolled successfully',
            old_position_id: parseInt(id, 10),
            new_position: newPosition,
        });
    }
    catch (error) {
        next(error);
    }
});
export default router;
