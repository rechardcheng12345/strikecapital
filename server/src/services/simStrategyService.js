// Automatic strategy portfolios: a Simulation portfolio that follows a saved backtest setting every trading
// day. The decisions are the backtest engine's own (createStrategy → step), run once on today with live
// Moomoo prices: the portfolio's open puts and assigned shares become the strategy's state, today's step
// decides, and each trade it makes is executed in the Simulation at the live bid/ask mid. Expiries and
// assignment are settled by the Simulation's own job (simService), not here. Every run is logged with what
// it did and why it skipped (sim_strategy_runs).
import { db } from '../config/database.js';
import { mergeParams, createStrategy, newStrategyState, expiryType, daysBetween, runBacktest } from './backtestEngine.js';
import { buildMarket, listPresets, BACKTEST_TICKERS } from './backtestService.js';
import { fetchPutChainRows, fetchOptionQuotes, fetchStockQuotes } from './priceService.js';
import { createPortfolio, portfolioBook, saveRulesState, strategyClosePut, linkRoll, openPut, closePosition } from './simService.js';
import { nyClock, isMarketOpen, quoteMid } from './simMath.js';

export const DEFAULT_RUN_AT = '15:30'; // New York time — late enough to act on the day's price, before the close
const MAX_AUTO_ATTEMPTS = 3; // per day, when data (proxy / quotes) is unavailable

const REASON_TEXT = {
    take_profit: 'Take profit', stop_loss: 'Stop loss', early_close: 'Closed early', rolled: 'Rolled (price near the strike)',
    sold_at_recovery: 'Back above cost', share_stop: 'Cut loss',
};
const TRIGGER_TEXT = {
    ladder: 'monthly ladder', new_expiry: 'new expiry listed', dip: 'dip', continuous: 'keep selling', reenter: 'after take profit',
    roll_out: 'roll after take profit', after_expiry: 'after expiry', roll: 'roll',
};

class StrategyError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}

const round4 = (n) => Math.round(n * 10000) / 10000;
const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * The setting as the Simulation runs it. Fills are at the live mid like every Simulation trade, so the
 * backtest's slippage is not applied; covered calls can't be traded in the Simulation yet.
 */
export function liveParams(params) {
    const P = mergeParams(params);
    const notes = ['Fills at the live bid/ask mid (the backtest\'s slippage is not applied).'];
    P.slippage_pct = 0;
    if (P.covered_calls.enabled && !P.sell_at_recovery.enabled) {
        P.covered_calls = { ...P.covered_calls, enabled: false };
        notes.push('Covered calls are not automated yet — assigned shares are held (the cut-loss rule still applies if on).');
    }
    return { P, notes };
}

/** Create a portfolio that runs a saved backtest setting (bt_presets) automatically. */
export async function createStrategyPortfolio({ name, description, starting_cash, preset_id, run_at, fee_per_stock_trade = 0 }, userId) {
    const preset = (await listPresets()).find((x) => x.id === preset_id);
    if (!preset) throw new StrategyError('Saved setting not found', 404);
    const params = { ...preset.params, starting_cash };
    const ticker = BACKTEST_TICKERS[0];
    return createPortfolio({
        name: name || preset.name,
        description: description || `Runs the backtest setting “${preset.name}” every trading day.`,
        starting_cash,
        fee_per_contract: Number(params.fee_per_contract ?? 0.65),
        fee_per_stock_trade,
        rules: { preset_id: preset.id, preset_name: preset.name, ticker, run_at: run_at || DEFAULT_RUN_AT, params },
    }, userId);
}

/** The latest trading day Yahoo has for the ticker (New York date) — tells a market holiday from a trading day. */
async function lastTradeDate(ticker) {
    try {
        const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`, {
            headers: { 'User-Agent': 'Mozilla/5.0 StrikeCapital/1.0' }, signal: AbortSignal.timeout(10000),
        });
        const t = (await resp.json())?.chart?.result?.[0]?.meta?.regularMarketTime;
        return t ? nyClock(new Date(t * 1000)).date : null;
    } catch {
        return null;
    }
}

function describeAction(a, ticker) {
    const pos = a.pos;
    if (a.kind === 'open_put') {
        const below = ((1 - pos.strike / a.S) * 100).toFixed(1);
        const why = pos.trigger.split('+').map((t) => TRIGGER_TEXT[t] || t).join(' + ');
        return `Sold ${pos.contracts} ${ticker} ${pos.expiry} $${pos.strike}P @ ${a.price} — ${below}% below ${money(a.S)}, ${pos.annual_return_pct}%/yr (${why})`;
    }
    if (a.kind === 'close_put') {
        const captured = pos.entry_price > 0 ? Math.round((1 - a.price / pos.entry_price) * 100) : null;
        return `${REASON_TEXT[a.reason] || a.reason}: bought back ${pos.contracts} ${ticker} ${pos.expiry} $${pos.strike}P @ ${a.price} (sold @ ${pos.entry_price}${captured != null ? `, ${captured}% of the premium kept` : ''})`;
    }
    if (a.kind === 'sell_shares') {
        return `${REASON_TEXT[a.reason] || a.reason}: sold ${a.shares} ${ticker} @ ${money(a.price)} (cost ${money(a.cost_basis)})`;
    }
    return `${a.kind} (not supported in the Simulation)`;
}

function skippedText(skipped, P) {
    const text = {
        trend: `price below its ${P.trend_filter.ma_days}-day average (trend filter)`,
        no_expiry: `no listed expiry ${P.expiry.min_dte}–${P.expiry.max_dte} days out`,
        no_price: 'no live quote for the chosen strike',
        low_premium: 'premium below the minimum',
        low_return: 'premium below the minimum annual return',
        capital: 'not enough free cash (or the size rounds to 0 contracts)',
        limit: 'position limit reached',
    };
    return Object.entries(skipped).filter(([k, n]) => n > 0 && text[k]).map(([k]) => text[k]);
}

const running = new Set();

/**
 * Run today's step for one strategy portfolio and execute its trades. trigger: 'auto' (the daily job) |
 * 'manual' (Run now). Returns the logged run.
 */
export async function runStrategy(portfolioId, { trigger = 'manual' } = {}) {
    if (running.has(portfolioId)) throw new StrategyError('This strategy is already running', 409);
    running.add(portfolioId);
    const today = nyClock().date;
    let memory = {};
    try {
        const book = await portfolioBook(portfolioId);
        const p = book.portfolio;
        if (p.strategy_type !== 'rules' || !p.rules?.params) throw new StrategyError('This portfolio has no automatic strategy');
        if (!p.is_active) throw new StrategyError('Portfolio is paused — resume it first');
        memory = p.rules_state || {};
        const ticker = p.rules.ticker || BACKTEST_TICKERS[0];
        const { P, notes } = liveParams(p.rules.params);
        const marketNote = isMarketOpen() ? null : 'Market closed — quotes may be stale.';

        // 1. Live data: the stock, the open puts' quotes, and every put listed in the entry window
        const [sq] = await fetchStockQuotes([ticker]);
        const S = sq?.price;
        if (!(S > 0)) throw new Error(`No live ${ticker} price (is the scanner proxy running?)`);
        const openPuts = book.positions.filter((x) => x.status === 'OPEN' && x.position_type === 'option' && x.ticker === ticker && (x.option_type || 'put') === 'put');
        const stock = book.positions.filter((x) => x.status === 'OPEN' && x.position_type === 'stock' && x.ticker === ticker);
        const key = (expiry, strike) => `${expiry}|${Number(strike).toFixed(4)}`;
        const quotes = new Map(); // expiry|strike → { bid, ask, last }
        if (openPuts.length) {
            const req = openPuts.map((x) => ({ id: x.id, ticker, strike_price: x.strike, expiration_date: x.expiration_date, option_type: 'put' }));
            for (const q of await fetchOptionQuotes(req)) {
                for (const id of q.positionIds || []) {
                    const x = openPuts.find((o) => String(o.id) === String(id));
                    if (x) quotes.set(key(x.expiration_date, x.strike), { bid: q.bid, ask: q.ask, last: q.option_price });
                }
            }
        }
        // A day wider each side: the proxy counts days from the UTC date, the strategy from New York's
        const chain = await fetchPutChainRows([ticker], Math.max(0, P.expiry.min_dte - 1), P.expiry.max_dte + 1);
        if (chain?.errors?.[ticker]) throw new Error(`Option chain: ${chain.errors[ticker]}`);
        const strikes = new Map(); // expiry → ascending listed strikes
        for (const r of chain?.rows || []) {
            quotes.set(key(r.expiry, r.strike), { bid: r.bid, ask: r.ask, last: r.last });
            if (!strikes.has(r.expiry)) strikes.set(r.expiry, []);
            strikes.get(r.expiry).push(Number(r.strike));
        }
        for (const list of strikes.values()) list.sort((a, b) => a - b);
        const types = new Set(P.expiry.calendars);
        const calendar = [...strikes.keys()].filter((e) => types.has(expiryType(e))).sort();

        // 2. Daily closes before today (trend filter, dip high) + today's live price; live quotes for prices
        const { md, market: model } = await buildMarket(ticker);
        const bars = md.bars.filter((b) => b.date < today).concat([{ date: today, close: S }]);
        const i = bars.length - 1;
        const market = {
            rate: model.rate,
            contractScale: () => 1,
            sigma: (j, k, years) => model.sigma(Math.min(j, md.bars.length - 1), k, years),
            // Listed strikes only: the nearest at or below the target, so a strike is never closer than asked
            snapStrike(date, expiry, K) {
                const list = strikes.get(expiry);
                if (!list?.length) return NaN;
                const below = list.filter((k) => k <= K + 1e-9);
                return below.length ? below[below.length - 1] : list[0];
            },
            optionPrice(date, j, s, K, expiry) {
                const q = quotes.get(key(expiry, K));
                const m = q ? quoteMid({ bid: q.bid, ask: q.ask, last: q.last }) : null;
                return m?.price > 0 ? { price: m.price, source: 'real' } : { price: null, source: 'live' };
            },
            callPrice: () => ({ price: null, source: 'live' }),
        };

        // 3. The strategy's state from the portfolio, plus what it remembers between days
        const st = newStrategyState(book.totals.cash);
        st.nextId = 1e9; // ids for trades decided today; the Simulation assigns the real ones
        for (const x of openPuts) {
            st.open.push({
                id: x.id, type: 'put', opened: x.open_date, expiry: x.expiration_date, strike: x.strike, contracts: x.contracts,
                entry_price: x.entry_price, entry_source: x.entry_source, S_entry: x.entry_context?.S ?? null,
                dte: daysBetween(x.open_date, x.expiration_date), trigger: x.entry_context?.trigger || 'manual',
                mark: x.current_price ?? x.entry_price, mark_source: x.price_source || 'live',
            });
        }
        for (const x of stock) {
            st.shares += x.shares;
            st.shareCost += x.entry_price * x.shares;
            st.shareBasis += x.entry_price * x.shares;
        }
        st.lastLadderMonth = memory.lastLadderMonth ?? null;
        st.lastDipEntry = memory.lastDipEntry ?? null;
        st.inWindowPrev = new Set(memory.inWindowPrev || []);
        st.stepped = !!memory.stepped;
        // Puts the Simulation settled as expired worthless since the last run (for "after expiry, sell the next")
        const handled = new Set(memory.handledExpired || []);
        const newlyExpired = book.positions.filter((x) => x.position_type === 'option' && x.ticker === ticker && x.close_reason === 'expired' && !handled.has(x.id));

        // 4. Decide today — the backtest engine's own step
        const decided = [];
        const strat = createStrategy({ params: P, market, bars, calendar, monthly: [], st, onAction: (a) => decided.push(a) });
        strat.step(i, { settle: false, expiredWorthless: memory.stepped ? newlyExpired.length : 0 });

        // 5. Execute in the order decided
        const log = [];
        for (const a of decided) {
            const entry = { kind: a.kind, text: describeAction(a, ticker), ok: true };
            try {
                if (a.kind === 'close_put') {
                    await strategyClosePut(a.pos.id, { price: round4(a.price), label: REASON_TEXT[a.reason] || a.reason, rolled: a.reason === 'rolled' });
                } else if (a.kind === 'open_put') {
                    const q = quotes.get(key(a.pos.expiry, a.pos.strike)) || {};
                    const pos = await openPut(p.id, {
                        ticker, strike: a.pos.strike, expiration_date: a.pos.expiry, contracts: a.pos.contracts,
                        resolvedFill: { price: round4(a.price), source: 'mid', bid: q.bid ?? null, ask: q.ask ?? null },
                        rolled_from_id: a.pos.rolled_from || null,
                        entry_context: { strategy: p.rules.preset_name, trigger: a.pos.trigger, S: round4(S), annual_return_pct: a.pos.annual_return_pct, pct_below: Math.round((1 - a.pos.strike / S) * 1000) / 10 },
                        notes: `Strategy: ${a.pos.trigger.split('+').map((t) => TRIGGER_TEXT[t] || t).join(' + ')}`,
                    });
                    if (a.pos.rolled_from) await linkRoll(a.pos.rolled_from, pos.id);
                } else if (a.kind === 'sell_shares') {
                    for (const x of stock) await closePosition(x.id, { price: round4(a.price) });
                } else {
                    throw new Error('Not supported in the Simulation');
                }
            } catch (err) {
                entry.ok = false;
                entry.error = err.message;
            }
            log.push(entry);
        }

        const reasons = skippedText(st.skipped, P);
        const message = [
            decided.length ? `${decided.length} trade${decided.length > 1 ? 's' : ''}.` : `No trades — ${reasons.length ? reasons.join('; ') : 'no entry trigger today'}.`,
            log.some((x) => !x.ok) ? 'Some trades failed (see below).' : null,
            marketNote,
        ].filter(Boolean).join(' ');
        const details = {
            S, equity: Math.round(strat.currentEquity(S) * 100) / 100, cash: Math.round(st.cash * 100) / 100,
            skipped: st.skipped, notes, expiries_in_window: calendar.length,
            open_puts: st.open.map((x) => ({ expiry: x.expiry, strike: x.strike, contracts: x.contracts, entry_price: x.entry_price, mark: x.mark, kept_pct: x.entry_price > 0 ? Math.round((1 - x.mark / x.entry_price) * 100) : null })),
            shares: st.shares,
        };
        await saveRulesState(p.id, {
            ...memory,
            lastLadderMonth: st.lastLadderMonth, lastDipEntry: st.lastDipEntry, inWindowPrev: [...st.inWindowPrev], stepped: true,
            handledExpired: [...handled, ...newlyExpired.map((x) => x.id)].slice(-200),
            last_run_date: today,
            last_auto_date: trigger === 'auto' ? today : memory.last_auto_date ?? null,
        });
        return await logRun(p.id, { run_date: today, trigger, status: log.some((x) => !x.ok) ? 'error' : 'ok', underlying_price: S, message, actions: log, details });
    } catch (err) {
        if (err instanceof StrategyError) throw err;
        if (trigger === 'auto') {
            const n = memory.attempts?.date === today ? memory.attempts.n + 1 : 1;
            await saveRulesState(portfolioId, { ...memory, attempts: { date: today, n } }).catch(() => {});
        }
        return logRun(portfolioId, { run_date: today, trigger, status: 'error', message: err.message, actions: [], details: null });
    } finally {
        running.delete(portfolioId);
    }
}

async function logRun(portfolioId, row) {
    const [id] = await db('sim_strategy_runs').insert({
        portfolio_id: portfolioId, run_date: row.run_date, trigger: row.trigger, status: row.status,
        underlying_price: row.underlying_price ?? null, message: row.message?.slice(0, 4000) ?? null,
        actions: JSON.stringify(row.actions || []), details: row.details ? JSON.stringify(row.details) : null,
    });
    return normRun(await db('sim_strategy_runs').where({ id }).first());
}

function normRun(r) {
    const parse = (t) => {
        try {
            return t ? JSON.parse(t) : null;
        } catch {
            return null;
        }
    };
    return {
        ...r,
        run_date: r.run_date instanceof Date ? r.run_date.toISOString().slice(0, 10) : String(r.run_date).slice(0, 10),
        underlying_price: r.underlying_price == null ? null : Number(r.underlying_price),
        actions: parse(r.actions) || [],
        details: parse(r.details),
    };
}

/** Strategy panel data: the rules, the run log, and the backtest of the same setting over the same days. */
export async function strategyOverview(portfolioId) {
    const { portfolio: p } = await portfolioBook(portfolioId);
    if (p.strategy_type !== 'rules' || !p.rules?.params) throw new StrategyError('This portfolio has no automatic strategy', 404);
    const runs = (await db('sim_strategy_runs').where({ portfolio_id: p.id }).orderBy('id', 'desc').limit(200)).map(normRun);
    const ticker = p.rules.ticker || BACKTEST_TICKERS[0];
    const start = nyClock(new Date(p.created_at)).date;
    let backtest = null;
    try {
        const { md, market } = await buildMarket(ticker);
        if (md.bars.some((b) => b.date >= start)) {
            const r = runBacktest({ bars: md.bars, market, params: { ...p.rules.params, start, end: undefined, starting_cash: p.starting_cash } });
            backtest = {
                equity: r.equity.map((e) => ({ date: e.date, equity: e.equity })),
                total_return_pct: r.summary.total_return_pct, trades: r.summary.trades, open_puts: r.summary.open_puts,
                real_price_pct: r.summary.real_price_pct,
            };
        }
    } catch (err) {
        backtest = { error: err.message };
    }
    const state = p.rules_state || {};
    return {
        rules: p.rules,
        notes: liveParams(p.rules.params).notes,
        last_run_date: state.last_run_date || null,
        last_auto_date: state.last_auto_date || null,
        runs,
        backtest,
    };
}

/** Change when the daily run happens (HH:MM, New York). */
export async function updateStrategy(portfolioId, { run_at }) {
    const { portfolio: p } = await portfolioBook(portfolioId);
    if (p.strategy_type !== 'rules') throw new StrategyError('This portfolio has no automatic strategy');
    await db('sim_portfolios').where({ id: p.id }).update({ rules: JSON.stringify({ ...p.rules, run_at }), updated_at: db.fn.now() });
}

let ticking = false;

/** Every few minutes in market hours: run each active strategy once a day, at or after its run time. */
async function tick() {
    if (ticking || !isMarketOpen()) return;
    ticking = true;
    try {
        const { date, minutes } = nyClock();
        const rows = await db('sim_portfolios').where({ is_active: true, strategy_type: 'rules' });
        let tradedToday = null; // checked once per tick, only when a strategy is due
        for (const row of rows) {
            let rules, state;
            try {
                rules = JSON.parse(row.rules || 'null');
                state = JSON.parse(row.rules_state || '{}') || {};
            } catch {
                continue;
            }
            if (!rules?.params) continue;
            const [h, m] = String(rules.run_at || DEFAULT_RUN_AT).split(':').map(Number);
            if (minutes < h * 60 + m || minutes > 16 * 60) continue;
            if (state.last_auto_date === date) continue;
            if (state.attempts?.date === date && state.attempts.n >= MAX_AUTO_ATTEMPTS) continue;
            if (tradedToday == null) tradedToday = (await lastTradeDate(rules.ticker || BACKTEST_TICKERS[0])) === date;
            if (!tradedToday) continue; // market holiday
            try {
                const run = await runStrategy(row.id, { trigger: 'auto' });
                console.log(`[Strategy] ${row.name}: ${run.status} — ${run.message}`);
            } catch (err) {
                console.warn(`[Strategy] ${row.name} failed:`, err.message);
            }
        }
    } finally {
        ticking = false;
    }
}

let strategyInterval = null;
export function startStrategyJob(intervalMinutes = 5) {
    console.log(`[Strategy] Automatic strategy portfolios checked every ${intervalMinutes} minutes (each runs once a day, default ${DEFAULT_RUN_AT} New York)`);
    strategyInterval = setInterval(() => tick().catch((err) => console.warn('[Strategy] tick failed:', err.message)), intervalMinutes * 60 * 1000);
}
export function stopStrategyJob() {
    if (strategyInterval) clearInterval(strategyInterval);
    strategyInterval = null;
}
