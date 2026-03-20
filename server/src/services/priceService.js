import { db } from '../config/database.js';
import { getOptionQuotes } from './moomooService.js';

/**
 * Build a Moomoo-style option code from position data.
 * e.g. ticker="NVDA PUT", strike=160, expiry="2026-03-27" => "NVDA260327P160000"
 */
function buildOptionCode(ticker, strikePrice, expirationDate) {
    const symbol = ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
    const strike = parseFloat(strikePrice);
    const dateStr = typeof expirationDate === 'object'
        ? `${expirationDate.getFullYear().toString().slice(2)}${String(expirationDate.getMonth() + 1).padStart(2, '0')}${String(expirationDate.getDate()).padStart(2, '0')}`
        : expirationDate.split('T')[0].replace(/^20(\d{2})-(\d{2})-(\d{2})$/, '$1$2$3');
    const strikeInt = Math.round(strike * 1000);
    return `${symbol}${dateStr}P${strikeInt}`;
}

function baseSymbol(ticker) {
    return ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
}

// ─── Yahoo Finance ─────────────────────────────────────

/**
 * Fetch current stock price from Yahoo Finance (free, no API key).
 * @param {string} symbol - e.g. "NVDA"
 * @returns {{ price: number, previousClose: number } | null}
 */
async function fetchYahooPrice(symbol) {
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

/**
 * Fetch stock prices for all unique tickers from Yahoo Finance,
 * update market_data_cache, and return a map of symbol -> price.
 * Falls back to cached prices in DB if Yahoo fails.
 * @returns {Map<string, number>} symbol -> stock price
 */
async function refreshStockPrices(symbols) {
    const stockPrices = new Map();
    const now = new Date();

    for (const symbol of symbols) {
        // Try Yahoo Finance first
        const quote = await fetchYahooPrice(symbol);

        if (quote) {
            stockPrices.set(symbol, quote.price);

            // Upsert cache
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
            // Fallback: read from cache
            const cached = await db('market_data_cache')
                .where('ticker', symbol)
                .first();
            if (cached) {
                stockPrices.set(symbol, parseFloat(cached.current_price));
                console.log(`[PriceService] ${symbol} stock: $${parseFloat(cached.current_price).toFixed(2)} (cached)`);
            }
        }
    }

    return stockPrices;
}

// ─── Main Refresh ──────────────────────────────────────

/**
 * Refresh option prices + stock prices for all open/monitoring option positions.
 * Option prices: Moomoo API → fallback DB cache
 * Stock prices: Yahoo Finance → fallback DB cache
 * @returns {{ updated: number, prices: Array, source: string, stockPrices: Object }}
 */
export async function refreshAllPrices() {
    // 1. Get active option positions with expiration dates
    const positions = await db('positions')
        .whereIn('status', ['OPEN', 'MONITORING'])
        .where('position_type', 'option')
        .whereNotNull('expiration_date')
        .select('id', 'ticker', 'strike_price', 'expiration_date');

    if (positions.length === 0) {
        return { updated: 0, prices: [], source: 'none', stockPrices: {} };
    }

    // 2. Get unique base symbols and fetch stock prices
    const symbols = [...new Set(positions.map(p => baseSymbol(p.ticker)))];
    const stockPriceMap = await refreshStockPrices(symbols);

    // 3. Try Moomoo API for option prices
    const quotes = await getOptionQuotes(positions);

    let result;
    if (quotes.length > 0) {
        result = { ...(await updateFromQuotes(quotes, stockPriceMap)), source: 'moomoo' };
    } else {
        // Fallback: read cached option prices
        console.log('[PriceService] Moomoo unavailable, falling back to cached option prices');
        result = { ...(await updateFromCache(positions, stockPriceMap)), source: 'cache' };
    }

    // Convert stockPriceMap to plain object for JSON response
    result.stockPrices = Object.fromEntries(stockPriceMap);
    return result;
}

/**
 * Update positions from live Moomoo quotes + stock prices.
 */
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

        // Upsert market_data_cache for option
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

        // Update matching positions by ID (avoids ticker+strike+expiry string matching issues)
        const updateData = {
            current_price: quote.option_price,
            last_price_update: now,
        };
        if (quote.implied_volatility != null) {
            updateData.implied_volatility = quote.implied_volatility;
        }

        const ids = quote.positionIds && quote.positionIds.length > 0
            ? quote.positionIds
            : null;
        if (!ids) continue;

        const count = await db('positions')
            .whereIn('id', ids)
            .whereIn('status', ['OPEN', 'MONITORING'])
            .update(updateData);

        // Compute distance to strike
        const strike = parseFloat(quote.strike_price);
        const distToStrike = stockPrice && stockPrice > 0
            ? Math.round(((stockPrice - strike) / stockPrice) * 100 * 100) / 100
            : null;

        updated += count;
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

/**
 * Fallback: update positions from market_data_cache table.
 */
async function updateFromCache(positions, stockPriceMap) {
    let updated = 0;
    const prices = [];

    for (const pos of positions) {
        const optionCode = buildOptionCode(pos.ticker, pos.strike_price, pos.expiration_date);
        const symbol = baseSymbol(pos.ticker);
        const stockPrice = stockPriceMap.get(symbol) ?? null;

        // Look up cache by exact option code first, then try prefix up to strike
        // e.g. "NVDA260326P160000" → exact, then "NVDA260326P" prefix (includes strike variations)
        let cached = await db('market_data_cache')
            .where('ticker', optionCode)
            .first();

        if (!cached) {
            // Prefix = symbol + date + 'P' — matches same expiry, any strike variant
            const prefix = optionCode.replace(/P\d+$/, 'P');
            cached = await db('market_data_cache')
                .where('ticker', 'like', `${prefix}%`)
                .where('source', 'moomoo')
                .orderBy('fetched_at', 'desc')
                .first();
        }

        if (!cached) continue;

        const updateData = {
            current_price: cached.current_price,
            last_price_update: cached.fetched_at,
        };

        const count = await db('positions')
            .where('id', pos.id)
            .whereIn('status', ['OPEN', 'MONITORING'])
            .update(updateData);

        const strike = parseFloat(pos.strike_price);
        const distToStrike = stockPrice && stockPrice > 0
            ? Math.round(((stockPrice - strike) / stockPrice) * 100 * 100) / 100
            : null;

        updated += count;
        prices.push({
            ticker: pos.ticker,
            strike: parseFloat(pos.strike_price),
            expiry: typeof pos.expiration_date === 'object'
                ? pos.expiration_date.toISOString().split('T')[0]
                : String(pos.expiration_date).split('T')[0],
            option_code: cached.ticker,
            price: parseFloat(cached.current_price),
            iv: cached.implied_volatility ? parseFloat(cached.implied_volatility) : null,
            delta: cached.delta ? parseFloat(cached.delta) : null,
            stock_price: stockPrice,
            distance_to_strike: distToStrike,
            cached_at: cached.fetched_at,
        });
    }

    console.log(`[PriceService] Updated ${updated} positions from cache (${prices.length} cached prices found)`);
    return { updated, prices };
}
