// Black-Scholes for European puts (no dividends) — pricing, delta, implied volatility, strike for a
// target delta. Used by the backtest to price long-dated puts on days with no real quote.

export function normCdf(x) {
    // Abramowitz & Stegun 7.1.26 (|error| < 7.5e-8)
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989422804014327 * Math.exp(-x * x / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
}

function d1d2(S, K, T, r, sigma) {
    const v = sigma * Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / v;
    return [d1, d1 - v];
}

/** Put price per share. T in years, r and sigma as decimals. */
export function bsPut(S, K, T, r, sigma) {
    if (!(S > 0) || !(K > 0)) return 0;
    if (!(T > 0) || !(sigma > 0)) return Math.max(0, K - S);
    const [d1, d2] = d1d2(S, K, T, r, sigma);
    return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

/** Put delta (negative, −1 … 0). */
export function bsPutDelta(S, K, T, r, sigma) {
    if (!(T > 0) || !(sigma > 0)) return S < K ? -1 : 0;
    return normCdf(d1d2(S, K, T, r, sigma)[0]) - 1;
}

/** Implied volatility from a put price (bisection); null when the price is outside model bounds. */
export function impliedVolPut(price, S, K, T, r) {
    if (!(price > 0) || !(T > 0)) return null;
    const lo0 = bsPut(S, K, T, r, 0.01), hi0 = bsPut(S, K, T, r, 5);
    if (price < lo0 || price > hi0) return null;
    let lo = 0.01, hi = 5;
    for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        if (bsPut(S, K, T, r, mid) < price) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/**
 * Strike whose put delta is `targetDelta` (e.g. −0.25 or 0.25). sigmaFor(K) gives the volatility to use
 * at each strike (lets a skew apply). Bisection on K between 1% and 100% of S.
 */
export function strikeForDelta(S, T, r, sigmaFor, targetDelta) {
    const target = -Math.abs(targetDelta);
    let lo = S * 0.01, hi = S;
    for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        // Put delta grows more negative as the strike rises
        if (bsPutDelta(S, mid, T, r, sigmaFor(mid)) > target) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/** Annualized close-to-close volatility over the last `n` returns ending at index `i` (inclusive). */
export function histVol(closes, i, n) {
    if (i < n) return null;
    let sum = 0, sum2 = 0;
    for (let j = i - n + 1; j <= i; j++) {
        const x = Math.log(closes[j] / closes[j - 1]);
        sum += x;
        sum2 += x * x;
    }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, (sum2 - n * mean * mean) / (n - 1)) * 252);
}

/** Call price per share. */
export function bsCall(S, K, T, r, sigma) {
    if (!(S > 0) || !(K > 0)) return 0;
    if (!(T > 0) || !(sigma > 0)) return Math.max(0, S - K);
    const [d1, d2] = d1d2(S, K, T, r, sigma);
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

/** Call delta (0 … 1). */
export function bsCallDelta(S, K, T, r, sigma) {
    if (!(T > 0) || !(sigma > 0)) return S > K ? 1 : 0;
    return normCdf(d1d2(S, K, T, r, sigma)[0]);
}

/** Strike above the price whose call delta is `targetDelta` (bisection on K between S and 10·S). */
export function strikeForCallDelta(S, T, r, sigmaFor, targetDelta) {
    let lo = S, hi = S * 10;
    for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        // Call delta falls as the strike rises
        if (bsCallDelta(S, mid, T, r, sigmaFor(mid)) > targetDelta) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}
