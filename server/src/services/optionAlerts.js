// Option Alerts — pure logic (no DB I/O): which puts count as newly listed, and their premium metrics.
// A contract's listing date is Moomoo's listTime when present; otherwise the date an alert check first
// saw it (except on a ticker's first check, which only records a baseline).

const DAY = 86400000;
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** Moomoo listTime ("2026-09-24" or "2026-09-24 00:00:00") → YYYY-MM-DD; null when missing/placeholder. */
export function normListDate(listTime) {
    const d = String(listTime || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < '1990-01-01') return null;
    return d;
}

/**
 * How a contract not seen before by this alert got there:
 *  'baseline' — first check for this ticker (nothing to compare with)
 *  'expiry'   — its expiry wasn't known before (a whole new expiry)
 *  'strike'   — its expiry was known, the strike is new
 */
export function firstSeenKind({ tickerSeenBefore, knownExpiries, expiry }) {
    if (!tickerSeenBefore) return 'baseline';
    return knownExpiries.has(expiry) ? 'strike' : 'expiry';
}

/**
 * Kind from Moomoo listing dates: a strike listed on (or the day after) the first listing of its expiry
 * came with the expiry; one listed later was added to an existing expiry.
 */
export function listedKind(listedOn, expiryFirstListedOn) {
    if (!listedOn || !expiryFirstListedOn) return null;
    return (new Date(listedOn) - new Date(expiryFirstListedOn)) / DAY <= 1 ? 'expiry' : 'strike';
}

/** When the contract became available and how we know: Moomoo's date first, then our first sighting. */
export function listingInfo(c) {
    if (c.listed_on) return { new_on: c.listed_on, source: 'moomoo', kind: c.listed_kind || c.first_seen_kind };
    if (c.first_seen_kind && c.first_seen_kind !== 'baseline') {
        return { new_on: String(c.first_seen_on).slice(0, 10), source: 'first_seen', kind: c.first_seen_kind };
    }
    return { new_on: null, source: null, kind: null };
}

export function isNewWithin(c, withinDays, today) {
    const { new_on } = listingInfo(c);
    if (!new_on) return false;
    return (new Date(today) - new Date(new_on)) / DAY <= withinDays;
}

/** Premium metrics for a short put at the bid/ask mid (last trade when a side is missing). */
export function putMetrics({ bid, ask, last, strike, expiry }, stockPrice, today) {
    const b = Number(bid), a = Number(ask), l = Number(last), K = Number(strike);
    const mid = b > 0 && a > 0 ? (b + a) / 2 : (l > 0 ? l : null);
    const dte = Math.round((new Date(expiry) - new Date(today)) / DAY);
    const ret = mid && K > 0 ? (mid / K) * 100 : null;
    return {
        mid: mid == null ? null : Math.round(mid * 10000) / 10000,
        mid_source: b > 0 && a > 0 ? 'mid' : (mid ? 'last' : null),
        premium: mid == null ? null : r2(mid * 100),
        collateral: r2(K * 100),
        dte,
        return_pct: r2(ret),
        annual_pct: ret != null && dte > 0 ? r2((ret * 365) / dte) : null,
        below_pct: stockPrice > 0 ? r2(((stockPrice - K) / stockPrice) * 100) : null,
        spread_pct: b > 0 && a > 0 ? r2(((a - b) / ((a + b) / 2)) * 100) : null,
    };
}
