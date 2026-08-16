import { ensureConnected, getValidExpiryDates, getOptionChain, getSnapshots } from './moomooService.js';
import { fetchYahooPrice } from './priceService.js';
import { env } from '../config/env.js';
import { attachScoreParts, computeScanScore } from './scanScore.js';

async function callRemoteProxy(tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume, maxSpread, riskFreeRate, targetDelta) {
    try {
        const resp = await fetch(`${env.scannerProxyUrl}/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(env.scannerProxySecret ? { 'x-proxy-secret': env.scannerProxySecret } : {}),
            },
            body: JSON.stringify({ tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume, maxSpread, riskFreeRate, targetDelta }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) return { results: [], error: `Proxy error: ${resp.status}`, debug: {} };
        const payload = await resp.json();
        return {
            ...payload,
            results: attachScoreParts(payload.results, targetDelta),
        };
    } catch (err) {
        return { results: [], error: `Proxy unreachable: ${err.message}`, debug: {} };
    }
}

/**
 * Fetch stock prices for a list of tickers via Yahoo Finance.
 * Returns a map of { TICKER: price }.
 */
export async function fetchStockPrices(tickers) {
    const prices = {};
    await Promise.all(tickers.map(async (ticker) => {
        const result = await fetchYahooPrice(ticker);
        if (result?.price) prices[ticker] = result.price;
    }));
    return prices;
}

// ─── Black-Scholes Put Pricing ──────────────────────────────────────────────
// Used to compute a model "fair value" so we can flag market premium as
// overpriced (good for sellers) or underpriced.
function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * ax);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1.0 + sign * y);
}

function bsPutPrice(S, K, T, sigma, r) {
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

/**
 * Scan PUT options matching expiry window + discount range across given tickers.
 * @param {string[]} tickers
 * @param {Object}  stockPrices  - { NVDA: 112.50, ... }
 * @param {number}  minDays      - min days to expiry (default 14)
 * @param {number}  maxDays      - max days to expiry (default 28)
 * @param {number}  minDiscount  - min % below current price (default 10)
 * @param {number}  maxDiscount  - max % below current price (default 20)
 * @param {number}  minDelta     - min |delta| (default 0)
 * @param {number}  maxDelta     - max |delta| (default 1)
 * @param {number}  minReturn    - min return % on collateral
 * @param {number}  minOI        - min open interest
 * @param {number}  minVolume    - min day volume
 * @param {number}  maxSpread    - max bid/ask spread % of mid (0 or null = no filter)
 * @param {number}  riskFreeRate - decimal (e.g. 0.0525)
 * @param {number}  targetDelta  - score peaks at this |delta|; default 0.16 (≈14% assignment prob)
 */
export async function scanPutOptions(
    tickers, stockPrices,
    minDays = 14, maxDays = 28,
    minDiscount = 10, maxDiscount = 20,
    minDelta = 0, maxDelta = 1,
    minReturn = 0, minOI = 0, minVolume = 0,
    maxSpread = 0, riskFreeRate = 0.0525,
    targetDelta = 0.16
) {
    if (env.scannerProxyUrl) {
        console.log('[Scanner] using remote proxy:', env.scannerProxyUrl);
        return callRemoteProxy(tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume, maxSpread, riskFreeRate, targetDelta);
    }
    console.log('[Scanner] scanPutOptions called, tickers:', tickers, 'stockPrices:', stockPrices);
    const isConnected = await ensureConnected();
    console.log('[Scanner] isConnected:', isConnected);
    if (!isConnected) return { results: [], error: 'Moomoo OpenD not available', debug: {} };

    const today = new Date();
    const optionSecurities = [];
    const debug = {};

    console.log('[Scanner] entering loop, tickers count:', tickers.length);
    for (const ticker of tickers) {
        const stockPrice = stockPrices[ticker];
        console.log(`[Scanner] ticker=${ticker} stockPrice=${stockPrice}`);
        debug[ticker] = { stockPrice: stockPrice ?? null };
        if (!stockPrice) {
            debug[ticker].skipped = 'no stock price';
            continue;
        }

        const minStrike = stockPrice * (1 - maxDiscount / 100);
        const maxStrike = stockPrice * (1 - minDiscount / 100);
        debug[ticker].strikeRange = { min: Math.round(minStrike * 100) / 100, max: Math.round(maxStrike * 100) / 100 };

        let expiryDates = [];
        console.log(`[Scanner] calling getValidExpiryDates for ${ticker}`);
        try {
            expiryDates = await getValidExpiryDates(ticker);
            console.log(`[Scanner] ${ticker} expiry dates (${expiryDates.length}):`, expiryDates.slice(0, 5));
        } catch (e) {
            console.error(`[Scanner] getValidExpiryDates error for ${ticker}:`, e);
            debug[ticker].expiryError = e?.message ?? String(e);
            continue;
        }
        debug[ticker].allExpiries = expiryDates.slice(0, 10);

        const filteredExpiries = expiryDates.filter(d => {
            const days = Math.round((new Date(d) - today) / (1000 * 60 * 60 * 24));
            return days >= minDays && days <= maxDays;
        });
        console.log(`[Scanner] ${ticker} filteredExpiries (${minDays}-${maxDays}d):`, filteredExpiries);
        debug[ticker].filteredExpiries = filteredExpiries;

        for (const expiry of filteredExpiries) {
            let chain = [];
            try { chain = await getOptionChain(ticker, expiry); } catch (e) {
                debug[ticker][`chainError_${expiry}`] = e.message;
                continue;
            }
            debug[ticker][`chain_${expiry}`] = { total: chain.length, strikeSample: chain.slice(0, 5).map(o => o.strikePrice) };

            for (const opt of chain) {
                if (opt.strikePrice >= minStrike && opt.strikePrice <= maxStrike) {
                    optionSecurities.push({
                        market: opt.market,
                        code: opt.code,
                        ticker,
                        strike: opt.strikePrice,
                        expiry,
                        stockPrice,
                    });
                }
            }
        }
    }

    console.log('[Scanner] optionSecurities count:', optionSecurities.length, '| debug:', JSON.stringify(debug));
    if (optionSecurities.length === 0) return { results: [], debug };

    const secList = optionSecurities.map(o => ({ market: o.market, code: o.code }));
    console.log('[Scanner] requesting snapshots for:', secList);
    const snapshots = await getSnapshots(secList);
    console.log('[Scanner] snapshots count:', snapshots.length, '| first snap keys:', snapshots[0] ? Object.keys(snapshots[0]) : []);
    if (snapshots.length > 0) console.log('[Scanner] first snap basic:', JSON.stringify(snapshots[0].basic));
    const snapMap = new Map(snapshots.map(s => [s.basic?.security?.code, s]));

    const results = [];
    for (const opt of optionSecurities) {
        const snap = snapMap.get(opt.code);
        if (!snap) continue;
        const daysToExpiry = Math.round((new Date(opt.expiry) - today) / (1000 * 60 * 60 * 24));
        const discountPct = Math.round(((opt.stockPrice - opt.strike) / opt.stockPrice) * 10000) / 100;
        const premium = snap.basic?.curPrice ?? 0;
        const bid = snap.basic?.bidPrice ?? null;
        const ask = snap.basic?.askPrice ?? null;
        // Mid is the honest reference. Fall back to last/curPrice when one side is missing.
        let mid = null;
        if (bid != null && ask != null && bid > 0 && ask > 0) mid = (bid + ask) / 2;
        else if (premium > 0) mid = premium;
        const spreadPct = (bid != null && ask != null && bid > 0 && ask > 0 && mid > 0)
            ? Math.round(((ask - bid) / mid) * 10000) / 100
            : null;
        const delta = snap.optionExData?.delta ?? null;
        const openInterest = snap.optionExData?.openInterest ?? null;
        const volume = Number(snap.basic?.volume) || 0;
        // Moomoo IV is already a percentage (e.g. 45.7 means 45.7%). BS wants the decimal.
        const ivPct = snap.optionExData?.impliedVolatility ?? null;
        const sigma = ivPct != null ? ivPct / 100 : 0;
        const T = daysToExpiry / 365;
        const bsFair = bsPutPrice(opt.stockPrice, opt.strike, T, sigma, riskFreeRate);
        const premiumRef = mid ?? premium;
        const premiumEdgePct = bsFair > 0 && premiumRef > 0
            ? Math.round(((premiumRef - bsFair) / bsFair) * 10000) / 100
            : null;
        const returnPct = opt.strike > 0 ? Math.round((premiumRef / opt.strike) * 10000) / 100 : 0;
        const annualReturnPct = daysToExpiry > 0 ? Math.round(returnPct * (365 / daysToExpiry) * 100) / 100 : 0;
        const absDelta = delta != null ? Math.abs(delta) : 0;
        // Probability of keeping full premium ≈ 1 - |delta|. At |Δ|=0.145 → 85.5%.
        const popKeepPremium = delta != null ? Math.round((1 - absDelta) * 10000) / 100 : null;
        const { score, score_parts } = computeScanScore({
            returnPct,
            discountPct,
            absDelta: delta != null ? absDelta : null,
            openInterest,
            targetDelta,
        });
        results.push({
            ticker: opt.ticker,
            option_code: opt.code,
            stock_price: opt.stockPrice,
            strike: opt.strike,
            discount_pct: discountPct,
            expiry: opt.expiry,
            days_to_expiry: daysToExpiry,
            premium,
            bid,
            ask,
            mid: mid != null ? Math.round(mid * 10000) / 10000 : null,
            spread_pct: spreadPct,
            bs_fair_value: bsFair > 0 ? Math.round(bsFair * 10000) / 10000 : null,
            premium_edge_pct: premiumEdgePct,
            iv: ivPct,
            delta,
            pop_keep_premium: popKeepPremium,
            theta: snap.optionExData?.theta ?? null,
            open_interest: openInterest,
            volume,
            return_pct: returnPct,
            annual_return_pct: annualReturnPct,
            score,
            score_parts,
        });
    }

    const filtered = results.filter(r => {
        const abs = r.delta != null ? Math.abs(r.delta) : null;
        if (abs != null && abs < minDelta) return false;
        if (abs != null && abs > maxDelta) return false;
        if (r.return_pct < minReturn) return false;
        if (minOI > 0 && (r.open_interest == null || r.open_interest < minOI)) return false;
        if (minVolume > 0 && r.volume < minVolume) return false;
        // Only filter when a spread cap was set AND we have a real spread to evaluate.
        // Missing bid/ask (spread_pct == null) is left through — it just means quote data was thin.
        if (maxSpread > 0 && r.spread_pct != null && r.spread_pct > maxSpread) return false;
        return true;
    });
    filtered.sort((a, b) => b.score - a.score);
    return { results: filtered, debug };
}
