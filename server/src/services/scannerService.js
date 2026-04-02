import { ensureConnected, getValidExpiryDates, getOptionChain, getSnapshots } from './moomooService.js';
import { fetchYahooPrice } from './priceService.js';
import { env } from '../config/env.js';

async function callRemoteProxy(tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume) {
    try {
        const resp = await fetch(`${env.scannerProxyUrl}/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(env.scannerProxySecret ? { 'x-proxy-secret': env.scannerProxySecret } : {}),
            },
            body: JSON.stringify({ tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) return { results: [], error: `Proxy error: ${resp.status}`, debug: {} };
        return await resp.json();
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

/**
 * Scan PUT options matching expiry window + discount range across given tickers.
 * @param {string[]} tickers
 * @param {Object}  stockPrices  - { NVDA: 112.50, ... }
 * @param {number}  minDays      - min days to expiry (default 12)
 * @param {number}  maxDays      - max days to expiry (default 20)
 * @param {number}  minDiscount  - min % below current price (default 10)
 * @param {number}  maxDiscount  - max % below current price (default 20)
 */
export async function scanPutOptions(
    tickers, stockPrices,
    minDays = 14, maxDays = 28,
    minDiscount = 10, maxDiscount = 20,
    minDelta = 0, maxDelta = 1,
    minReturn = 0, minOI = 0, minVolume = 0
) {
    if (env.scannerProxyUrl) {
        console.log('[Scanner] using remote proxy:', env.scannerProxyUrl);
        return callRemoteProxy(tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume);
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
        const delta = snap.optionExData?.delta ?? null;
        const openInterest = snap.optionExData?.openInterest ?? null;
        const volume = Number(snap.basic?.volume) || 0;
        const returnPct = opt.strike > 0 ? Math.round((premium / opt.strike) * 10000) / 100 : 0;
        const annualReturnPct = daysToExpiry > 0 ? Math.round(returnPct * (365 / daysToExpiry) * 100) / 100 : 0;
        const absDelta = delta != null ? Math.abs(delta) : 0;
        const score = Math.round(
            Math.min(returnPct / 1.5, 1) * 40 +
            Math.min(discountPct / 15, 1) * 30 +
            Math.max(0, 1 - Math.abs(absDelta - 0.25) / 0.15) * 20 +
            Math.min((openInterest ?? 0) / 5000, 1) * 10
        );
        results.push({
            ticker: opt.ticker,
            option_code: opt.code,
            stock_price: opt.stockPrice,
            strike: opt.strike,
            discount_pct: discountPct,
            expiry: opt.expiry,
            days_to_expiry: daysToExpiry,
            premium,
            iv: snap.optionExData?.impliedVolatility ?? null,
            delta,
            theta: snap.optionExData?.theta ?? null,
            open_interest: openInterest,
            volume,
            return_pct: returnPct,
            annual_return_pct: annualReturnPct,
            score,
        });
    }

    const filtered = results.filter(r => {
        const abs = r.delta != null ? Math.abs(r.delta) : null;
        if (abs != null && abs < minDelta) return false;
        if (abs != null && abs > maxDelta) return false;
        if (r.return_pct < minReturn) return false;
        if (minOI > 0 && (r.open_interest == null || r.open_interest < minOI)) return false;
        if (minVolume > 0 && r.volume < minVolume) return false;
        return true;
    });
    filtered.sort((a, b) => b.score - a.score);
    return { results: filtered, debug };
}
