import { db } from '../config/database.js';
import { getOptionQuotes } from './moomooService.js';
import { env } from '../config/env.js';

function baseSymbol(ticker) {
    return ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
}

// ─── Support & Resistance Levels (Yahoo Finance 6-month OHLCV) ─────────────

export async function fetchYahooLevels(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=6mo`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 StrikeCapital/1.0' },
            signal: AbortSignal.timeout(12000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const result = data?.chart?.result?.[0];
        if (!result) return null;

        const meta = result.meta || {};
        const quote = result.indicators?.quote?.[0] || {};
        const highs = quote.high || [];
        const lows = quote.low || [];
        const currentPrice = meta.regularMarketPrice ?? 0;

        // Swing detection: a swing high/low needs to be a local extreme over a ±5 bar window
        const WINDOW = 5;
        const swingHighs = [];
        const swingLows = [];
        for (let i = WINDOW; i < highs.length - WINDOW; i++) {
            const h = highs[i];
            const l = lows[i];
            if (h == null || l == null) continue;
            const isSwingHigh = highs.slice(i - WINDOW, i).every(v => v != null && v <= h) &&
                                highs.slice(i + 1, i + WINDOW + 1).every(v => v != null && v <= h);
            const isSwingLow  = lows.slice(i - WINDOW, i).every(v => v != null && v >= l) &&
                                lows.slice(i + 1, i + WINDOW + 1).every(v => v != null && v >= l);
            if (isSwingHigh) swingHighs.push(h);
            if (isSwingLow)  swingLows.push(l);
        }

        // Cluster nearby levels (within 1% of each other → keep only the most recent)
        function cluster(prices) {
            const sorted = [...prices].sort((a, b) => b - a); // most recent last → sorted desc by price
            const result = [];
            for (const p of sorted) {
                if (!result.some(r => Math.abs(r - p) / p < 0.01)) result.push(p);
            }
            return result;
        }

        const allSwingResistance = cluster(swingHighs.filter(p => p > currentPrice));
        const allSwingSupport    = cluster(swingLows.filter(p => p < currentPrice));

        return {
            currentPrice,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
            fiftyTwoWeekLow:  meta.fiftyTwoWeekLow  ?? null,
            ma50:   meta.fiftyDayAverage       ?? null,
            ma200:  meta.twoHundredDayAverage  ?? null,
            swingResistance: allSwingResistance.slice(0, 4),
            swingSupport:    allSwingSupport.slice(-4).reverse(), // closest below price first
        };
    } catch (err) {
        console.warn(`[PriceService] fetchYahooLevels failed for ${symbol}:`, err.message);
        return null;
    }
}

// ─── Scanner Proxy (remote Moomoo) ──────────────────────────

async function callProxyForQuotes(positions) {
    try {
        const payload = positions.map(p => ({
            id: p.id,
            ticker: p.ticker,
            strike_price: p.strike_price,
            expiration_date: p.expiration_date,
        }));
        const resp = await fetch(`${env.scannerProxyUrl}/quotes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(env.scannerProxySecret ? { 'x-proxy-secret': env.scannerProxySecret } : {}),
            },
            body: JSON.stringify({ positions: payload }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) {
            console.warn(`[PriceService] Proxy /quotes error: ${resp.status}`);
            return [];
        }
        const data = await resp.json();
        return data.quotes || [];
    } catch (err) {
        console.warn('[PriceService] Proxy /quotes unreachable:', err.message);
        return [];
    }
}

// ─── Yahoo Finance ──────────────────────────────────────────

export async function fetchYahooPrice(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 StrikeCapital/1.0' },
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return null;
        return {
            price: meta.regularMarketPrice,
            previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        };
    } catch (err) {
        console.warn(`[PriceService] Yahoo Finance failed for ${symbol}:`, err.message);
        return null;
    }
}

async function refreshStockPrices(symbols) {
    const stockPrices = new Map();
    const now = new Date();

    for (const symbol of symbols) {
        const quote = await fetchYahooPrice(symbol);

        if (quote) {
            stockPrices.set(symbol, quote.price);
            const cacheData = {
                current_price: quote.price,
                previous_close: quote.previousClose,
                day_change_pct: quote.previousClose > 0
                    ? ((quote.price - quote.previousClose) / quote.previousClose * 100)
                    : null,
                fetched_at: now,
                source: 'yahoo',
            };
            try {
                const existing = await db('market_data_cache').where('ticker', symbol).first();
                if (existing) {
                    await db('market_data_cache').where('ticker', symbol).update(cacheData);
                } else {
                    await db('market_data_cache').insert({ ticker: symbol, ...cacheData });
                }
            } catch (err) {
                console.warn(`[PriceService] Cache update failed for stock ${symbol}:`, err.message);
            }
            console.log(`[PriceService] ${symbol} stock: $${quote.price.toFixed(2)} (Yahoo)`);
        } else {
            // Fallback: read from cache — wrapped so a DB error doesn't abort the whole refresh
            try {
                const cached = await db('market_data_cache').where('ticker', symbol).first();
                if (cached) {
                    stockPrices.set(symbol, parseFloat(cached.current_price));
                    console.log(`[PriceService] ${symbol} stock: $${parseFloat(cached.current_price).toFixed(2)} (cached)`);
                }
            } catch (err) {
                console.warn(`[PriceService] Cache read failed for stock ${symbol}:`, err.message);
            }
        }
    }

    return stockPrices;
}

// ─── Main Refresh ───────────────────────────────────────────

/**
 * Refresh option prices + stock prices for all open/monitoring option positions.
 * Each external call is wrapped in try-catch so a single failure never causes a 500.
 */
export async function refreshAllPrices() {
    try {
        // Single DB call upfront — includes current_price so the cache fallback needs no second query
        let positions;
        try {
            positions = await db('positions')
                .whereIn('status', ['OPEN', 'MONITORING'])
                .where('position_type', 'option')
                .whereNotNull('expiration_date')
                .select('id', 'ticker', 'strike_price', 'expiration_date',
                        'current_price', 'last_price_update', 'implied_volatility');
        } catch (err) {
            console.warn('[PriceService] Failed to load positions from DB:', err.message);
            return { updated: 0, prices: [], source: 'error', stockPrices: {} };
        }

        if (positions.length === 0) {
            return { updated: 0, prices: [], source: 'none', stockPrices: {} };
        }

        const symbols = [...new Set(positions.map(p => baseSymbol(p.ticker)))];

        // Stock prices (Yahoo Finance) — failure is non-fatal
        let stockPriceMap = new Map();
        try {
            stockPriceMap = await refreshStockPrices(symbols);
        } catch (err) {
            console.warn('[PriceService] Stock price refresh failed:', err.message);
        }

        // Option prices (Moomoo OpenD) — failure is non-fatal, falls back to existing DB prices
        // If scannerProxyUrl is configured, delegate to the remote proxy instead of local TCP
        let quotes = [];
        try {
            quotes = env.scannerProxyUrl
                ? await callProxyForQuotes(positions)
                : await getOptionQuotes(positions);
        } catch (err) {
            console.warn('[PriceService] Moomoo unavailable:', err.message);
        }

        let result;
        if (quotes.length > 0) {
            try {
                result = { ...(await updateFromQuotes(quotes, stockPriceMap)), source: 'moomoo' };
            } catch (err) {
                console.warn('[PriceService] updateFromQuotes failed, falling back:', err.message);
                result = { ...buildCacheResult(positions, stockPriceMap), source: 'cache' };
            }
        } else {
            result = { ...buildCacheResult(positions, stockPriceMap), source: 'cache' };
        }

        result.stockPrices = Object.fromEntries(stockPriceMap);
        return result;
    } catch (err) {
        console.error('[PriceService] Unexpected error in refreshAllPrices:', err.message);
        return { updated: 0, prices: [], source: 'error', stockPrices: {} };
    }
}

// ─── Update from live Moomoo quotes ────────────────────────

async function updateFromQuotes(quotes, stockPriceMap) {
    const now = new Date();
    let updated = 0;
    const prices = [];

    for (const quote of quotes) {
        const cacheKey = quote.option_code;
        const symbol = baseSymbol(quote.ticker);
        const stockPrice = stockPriceMap.get(symbol) ?? null;

        const cacheData = {
            current_price: quote.option_price,
            previous_close: quote.prev_close || null,
            day_change_pct: quote.prev_close > 0
                ? ((quote.option_price - quote.prev_close) / quote.prev_close * 100)
                : null,
            implied_volatility: quote.implied_volatility ?? null,
            delta: quote.delta ?? null,
            fetched_at: now,
            source: 'moomoo',
        };

        try {
            const existing = await db('market_data_cache').where('ticker', cacheKey).first();
            if (existing) {
                await db('market_data_cache').where('ticker', cacheKey).update(cacheData);
            } else {
                await db('market_data_cache').insert({ ticker: cacheKey, ...cacheData });
            }
        } catch (err) {
            console.warn(`[PriceService] Cache update failed for ${cacheKey}:`, err.message);
        }

        // Update by position ID — avoids ticker+strike+expiry string matching issues
        const ids = quote.positionIds?.length > 0 ? quote.positionIds : null;
        if (!ids) continue;

        const updateData = { current_price: quote.option_price, last_price_update: now };
        if (quote.implied_volatility != null) updateData.implied_volatility = quote.implied_volatility;

        try {
            const count = await db('positions')
                .whereIn('id', ids)
                .whereIn('status', ['OPEN', 'MONITORING'])
                .update(updateData);
            updated += count;
        } catch (err) {
            console.warn(`[PriceService] Position update failed for ids ${ids}:`, err.message);
        }

        const strike = parseFloat(quote.strike_price);
        const distToStrike = stockPrice && stockPrice > 0
            ? Math.round(((stockPrice - strike) / stockPrice) * 100 * 100) / 100
            : null;

        prices.push({
            ticker: quote.ticker,
            strike: quote.strike_price,
            expiry: quote.expiration_date,
            option_code: quote.option_code,
            price: quote.option_price,
            iv: quote.implied_volatility,
            delta: quote.delta,
            stock_price: stockPrice,
            distance_to_strike: distToStrike,
        });
    }

    console.log(`[PriceService] Refreshed ${prices.length} options from Moomoo, updated ${updated} positions`);
    return { updated, prices };
}

// ─── Cache fallback — uses positions already fetched, zero DB calls ─────────

function buildCacheResult(positions, stockPriceMap) {
    const prices = [];

    for (const pos of positions) {
        if (pos.current_price == null) continue;

        const symbol = baseSymbol(pos.ticker);
        const stockPrice = stockPriceMap.get(symbol) ?? null;
        const strike = parseFloat(pos.strike_price);
        const distToStrike = stockPrice && stockPrice > 0
            ? Math.round(((stockPrice - strike) / stockPrice) * 100 * 100) / 100
            : null;

        prices.push({
            ticker: pos.ticker,
            strike,
            expiry: typeof pos.expiration_date === 'object'
                ? pos.expiration_date.toISOString().split('T')[0]
                : String(pos.expiration_date).split('T')[0],
            price: parseFloat(pos.current_price),
            iv: pos.implied_volatility ? parseFloat(pos.implied_volatility) : null,
            delta: pos.delta ? parseFloat(pos.delta) : null,
            stock_price: stockPrice,
            distance_to_strike: distToStrike,
            cached_at: pos.last_price_update,
        });
    }

    console.log(`[PriceService] Moomoo unavailable — returning existing prices for ${prices.length} position(s)`);
    return { updated: 0, prices };
}
