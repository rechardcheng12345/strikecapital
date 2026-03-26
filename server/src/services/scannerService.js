import { ensureConnected, getValidExpiryDates, getOptionChain, getSnapshots } from './moomooService.js';
import { fetchYahooPrice } from './priceService.js';

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
export async function scanPutOptions(tickers, stockPrices, minDays = 12, maxDays = 20, minDiscount = 10, maxDiscount = 20) {
    const isConnected = await ensureConnected();
    if (!isConnected) return { results: [], error: 'Moomoo OpenD not available' };

    const today = new Date();
    const optionSecurities = [];

    for (const ticker of tickers) {
        const stockPrice = stockPrices[ticker];
        if (!stockPrice) continue;

        const minStrike = stockPrice * (1 - maxDiscount / 100);
        const maxStrike = stockPrice * (1 - minDiscount / 100);

        let expiryDates = [];
        try { expiryDates = await getValidExpiryDates(ticker); } catch { continue; }

        const filteredExpiries = expiryDates.filter(d => {
            const days = Math.round((new Date(d) - today) / (1000 * 60 * 60 * 24));
            return days >= minDays && days <= maxDays;
        });

        for (const expiry of filteredExpiries) {
            let chain = [];
            try { chain = await getOptionChain(ticker, expiry); } catch { continue; }

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

    if (optionSecurities.length === 0) return { results: [] };

    const snapshots = await getSnapshots(optionSecurities.map(o => ({ market: o.market, code: o.code })));
    const snapMap = new Map(snapshots.map(s => [s.basic?.security?.code, s]));

    const results = [];
    for (const opt of optionSecurities) {
        const snap = snapMap.get(opt.code);
        if (!snap) continue;
        const daysToExpiry = Math.round((new Date(opt.expiry) - today) / (1000 * 60 * 60 * 24));
        const discountPct = Math.round(((opt.stockPrice - opt.strike) / opt.stockPrice) * 10000) / 100;
        results.push({
            ticker: opt.ticker,
            option_code: opt.code,
            stock_price: opt.stockPrice,
            strike: opt.strike,
            discount_pct: discountPct,
            expiry: opt.expiry,
            days_to_expiry: daysToExpiry,
            premium: snap.basic?.curPrice ?? 0,
            iv: snap.optionExData?.impliedVolatility ?? null,
            delta: snap.optionExData?.delta ?? null,
            theta: snap.optionExData?.theta ?? null,
            open_interest: snap.optionExData?.openInterest ?? null,
            volume: Number(snap.basic?.volume) || 0,
        });
    }

    results.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.expiry.localeCompare(b.expiry) || b.strike - a.strike);
    return { results };
}
