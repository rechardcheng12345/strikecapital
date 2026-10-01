// Paper-trading (simulation) portfolios: fills at the live bid/ask mid, marks open positions, settles
// expiries (assignment when the underlying closes below the strike) and keeps one snapshot per NY day.
// Never touches the live fund's tables. Math lives in simMath.js.
import { db } from '../config/database.js';
import { fetchOptionQuotes, fetchYahooPrice, fetchStockQuotes } from './priceService.js';
import {
    quoteMid, optionFees, stockFees, closedPutPnl, closedStockPnl, portfolioTotals, unrealizedPnl,
    maxDrawdownPct, annualizedPct, tradeStats, nyClock, isMarketOpen, isExpiryDue, expiryOutcome,
    collateralFor, spreadWidth, spreadIntrinsic, spreadStopReason,
} from './simMath.js';

const NUM_FIELDS = ['strike', 'long_strike', 'entry_price', 'entry_fees', 'current_price', 'current_bid', 'current_ask', 'underlying_price', 'close_price', 'exit_fees', 'realized_pnl'];

class SimError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function ymd(d) {
    if (!d) return null;
    return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
function parseJson(text) {
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}
function normPortfolio(p) {
    return {
        ...p,
        starting_cash: Number(p.starting_cash),
        fee_per_contract: Number(p.fee_per_contract),
        fee_per_stock_trade: Number(p.fee_per_stock_trade),
        is_active: !!p.is_active,
        rules: parseJson(p.rules),
    };
}
function normPosition(p) {
    const out = { ...p };
    for (const k of NUM_FIELDS) out[k] = p[k] == null ? null : Number(p[k]);
    out.expiration_date = ymd(p.expiration_date);
    out.open_date = ymd(p.open_date);
    out.close_date = ymd(p.close_date);
    out.entry_context = parseJson(p.entry_context);
    out.monitor = parseJson(p.monitor);
    if (out.position_type === 'spread') {
        out.width = spreadWidth(out);
        out.max_loss = Math.round(((out.width - out.entry_price) * 100 * out.contracts + out.entry_fees) * 100) / 100;
    }
    if (out.status === 'OPEN') {
        out.unrealized_pnl = unrealizedPnl(out);
        if (out.position_type === 'option' || out.position_type === 'spread') {
            const premium = out.entry_price * 100 * out.contracts;
            out.collateral = collateralFor(out);
            out.profit_captured_pct = out.current_price != null && premium > 0
                ? Math.round(((out.entry_price - out.current_price) / out.entry_price) * 10000) / 100
                : null;
            out.days_to_expiry = out.expiration_date
                ? Math.round((new Date(`${out.expiration_date}T00:00:00Z`) - new Date(`${nyClock().date}T00:00:00Z`)) / 86400000)
                : null;
        }
    }
    return out;
}

async function loadPortfolio(id, trx = db) {
    const row = await trx('sim_portfolios').where({ id }).first();
    if (!row) throw new SimError('Portfolio not found', 404);
    return normPortfolio(row);
}
async function ledgerSum(portfolioId, trx = db) {
    const row = await trx('sim_transactions').where({ portfolio_id: portfolioId }).sum('amount as total').first();
    return Number(row?.total) || 0;
}
async function totalsFor(portfolio, trx = db) {
    const positions = (await trx('sim_positions').where({ portfolio_id: portfolio.id })).map(normPosition);
    return { positions, totals: portfolioTotals(portfolio, positions, await ledgerSum(portfolio.id, trx)) };
}

// ─── Quotes ───────────────────────────────────────────────────

/** Live quote for one put: { bid, ask, last, price (mid or last), source, iv, delta }. */
export async function quotePut({ ticker, strike, expiration_date }) {
    const [q] = await fetchOptionQuotes([{ id: 0, ticker: String(ticker).toUpperCase(), strike_price: Number(strike), expiration_date }]);
    if (!q) return null;
    const { price, source } = quoteMid({ bid: q.bid, ask: q.ask, last: q.option_price });
    return {
        bid: q.bid ?? null,
        ask: q.ask ?? null,
        last: q.option_price ?? null,
        price,
        source,
        implied_volatility: q.implied_volatility ?? null,
        delta: q.delta ?? null,
        option_code: q.option_code,
    };
}

function legMid(q) {
    return q ? quoteMid({ bid: q.bid, ask: q.ask, last: q.option_price }) : { price: null, source: null };
}

/**
 * Live quote for a vertical spread: each leg's bid/ask/mid, the net credit at the mids (short − long),
 * and the natural credit (short bid − long ask) you'd get crossing the spread.
 */
export async function quoteSpread({ ticker, expiration_date, option_type, short_strike, long_strike }) {
    const T = String(ticker).toUpperCase();
    const quotes = await fetchOptionQuotes([
        { id: 's', ticker: T, strike_price: Number(short_strike), expiration_date, option_type },
        { id: 'l', ticker: T, strike_price: Number(long_strike), expiration_date, option_type },
    ]);
    const s = quotes.find((q) => q.positionIds?.includes('s'));
    const l = quotes.find((q) => q.positionIds?.includes('l'));
    if (!s || !l) return null;
    const sm = legMid(s), lm = legMid(l);
    const leg = (q, m) => ({ bid: q.bid ?? null, ask: q.ask ?? null, mid: m.price, delta: q.delta ?? null, option_code: q.option_code });
    return {
        short: leg(s, sm),
        long: leg(l, lm),
        credit: sm.price != null && lm.price != null ? Math.round((sm.price - lm.price) * 10000) / 10000 : null,
        natural_credit: s.bid != null && l.ask != null ? Math.round((s.bid - l.ask) * 10000) / 10000 : null,
        source: sm.source === 'mid' && lm.source === 'mid' ? 'mid' : 'last',
    };
}

/** Fill price: explicit override → live mid → the caller's reference price (e.g. the scanner row's mid). */
async function resolveFill({ ticker, strike, expiration_date, price, fallback_price }) {
    if (price != null) return { price: Number(price), source: 'manual' };
    const q = await quotePut({ ticker, strike, expiration_date });
    if (q?.price > 0) return { price: q.price, source: q.source, bid: q.bid, ask: q.ask };
    if (fallback_price > 0) return { price: Number(fallback_price), source: 'scanner' };
    throw new SimError('No live quote for that contract (check the strike and expiry exist, and that OpenD / the scanner proxy is running). Enter a fill price to trade anyway.');
}

// ─── Portfolios ───────────────────────────────────────────────

export async function listPortfolios() {
    const rows = (await db('sim_portfolios').orderBy('created_at', 'asc')).map(normPortfolio);
    const out = [];
    for (const p of rows) {
        const { positions, totals } = await totalsFor(p);
        const stats = tradeStats(positions);
        const snaps = await db('sim_snapshots').where({ portfolio_id: p.id }).orderBy('snap_date').select('snap_date', 'total_value', 'spy_price');
        out.push({
            ...p,
            ...totals,
            max_drawdown_pct: maxDrawdownPct([p.starting_cash, ...snaps.map((s) => Number(s.total_value)), totals.total_value]),
            annualized_pct: annualizedPct(p.starting_cash, totals.total_value, daysSince(p.created_at)),
            win_rate_pct: stats.win_rate_pct,
            closed_trades: stats.closed_trades,
            snapshots: snaps.map((s) => ({ snap_date: ymd(s.snap_date), total_value: Number(s.total_value), spy_price: s.spy_price == null ? null : Number(s.spy_price) })),
        });
    }
    return out;
}

function daysSince(d) {
    return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000));
}

export async function getPortfolio(id) {
    const p = await loadPortfolio(id);
    const { positions, totals } = await totalsFor(p);
    const transactions = await db('sim_transactions').where({ portfolio_id: id }).orderBy('id', 'desc').limit(500);
    const snapshots = (await db('sim_snapshots').where({ portfolio_id: id }).orderBy('snap_date')).map((s) => ({
        snap_date: ymd(s.snap_date),
        cash: Number(s.cash),
        collateral: Number(s.collateral),
        realized: Number(s.realized),
        unrealized: Number(s.unrealized),
        total_value: Number(s.total_value),
        spy_price: s.spy_price == null ? null : Number(s.spy_price),
    }));
    return {
        portfolio: p,
        totals: {
            ...totals,
            max_drawdown_pct: maxDrawdownPct([p.starting_cash, ...snapshots.map((s) => s.total_value), totals.total_value]),
            annualized_pct: annualizedPct(p.starting_cash, totals.total_value, daysSince(p.created_at)),
            days_running: daysSince(p.created_at),
        },
        stats: tradeStats(positions),
        open_positions: positions.filter((x) => x.status === 'OPEN').sort((a, b) => String(a.expiration_date).localeCompare(String(b.expiration_date))),
        closed_positions: positions.filter((x) => x.status === 'CLOSED').sort((a, b) => b.id - a.id),
        transactions: transactions.map((t) => ({ ...t, amount: Number(t.amount), fees: Number(t.fees) })),
        snapshots,
    };
}

export async function createPortfolio({ name, description, starting_cash, fee_per_contract = 0, fee_per_stock_trade = 0, spread_exit_rule = 'touch' }, userId) {
    const [id] = await db('sim_portfolios').insert({
        name, description: description || null, starting_cash, fee_per_contract, fee_per_stock_trade, spread_exit_rule, created_by: userId || null,
    });
    await snapshotPortfolio(await loadPortfolio(id), await spyPrice());
    return loadPortfolio(id);
}

export async function updatePortfolio(id, updates) {
    const p = await loadPortfolio(id);
    const patch = {};
    for (const k of ['name', 'description', 'fee_per_contract', 'fee_per_stock_trade', 'is_active', 'spread_exit_rule']) {
        if (updates[k] !== undefined) patch[k] = updates[k];
    }
    if (updates.starting_cash !== undefined && Number(updates.starting_cash) !== p.starting_cash) {
        const [{ n }] = await db('sim_transactions').where({ portfolio_id: id }).count('* as n');
        if (Number(n) > 0) throw new SimError('Starting cash can only be changed before the first trade.');
        patch.starting_cash = updates.starting_cash;
    }
    if (Object.keys(patch).length) await db('sim_portfolios').where({ id }).update({ ...patch, updated_at: db.fn.now() });
    return loadPortfolio(id);
}

export async function deletePortfolio(id) {
    await loadPortfolio(id);
    await db('sim_portfolios').where({ id }).del();
}

// ─── Trading ──────────────────────────────────────────────────

/** Sell to open a cash-secured put at the mid. Refused when free cash can't cover the collateral. */
export async function openPut(portfolioId, input, trx = null) {
    const ticker = String(input.ticker || '').trim().toUpperCase().replace(/\s+(PUT|P)$/, '');
    const strike = Number(input.strike);
    const contracts = Number(input.contracts) || 1;
    const expiration_date = ymd(input.expiration_date);
    if (!ticker || !(strike > 0) || !expiration_date) throw new SimError('Ticker, strike and expiration date are required');
    if (!(contracts >= 1)) throw new SimError('Contracts must be at least 1');
    if (expiration_date < nyClock().date) throw new SimError('That option has already expired');
    const fill = input.resolvedFill || await resolveFill({ ticker, strike, expiration_date, price: input.price, fallback_price: input.fallback_price });

    const run = async (t) => {
        const p = await loadPortfolio(portfolioId, t);
        if (!p.is_active) throw new SimError('Portfolio is paused');
        const { totals } = await totalsFor(p, t);
        const fees = optionFees(p, contracts);
        const premium = Math.round(fill.price * 100 * contracts * 100) / 100;
        const need = strike * 100 * contracts;
        const freeAfter = totals.free_cash + premium - fees - need;
        if (freeAfter < -0.005) {
            throw new SimError(`Not enough free cash: this put needs $${need.toFixed(2)} collateral, free cash after the premium would be $${freeAfter.toFixed(2)}`);
        }
        const context = input.entry_context ? JSON.stringify(input.entry_context).slice(0, 4000) : null;
        const [id] = await t('sim_positions').insert({
            portfolio_id: p.id, position_type: 'option', ticker, strike, expiration_date, contracts,
            entry_price: fill.price, entry_source: fill.source, entry_fees: fees, open_date: nyClock().date,
            current_price: fill.price, current_bid: fill.bid ?? null, current_ask: fill.ask ?? null, price_source: fill.source, price_updated_at: new Date(),
            rolled_from_id: input.rolled_from_id || null, entry_context: context, notes: input.notes || null,
        });
        await t('sim_transactions').insert({
            portfolio_id: p.id, position_id: id, type: 'sell_to_open', amount: premium - fees, fees,
            description: `Sold ${contracts} ${ticker} ${expiration_date} $${strike}P @ ${fill.price} (${fill.source})`,
        });
        return id;
    };
    const id = trx ? await run(trx) : await db.transaction(run);
    return normPosition(await (trx || db)('sim_positions').where({ id }).first());
}

function spreadLabel(pos) {
    return `${pos.ticker} ${pos.expiration_date} ${pos.strike}/${pos.long_strike} ${pos.option_type} spread`;
}

/**
 * Sell one vertical credit spread, or an iron condor (a put leg + a call leg, linked by group_id), at the
 * live mids. legs: [{ option_type, short_strike, long_strike, price? (net credit override) }].
 * Free cash must cover the width × 100 × contracts the broker holds against each spread.
 */
export async function openSpreads(portfolioId, input) {
    const ticker = String(input.ticker || '').trim().toUpperCase();
    const contracts = Number(input.contracts) || 1;
    const expiration_date = ymd(input.expiration_date);
    const legs = input.legs || [];
    if (!ticker || !expiration_date || !legs.length) throw new SimError('Ticker, expiry and at least one spread are required');
    if (legs.length > 2 || (legs.length === 2 && legs[0].option_type === legs[1].option_type)) throw new SimError('Use one put spread and/or one call spread');
    if (expiration_date < nyClock().date) throw new SimError('That expiry has already passed');
    const fills = [];
    for (const leg of legs) {
        const K = Number(leg.short_strike), L = Number(leg.long_strike);
        if (leg.option_type === 'put' ? !(L < K) : !(L > K)) {
            throw new SimError(leg.option_type === 'put'
                ? 'Put spread: the long (bought) strike must be below the short strike'
                : 'Call spread: the long (bought) strike must be above the short strike');
        }
        let credit, source = 'manual';
        if (leg.price != null) credit = Number(leg.price);
        else {
            const q = await quoteSpread({ ticker, expiration_date, option_type: leg.option_type, short_strike: K, long_strike: L });
            if (!q || q.credit == null) throw new SimError(`No live quote for the ${leg.option_type} spread ${K}/${L} — check the strikes exist for ${expiration_date}, or enter a credit.`);
            credit = q.credit;
            source = q.source;
        }
        if (!(credit > 0)) throw new SimError(`The ${leg.option_type} spread ${K}/${L} has no credit (${credit}).`);
        fills.push({ option_type: leg.option_type, short_strike: K, long_strike: L, credit, source });
    }
    const [uq] = await fetchStockQuotes([ticker]);
    const monitor = JSON.stringify({ entry_price: uq?.price ?? null, entry_high: uq?.high ?? null, entry_low: uq?.low ?? null, source: uq?.source ?? null });
    const group_id = fills.length > 1 ? `ic-${Date.now()}-${Math.round(Math.random() * 1e6)}` : null;

    const ids = await db.transaction(async (t) => {
        const p = await loadPortfolio(portfolioId, t);
        if (!p.is_active) throw new SimError('Portfolio is paused');
        const { totals } = await totalsFor(p, t);
        const fees = optionFees(p, contracts * 2); // two legs per spread
        let freeAfter = totals.free_cash;
        for (const f of fills) freeAfter += f.credit * 100 * contracts - fees - Math.abs(f.short_strike - f.long_strike) * 100 * contracts;
        if (freeAfter < -0.005) throw new SimError(`Not enough free cash: free cash after this trade would be $${freeAfter.toFixed(2)}`);
        const context = input.entry_context ? JSON.stringify(input.entry_context).slice(0, 4000) : null;
        const out = [];
        for (const f of fills) {
            const [id] = await t('sim_positions').insert({
                portfolio_id: p.id, position_type: 'spread', option_type: f.option_type, ticker,
                strike: f.short_strike, long_strike: f.long_strike, expiration_date, contracts,
                entry_price: f.credit, entry_source: f.source, entry_fees: fees, open_date: nyClock().date,
                current_price: f.credit, price_source: f.source, price_updated_at: new Date(),
                underlying_price: uq?.price ?? null, group_id, monitor, entry_context: context, notes: input.notes || null,
            });
            const premium = Math.round(f.credit * 100 * contracts * 100) / 100;
            await t('sim_transactions').insert({
                portfolio_id: p.id, position_id: id, type: 'sell_to_open', amount: premium - fees, fees,
                description: `Sold ${contracts} ${ticker} ${expiration_date} ${f.short_strike}/${f.long_strike} ${f.option_type} spread @ ${f.credit} (${f.source})`,
            });
            out.push(id);
        }
        return out;
    });
    return (await db('sim_positions').whereIn('id', ids)).map(normPosition);
}

const CLOSE_TEXT = { stopped: 'Stopped out', expired: 'Expired worthless', settled: 'Settled at expiry', bought_to_close: 'Bought to close' };

/** Close a spread at a net debit (buy back the short, sell the long), clamped to 0 … width. */
async function closeSpreadRow(t, p, pos, { price, reason, note = null }) {
    const debit = Math.min(spreadWidth(pos), Math.max(0, Number(price)));
    const fees = reason === 'expired' || reason === 'settled' ? 0 : optionFees(p, pos.contracts * 2);
    const realized = closedPutPnl({ entryPrice: pos.entry_price, closePrice: debit, contracts: pos.contracts, entryFees: pos.entry_fees, exitFees: fees });
    await t('sim_positions').where({ id: pos.id }).update({
        status: 'CLOSED', close_reason: reason, close_price: debit, exit_fees: fees, close_date: nyClock().date,
        realized_pnl: realized, current_price: debit, close_note: note, updated_at: t.fn.now(),
    });
    const cost = Math.round(debit * 100 * pos.contracts * 100) / 100;
    await t('sim_transactions').insert({
        portfolio_id: p.id, position_id: pos.id,
        type: reason === 'expired' || reason === 'settled' ? reason : 'buy_to_close',
        amount: -(cost + fees), fees,
        description: `${CLOSE_TEXT[reason] || reason}: ${spreadLabel(pos)} @ ${debit}${note ? ` — ${note}` : ''}`,
    });
    return realized;
}

async function liveSpreadDebit(pos) {
    const q = await quoteSpread({ ticker: pos.ticker, expiration_date: pos.expiration_date, option_type: pos.option_type, short_strike: pos.strike, long_strike: pos.long_strike });
    return q?.credit != null ? Math.max(0, q.credit) : null;
}

async function loadOpenPosition(positionId, trx = db) {
    const pos = await trx('sim_positions').where({ id: positionId }).first();
    if (!pos) throw new SimError('Position not found', 404);
    if (pos.status !== 'OPEN') throw new SimError('Position is already closed');
    return normPosition(pos);
}

async function closePutRow(t, p, pos, { price, reason, rolledToId = null, description }) {
    const fees = reason === 'bought_to_close' || reason === 'rolled' ? optionFees(p, pos.contracts) : 0;
    const realized = closedPutPnl({ entryPrice: pos.entry_price, closePrice: price, contracts: pos.contracts, entryFees: pos.entry_fees, exitFees: fees });
    await t('sim_positions').where({ id: pos.id }).update({
        status: 'CLOSED', close_reason: reason, close_price: price, exit_fees: fees, close_date: nyClock().date,
        realized_pnl: realized, rolled_to_id: rolledToId, current_price: price, updated_at: t.fn.now(),
    });
    const cost = Math.round(price * 100 * pos.contracts * 100) / 100;
    if (cost > 0 || fees > 0) {
        await t('sim_transactions').insert({ portfolio_id: p.id, position_id: pos.id, type: 'buy_to_close', amount: -(cost + fees), fees, description });
    }
    return realized;
}

/** Buy to close a put at the mid, or sell shares at the given / latest Yahoo price. */
export async function closePosition(positionId, { price } = {}) {
    const pos = await loadOpenPosition(positionId);
    if (pos.position_type === 'stock') {
        let px = price != null ? Number(price) : null;
        if (px == null) px = (await fetchYahooPrice(pos.ticker))?.price ?? null;
        if (!(px > 0)) throw new SimError('No stock price available — enter a sale price.');
        await db.transaction(async (t) => {
            const p = await loadPortfolio(pos.portfolio_id, t);
            const fees = stockFees(p);
            const realized = closedStockPnl({ costBasis: pos.entry_price, salePrice: px, shares: pos.shares, entryFees: pos.entry_fees, exitFees: fees });
            await t('sim_positions').where({ id: pos.id }).update({
                status: 'CLOSED', close_reason: 'sold', close_price: px, exit_fees: fees, close_date: nyClock().date,
                realized_pnl: realized, current_price: px, updated_at: t.fn.now(),
            });
            await t('sim_transactions').insert({
                portfolio_id: p.id, position_id: pos.id, type: 'sell_stock', amount: Math.round(px * pos.shares * 100) / 100 - fees, fees,
                description: `Sold ${pos.shares} ${pos.ticker} @ ${px}`,
            });
        });
    } else if (pos.position_type === 'spread') {
        const debit = price != null ? Number(price) : await liveSpreadDebit(pos);
        if (debit == null) throw new SimError('No live quote for the spread — enter a closing debit.');
        await db.transaction(async (t) => {
            const p = await loadPortfolio(pos.portfolio_id, t);
            await closeSpreadRow(t, p, pos, { price: debit, reason: 'bought_to_close' });
        });
    } else {
        const fill = await resolveFill({ ticker: pos.ticker, strike: pos.strike, expiration_date: pos.expiration_date, price, fallback_price: pos.current_price });
        await db.transaction(async (t) => {
            const p = await loadPortfolio(pos.portfolio_id, t);
            await closePutRow(t, p, pos, {
                price: fill.price, reason: 'bought_to_close',
                description: `Bought to close ${pos.contracts} ${pos.ticker} ${pos.expiration_date} $${pos.strike}P @ ${fill.price} (${fill.source})`,
            });
        });
    }
    return normPosition(await db('sim_positions').where({ id: positionId }).first());
}

/** Roll: buy the put back at the mid and sell a new one at its mid, as one step. */
export async function rollPosition(positionId, input) {
    const pos = await loadOpenPosition(positionId);
    if (pos.position_type !== 'option') throw new SimError('Only puts can be rolled');
    const closeFill = await resolveFill({ ticker: pos.ticker, strike: pos.strike, expiration_date: pos.expiration_date, price: input.close_price, fallback_price: pos.current_price });
    const strike = Number(input.strike ?? pos.strike);
    const expiration_date = ymd(input.expiration_date);
    const openFill = await resolveFill({ ticker: pos.ticker, strike, expiration_date, price: input.price, fallback_price: input.fallback_price });
    return db.transaction(async (t) => {
        const p = await loadPortfolio(pos.portfolio_id, t);
        await closePutRow(t, p, pos, {
            price: closeFill.price, reason: 'rolled',
            description: `Rolled: bought back ${pos.contracts} ${pos.ticker} ${pos.expiration_date} $${pos.strike}P @ ${closeFill.price} (${closeFill.source})`,
        });
        const next = await openPut(p.id, {
            ticker: pos.ticker, strike, expiration_date, contracts: input.contracts ?? pos.contracts,
            resolvedFill: openFill, rolled_from_id: pos.id, entry_context: pos.entry_context, notes: input.notes,
        }, t);
        await t('sim_positions').where({ id: pos.id }).update({ rolled_to_id: next.id });
        return next;
    });
}

async function settleExpiry(pos, underlying) {
    if (pos.position_type === 'spread') {
        const value = spreadIntrinsic(pos, underlying);
        await db.transaction(async (t) => {
            const p = await loadPortfolio(pos.portfolio_id, t);
            await closeSpreadRow(t, p, pos, { price: value, reason: value > 0 ? 'settled' : 'expired', note: `${pos.ticker} closed at ${underlying}` });
            await t('sim_positions').where({ id: pos.id }).update({ underlying_price: underlying });
        });
        return value > 0 ? 'settled' : 'expired';
    }
    const outcome = expiryOutcome(pos.strike, underlying);
    await db.transaction(async (t) => {
        const p = await loadPortfolio(pos.portfolio_id, t);
        await closePutRow(t, p, pos, { price: 0, reason: outcome, description: null });
        await t('sim_positions').where({ id: pos.id }).update({ underlying_price: underlying });
        if (outcome === 'expired') {
            await t('sim_transactions').insert({
                portfolio_id: p.id, position_id: pos.id, type: 'expired', amount: 0, fees: 0,
                description: `${pos.ticker} ${pos.expiration_date} $${pos.strike}P expired worthless (${pos.ticker} ${underlying})`,
            });
            return;
        }
        const shares = pos.contracts * 100;
        const [stockId] = await t('sim_positions').insert({
            portfolio_id: p.id, position_type: 'stock', ticker: pos.ticker, shares, entry_price: pos.strike,
            entry_source: 'assigned', entry_fees: 0, open_date: nyClock().date, current_price: underlying,
            price_source: 'yahoo', price_updated_at: new Date(), underlying_price: underlying, assigned_from_id: pos.id,
        });
        await t('sim_transactions').insert({
            portfolio_id: p.id, position_id: stockId, type: 'assigned', amount: -(pos.strike * shares), fees: 0,
            description: `Assigned ${shares} ${pos.ticker} @ $${pos.strike} (closed at ${underlying})`,
        });
    });
    return outcome;
}

// ─── Marking, expiry, snapshots ───────────────────────────────

async function spyPrice() {
    return (await fetchYahooPrice('SPY'))?.price ?? null;
}

async function snapshotPortfolio(p, spy) {
    const { totals } = await totalsFor(p);
    const row = {
        cash: totals.cash, collateral: totals.collateral, realized: totals.realized, unrealized: totals.unrealized,
        total_value: totals.total_value, spy_price: spy, updated_at: db.fn.now(),
    };
    const snap_date = nyClock().date;
    const existing = await db('sim_snapshots').where({ portfolio_id: p.id, snap_date }).first();
    if (existing) await db('sim_snapshots').where({ id: existing.id }).update({ ...row, spy_price: spy ?? existing.spy_price });
    else await db('sim_snapshots').insert({ portfolio_id: p.id, snap_date, ...row });
}

async function openPositions(portfolioId = null) {
    const q = db('sim_positions as s')
        .join('sim_portfolios as p', 'p.id', 's.portfolio_id')
        .where('s.status', 'OPEN').where('p.is_active', true)
        .select('s.*');
    if (portfolioId) q.where('s.portfolio_id', portfolioId);
    return (await q).map(normPosition);
}

/**
 * Mark open puts and spreads at the live Moomoo mids (bid/ask; last trade when a side is missing) and
 * refresh the underlying / assigned-share prices (Moomoo real time, Yahoo fallback). Returns the underlying
 * quotes ({ price, high, low }) for expiry settlement and spread stops.
 */
async function markPositions(open, { quoteOptions = true } = {}) {
    const priced = open.filter((x) => x.position_type === 'option' || x.position_type === 'spread');
    const out = { marked: 0, unquoted: 0, underlying: new Map(), quotes: new Map() };
    if (priced.length && quoteOptions) {
        const req = [];
        for (const x of priced) {
            const base = { ticker: x.ticker, expiration_date: x.expiration_date, option_type: x.option_type || 'put' };
            if (x.position_type === 'spread') {
                req.push({ ...base, id: `${x.id}:s`, strike_price: x.strike }, { ...base, id: `${x.id}:l`, strike_price: x.long_strike });
            } else {
                req.push({ ...base, id: x.id, strike_price: x.strike });
            }
        }
        const byId = new Map();
        for (const q of await fetchOptionQuotes(req)) for (const id of q.positionIds || []) byId.set(String(id), q);
        const now = new Date();
        for (const x of priced) {
            let patch = null;
            if (x.position_type === 'spread') {
                const sq = byId.get(`${x.id}:s`), lq = byId.get(`${x.id}:l`);
                const sm = sq && quoteMid({ bid: sq.bid, ask: sq.ask, last: sq.option_price });
                const lm = lq && quoteMid({ bid: lq.bid, ask: lq.ask, last: lq.option_price });
                if (sm?.price != null && lm?.price != null) {
                    const width = spreadWidth(x);
                    const clamp = (v) => (v == null ? null : Math.round(Math.min(width, Math.max(0, v)) * 10000) / 10000);
                    patch = {
                        current_price: clamp(sm.price - lm.price),
                        current_bid: sq.bid != null && lq.ask != null ? clamp(sq.bid - lq.ask) : null,
                        current_ask: sq.ask != null && lq.bid != null ? clamp(sq.ask - lq.bid) : null,
                        price_source: sm.source === 'mid' && lm.source === 'mid' ? 'mid' : 'last',
                    };
                }
            } else {
                const q = byId.get(String(x.id));
                const m = q && quoteMid({ bid: q.bid, ask: q.ask, last: q.option_price });
                if (m?.price > 0) patch = { current_price: m.price, current_bid: q.bid ?? null, current_ask: q.ask ?? null, price_source: m.source };
            }
            if (!patch) {
                out.unquoted++;
                continue;
            }
            out.marked++;
            await db('sim_positions').where({ id: x.id }).update({ ...patch, price_updated_at: now });
        }
    }
    const tickers = [...new Set(open.map((x) => x.ticker))];
    for (const q of tickers.length ? await fetchStockQuotes(tickers) : []) {
        if (q?.price > 0) {
            out.underlying.set(q.ticker, q.price);
            out.quotes.set(q.ticker, q);
        }
    }
    for (const x of open) {
        const px = out.underlying.get(x.ticker);
        if (!px) continue;
        const patch = { underlying_price: px };
        if (x.position_type === 'stock') Object.assign(patch, { current_price: px, price_source: out.quotes.get(x.ticker)?.source || 'yahoo', price_updated_at: new Date() });
        await db('sim_positions').where({ id: x.id }).update(patch);
    }
    return out;
}

// Pages poll for live prices; several tabs must not each hit the proxy, so a mark is reused for a few seconds.
const LIVE_MIN_GAP_MS = 15000;
const lastLiveMark = new Map(); // portfolioId | 'all' → { at, promise }

/** Mark one portfolio (or all active ones) at live prices, at most once per LIVE_MIN_GAP_MS. */
export async function markLive(portfolioId = null) {
    const key = portfolioId || 'all';
    const prev = lastLiveMark.get(key) || lastLiveMark.get('all');
    if (prev && Date.now() - prev.at < LIVE_MIN_GAP_MS) return prev.promise;
    const promise = (async () => {
        const r = await markPositions(await openPositions(portfolioId));
        return { marked: r.marked, unquoted: r.unquoted, marked_at: new Date().toISOString() };
    })();
    lastLiveMark.set(key, { at: Date.now(), promise });
    try {
        return await promise;
    } catch (err) {
        lastLiveMark.delete(key);
        throw err;
    }
}

let running = false;

/**
 * Mark open puts at the mid (market hours only unless forced), refresh underlying / stock prices,
 * settle expired puts, then upsert today's snapshot for every active portfolio.
 */
export async function refreshSimulation({ force = false } = {}) {
    if (running) return { skipped: 'already running' };
    running = true;
    const result = { marked: 0, unquoted: 0, expired: 0, assigned: 0, snapshots: 0, market_open: isMarketOpen() };
    try {
        const open = await openPositions();
        const marks = await markPositions(open, { quoteOptions: force || result.market_open });
        result.marked = marks.marked;
        result.unquoted = marks.unquoted;

        for (const x of open.filter((pp) => (pp.position_type === 'option' || pp.position_type === 'spread') && isExpiryDue(pp.expiration_date))) {
            const px = marks.underlying.get(x.ticker);
            if (!px) continue; // retried on the next run
            const outcome = await settleExpiry(x, px);
            result[outcome] = (result[outcome] || 0) + 1;
        }

        const { weekday } = nyClock();
        if (weekday !== 'Sat' && weekday !== 'Sun') {
            const spy = await spyPrice();
            for (const p of (await db('sim_portfolios').where({ is_active: true })).map(normPortfolio)) {
                await snapshotPortfolio(p, spy);
                result.snapshots++;
            }
        }
        return result;
    } finally {
        running = false;
    }
}

let monitoring = false;

/**
 * Every minute in market hours: mark open spreads and close any that hit their portfolio's exit rule
 * (touch of the short strike, 2× credit loss, or hold to expiry) at the live debit.
 */
export async function monitorSpreads({ force = false } = {}) {
    if (monitoring || (!force && !isMarketOpen())) return { skipped: true };
    monitoring = true;
    try {
        const open = (await openPositions()).filter((x) => x.position_type === 'spread');
        if (!open.length) return { checked: 0, stopped: 0 };
        const marks = await markPositions(open);
        const rules = new Map((await db('sim_portfolios').whereIn('id', [...new Set(open.map((x) => x.portfolio_id))]).select('id', 'spread_exit_rule'))
            .map((r) => [r.id, r.spread_exit_rule || 'touch']));
        let stopped = 0;
        for (const x of (await db('sim_positions').whereIn('id', open.map((o) => o.id)).where('status', 'OPEN')).map(normPosition)) {
            const reason = spreadStopReason(x, rules.get(x.portfolio_id), marks.quotes.get(x.ticker) || {}, x.monitor || {});
            if (!reason || x.current_price == null) continue;
            await db.transaction(async (t) => {
                const p = await loadPortfolio(x.portfolio_id, t);
                await closeSpreadRow(t, p, x, { price: x.current_price, reason: 'stopped', note: reason });
            });
            stopped++;
        }
        return { checked: open.length, stopped };
    } finally {
        monitoring = false;
    }
}

let simInterval = null;
let monitorInterval = null;
export function startSimulationJob(intervalMinutes = 30) {
    const tick = () => refreshSimulation().catch((err) => console.warn('[Simulation] refresh failed:', err.message));
    console.log(`[Simulation] Starting job every ${intervalMinutes} minutes; spread exits checked every minute in market hours`);
    simInterval = setInterval(tick, intervalMinutes * 60 * 1000);
    monitorInterval = setInterval(() => monitorSpreads().catch((err) => console.warn('[Simulation] spread monitor failed:', err.message)), 60 * 1000);
}
export function stopSimulationJob() {
    if (simInterval) clearInterval(simInterval);
    if (monitorInterval) clearInterval(monitorInterval);
    simInterval = null;
    monitorInterval = null;
}
