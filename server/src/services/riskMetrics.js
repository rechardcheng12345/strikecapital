import { db } from '../config/database.js';
export async function getCapitalUtilization() {
    const settings = await db('fund_settings').first();
    const totalCollateral = await db('positions')
        .whereIn('status', ['OPEN', 'MONITORING'])
        .sum('collateral as total')
        .first();
    const utilized = parseFloat(totalCollateral?.total || '0');
    const total = parseFloat(settings?.total_fund_capital || '0');
    const pct = total > 0 ? (utilized / total) * 100 : 0;
    return {
        totalCapital: total,
        utilizedCapital: utilized,
        availableCapital: total - utilized,
        utilizationPct: Math.round(pct * 100) / 100,
    };
}
export async function getTickerConcentration() {
    const positions = await db('positions')
        .whereIn('status', ['OPEN', 'MONITORING'])
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
        .whereIn('status', ['OPEN', 'MONITORING'])
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
