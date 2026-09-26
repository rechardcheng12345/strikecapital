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
