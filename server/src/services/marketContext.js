// Per-ticker market context used by the option scanner: realized volatility, next earnings
// date, company profile and recent headlines. Everything is cached in memory for a few hours —
// none of it changes intraday in a way that matters for 30–60 DTE put selling.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // key -> { at, value }

async function cached(key, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = await loader();
    // Don't pin failures for 6h — retry on the next scan.
    if (value != null) cache.set(key, { at: Date.now(), value });
    return value;
}

async function getJson(url, headers = {}) {
    const resp = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

/**
 * Realized (historical) volatility from Yahoo daily closes.
 * Returns annualized % (same units as Moomoo IV, e.g. 42.5) for 20 and 60 trading days,
 * plus 200-day average and 52-week range for "happy to own" context.
 */
export function getVolatilityStats(ticker) {
    return cached(`vol:${ticker}`, async () => {
        try {
            const data = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`);
            const result = data?.chart?.result?.[0];
            const closes = (result?.indicators?.quote?.[0]?.close || []).filter(c => c != null && c > 0);
            if (closes.length < 25) return null;
            const hv = (n) => {
                const slice = closes.slice(-(n + 1));
                const rets = [];
                for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
                const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
                const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
                return Math.round(Math.sqrt(variance * 252) * 10000) / 100;
            };
            const last200 = closes.slice(-200);
            return {
                hv20: hv(20),
                hv60: closes.length > 61 ? hv(60) : null,
                ma200: last200.length >= 150 ? last200.reduce((a, b) => a + b, 0) / last200.length : null,
                high52: Math.max(...closes),
                low52: Math.min(...closes),
                lastClose: closes[closes.length - 1],
            };
        } catch (err) {
            console.warn(`[MarketContext] vol stats failed for ${ticker}:`, err.message);
            return null;
        }
    });
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Next earnings date (YYYY-MM-DD) from Nasdaq's analyst endpoint (Zacks estimate or confirmed).
 * Returns { date, estimated } or { date: null } when unknown (ETFs, no coverage).
 */
export function getEarningsDate(ticker) {
    return cached(`earn:${ticker}`, async () => {
        try {
            const data = await getJson(`https://api.nasdaq.com/api/analyst/${encodeURIComponent(ticker)}/earnings-date`);
            const text = `${data?.data?.announcement || ''} ${data?.data?.reportText || ''}`;
            // "Earnings announcement* for NVDA: Nov 18, 2026"
            let m = text.match(/:\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
            let date = null;
            if (m && MONTHS[m[1].toLowerCase()] != null) {
                date = new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
            } else {
                // "... report earnings on 11/18/2026"
                m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                if (m) date = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2]));
            }
            return {
                date: date ? date.toISOString().slice(0, 10) : null,
                estimated: /estimated|algorithm/i.test(text),
            };
        } catch (err) {
            console.warn(`[MarketContext] earnings date failed for ${ticker}:`, err.message);
            return null;
        }
    });
}

/** Company name / sector / industry / one-line description from Nasdaq. */
export function getCompanyProfile(ticker) {
    return cached(`profile:${ticker}`, async () => {
        try {
            const data = await getJson(`https://api.nasdaq.com/api/company/${encodeURIComponent(ticker)}/company-profile`);
            const d = data?.data;
            if (!d) return null;
            const v = (k) => d[k]?.value || null;
            return {
                name: v('CompanyName'),
                sector: v('Sector'),
                industry: v('Industry'),
                description: (v('CompanyDescription') || '').slice(0, 600) || null,
            };
        } catch (err) {
            console.warn(`[MarketContext] profile failed for ${ticker}:`, err.message);
            return null;
        }
    });
}

/**
 * Recent headlines that are actually about this ticker (Yahoo search tags related tickers).
 * Returns up to `limit` items from the last `days` days, newest first.
 */
export function getRecentHeadlines(ticker, { limit = 8, days = 21 } = {}) {
    return cached(`news:${ticker}`, async () => {
        try {
            const data = await getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=25&quotesCount=1`);
            const cutoff = Date.now() / 1000 - days * 86400;
            const T = ticker.toUpperCase();
            return (data?.news || [])
                .filter(n => n.providerPublishTime >= cutoff)
                .filter(n => (n.relatedTickers || []).map(t => t.toUpperCase()).includes(T))
                .sort((a, b) => b.providerPublishTime - a.providerPublishTime)
                .slice(0, limit)
                .map(n => ({
                    title: n.title,
                    publisher: n.publisher,
                    link: n.link,
                    published: new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10),
                }));
        } catch (err) {
            console.warn(`[MarketContext] headlines failed for ${ticker}:`, err.message);
            return null;
        }
    });
}
