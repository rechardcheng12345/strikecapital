// Option Alerts: saved tickers + DTE window. "Check" pulls every put in the window from Moomoo (via the
// scanner proxy when configured), remembers what it has seen, and lists puts newly listed within N days —
// by Moomoo's listing date, or by when a check first saw a new expiry / strike. Logic in optionAlerts.js.
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { getPutChain } from './moomooService.js';
import { fetchYahooPrice } from './priceService.js';
import { nyClock } from './simMath.js';
import { normListDate, firstSeenKind, listedKind, listingInfo, isNewWithin, putMetrics } from './optionAlerts.js';

class AlertError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

function ymd(d) {
    if (!d) return null;
    return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}
function parseJson(text, fallback) {
    try {
        return text ? JSON.parse(text) : fallback;
    } catch {
        return fallback;
    }
}
function normTickers(list) {
    return [...new Set((list || []).map((t) => String(t).trim().toUpperCase().replace(/\s+(PUT|CALL|P|C)$/, '')).filter(Boolean))];
}
function normAlert(a) {
    return { ...a, tickers: parseJson(a.tickers, []), last_check_info: parseJson(a.last_check_info, null) };
}
function normContract(c) {
    const out = { ...c };
    for (const k of ['strike', 'bid', 'ask', 'last', 'implied_volatility', 'delta', 'stock_price']) out[k] = c[k] == null ? null : Number(c[k]);
    out.expiry = ymd(c.expiry);
    out.listed_on = ymd(c.listed_on);
    out.first_seen_on = c.first_seen_at instanceof Date ? c.first_seen_at.toISOString().slice(0, 10) : String(c.first_seen_at).slice(0, 10);
    out.dismissed = !!c.dismissed;
    return out;
}
function withMetrics(c, today) {
    const info = listingInfo(c);
    return {
        ...c,
        new_on: info.new_on,
        new_source: info.source,
        new_kind: info.kind,
        ...putMetrics(c, c.stock_price, today),
    };
}
function sortResults(a, b) {
    return String(b.new_on).localeCompare(String(a.new_on)) || a.ticker.localeCompare(b.ticker)
        || a.expiry.localeCompare(b.expiry) || b.strike - a.strike;
}

async function loadAlert(id) {
    const a = await db('option_alerts').where({ id }).first();
    if (!a) throw new AlertError('Alert not found', 404);
    return normAlert(a);
}

async function fetchPutChain(tickers, minDays, maxDays) {
    if (!env.scannerProxyUrl) return getPutChain(tickers, minDays, maxDays);
    const resp = await fetch(`${env.scannerProxyUrl}/chain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(env.scannerProxySecret ? { 'x-proxy-secret': env.scannerProxySecret } : {}) },
        body: JSON.stringify({ tickers, minDays, maxDays }),
        signal: AbortSignal.timeout(10 * 60 * 1000), // ~10 chain requests per 30s on Moomoo's side
    });
    if (resp.status === 404) throw new AlertError('The scanner proxy has no /chain endpoint yet — update scanner-proxy/index.js on the OpenD PC and restart it.', 502);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new AlertError(`Scanner proxy: ${data.error || resp.status}`, 502);
    return data;
}

// ─── CRUD ─────────────────────────────────────────────────────

function validateCriteria({ tickers, min_dte, max_dte, listed_within_days }) {
    if (!tickers.length) throw new AlertError('Add at least one ticker');
    if (tickers.length > 40) throw new AlertError('At most 40 tickers per alert');
    if (!(min_dte >= 0) || !(max_dte >= min_dte)) throw new AlertError('Expiry window: max days must be ≥ min days');
    if (!(listed_within_days >= 1)) throw new AlertError('"Listed within" must be at least 1 day');
}

export async function listAlerts() {
    const today = nyClock().date;
    const alerts = (await db('option_alerts').orderBy('created_at')).map(normAlert);
    const contracts = (await db('option_alert_contracts').where({ dismissed: false })
        .select('alert_id', 'listed_on', 'listed_kind', 'first_seen_kind', 'first_seen_at')).map(normContract);
    return alerts.map((a) => ({
        ...a,
        new_count: contracts.filter((c) => c.alert_id === a.id && isNewWithin(c, a.listed_within_days, today)).length,
    }));
}

export async function createAlert(input, userId) {
    const tickers = normTickers(input.tickers);
    const row = { min_dte: input.min_dte, max_dte: input.max_dte, listed_within_days: input.listed_within_days ?? 7, tickers };
    validateCriteria(row);
    const [id] = await db('option_alerts').insert({ ...row, name: input.name, tickers: JSON.stringify(tickers), created_by: userId || null });
    return loadAlert(id);
}

export async function updateAlert(id, input) {
    const a = await loadAlert(id);
    const next = {
        tickers: input.tickers ? normTickers(input.tickers) : a.tickers,
        min_dte: input.min_dte ?? a.min_dte,
        max_dte: input.max_dte ?? a.max_dte,
        listed_within_days: input.listed_within_days ?? a.listed_within_days,
    };
    validateCriteria(next);
    await db('option_alerts').where({ id }).update({
        ...next, tickers: JSON.stringify(next.tickers), name: input.name ?? a.name, updated_at: db.fn.now(),
    });
    // Contracts of removed tickers are forgotten, so re-adding a ticker starts a fresh baseline.
    const removed = a.tickers.filter((t) => !next.tickers.includes(t));
    if (removed.length) await db('option_alert_contracts').where({ alert_id: id }).whereIn('ticker', removed).del();
    return loadAlert(id);
}

export async function deleteAlert(id) {
    await loadAlert(id);
    await db('option_alerts').where({ id }).del();
}

export async function setDismissed(contractId, dismissed) {
    const n = await db('option_alert_contracts').where({ id: contractId }).update({ dismissed });
    if (!n) throw new AlertError('Contract not found', 404);
}

/** Alert + its current new listings (from the last check's data — no Moomoo call). */
export async function getAlert(id) {
    const a = await loadAlert(id);
    const today = nyClock().date;
    const rows = (await db('option_alert_contracts').where({ alert_id: id })).map(normContract);
    const fresh = rows.filter((c) => isNewWithin(c, a.listed_within_days, today));
    return {
        alert: a,
        results: fresh.filter((c) => !c.dismissed).map((c) => withMetrics(c, today)).sort(sortResults),
        dismissed: fresh.filter((c) => c.dismissed).map((c) => withMetrics(c, today)).sort(sortResults),
        tracked: rows.length,
    };
}

// ─── Check ────────────────────────────────────────────────────

/**
 * Pull every put in the alert's DTE window, record contracts not seen before (new expiry / new strike,
 * or baseline on a ticker's first check), refresh quotes of the ones listed recently, and return them.
 */
export async function checkAlert(id) {
    const a = await loadAlert(id);
    const today = nyClock().date;
    const chain = await fetchPutChain(a.tickers, a.min_dte, a.max_dte);
    const now = new Date();

    const existing = new Map((await db('option_alert_contracts').where({ alert_id: id })).map((c) => [c.option_code, normContract(c)]));
    const prices = new Map(await Promise.all(a.tickers.map(async (t) => [t, (await fetchYahooPrice(t))?.price ?? null])));

    // Earliest Moomoo listing date per ticker+expiry, to tell a new expiry from a strike added later.
    const expiryFirstListed = new Map();
    for (const r of chain.rows) {
        const d = normListDate(r.list_time);
        const key = `${r.ticker}|${r.expiry}`;
        if (d && (!expiryFirstListed.has(key) || d < expiryFirstListed.get(key))) expiryFirstListed.set(key, d);
    }
    const seenTickers = new Set([...existing.values()].map((c) => c.ticker));
    const knownExpiries = new Map();
    for (const c of existing.values()) {
        if (!knownExpiries.has(c.ticker)) knownExpiries.set(c.ticker, new Set());
        knownExpiries.get(c.ticker).add(c.expiry);
    }

    const inserts = [];
    const updates = [];
    const counts = { contracts: chain.rows.length, new_contracts: 0, baseline: 0, with_listing_date: 0 };
    for (const r of chain.rows) {
        const listed_on = normListDate(r.list_time);
        if (listed_on) counts.with_listing_date++;
        const listed_kind = listedKind(listed_on, expiryFirstListed.get(`${r.ticker}|${r.expiry}`));
        const quote = {
            bid: r.bid, ask: r.ask, last: r.last, implied_volatility: r.implied_volatility, delta: r.delta,
            open_interest: r.open_interest, volume: r.volume, stock_price: prices.get(r.ticker), quoted_at: now,
        };
        const prev = existing.get(r.option_code);
        if (!prev) {
            const kind = firstSeenKind({ tickerSeenBefore: seenTickers.has(r.ticker), knownExpiries: knownExpiries.get(r.ticker) || new Set(), expiry: r.expiry });
            counts[kind === 'baseline' ? 'baseline' : 'new_contracts']++;
            inserts.push({
                alert_id: id, ticker: r.ticker, option_code: r.option_code, expiry: r.expiry, strike: r.strike,
                listed_on, listed_kind, first_seen_at: now, first_seen_kind: kind, ...quote,
            });
            continue;
        }
        const merged = { ...prev, listed_on: listed_on || prev.listed_on, listed_kind: listed_kind || prev.listed_kind };
        // Only write rows that matter: recent listings (fresh quotes for the results) or a newly learned date.
        if (isNewWithin(merged, a.listed_within_days, today) || (listed_on && listed_on !== prev.listed_on)) {
            updates.push({ id: prev.id, patch: { listed_on: merged.listed_on, listed_kind: merged.listed_kind, ...quote } });
        }
    }
    for (let i = 0; i < inserts.length; i += 200) await db('option_alert_contracts').insert(inserts.slice(i, i + 200));
    for (const u of updates) await db('option_alert_contracts').where({ id: u.id }).update(u.patch);

    const info = {
        checked_at: now.toISOString(),
        expiries: chain.expiries || {},
        errors: chain.errors || {},
        ...counts,
    };
    await db('option_alerts').where({ id }).update({ last_checked_at: now, last_check_info: JSON.stringify(info), updated_at: db.fn.now() });
    return { ...(await getAlert(id)), check: info };
}
