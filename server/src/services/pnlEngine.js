export function calculateCollateral(strikePrice, contracts) {
    return strikePrice * contracts * 100;
}
export function calculateBreakEven(strikePrice, premiumReceived, contracts, commission = 0, platformFee = 0) {
    const netPremium = premiumReceived - commission - platformFee;
    const premiumPerShare = netPremium / (contracts * 100);
    return strikePrice - premiumPerShare;
}
export function calculateMaxProfit(premiumReceived, commission = 0, platformFee = 0) {
    return premiumReceived - commission - platformFee;
}
export function calculateDistanceToStrike(currentPrice, strikePrice) {
    if (currentPrice === 0)
        return 0;
    return ((currentPrice - strikePrice) / currentPrice) * 100;
}
export function calculateAnnualizedReturn(premiumReceived, collateral, daysHeld) {
    if (collateral === 0 || daysHeld === 0)
        return 0;
    return (premiumReceived / collateral) * (365 / daysHeld) * 100;
}
export function calculateReturnOnCollateral(premiumReceived, collateral) {
    if (collateral === 0)
        return 0;
    return (premiumReceived / collateral) * 100;
}
export function calculateStockCollateral(shares, costBasis) {
    return Math.round(shares * costBasis * 100) / 100;
}
export function calculateStockBreakEven(costBasis, originalPremium, shares) {
    return Math.round((costBasis - (originalPremium / shares)) * 100) / 100;
}
// % of max profit captured on a short option: (premium received − current cost to close) / premium received.
// 100% = option worth $0, 0% = unchanged, negative = option now worth more than sold for. Gross of fees.
export function calculateProfitCapturedPct(premiumReceived, currentPrice, contracts) {
    const premium = parseFloat(premiumReceived);
    const price = parseFloat(currentPrice);
    if (!(premium > 0) || !(contracts > 0) || currentPrice == null || isNaN(price)) return null;
    const costToClose = price * contracts * 100;
    return Math.round(((premium - costToClose) / premium) * 10000) / 100;
}

// ─── Covered calls ──────────────────────────────────────
// A call is written against shares the fund already holds, so it ties up no extra cash (collateral 0).
export function calculateCallBreakEven(strikePrice, premiumReceived, contracts, commission = 0, platformFee = 0) {
    const netPremium = premiumReceived - commission - platformFee;
    return strikePrice + netPremium / (contracts * 100);
}
// % the stock can move against the short option before it is in the money: positive = out of the money.
// Put: stock falling to the strike. Call: stock rising to the strike.
export function calculateOptionDistancePct(stockPrice, strikePrice, optionType = 'put') {
    const s = Number(stockPrice);
    const k = Number(strikePrice);
    if (!(s > 0) || !(k > 0)) return null;
    const pct = optionType === 'call' ? (k - s) / s : (s - k) / s;
    return Math.round(pct * 10000) / 100;
}
// Shares sold at the strike when a call is exercised, and the stock leg's realized P&L.
export function calculateCalledAway(strikePrice, contracts, costBasis) {
    const shares = contracts * 100;
    return { shares, proceeds: Math.round(strikePrice * shares * 100) / 100, realized_pnl: Math.round((strikePrice - costBasis) * shares * 100) / 100 };
}
// Shares of a stock position still free to cover a new call, given the open calls already written on it.
export function uncoveredShares(stockShares, openCalls) {
    return stockShares - openCalls.reduce((n, c) => n + Number(c.contracts) * 100, 0);
}
