import { db } from '../config/database.js';
import { getCapitalUtilization } from './riskMetrics.js';

export function baseSymbol(ticker) {
    return String(ticker || '').replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
}

/**
 * Snapshot of what the fund can take on right now. Capital base = total capital + realized P&L
 * (same base as the Capital Utilization figures).
 */
export async function getPortfolioSnapshot() {
    const [util, settings, open] = await Promise.all([
        getCapitalUtilization(),
        db('fund_settings').first(),
        db('positions').where('status', 'OPEN').select('ticker', 'collateral'),
    ]);
    const exposure = {};
    for (const p of open) {
        const sym = baseSymbol(p.ticker);
        exposure[sym] = (exposure[sym] || 0) + (parseFloat(p.collateral) || 0);
    }
    const num = (v) => (v == null ? null : parseFloat(v));
    return {
        capitalBase: util.capitalBase,
        available: util.availableCapital,
        maxUtilizationPct: num(settings?.max_capital_utilization),
        maxSinglePositionPct: num(settings?.max_single_position),
        maxTickerConcentrationPct: num(settings?.max_ticker_concentration),
        maxCapitalPerPosition: num(settings?.max_capital_per_position),
        utilized: util.utilizedCapital,
        exposure,
    };
}

/**
 * Per-contract fit of one scan row against the fund's limits.
 * flags: NO_CAPITAL | OVER_UTILIZATION | OVER_POSITION_LIMIT | OVER_CONCENTRATION | ALREADY_HELD (info only)
 */
export function portfolioFit(row, snap) {
    const collateral = row.strike * 100;
    const sym = baseSymbol(row.ticker);
    const held = snap.exposure[sym] || 0;
    const base = snap.capitalBase > 0 ? snap.capitalBase : 0;
    const pctOf = (v) => (base > 0 ? Math.round((v / base) * 10000) / 100 : null);
    const flags = [];

    if (collateral > snap.available) flags.push('NO_CAPITAL');
    if (snap.maxUtilizationPct != null && base > 0
        && ((snap.utilized + collateral) / base) * 100 > snap.maxUtilizationPct) flags.push('OVER_UTILIZATION');
    if ((snap.maxCapitalPerPosition != null && collateral > snap.maxCapitalPerPosition)
        || (snap.maxSinglePositionPct != null && base > 0 && pctOf(collateral) > snap.maxSinglePositionPct)) {
        flags.push('OVER_POSITION_LIMIT');
    }
    const tickerAfterPct = pctOf(held + collateral);
    if (snap.maxTickerConcentrationPct != null && tickerAfterPct != null
        && tickerAfterPct > snap.maxTickerConcentrationPct) flags.push('OVER_CONCENTRATION');
    if (held > 0) flags.push('ALREADY_HELD');

    // Contracts affordable within available capital and the per-position caps.
    let cap = Math.max(0, snap.available);
    if (snap.maxCapitalPerPosition != null) cap = Math.min(cap, snap.maxCapitalPerPosition);
    if (snap.maxSinglePositionPct != null && base > 0) cap = Math.min(cap, base * snap.maxSinglePositionPct / 100);
    const maxContracts = collateral > 0 ? Math.floor(cap / collateral) : 0;

    return {
        collateral_pct_of_base: pctOf(collateral),
        collateral_pct_of_available: snap.available > 0 ? Math.round((collateral / snap.available) * 10000) / 100 : null,
        ticker_exposure_pct: pctOf(held),
        ticker_exposure_after_pct: tickerAfterPct,
        max_contracts: maxContracts,
        fit_flags: flags,
        fits: !flags.some(f => f !== 'ALREADY_HELD'),
    };
}
