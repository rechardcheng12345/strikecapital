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
