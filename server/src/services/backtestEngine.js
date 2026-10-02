// Long-dated cash-secured put backtest engine — pure, no I/O.
// Replays trading days: mark open puts and calls, settle expiries, apply exits, sell covered calls on any
// assigned shares (the wheel), then enter new puts when a trigger fires (monthly ladder, new expiry in the
// window, or a dip). Prices come from `market` (real quotes where they exist, else the calibrated model —
// see backtestService.js). An assigned put's P&L includes the drop from strike to market at assignment, so
// covered calls and call-aways are measured from that market price (no double count); the strike stays
// the cost basis for the "never sell calls below cost" rule.
import { strikeForDelta, strikeForCallDelta } from './bsModel.js';

const DAY = 86400000;
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
// Prices keep 6 decimals: split-adjusted history has SOXL near $1, where premiums are fractions of a cent.
const p6 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 1e6) / 1e6);

export const DEFAULT_PARAMS = {
    starting_cash: 100000,
    size_mode: 'equity_pct', // equity_pct: each new put's collateral ≈ size_pct of equity | contracts: fixed count of real contracts
    size_pct: 10,
    contracts: 1,
    entry: {
        ladder: { enabled: true, day: 1 },
        listing: { enabled: false },
        dip: { enabled: false, pct: 30, cooldown_days: 30 },
        // Keep selling: any day the position limits allow another put, sell one
        continuous: { enabled: false },
    },
    // In real 100-share units: max open puts at once, and max (shares ÷ 100 + open puts). null = no limit.
    limits: { max_open_puts: null, max_units: null },
    expiry: { min_dte: 400, max_dte: 500, calendar: 'january' }, // january | monthly | weekly
    // delta | pct (percent below the price) | yield (the furthest strike, between min_discount_pct and
    // max_discount_pct below the price, whose premium still pays target_annual_pct a year on the strike);
    // min_discount_pct caps every mode at (100 − x)% of the price
    strike: { mode: 'pct', delta: 0.25, pct: 60, min_discount_pct: 60, max_discount_pct: 80, target_annual_pct: 10 },
    min_annual_return_pct: 0,
    // Skip puts paying less than this per real share (split-adjusted prices are scaled back first)
    min_put_premium: 0.05,
    max_capital_pct: 70,
    exit: {
        take_profit_pct: 30, // % of the premium earned (null = off)
        // After a take profit: 'roll' = sell a put at a later expiry (expiry rules) with the strike roll_discount_pct
        // below the price at that moment, same contracts · 'reenter' = sell a new put by the entry strike rule ·
        // 'none' = wait for the next entry trigger
        after_tp: 'roll',
        roll_discount_pct: 70,
        roll_strike: 'pct', // 'pct' = roll_discount_pct below the price then | 'entry' = same rule as new entries
        // When a put expires worthless: 'reenter' = sell the next one the same day by the entry rules
        after_expiry: 'none',
        early_close: { enabled: false, remaining_pct: 10, min_days_left: 180 },
        roll_when_tested: { enabled: false, buffer_pct: 5 },
    },
    // After assignment: sell calls on the shares (the wheel). Calls are model-priced.
    // mode: delta | pct (above the current price) | cost_pct (above the assignment cost basis)
    covered_calls: { enabled: true, dte: 30, mode: 'delta', delta: 0.25, pct: 10, floor_at_cost: true, take_profit_pct: null, min_premium: 0.05 },
    // Alternative to covered calls: hold assigned shares and sell them all once the close is back at or above
    // the cost basis (+ above_pct). When on, covered calls are not sold.
    sell_at_recovery: { enabled: false, above_pct: 0 },
    fee_per_contract: 0.65,
    slippage_pct: 2,
};

export function mergeParams(p = {}) {
    const d = DEFAULT_PARAMS;
    return {
        ...d, ...p,
        entry: {
            ladder: { ...d.entry.ladder, ...p.entry?.ladder },
            listing: { ...d.entry.listing, ...p.entry?.listing },
            dip: { ...d.entry.dip, ...p.entry?.dip },
            continuous: { ...d.entry.continuous, ...p.entry?.continuous },
        },
        limits: { ...d.limits, ...p.limits },
        expiry: { ...d.expiry, ...p.expiry },
        strike: { ...d.strike, ...p.strike },
        exit: {
            ...d.exit, ...p.exit,
            early_close: { ...d.exit.early_close, ...p.exit?.early_close },
            roll_when_tested: { ...d.exit.roll_when_tested, ...p.exit?.roll_when_tested },
        },
        covered_calls: { ...d.covered_calls, ...p.covered_calls },
        sell_at_recovery: { ...d.sell_at_recovery, ...p.sell_at_recovery },
    };
}

// Older saved runs used a reenter_after_tp flag
function afterTp(exit) {
    if (exit.after_tp) return exit.after_tp;
    return exit.reenter_after_tp ? 'reenter' : 'none';
}

/**
 * Strike spacing when no real chain is known: about 1% of the strike, rounded to 1 / 2.5 / 5 × 10^n.
 * Relative, because split-adjusted history puts SOXL near $1 in 2015, where a real-world $0.50 step
 * would turn "60% below" into 74% below.
 */
export function strikeStep(K) {
    const raw = Math.max(1e-4, Math.abs(K) * 0.01);
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw - 1e-12);
}

/** Third Friday of a month (standard monthly / LEAPS expiry), as YYYY-MM-DD. */
export function thirdFriday(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (5 - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(year, month - 1, 1 + offset + 14)).toISOString().slice(0, 10);
}

export function expiryCalendar(fromYear, toYear, calendar) {
    const out = [];
    if (calendar === 'weekly') {
        // Every Friday
        let d = new Date(Date.UTC(fromYear, 0, 1));
        while (d.getUTCDay() !== 5) d = new Date(d.getTime() + DAY);
        while (d.getUTCFullYear() <= toYear) {
            out.push(d.toISOString().slice(0, 10));
            d = new Date(d.getTime() + 7 * DAY);
        }
        return out;
    }
    for (let y = fromYear; y <= toYear; y++) {
        for (let m = 1; m <= 12; m++) if (calendar === 'monthly' || m === 1) out.push(thirdFriday(y, m));
    }
    return out;
}

export const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / DAY);

/**
 * bars: [{ date, close }] ascending (split-adjusted). market: {
 *   rate(date) → decimal; sigma(i, k) → model vol for moneyness k on bar i;
 *   snapStrike(date, expiry, K) → listed strike nearest K; optionPrice(date, i, S, K, expiry) → { price, source };
 *   callPrice(date, i, S, K, expiry) → { price, source } (covered calls);
 *   contractScale(date) → real contracts per backtest contract (1 / later split ratio; optional, default 1)
 * }. Prices are split-adjusted, so before a split one real contract covers several backtest contracts —
 * fees and the covered-call minimum premium are charged per real contract. bench: { [name]: Map(date → close) } for buy-and-hold comparisons.
 */
export function runBacktest({ bars, market, params: rawParams, bench = {} }) {
    const P = mergeParams(rawParams);
    const start = P.start || bars[0]?.date, end = P.end || bars[bars.length - 1]?.date;
    const from = bars.findIndex((b) => b.date >= start);
    if (from < 0) throw new Error('No price data in the chosen range');
    const lastIdx = bars.findLastIndex((b) => b.date <= end);
    const y0 = Number(start.slice(0, 4));
    const calendar = expiryCalendar(y0, Number(end.slice(0, 4)) + 3, P.expiry.calendar);
    const monthly = expiryCalendar(y0, Number(end.slice(0, 4)) + 1, P.expiry.calendar === 'weekly' ? 'weekly' : 'monthly');
    const CC = P.covered_calls;
    const slip = (P.slippage_pct || 0) / 100;
    const fixedContracts = Math.max(1, Math.round(P.contracts || 1));

    let cash = P.starting_cash;
    // shareCost: what was paid (strikes) — the cost basis; shareBasis: market value at assignment (P&L basis)
    let shares = 0, shareCost = 0, shareBasis = 0;
    const open = []; // puts: { id, opened, expiry, strike, contracts, entry_price, entry_source, S_entry, dte, trigger, mark, mark_source }
    const calls = []; // covered calls, same shape
    const stockEvents = []; // called away
    let ccPremium = 0;
    const trades = [];
    const assignments = [];
    const equity = [];
    const skipped = { no_expiry: 0, low_return: 0, low_premium: 0, capital: 0, no_price: 0, call_low_premium: 0, limit: 0 };
    const pricing = { real: 0, model: 0 };
    let nextId = 1, lastLadderMonth = null, lastDipEntry = null;
    const inWindowPrev = new Set();
    let peakEquity = -Infinity, maxDD = 0, ddPeakDate = null, ddTroughDate = null, curPeakDate = null;
    const closesUpTo = (i) => bars[i].close;

    const scale = (date) => market.contractScale?.(date) ?? 1;
    let today = null; // current bar date, for per-real-contract fees
    const fee = (n, date = today) => (P.fee_per_contract || 0) * n * scale(date);
    const collateral = () => open.reduce((s, p) => s + p.strike * 100 * p.contracts, 0);
    const liability = () => [...open, ...calls].reduce((s, p) => s + p.mark * 100 * p.contracts, 0);
    /** Position limits in real 100-share units (split-adjusted counts scaled back). */
    function withinLimits(date, addContracts) {
        const L = P.limits || {};
        const real = (adjContracts) => adjContracts * scale(date);
        const openPutsReal = real(open.reduce((a, p) => a + p.contracts, 0));
        const addReal = real(addContracts);
        if (L.max_open_puts != null && openPutsReal + addReal > L.max_open_puts + 1e-9) return false;
        if (L.max_units != null && (shares * scale(date)) / 100 + openPutsReal + addReal > L.max_units + 1e-9) return false;
        return true;
    }
    const price = (date, i, S, K, expiry) => {
        const q = market.optionPrice(date, i, S, K, expiry);
        if (q?.price != null) pricing[q.source === 'real' ? 'real' : 'model']++;
        return q;
    };

    function closePut(pos, date, S, how, closePx, source) {
        const n = pos.contracts;
        const cost = closePx * (1 + slip);
        cash -= cost * 100 * n + fee(n);
        const pnl = (pos.entry_price - cost) * 100 * n - fee(n) * 2;
        trades.push({
            ...pos, closed: date, close_price: p6(cost), close_source: source, reason: how, S_close: p6(S),
            pnl: r2(pnl), days_held: daysBetween(pos.opened, date),
        });
        const list = pos.type === 'call' ? calls : open;
        list.splice(list.indexOf(pos), 1);
    }

    /** Sell calls on shares not yet covered: expiry ≥ cc.dte days out, strike by delta or % above, never below cost if set. */
    function sellCoveredCalls(i, date, S) {
        const covered = calls.reduce((n, c) => n + c.contracts * 100, 0);
        const n = Math.floor((shares - covered) / 100);
        if (n < 1) return;
        const expiry = monthly.find((e) => daysBetween(date, e) >= CC.dte);
        if (!expiry) return;
        const dte = daysBetween(date, expiry);
        const T = dte / 365, r = market.rate(date);
        const avgCost = shares ? shareCost / shares : 0;
        let K = CC.mode === 'cost_pct'
            ? avgCost * (1 + CC.pct / 100)
            : CC.mode === 'pct'
                ? S * (1 + CC.pct / 100)
                : strikeForCallDelta(S, T, r, (k) => market.sigma(i, k / S, T) || 0.8, CC.delta);
        const step = strikeStep(K);
        K = CC.mode === 'cost_pct' ? Math.ceil(K / step - 1e-9) * step : Math.round(K / step) * step;
        if (CC.floor_at_cost && K < avgCost) K = Math.ceil(avgCost / strikeStep(avgCost)) * strikeStep(avgCost);
        const q = market.callPrice(date, i, S, K, expiry);
        const premium = (q?.price || 0) * (1 - slip);
        if (premium < (CC.min_premium || 0) * scale(date)) {
            skipped.call_low_premium++;
            return;
        }
        cash += premium * 100 * n - fee(n);
        ccPremium += premium * 100 * n;
        calls.push({
            id: nextId++, type: 'call', opened: date, expiry, strike: p6(K), contracts: n, entry_price: p6(premium), entry_source: q.source,
            S_entry: p6(S), dte, trigger: 'covered_call', annual_return_pct: r2((premium / S) * (365 / dte) * 100), mark: q.price, mark_source: q.source,
            cost_basis: p6(avgCost),
        });
    }

    /**
     * Sell a put. Normal entries pick the expiry (latest in the window) and strike by the rules; a roll passes
     * `roll` = { discount_pct, contracts, after }: strike that far below today's price, same size, expiry later than `after`.
     */
    function tryEnter(i, date, S, triggers, forcedExpiry = null, equityNow, roll = null) {
        const window = calendar.filter((e) => {
            const dte = daysBetween(date, e);
            return dte >= P.expiry.min_dte && dte <= P.expiry.max_dte && (!roll || e > roll.after);
        });
        const expiry = forcedExpiry || window[window.length - 1];
        if (!expiry) {
            skipped.no_expiry++;
            return false;
        }
        const dte = daysBetween(date, expiry);
        const T = dte / 365, r = market.rate(date);
        let K;
        let yieldQuote = null;
        if (roll && P.exit.roll_strike !== 'entry') {
            const target = S * (1 - roll.discount_pct / 100);
            K = market.snapStrike(date, expiry, target);
            if (K > target) K = Math.floor(target / strikeStep(target)) * strikeStep(target); // stay at least that far below
        } else if (P.strike.mode === 'yield') {
            // Walk up from the furthest allowed strike; the first that pays the target annual return wins
            const lo = S * (1 - (P.strike.max_discount_pct ?? 80) / 100);
            const hi = S * (1 - (P.strike.min_discount_pct ?? 0) / 100);
            const step = strikeStep(lo);
            const tried = new Set();
            for (let k = Math.ceil(lo / step) * step; k <= hi + 1e-9 && !yieldQuote; k += step) {
                const cand = market.snapStrike(date, expiry, k);
                if (!(cand > 0) || cand < lo - 1e-9 || cand > hi + 1e-9 || tried.has(cand)) continue;
                tried.add(cand);
                const q = price(date, i, S, cand, expiry);
                if (q?.price > 0 && ((q.price * (1 - slip)) / cand) * (365 / dte) * 100 >= (P.strike.target_annual_pct ?? 10)) {
                    K = cand;
                    yieldQuote = q;
                }
            }
            if (!yieldQuote) {
                skipped.low_return++;
                return false;
            }
        } else {
            K = P.strike.mode === 'pct'
                ? S * (1 - P.strike.pct / 100)
                : strikeForDelta(S, T, r, (k) => market.sigma(i, k / S, T) || 0.8, P.strike.delta);
            const cap = P.strike.min_discount_pct ? S * (1 - P.strike.min_discount_pct / 100) : Infinity;
            K = market.snapStrike(date, expiry, Math.min(K, cap));
            if (K > cap) K = Math.floor(cap / strikeStep(cap)) * strikeStep(cap); // nearest listed strike was above the cap
        }
        if (!(K > 0)) {
            skipped.no_price++;
            return false;
        }
        const q = yieldQuote || price(date, i, S, K, expiry);
        if (!(q?.price > 0)) {
            skipped.no_price++;
            return false;
        }
        const premium = q.price * (1 - slip);
        if (premium < (P.min_put_premium || 0) * scale(date)) {
            skipped.low_premium++;
            return false;
        }
        const annual = (premium / K) * (365 / dte) * 100;
        if (annual < (P.min_annual_return_pct || 0)) {
            skipped.low_return++;
            return false;
        }
        // Fixed sizes are real contracts: before a split one real contract is several split-adjusted ones
        const n = roll ? roll.contracts : P.size_mode === 'equity_pct'
            ? Math.floor(((P.size_pct || 10) / 100) * equityNow / (K * 100))
            : Math.max(1, Math.round(fixedContracts / scale(date)));
        if (n < 1) {
            skipped.capital++;
            return false;
        }
        if (!roll && !withinLimits(date, n)) {
            skipped.limit++;
            return false;
        }
        const need = K * 100 * n;
        const free = cash - collateral() + premium * 100 * n - fee(n);
        if (free < need || collateral() + need > (P.max_capital_pct / 100) * equityNow) {
            skipped.capital++;
            return false;
        }
        cash += premium * 100 * n - fee(n);
        open.push({
            id: nextId++, type: 'put', opened: date, expiry, strike: p6(K), contracts: n, entry_price: p6(premium), entry_source: q.source,
            S_entry: p6(S), dte, trigger: triggers.join('+'), annual_return_pct: r2(annual), mark: q.price, mark_source: q.source,
            rolled_from: roll?.from ?? null,
        });
        return true;
    }

    for (let i = from; i <= lastIdx; i++) {
        const { date, close: S } = bars[i];
        today = date;

        // 1. Mark open puts
        for (const pos of open) {
            const q = price(date, i, S, pos.strike, pos.expiry);
            if (q?.price != null) {
                pos.mark = q.price;
                pos.mark_source = q.source;
            }
        }
        for (const c of calls) {
            const q = market.callPrice(date, i, S, c.strike, c.expiry);
            if (q?.price != null) {
                c.mark = q.price;
                c.mark_source = q.source;
            }
        }
        // 2. Expiry: assignment below the strike (shares join the wheel), else worthless
        for (const pos of [...open]) {
            if (date < pos.expiry) continue;
            if (S < pos.strike) {
                const n = pos.contracts;
                cash -= pos.strike * 100 * n;
                shareCost += pos.strike * 100 * n;
                shareBasis += S * 100 * n;
                shares += 100 * n;
                assignments.push({ date, strike: pos.strike, shares: 100 * n, S: p6(S), depth_pct: r2(((pos.strike - S) / pos.strike) * 100), recovered_on: null });
                closePutAtExpiry(pos, date, S, 'assigned');
            } else {
                closePutAtExpiry(pos, date, S, 'expired');
                if (P.exit.after_expiry === 'reenter') tryEnter(i, date, S, ['after_expiry'], null, currentEquity(S));
            }
        }
        // Covered calls at expiry: called away above the strike, else they expire and the shares stay
        for (const c of [...calls]) {
            if (date < c.expiry) continue;
            const n = c.contracts;
            if (S > c.strike) {
                const avgCost = shareCost / shares, avgBasis = shareBasis / shares;
                cash += c.strike * 100 * n;
                shares -= 100 * n;
                shareCost -= avgCost * 100 * n;
                shareBasis -= avgBasis * 100 * n;
                stockEvents.push({
                    date, shares: 100 * n, price: c.strike, S: p6(S), cost_basis: p6(avgCost),
                    vs_cost: r2((c.strike - avgCost) * 100 * n), vs_assignment: r2((c.strike - avgBasis) * 100 * n),
                });
                // Option P&L: premium less the intrinsic value given up (the shares were delivered at the strike)
                trades.push({ ...c, closed: date, close_price: p6(S - c.strike), close_source: 'expiry', reason: 'called_away', S_close: p6(S), pnl: r2(c.entry_price * 100 * n - fee(n) + (c.strike - avgBasis) * 100 * n), days_held: daysBetween(c.opened, date) });
            } else {
                trades.push({ ...c, closed: date, close_price: 0, close_source: 'expiry', reason: 'expired', S_close: p6(S), pnl: r2(c.entry_price * 100 * n - fee(n)), days_held: daysBetween(c.opened, date) });
            }
            calls.splice(calls.indexOf(c), 1);
        }
        if (CC.take_profit_pct != null) {
            for (const c of [...calls]) if (c.mark <= c.entry_price * (1 - CC.take_profit_pct / 100)) closePut(c, date, S, 'take_profit', c.mark, c.mark_source);
        }

        // 3. Exits
        for (const pos of [...open]) {
            const tp = P.exit.take_profit_pct;
            const left = daysBetween(date, pos.expiry);
            if (tp != null && pos.mark <= pos.entry_price * (1 - tp / 100)) {
                closePut(pos, date, S, 'take_profit', pos.mark, pos.mark_source);
                const then = afterTp(P.exit);
                if (then === 'roll') {
                    tryEnter(i, date, S, ['roll_out'], null, currentEquity(S), { discount_pct: P.exit.roll_discount_pct ?? 70, contracts: pos.contracts, after: pos.expiry, from: pos.id });
                } else if (then === 'reenter') {
                    tryEnter(i, date, S, ['reenter'], null, currentEquity(S));
                }
            } else if (P.exit.early_close.enabled && left >= P.exit.early_close.min_days_left && pos.mark <= pos.entry_price * (P.exit.early_close.remaining_pct / 100)) {
                closePut(pos, date, S, 'early_close', pos.mark, pos.mark_source);
            } else if (P.exit.roll_when_tested.enabled && S <= pos.strike * (1 + P.exit.roll_when_tested.buffer_pct / 100)) {
                closePut(pos, date, S, 'rolled', pos.mark, pos.mark_source);
                tryEnter(i, date, S, ['roll'], null, currentEquity(S));
            }
        }
        // Recovery of assigned shares
        for (const a of assignments) if (!a.recovered_on && S >= a.strike) a.recovered_on = date;

        // Assigned shares: sell them once back above cost, or sell covered calls on them
        const SR = P.sell_at_recovery;
        // The price received after slippage must reach the target, so a sale is never below cost
        if (SR.enabled && shares > 0 && S * (1 - slip) >= (shareCost / shares) * (1 + (SR.above_pct || 0) / 100)) {
            const avgCost = shareCost / shares, avgBasis = shareBasis / shares, sold = shares;
            const proceeds = S * (1 - slip) * sold;
            cash += proceeds;
            stockEvents.push({
                date, type: 'sold_at_recovery', shares: sold, price: p6(S * (1 - slip)), S: p6(S), cost_basis: p6(avgCost),
                vs_cost: r2(proceeds - avgCost * sold), vs_assignment: r2(proceeds - avgBasis * sold),
            });
            trades.push({
                id: nextId++, type: 'stock', opened: null, expiry: null, strike: p6(avgCost), contracts: sold / 100, entry_price: p6(avgCost),
                entry_source: 'assigned', S_entry: p6(avgBasis), trigger: 'assigned_shares', closed: date, close_price: p6(S * (1 - slip)),
                close_source: 'market', reason: 'sold_at_recovery', S_close: p6(S), pnl: r2(proceeds - avgBasis * sold),
                cost_basis: p6(avgCost),
            });
            shares = 0;
            shareCost = 0;
            shareBasis = 0;
        } else if (!SR.enabled && CC.enabled && shares >= 100) {
            sellCoveredCalls(i, date, S);
        }

        // 4. Entries
        const triggers = [];
        let forced = null;
        const ym = date.slice(0, 7);
        if (P.entry.ladder.enabled && ym !== lastLadderMonth && Number(date.slice(8, 10)) >= P.entry.ladder.day) {
            triggers.push('ladder');
            lastLadderMonth = ym;
        }
        if (P.entry.listing.enabled) {
            for (const e of calendar) {
                const dte = daysBetween(date, e);
                const inW = dte >= P.expiry.min_dte && dte <= P.expiry.max_dte;
                if (inW && !inWindowPrev.has(e) && i > from) {
                    triggers.push('new_expiry');
                    forced = e;
                }
                if (inW) inWindowPrev.add(e);
                else inWindowPrev.delete(e);
            }
            if (i === from) for (const e of calendar) {
                const dte = daysBetween(date, e);
                if (dte >= P.expiry.min_dte && dte <= P.expiry.max_dte) inWindowPrev.add(e);
            }
        }
        if (P.entry.dip.enabled) {
            let high = 0;
            for (let j = Math.max(0, i - 251); j <= i; j++) high = Math.max(high, closesUpTo(j));
            const cooled = !lastDipEntry || daysBetween(lastDipEntry, date) >= P.entry.dip.cooldown_days;
            if (S <= high * (1 - P.entry.dip.pct / 100) && cooled) triggers.push('dip');
        }
        if (P.entry.continuous.enabled && !triggers.length) triggers.push('continuous');
        if (triggers.length) {
            const ok = tryEnter(i, date, S, triggers, forced, currentEquity(S));
            if (ok && triggers.includes('dip')) lastDipEntry = date;
        }

        // 5. Equity
        const eq = currentEquity(S);
        const row = {
            date, equity: r2(eq), cash: r2(cash), collateral: r2(collateral()), stock_value: r2(shares * S),
            option_liability: r2(liability()), open_puts: open.length, open_calls: calls.length,
        };
        for (const [name, map] of Object.entries(bench)) {
            const b0 = map.get(bars[from].date), bt = map.get(date);
            if (b0 && bt) row[name] = r2(P.starting_cash * (bt / b0));
        }
        equity.push(row);
        if (eq > peakEquity) {
            peakEquity = eq;
            curPeakDate = date;
        }
        const dd = peakEquity > 0 ? (peakEquity - eq) / peakEquity : 0;
        if (dd > maxDD) {
            maxDD = dd;
            ddPeakDate = curPeakDate;
            ddTroughDate = date;
        }
    }

    function closePutAtExpiry(pos, date, S, how) {
        // No fee at expiry / assignment. An assigned put's result includes the loss of buying the shares at
        // the strike when they were worth S (the shares then live on in the equity at market value).
        const n = pos.contracts;
        const assignmentLoss = how === 'assigned' ? (pos.strike - S) * 100 * n : 0;
        const pnl = pos.entry_price * 100 * n - fee(n) - assignmentLoss;
        trades.push({ ...pos, closed: date, close_price: 0, close_source: 'expiry', reason: how, S_close: p6(S), pnl: r2(pnl), days_held: daysBetween(pos.opened, date) });
        open.splice(open.indexOf(pos), 1);
    }
    function currentEquity(S) {
        return cash + shares * S - liability();
    }

    // Still-open puts are reported at their last mark
    const lastS = bars[lastIdx].close;
    for (const pos of [...open, ...calls]) trades.push({ ...pos, closed: null, reason: 'open', close_price: p6(pos.mark), pnl: r2((pos.entry_price - pos.mark) * 100 * pos.contracts - fee(pos.contracts)), days_held: daysBetween(pos.opened, bars[lastIdx].date) });

    const out = summarize({ P, equity, trades, assignments, skipped, pricing, maxDD, ddPeakDate, ddTroughDate, shares, shareCost, lastS });
    const callTrades = trades.filter((t) => t.type === 'call');
    out.summary.covered_calls = {
        sold: callTrades.length,
        premium: r2(ccPremium),
        called_away: stockEvents.length,
        expired: callTrades.filter((t) => t.reason === 'expired').length,
        open: calls.length,
        realized_vs_cost: r2(stockEvents.filter((e) => e.type !== 'sold_at_recovery').reduce((a, e) => a + e.vs_cost, 0)),
    };
    const recov = stockEvents.filter((e) => e.type === 'sold_at_recovery');
    out.summary.sold_at_recovery = { times: recov.length, vs_cost: r2(recov.reduce((a, e) => a + e.vs_cost, 0)) };
    out.summary.cost_basis_avg = shares ? r2(shareCost / shares) : null;
    out.stock_events = stockEvents;
    return { params: P, ...out };
}

function summarize({ P, equity, trades, assignments, skipped, pricing, maxDD, ddPeakDate, ddTroughDate, shares, shareCost, lastS }) {
    const first = equity[0], last = equity[equity.length - 1];
    const years = Math.max(1 / 365, daysBetween(first.date, last.date) / 365);
    const finalEq = last.equity;
    const byYear = [];
    let prevEnd = P.starting_cash;
    for (const y of [...new Set(equity.map((e) => e.date.slice(0, 4)))]) {
        const rows = equity.filter((e) => e.date.startsWith(y));
        const end = rows[rows.length - 1].equity;
        let peak = -Infinity, dd = 0;
        for (const r of rows) {
            peak = Math.max(peak, r.equity);
            dd = Math.max(dd, (peak - r.equity) / peak);
        }
        byYear.push({ year: y, return_pct: r2(((end - prevEnd) / prevEnd) * 100), max_drawdown_pct: r2(dd * 100), end_equity: r2(end) });
        prevEnd = end;
    }
    const closed = trades.filter((t) => t.reason !== 'open' && t.type === 'put');
    const wins = closed.filter((t) => t.pnl > 0);
    const util = equity.map((e) => (e.equity > 0 ? e.collateral / e.equity : 0));
    const benchmarks = {};
    for (const key of Object.keys(last).filter((k) => !['date', 'equity', 'cash', 'collateral', 'stock_value', 'option_liability', 'open_puts', 'open_calls'].includes(k))) {
        const b = last[key];
        let peak = -Infinity, dd = 0;
        for (const e of equity) if (e[key] != null) {
            peak = Math.max(peak, e[key]);
            dd = Math.max(dd, (peak - e[key]) / peak);
        }
        benchmarks[key] = { final: b, total_return_pct: r2(((b - P.starting_cash) / P.starting_cash) * 100), cagr_pct: r2((Math.pow(b / P.starting_cash, 1 / years) - 1) * 100), max_drawdown_pct: r2(dd * 100) };
    }
    return {
        summary: {
            start: first.date,
            end: last.date,
            years: r2(years),
            final_equity: finalEq,
            total_return_pct: r2(((finalEq - P.starting_cash) / P.starting_cash) * 100),
            cagr_pct: r2((Math.pow(Math.max(finalEq, 1) / P.starting_cash, 1 / years) - 1) * 100),
            max_drawdown_pct: r2(maxDD * 100),
            max_drawdown_from: ddPeakDate,
            max_drawdown_to: ddTroughDate,
            trades: closed.length,
            open_puts: trades.filter((t) => t.reason === 'open' && t.type === 'put').length,
            win_rate_pct: closed.length ? r2((wins.length / closed.length) * 100) : null,
            avg_pnl: closed.length ? r2(closed.reduce((s, t) => s + t.pnl, 0) / closed.length) : null,
            premium_collected: r2(trades.filter((t) => t.type === 'put').reduce((s, t) => s + t.entry_price * 100 * t.contracts, 0)),
            assignments: assignments.length,
            shares_held: shares,
            shares_cost: r2(shareCost),
            shares_value: r2(shares * lastS),
            avg_capital_used_pct: r2((util.reduce((a, b) => a + b, 0) / util.length) * 100),
            real_price_pct: pricing.real + pricing.model ? r2((pricing.real / (pricing.real + pricing.model)) * 100) : 0,
            skipped,
        },
        benchmarks,
        by_year: byYear,
        trades,
        assignments: assignments.map((a) => ({ ...a, recover_days: a.recovered_on ? daysBetween(a.date, a.recovered_on) : null })),
        equity,
    };
}
