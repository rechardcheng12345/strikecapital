import { db } from '../config/database.js';
// Total realized P&L (net of commission + platform_fee)
export async function getTotalRealizedPnl() {
    const row = await db('pnl_records')
        .join('positions', 'pnl_records.position_id', 'positions.id')
        .select(db.raw('SUM(pnl_records.pnl_amount - COALESCE(positions.commission, 0) - COALESCE(positions.platform_fee, 0)) as total'))
        .first();
    return parseFloat(row?.total || '0') || 0;
}
// Utilization is measured against capital base = total fund capital + realized P&L
export async function getCapitalUtilization() {
    const settings = await db('fund_settings').first();
    const totalCollateral = await db('positions')
        .where('status', 'OPEN')
        .sum('collateral as total')
        .first();
    const utilized = parseFloat(totalCollateral?.total || '0');
    const total = parseFloat(settings?.total_fund_capital || '0');
    const realizedPnl = await getTotalRealizedPnl();
    const base = total + realizedPnl;
    const pct = base > 0 ? (utilized / base) * 100 : 0;
    return {
        totalCapital: total,
        realizedPnl,
        capitalBase: base,
        utilizedCapital: utilized,
        availableCapital: base - utilized,
        utilizationPct: Math.round(pct * 100) / 100,
    };
}
export async function getTickerConcentration() {
    const positions = await db('positions')
        .where('status', 'OPEN')
        .select('ticker')
        .sum('collateral as total_collateral')
        .groupBy('ticker')
        .orderBy('total_collateral', 'desc');
    const grandTotal = positions.reduce((sum, p) => sum + parseFloat(p.total_collateral), 0);
    return positions.map((p) => ({
        ticker: p.ticker,
        collateral: parseFloat(p.total_collateral),
        pct: grandTotal > 0 ? Math.round((parseFloat(p.total_collateral) / grandTotal) * 10000) / 100 : 0,
    }));
}
export async function getDistanceToStrikeDistribution() {
    const positions = await db('positions')
        .where('status', 'OPEN')
        .whereNotNull('current_price')
        .select('id', 'ticker', 'strike_price', 'current_price');
    return positions.map((p) => {
        const distance = ((p.current_price - p.strike_price) / p.current_price) * 100;
        return {
            id: p.id,
            ticker: p.ticker,
            strikePrice: parseFloat(p.strike_price),
            currentPrice: parseFloat(p.current_price),
            distancePct: Math.round(distance * 100) / 100,
            riskLevel: distance < 3 ? 'high' : distance < 8 ? 'medium' : 'low',
        };
    });
}
