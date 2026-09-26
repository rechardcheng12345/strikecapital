// Roll finder for open cash-secured puts: prices "buy to close the current put, sell a later put"
// using the same scanner pipeline (local OpenD or remote proxy), then ranks the candidates in code.
import { db } from '../config/database.js';
import { scanPutOptions, fetchStockPrices } from './scannerService.js';
import { enrichScanRow } from './scanScore.js';
import { getVolatilityStats, getEarningsDate } from './marketContext.js';
import { getPortfolioSnapshot, baseSymbol } from './portfolioFit.js';
import { calculateProfitCapturedPct } from './pnlEngine.js';

const DAY_MS = 86400000;

function toCalendarDate(d) {
    if (!d) return null;
    return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
function daysUntil(dateStr, today = new Date()) {
    const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return Math.round((new Date(`${dateStr}T00:00:00Z`) - t) / DAY_MS);
}
function round(v, dp = 2) {
    if (v == null || !Number.isFinite(v)) return null;
    const f = 10 ** dp;
    return Math.round(v * f) / f;
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
// Discount % bounds that make the scanner return strikes in [lowStrike, highStrike].
function discountRange(S, lowStrike, highStrike) {
    return {
        minDiscount: ((S - highStrike) / S) * 100 - 0.01,
        maxDiscount: ((S - lowStrike) / S) * 100 + 0.01,
    };
}

/**
 * Why an open put may need attention. Used for the "Roll watch" list on the scanner page.
 * Reasons: ITM (strike above stock), CLOSE_TO_STRIKE (< 5% cushion), SHORT_DTE (≤ 21 days and < 50% captured),
 * LOSING (option now worth more than it was sold for), TAKE_PROFIT (≥ 80% captured — close rather than roll).
 */
export async function getRollWatchList() {
    const positions = await db('positions')
        .where({ status: 'OPEN', position_type: 'option' })
        .select('id', 'ticker', 'strike_price', 'premium_received', 'contracts', 'expiration_date', 'current_price', 'last_price_update');
    const symbols = [...new Set(positions.map(p => baseSymbol(p.ticker)))];
    const cached = symbols.length
        ? await db('market_data_cache').whereIn('ticker', symbols).select('ticker', 'current_price')
        : [];
    const stockMap = new Map(cached.map(r => [r.ticker, parseFloat(r.current_price)]));

    return positions.map(p => {
        const symbol = baseSymbol(p.ticker);
        const strike = parseFloat(p.strike_price);
        const expiry = toCalendarDate(p.expiration_date);
        const dte = expiry ? daysUntil(expiry) : null;
        const stock = stockMap.get(symbol) ?? null;
        const captured = calculateProfitCapturedPct(p.premium_received, p.current_price, p.contracts);
        const cushionPct = stock ? round(((stock - strike) / stock) * 100) : null;
        const reasons = [];
        if (cushionPct != null && cushionPct < 0) reasons.push('ITM');
        else if (cushionPct != null && cushionPct < 5) reasons.push('CLOSE_TO_STRIKE');
        if (dte != null && dte <= 21 && (captured == null || captured < 50)) reasons.push('SHORT_DTE');
        if (captured != null && captured < 0) reasons.push('LOSING');
        if (captured != null && captured >= 80) reasons.push('TAKE_PROFIT');
        return {
            id: p.id,
            ticker: symbol,
            strike,
            contracts: p.contracts,
            expiry,
            dte,
            stock_price: stock,
            cushion_pct: cushionPct,
            option_price: p.current_price != null ? parseFloat(p.current_price) : null,
            premium_received: parseFloat(p.premium_received),
            profit_captured_pct: captured,
            reasons,
            needs_attention: reasons.length > 0,
        };
    }).sort((a, b) => (b.needs_attention - a.needs_attention) || ((a.dte ?? 999) - (b.dte ?? 999)));
}

/**
 * Roll candidates for one open put.
 * @param {number} positionId
 * @param {object} opts { minDays=28, maxDays=63, expiryTargets=[30,45,60], maxStrikeDropPct=20, riskFreeRate }
 */
export async function findRollCandidates(positionId, {
    minDays = 28, maxDays = 63, expiryTargets = [30, 45, 60], maxStrikeDropPct = 20, riskFreeRate = 0.0525,
} = {}) {
    const pos = await db('positions').where({ id: positionId }).first();
    if (!pos) return { error: 'Position not found', status: 404 };
    if (pos.position_type !== 'option') return { error: 'Only option positions can be rolled', status: 400 };
    if (pos.status === 'RESOLVED') return { error: 'Position is already resolved', status: 400 };

    const ticker = baseSymbol(pos.ticker);
    const K = parseFloat(pos.strike_price);
    const contracts = pos.contracts || 1;
    const expiry = toCalendarDate(pos.expiration_date);
    const dte = expiry ? daysUntil(expiry) : 0;

    const [prices, vol, earnings, portfolio] = await Promise.all([
        fetchStockPrices([ticker]), getVolatilityStats(ticker), getEarningsDate(ticker), getPortfolioSnapshot(),
    ]);
    const S = prices[ticker];
    if (!S) return { error: `No stock price for ${ticker}`, status: 502 };
    const stockPrices = { [ticker]: S };

    // 1) Live cost to close the current put (ask = what we'd actually pay; fall back to mid, then cached price).
    let close = { source: 'cached', per_share: pos.current_price != null ? parseFloat(pos.current_price) : null };
    if (dte >= 0) {
        const { minDiscount, maxDiscount } = discountRange(S, K, K);
        const cur = await scanPutOptions([ticker], stockPrices, Math.max(0, dte - 1), dte + 1, minDiscount, maxDiscount,
            0, 1, 0, 0, 0, 0, riskFreeRate, 0.2, []);
        const row = (cur.results || []).find(r => Math.abs(r.strike - K) < 0.001 && r.expiry === expiry);
        if (row) {
            const px = row.ask > 0 ? row.ask : (row.mid ?? row.premium);
            if (px != null) close = { source: row.ask > 0 ? 'ask' : 'mid', per_share: px, bid: row.bid, ask: row.ask, mid: row.mid, delta: row.delta };
        }
    }
    if (close.per_share == null) return { error: 'Could not price the current option — refresh prices and try again', status: 502 };
    const closeCost = close.per_share * 100 * contracts;

    // 2) Later puts at the same strike or lower (roll out, or down-and-out).
    const lowStrike = K * (1 - maxStrikeDropPct / 100);
    const { minDiscount, maxDiscount } = discountRange(S, lowStrike, K);
    const later = await scanPutOptions([ticker], stockPrices, Math.max(minDays, dte + 7), maxDays, minDiscount, maxDiscount,
        0, 1, 0, 0, 0, 0, riskFreeRate, 0.2, expiryTargets);
    if (later.error && !(later.results || []).length) return { error: later.error, status: 502 };

    const origPremium = parseFloat(pos.premium_received) || 0;
    const oldCollateral = K * 100 * contracts;
    const candidates = (later.results || [])
        .filter(r => r.expiry > expiry)
        .map(r => enrichScanRow(r, { riskFreeRate, vol, earnings }))
        .map(r => {
            // Sell at the bid to be conservative; mid shown alongside.
            const sellPx = r.bid > 0 ? r.bid : (r.mid ?? r.premium ?? 0);
            const newCredit = sellPx * 100 * contracts;
            const net = newCredit - closeCost;
            const newCollateral = r.strike * 100 * contracts;
            const extraDays = r.days_to_expiry - Math.max(dte, 0);
            const netAnnPct = extraDays > 0 ? (net / newCollateral) * (365 / extraDays) * 100 : null;
            const strikeDropPct = ((K - r.strike) / K) * 100;
            // Effective cost if assigned on the new put, counting everything collected on this chain.
            const effectiveCost = r.strike - (origPremium + net) / (100 * contracts);
            const extraCollateral = newCollateral - oldCollateral;

            const parts = {
                credit: clamp01((netAnnPct ?? 0) / 25) * 35,
                strike: clamp01(strikeDropPct / 10) * 25,
                cushion: clamp01((r.sigma_otm ?? 0) / 1.5) * 25,
                clean: (r.earnings_before_expiry ? 0 : 10) + (r.spread_pct == null ? 2.5 : clamp01((25 - r.spread_pct) / 20) * 5),
            };
            const rollScore = net < 0 ? 0 : Math.round(parts.credit + parts.strike + parts.cushion + parts.clean);
            return {
                option_code: r.option_code,
                strike: r.strike,
                expiry: r.expiry,
                days_to_expiry: r.days_to_expiry,
                extra_days: extraDays,
                bid: r.bid, ask: r.ask, mid: r.mid, spread_pct: r.spread_pct,
                delta: r.delta, iv: r.iv,
                sigma_otm: r.sigma_otm,
                earnings_before_expiry: r.earnings_before_expiry,
                earnings_date: r.earnings_date,
                new_credit: round(newCredit),
                net_credit: round(net),
                net_ann_pct: round(netAnnPct),
                strike_drop_pct: round(strikeDropPct),
                effective_cost_if_assigned: round(effectiveCost),
                extra_collateral: round(extraCollateral),
                fits_capital: extraCollateral <= Math.max(0, portfolio.available),
                roll_score: rollScore,
                roll_score_parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, round(v)])),
            };
        })
        .sort((a, b) => (b.roll_score - a.roll_score) || (b.net_credit - a.net_credit));

    return {
        position: {
            id: pos.id, ticker, strike: K, contracts, expiry, dte,
            premium_received: origPremium,
            stock_price: S,
            cushion_pct: round(((S - K) / S) * 100),
        },
        close: { ...close, cost: round(closeCost) },
        candidates,
        credit_count: candidates.filter(c => c.net_credit >= 0).length,
        debug: later.debug,
    };
}
