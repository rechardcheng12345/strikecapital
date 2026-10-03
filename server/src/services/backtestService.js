// Backtesting long-dated cash-secured puts: data loading, calibration, running and saving runs.
// Real option prices: Yahoo's daily history of every contract listed today (back to its listing) plus our
// own end-of-day Moomoo mids recorded from now on. Before that the calibrated model prices puts
// (backtestCalibration.js). The engine itself is pure (backtestEngine.js).
import { db } from '../config/database.js';
import { fetchPutChainRows } from './priceService.js';
import { nyClock } from './simMath.js';
import { bsPut, bsCall, histVol } from './bsModel.js';
import { calibrate, modelSigma, LOOKBACKS } from './backtestCalibration.js';
import { runBacktest, mergeParams, daysBetween, strikeStep } from './backtestEngine.js';

export const BACKTEST_TICKERS = ['SOXL'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

class BtError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
const ymd = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
function checkTicker(t) {
    const T = String(t || '').toUpperCase();
    if (!BACKTEST_TICKERS.includes(T)) throw new BtError(`Backtesting supports ${BACKTEST_TICKERS.join(', ')} for now`);
    return T;
}

// ─── Yahoo history ────────────────────────────────────────────

const memo = new Map(); // key → { at, value }
async function cached(key, ttlMs, loader) {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await loader();
    if (value != null) memo.set(key, { at: Date.now(), value });
    return value;
}

// range='max' makes Yahoo silently return monthly bars, so long histories use an explicit period instead.
async function yahooChart(symbol, range) {
    const span = range === 'max'
        ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}`
        : `range=${range}`;
    for (let attempt = 0; attempt < 4; attempt++) {
        const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&${span}&events=split`, {
            headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000),
        });
        if (resp.status === 429) {
            await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
            continue;
        }
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`Yahoo ${symbol}: HTTP ${resp.status}`);
        return (await resp.json())?.chart?.result?.[0] || null;
    }
    throw new Error(`Yahoo ${symbol}: rate limited`);
}

/** Daily bars (split-adjusted closes), ascending; `splits` = [{ date, ratio }] (e.g. 15 for 15:1). */
async function dailyBars(symbol) {
    return cached(`bars:${symbol}`, 6 * 3600 * 1000, async () => {
        const r = await yahooChart(symbol, 'max');
        if (!r) return null;
        const q = r.indicators?.quote?.[0] || {};
        const out = [];
        (r.timestamp || []).forEach((ts, i) => {
            const c = q.close?.[i];
            if (c > 0) out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: c });
        });
        out.splits = Object.values(r.events?.splits || {})
            .map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.numerator / s.denominator }))
            .filter((s) => s.ratio > 0)
            .sort((a, b) => a.date.localeCompare(b.date));
        return out;
    });
}

/** Real contracts per split-adjusted contract on `date`: 1 / (product of later split ratios). */
export function contractScaleFor(splits, date) {
    let f = 1;
    for (const s of splits || []) if (s.date > date) f *= s.ratio;
    return 1 / f;
}

/** OCC-style option symbol, e.g. SOXL + 280121 + P + 00060000. */
export function occSymbol(ticker, expiry, strike, type = 'put') {
    const d = String(expiry).replace(/-/g, '').slice(2);
    return `${ticker}${d}${type === 'call' ? 'C' : 'P'}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

// ─── Loading real prices ──────────────────────────────────────

const jobs = new Map(); // ticker → { running, done, total, bars, errors, started_at, finished_at, message }

export function loadStatus(ticker) {
    return jobs.get(checkTicker(ticker)) || null;
}

// Puts recorded / loaded: 7 days to expiry and further, so short-dated routines (35–40 days, held until
// take profit) have real prices as their puts age
const MIN_DAYS = 7, MAX_DAYS = 1300;

/** New York date of the ticker's latest trade on Yahoo — tells a trading day from a market holiday. */
export async function lastTradeDate(ticker) {
    try {
        const t = (await yahooChart(ticker, '5d'))?.meta?.regularMarketTime;
        return t ? nyClock(new Date(t * 1000)).date : null;
    } catch {
        return null;
    }
}

/**
 * Load Yahoo's daily history for every put listed today (expiries 7–1300 days out) into bt_option_bars.
 * Runs in the background — poll loadStatus(). Re-running only adds missing days. range: how far back to
 * fetch per contract ('5y' from the button; the daily job uses '1mo' — enough to fill recent days).
 */
export async function startHistoryLoad(ticker, { range = '5y', auto = false } = {}) {
    const T = checkTicker(ticker);
    if (jobs.get(T)?.running) return jobs.get(T);
    const job = { running: true, done: 0, total: 0, bars: 0, errors: 0, started_at: new Date().toISOString(), message: 'Listing contracts from Moomoo…' };
    jobs.set(T, job);
    (async () => {
        const [logId] = await db('bt_data_loads').insert({ ticker: T, kind: 'history', started_at: new Date(), info: JSON.stringify({ range, auto }) });
        try {
            const chain = await fetchPutChainRows([T], MIN_DAYS, MAX_DAYS);
            const contracts = (chain.rows || []).map((r) => ({ expiry: r.expiry, strike: Number(r.strike) }));
            job.total = contracts.length;
            job.message = `Loading ${contracts.length} contracts from Yahoo…`;
            let i = 0;
            const worker = async () => {
                while (i < contracts.length) {
                    const ct = contracts[i++];
                    const symbol = occSymbol(T, ct.expiry, ct.strike);
                    try {
                        const r = await yahooChart(symbol, range);
                        const q = r?.indicators?.quote?.[0] || {};
                        const rows = [];
                        (r?.timestamp || []).forEach((ts, k) => {
                            const c = q.close?.[k];
                            if (!(c > 0)) return;
                            rows.push({
                                underlying: T, symbol, expiry: ct.expiry, strike: ct.strike, option_type: 'put',
                                bar_date: new Date(ts * 1000).toISOString().slice(0, 10), close: c, volume: q.volume?.[k] ?? null, source: 'yahoo',
                            });
                        });
                        for (let s = 0; s < rows.length; s += 500) {
                            await db('bt_option_bars').insert(rows.slice(s, s + 500)).onConflict(['symbol', 'bar_date', 'source']).merge(['close', 'volume']);
                        }
                        job.bars += rows.length;
                    } catch {
                        job.errors++;
                    }
                    job.done++;
                }
            };
            await Promise.all(Array.from({ length: 4 }, worker));
            job.message = `Loaded ${job.bars} daily prices for ${job.total} contracts${job.errors ? ` (${job.errors} failed)` : ''}`;
            await db('bt_data_loads').where({ id: logId }).update({ finished_at: new Date(), contracts: job.total, bars: job.bars, info: JSON.stringify({ range, auto, errors: job.errors }) });
            calibrationCache.delete(T);
        } catch (err) {
            job.message = `Load failed: ${err.message}`;
            await db('bt_data_loads').where({ id: logId }).update({ finished_at: new Date(), info: JSON.stringify({ range, auto, error: err.message }) });
        } finally {
            job.running = false;
            job.finished_at = new Date().toISOString();
        }
    })();
    return job;
}

/** Save today's end-of-day mids for every listed put 7–1300 days out (our own real history, going forward). */
export async function recordChains(ticker) {
    const T = checkTicker(ticker);
    // Dated by the last trading day, so quotes saved on a weekend or holiday aren't filed under a non-trading day
    const date = (await lastTradeDate(T)) || nyClock().date;
    const chain = await fetchPutChainRows([T], MIN_DAYS, MAX_DAYS);
    const rows = [];
    for (const r of chain.rows || []) {
        const mid = r.bid > 0 && r.ask > 0 ? (r.bid + r.ask) / 2 : null;
        if (!mid) continue;
        rows.push({ underlying: T, symbol: occSymbol(T, r.expiry, r.strike), expiry: r.expiry, strike: r.strike, option_type: 'put', bar_date: date, close: Math.round(mid * 10000) / 10000, volume: r.volume ?? null, source: 'moomoo_mid' });
    }
    for (let s = 0; s < rows.length; s += 500) {
        await db('bt_option_bars').insert(rows.slice(s, s + 500)).onConflict(['symbol', 'bar_date', 'source']).merge(['close', 'volume']);
    }
    await db('bt_data_loads').insert({ ticker: T, kind: 'record', started_at: new Date(), finished_at: new Date(), contracts: rows.length, bars: rows.length });
    calibrationCache.delete(T);
    return { date, recorded: rows.length };
}

const MAX_DAILY_ATTEMPTS = 3;
let recorderTimer = null;
/**
 * Once each trading day after 16:15 New York (market holidays skipped): record the chain's end-of-day mids,
 * then refresh the last month of Yahoo history for every listed put. Failed steps retry on later ticks,
 * up to MAX_DAILY_ATTEMPTS a day.
 */
export function startChainRecorder(intervalMinutes = 30) {
    const tick = async () => {
        const { date, minutes, weekday } = nyClock();
        if (weekday === 'Sat' || weekday === 'Sun' || minutes < 16 * 60 + 15) return;
        for (const T of BACKTEST_TICKERS) {
            try {
                const today = await db('bt_data_loads').where({ ticker: T }).where('started_at', '>=', `${date} 00:00:00`);
                const recorded = today.some((r) => r.kind === 'record');
                const refreshes = today.filter((r) => r.kind === 'history');
                const refreshed = refreshes.some((r) => r.finished_at && !String(r.info || '').includes('"error"'));
                if (recorded && (refreshed || refreshes.length >= MAX_DAILY_ATTEMPTS || jobs.get(T)?.running)) continue;
                if ((await lastTradeDate(T)) !== date) continue; // market holiday — nothing new to save
                if (!recorded) {
                    const r = await recordChains(T);
                    console.log(`[Backtest] ${T}: recorded ${r.recorded} end-of-day prices for ${r.date}`);
                }
                if (!refreshed && refreshes.length < MAX_DAILY_ATTEMPTS && !jobs.get(T)?.running) {
                    await startHistoryLoad(T, { range: '1mo', auto: true });
                    console.log(`[Backtest] ${T}: daily real-price refresh started`);
                }
            } catch (err) {
                console.warn(`[Backtest] daily data update for ${T} failed:`, err.message);
            }
        }
    };
    recorderTimer = setInterval(() => tick().catch(() => {}), intervalMinutes * 60 * 1000);
}
export function stopChainRecorder() {
    if (recorderTimer) clearInterval(recorderTimer);
}

// ─── Market: real prices first, calibrated model otherwise ────

async function loadRealBars(T) {
    const rows = await db('bt_option_bars').where({ underlying: T, option_type: 'put' })
        .select('expiry', 'strike', 'bar_date', 'close', 'volume', 'source');
    const prices = new Map(); // expiry|strike|date → price
    const strikes = new Map(); // expiry|date → [strikes]
    // Our recorded mids beat Yahoo's last trade; Yahoo only counts on days the contract traded.
    for (const r of rows.sort((a, b) => (a.source === 'moomoo_mid' ? 1 : 0) - (b.source === 'moomoo_mid' ? 1 : 0))) {
        if (r.source === 'yahoo' && !(r.volume > 0)) continue;
        const e = ymd(r.expiry), d = ymd(r.bar_date), K = Number(r.strike);
        prices.set(`${e}|${K}|${d}`, Number(r.close));
        const sk = `${e}|${d}`;
        if (!strikes.has(sk)) strikes.set(sk, new Set());
        strikes.get(sk).add(K);
    }
    return { prices, strikes, count: rows.length, firstDate: rows.length ? ymd(rows.reduce((m, r) => (ymd(r.bar_date) < m ? ymd(r.bar_date) : m), '9999')) : null };
}

async function marketData(T) {
    const [bars, irx] = await Promise.all([dailyBars(T), dailyBars('^IRX')]);
    if (!bars?.length) throw new BtError(`No price history for ${T}`, 424);
    const closes = bars.map((b) => b.close);
    const hv = Object.fromEntries(LOOKBACKS.map((n) => [n, bars.map((_, i) => histVol(closes, i, n))]));
    const irxDates = (irx || []).map((b) => b.date);
    const irxVals = (irx || []).map((b) => b.close);
    const rate = (date) => {
        let lo = 0, hi = irxDates.length - 1, best = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (irxDates[mid] <= date) {
                best = mid;
                lo = mid + 1;
            } else hi = mid - 1;
        }
        return best >= 0 ? irxVals[best] / 100 : 0.04;
    };
    const index = new Map(bars.map((b, i) => [b.date, i]));
    return { bars, hv, rate, index };
}

const calibrationCache = new Map(); // ticker → { at, value }
// Puts this close to expiry or nearer use the short-dated fit
export const SHORT_DATED_YEARS = 0.35;

/**
 * Fit the model on the ticker's real put prices: one fit for long-dated puts (≥ 0.75 years) and one for
 * short-dated puts (20–100 days), since near-dated options carry a different volatility premium.
 */
export async function getCalibration(ticker) {
    const T = checkTicker(ticker);
    const hit = calibrationCache.get(T);
    if (hit && Date.now() - hit.at < 3600 * 1000) return hit.value;
    const [{ bars, hv, rate, index }, real] = await Promise.all([marketData(T), loadRealBars(T)]);
    const points = [];
    for (const [key, price] of real.prices) {
        const [expiry, K, date] = key.split('|');
        const i = index.get(date);
        if (i == null) continue;
        points.push({
            date, S: bars[i].close, K: Number(K), T: daysBetween(date, expiry) / 365, r: rate(date), price,
            hv: Object.fromEntries(LOOKBACKS.map((n) => [n, hv[n][i]])),
        });
    }
    const value = calibrate(points);
    value.short = calibrate(points, { minYears: 20 / 365, maxYears: 100 / 365, minPrice: 0.1 });
    calibrationCache.set(T, { at: Date.now(), value });
    return value;
}

/** The fit to use for a put with `years` to expiry (short-dated fit when available). */
function calFor(cal, years) {
    return years < SHORT_DATED_YEARS && cal.short?.calibrated ? cal.short : cal;
}

export async function buildMarket(T) {
    const [md, real, cal] = await Promise.all([marketData(T), loadRealBars(T), getCalibration(T)]);
    const { hv, rate } = md;
    return {
        md,
        real,
        cal,
        market: {
            rate,
            contractScale: (date) => contractScaleFor(md.bars.splits, date),
            // Strike selection: maturity unknown here, so the engine's T decides via sigmaFor(T)
            sigma: (i, k, years = 1) => {
                const c = calFor(cal, years);
                return modelSigma(c, hv[c.lookback][i], k);
            },
            snapStrike(date, expiry, K) {
                const listed = real.strikes.get(`${expiry}|${date}`);
                if (listed?.size) return [...listed].reduce((a, b) => (Math.abs(b - K) < Math.abs(a - K) ? b : a));
                const step = strikeStep(K);
                return Math.max(step, Math.round(K / step) * step);
            },
            optionPrice(date, i, S, K, expiry) {
                const realPx = real.prices.get(`${expiry}|${K}|${date}`);
                if (realPx != null) return { price: realPx, source: 'real' };
                const t = Math.max(0, daysBetween(date, expiry)) / 365;
                const c = calFor(cal, t);
                const sigma = modelSigma(c, hv[c.lookback][i], K / S);
                if (sigma == null) return { price: null, source: 'model' };
                return { price: bsPut(S, K, t, rate(date), sigma), source: 'model' };
            },
            // Covered calls: always modelled (real history is loaded for puts only), skew multiplier at K ÷ S
            callPrice(date, i, S, K, expiry) {
                const t = Math.max(0, daysBetween(date, expiry)) / 365;
                const c = calFor(cal, t);
                const sigma = modelSigma(c, hv[c.lookback][i], K / S);
                if (sigma == null) return { price: null, source: 'model' };
                return { price: bsCall(S, K, t, rate(date), sigma), source: 'model' };
            },
        },
    };
}

// ─── Status, runs ─────────────────────────────────────────────

export async function dataStatus(ticker) {
    const T = checkTicker(ticker);
    const agg = await db('bt_option_bars').where({ underlying: T })
        .select('source').count('* as bars').countDistinct('symbol as contracts').min('bar_date as first').max('bar_date as last').groupBy('source');
    const lastLoad = await db('bt_data_loads').where({ ticker: T }).orderBy('id', 'desc').limit(5);
    let calibration = null;
    try {
        calibration = await getCalibration(T);
    } catch (err) {
        calibration = { calibrated: false, reason: err.message };
    }
    const bars = await dailyBars(T);
    return {
        ticker: T,
        underlying: bars?.length ? { first: bars[0].date, last: bars[bars.length - 1].date, days: bars.length } : null,
        sources: agg.map((a) => ({ source: a.source, bars: Number(a.bars), contracts: Number(a.contracts), first: ymd(a.first), last: ymd(a.last) })),
        loads: lastLoad.map((l) => ({ ...l, info: l.info ? JSON.parse(l.info) : null })),
        job: jobs.get(T) || null,
        calibration,
    };
}

export async function runAndSave({ name, ticker, params }, userId) {
    const T = checkTicker(ticker);
    const P = mergeParams(params);
    if (P.start && P.end && P.start >= P.end) throw new BtError('Start date must be before the end date');
    const { md, real, cal, market } = await buildMarket(T);
    const spy = await dailyBars('SPY');
    const bench = {
        [`${T}_hold`]: new Map(md.bars.map((b) => [b.date, b.close])),
        SPY_hold: new Map((spy || []).map((b) => [b.date, b.close])),
    };
    const result = runBacktest({ bars: md.bars, market, params: { ...P, start: P.start || md.bars[0].date }, bench });
    const meta = {
        ticker: T,
        real_data_from: real.firstDate,
        calibration: {
            calibrated: cal.calibrated, lookback: cal.lookback, holdout: cal.holdout, points: cal.points, reason: cal.reason,
            short: cal.short ? { calibrated: cal.short.calibrated, lookback: cal.short.lookback, holdout: cal.short.holdout, holdout_core: cal.short.holdout_core, points: cal.short.points, first_date: cal.short.first_date, reason: cal.short.reason } : null,
        },
    };
    const summary = { ...result.summary, ...meta };
    const runName = name?.trim() || `${T} ${P.strike.mode === 'delta' ? `Δ${P.strike.delta}` : `${P.strike.pct}% OTM`} ${P.expiry.min_dte}-${P.expiry.max_dte}d`;
    const [id] = await db('bt_runs').insert({
        name: runName.slice(0, 120), ticker: T, params: JSON.stringify(result.params), summary: JSON.stringify(summary),
        result: JSON.stringify({ ...result, meta }), created_by: userId || null,
    });
    return { id, name: runName, ...result, summary, meta };
}

export async function listRuns() {
    const rows = await db('bt_runs').select('id', 'name', 'ticker', 'params', 'summary', 'created_at').orderBy('id', 'desc').limit(100);
    return rows.map((r) => ({ ...r, params: JSON.parse(r.params), summary: JSON.parse(r.summary) }));
}

export async function getRun(id) {
    const r = await db('bt_runs').where({ id }).first();
    if (!r) throw new BtError('Run not found', 404);
    return { id: r.id, name: r.name, ticker: r.ticker, created_at: r.created_at, ...JSON.parse(r.result), summary: JSON.parse(r.summary) };
}

export async function deleteRun(id) {
    const n = await db('bt_runs').where({ id }).del();
    if (!n) throw new BtError('Run not found', 404);
}

// ─── Saved settings (presets) ─────────────────────────────────

export async function listPresets() {
    const rows = await db('bt_presets').orderBy('name');
    return rows.map((r) => ({ id: r.id, name: r.name, params: JSON.parse(r.params), updated_at: r.updated_at }));
}

/** Save the strategy form under a name; saving an existing name overwrites it. */
export async function savePreset({ name, params }, userId) {
    const n = String(name || '').trim();
    if (!n) throw new BtError('Give the settings a name');
    const row = { name: n.slice(0, 120), params: JSON.stringify(params || {}), created_by: userId || null, updated_at: db.fn.now() };
    const existing = await db('bt_presets').where({ name: row.name }).first();
    if (existing) await db('bt_presets').where({ id: existing.id }).update(row);
    else await db('bt_presets').insert(row);
    const saved = await db('bt_presets').where({ name: row.name }).first();
    return { id: saved.id, name: saved.name, params: JSON.parse(saved.params), overwritten: !!existing };
}

export async function deletePreset(id) {
    const n = await db('bt_presets').where({ id }).del();
    if (!n) throw new BtError('Saved settings not found', 404);
}
