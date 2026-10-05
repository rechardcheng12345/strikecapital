// Alpaca market data (free plan): daily bars for US options since February 2024, including expired contracts —
// the history Yahoo drops. Bars are built from real OPRA trades, so a contract only has a bar on days it traded.
// Keys: ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY (a free paper-trading account is enough).
import { env } from '../config/env.js';

export const ALPACA_FIRST_DATE = '2024-02-01'; // Alpaca's option history starts here
const GAP_MS = 350; // ~170 requests a minute, under the free plan's limit

export const alpacaConfigured = () => !!(env.alpacaKeyId && env.alpacaSecretKey);

let lastCall = 0;
async function call(url) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const wait = lastCall + GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        lastCall = Date.now();
        const resp = await fetch(url, {
            headers: { 'APCA-API-KEY-ID': env.alpacaKeyId, 'APCA-API-SECRET-KEY': env.alpacaSecretKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(30000),
        });
        if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
            continue;
        }
        if (resp.status === 401 || resp.status === 403) throw new Error('Alpaca rejected the API keys — check ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY');
        if (!resp.ok) throw new Error(`Alpaca HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        return resp.json();
    }
    throw new Error('Alpaca rate limit — try again later');
}

/** Every put on `ticker` (active and expired) expiring between the dates: [{ symbol, expiry, strike }]. */
export async function listPutContracts(ticker, fromDate, toDate) {
    const out = [];
    for (const status of ['active', 'inactive']) {
        let token = null;
        do {
            const q = new URLSearchParams({
                underlying_symbols: ticker, type: 'put', status, limit: '10000',
                expiration_date_gte: fromDate, expiration_date_lte: toDate,
            });
            if (token) q.set('page_token', token);
            const r = await call(`${env.alpacaTradingUrl}/v2/options/contracts?${q}`);
            for (const c of r.option_contracts || []) {
                // Only the plain contract: adjusted ones after corporate actions get a different root (e.g. SOXL1)
                if (c.root_symbol && c.root_symbol !== ticker) continue;
                out.push({ symbol: c.symbol, expiry: c.expiration_date, strike: Number(c.strike_price) });
            }
            token = r.next_page_token;
        } while (token);
    }
    return out;
}

/** Daily bars for up to 100 contracts from `start` (YYYY-MM-DD): Map(symbol → [{ date, close, volume }]). */
export async function dailyBars(symbols, start, end) {
    const out = new Map();
    let token = null;
    do {
        const q = new URLSearchParams({ symbols: symbols.join(','), timeframe: '1Day', start, limit: '10000', sort: 'asc' });
        if (end) q.set('end', end);
        if (token) q.set('page_token', token);
        const r = await call(`${env.alpacaDataUrl}/v1beta1/options/bars?${q}`);
        for (const [sym, bars] of Object.entries(r.bars || {})) {
            if (!out.has(sym)) out.set(sym, []);
            for (const b of bars) if (b.c > 0) out.get(sym).push({ date: String(b.t).slice(0, 10), close: b.c, volume: b.v ?? null });
        }
        token = r.next_page_token;
    } while (token);
    return out;
}
