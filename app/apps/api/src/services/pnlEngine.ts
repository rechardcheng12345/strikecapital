export function calculateCollateral(strikePrice: number, contracts: number): number {
  return strikePrice * contracts * 100;
}

export function calculateBreakEven(strikePrice: number, premiumReceived: number, contracts: number): number {
  const premiumPerShare = premiumReceived / (contracts * 100);
  return strikePrice - premiumPerShare;
}

export function calculateMaxProfit(premiumReceived: number): number {
  return premiumReceived;
}

export function calculateDistanceToStrike(currentPrice: number, strikePrice: number): number {
  if (currentPrice === 0) return 0;
  return ((currentPrice - strikePrice) / currentPrice) * 100;
}

export function calculateAnnualizedReturn(premiumReceived: number, collateral: number, daysHeld: number): number {
  if (collateral === 0 || daysHeld === 0) return 0;
  return (premiumReceived / collateral) * (365 / daysHeld) * 100;
}

export function calculateReturnOnCollateral(premiumReceived: number, collateral: number): number {
  if (collateral === 0) return 0;
  return (premiumReceived / collateral) * 100;
}

export function calculateStockCollateral(shares: number, costBasis: number): number {
  return Math.round(shares * costBasis * 100) / 100;
}

export function calculateStockBreakEven(costBasis: number, originalPremium: number, shares: number): number {
  return Math.round((costBasis - (originalPremium / shares)) * 100) / 100;
}
