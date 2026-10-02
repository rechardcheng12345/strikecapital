import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bsPut, bsCall } from './bsModel.js';
import { runBacktest, thirdFriday, expiryCalendar, daysBetween } from './backtestEngine.js';

// Weekday bars from `start` for `n` days with a price path f(i)
function makeBars(start, n, f) {
    const out = [];
    let d = new Date(`${start}T00:00:00Z`);
    while (out.length < n) {
        const wd = d.getUTCDay();
        if (wd !== 0 && wd !== 6) out.push({ date: d.toISOString().slice(0, 10), close: f(out.length) });
        d = new Date(d.getTime() + 86400000);
    }
    return out;
}
const market = (sigma = 0.8) => ({
    rate: () => 0.04,
    sigma: () => sigma,
    snapStrike: (_d, _e, K) => (K < 100 ? Math.round(K) : Math.round(K / 5) * 5),
    optionPrice: (date, _i, S, K, expiry) => ({ price: bsPut(S, K, Math.max(0, daysBetween(date, expiry)) / 365, 0.04, sigma), source: 'model' }),
    callPrice: (date, _i, S, K, expiry) => ({ price: bsCall(S, K, Math.max(0, daysBetween(date, expiry)) / 365, 0.04, sigma), source: 'model' }),
});

describe('calendar', () => {
    it('third Fridays', () => {
        assert.equal(thirdFriday(2027, 1), '2027-01-15');
        assert.equal(thirdFriday(2028, 1), '2028-01-21');
        assert.equal(expiryCalendar(2027, 2027, 'january').length, 1);
        assert.equal(expiryCalendar(2027, 2027, 'monthly').length, 12);
    });
});

describe('backtest engine', () => {
    it('ladder with January expiries only enters while an expiry is 400–500 days out', () => {
        const bars = makeBars('2020-01-01', 520, () => 100);
        const r = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, starting_cash: 100000, exit: { take_profit_pct: null } } });
        const opened = r.trades.map((t) => t.opened.slice(0, 7));
        assert.ok(opened.length >= 3, `entries ${opened}`);
        for (const t of r.trades) assert.ok(t.dte >= 400 && t.dte <= 500 && t.expiry.endsWith('-01-15') || t.expiry.slice(5, 7) === '01');
        assert.ok(r.summary.skipped.no_expiry > 0); // months with no January expiry in the window
    });

    it('take profit closes once the put has lost half its value', () => {
        const bars = makeBars('2020-01-01', 400, (i) => 100 + i * 0.4); // steady rise
        const r = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, expiry: { calendar: 'monthly' }, exit: { take_profit_pct: 50 } } });
        const tp = r.trades.filter((t) => t.reason === 'take_profit');
        assert.ok(tp.length > 0);
        for (const t of tp) assert.ok(t.pnl > 0);
    });

    it('a crash leads to assignment; shares are held and marked; equity reconciles', () => {
        // Rise, sell, then crash 70% and stay down through expiry
        const bars = makeBars('2020-01-01', 700, (i) => (i < 30 ? 100 : i < 60 ? 100 - (i - 30) * 2.3 : 31));
        const r = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, starting_cash: 20000, expiry: { calendar: 'monthly' }, entry: { ladder: { enabled: true, day: 1 } }, exit: { take_profit_pct: null }, max_capital_pct: 100 } });
        assert.ok(r.assignments.length > 0);
        const a = r.assignments[0];
        assert.ok(a.depth_pct > 20 && a.recovered_on === null);
        assert.ok(r.summary.shares_held >= 100);
        for (const e of r.equity) {
            assert.ok(Math.abs(e.equity - (e.cash + e.stock_value - e.option_liability)) < 0.05, JSON.stringify(e));
        }
        assert.ok(r.summary.max_drawdown_pct > 10, `${r.summary.max_drawdown_pct}`);
        // An assigned put is a loss once the stock is far below the strike
        assert.ok(r.trades.filter((t) => t.reason === 'assigned').every((t) => t.pnl < 0));
    });

    it('respects the capital cap', () => {
        const bars = makeBars('2020-01-01', 400, () => 100);
        const r = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, starting_cash: 20000, max_capital_pct: 50, expiry: { calendar: 'monthly' }, exit: { take_profit_pct: null } } });
        for (const e of r.equity) assert.ok(e.collateral <= 0.5 * 20000 + 1e-6 + 2000, `${e.collateral}`); // within cap (cap uses equity at entry)
        assert.ok(r.summary.skipped.capital > 0);
    });

    it('dip trigger with cooldown, and new-expiry trigger once per expiry', () => {
        const bars = makeBars('2020-01-01', 600, (i) => (i < 260 ? 100 : 65)); // 35% below the 1-year high
        const dip = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, entry: { ladder: { enabled: false }, dip: { enabled: true, pct: 30, cooldown_days: 60 } }, expiry: { calendar: 'monthly' }, exit: { take_profit_pct: null }, max_capital_pct: 100 } });
        const dips = dip.trades.filter((t) => t.trigger.includes('dip'));
        assert.ok(dips.length >= 2);
        for (let k = 1; k < dips.length; k++) assert.ok(daysBetween(dips[k - 1].opened, dips[k].opened) >= 60);

        const flat = makeBars('2020-01-01', 600, () => 100);
        const lst = runBacktest({ bars: flat, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, entry: { ladder: { enabled: false }, listing: { enabled: true } }, expiry: { calendar: 'january' }, exit: { take_profit_pct: null }, max_capital_pct: 100 } });
        const expiries = lst.trades.map((t) => t.expiry);
        assert.ok(expiries.length >= 1);
        assert.equal(new Set(expiries).size, expiries.length); // one entry per newly listed expiry
        for (const t of lst.trades) assert.equal(t.dte, 500);
    });

    it('min annual return skips poor premium', () => {
        const bars = makeBars('2020-01-01', 300, () => 100);
        const r = runBacktest({ bars, market: market(0.2), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.25, min_discount_pct: 0 }, min_annual_return_pct: 50, expiry: { calendar: 'monthly' } } });
        assert.equal(r.trades.length, 0);
        assert.ok(r.summary.skipped.low_return > 0);
    });

    it('sizes each new put as a share of equity', () => {
        const bars = makeBars('2020-01-01', 300, () => 100);
        const r = runBacktest({ bars, market: market(), params: { starting_cash: 200000, size_mode: 'equity_pct', size_pct: 10, expiry: { calendar: 'monthly' }, exit: { take_profit_pct: null } } });
        const t = r.trades[0];
        // 10% of ~$200k against a strike near $60–80 → 2–3 contracts
        assert.equal(t.contracts, Math.floor(20000 / (t.strike * 100)));
        assert.ok(t.contracts >= 2);
    });

    it('strike cap: never above (100 − min discount)% of the price', () => {
        const bars = makeBars('2020-01-01', 200, () => 100);
        const r = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'delta', delta: 0.3, min_discount_pct: 60 }, expiry: { calendar: 'monthly' }, exit: { take_profit_pct: null } } });
        assert.ok(r.trades.length > 0);
        for (const t of r.trades) assert.ok(t.strike <= 40, `strike ${t.strike}`);
        const pct = runBacktest({ bars, market: market(), params: { size_mode: 'contracts', strike: { mode: 'pct', pct: 60 }, expiry: { calendar: 'monthly' }, exit: { take_profit_pct: null } } });
        for (const t of pct.trades) assert.equal(t.strike, 40);
    });

    it('wheel: assigned, calls sold no lower than cost, shares called away on the recovery', () => {
        // Sell at 100 (strike 60), crash to 40 through expiry, then recover to 90
        const bars = makeBars('2020-01-01', 900, (i) => (i < 20 ? 100 : i < 420 ? 40 : Math.min(90, 40 + (i - 420) * 0.5)));
        const r = runBacktest({ bars, market: market(), params: {
            size_mode: 'contracts', strike: { mode: 'pct', pct: 40, min_discount_pct: 0 }, expiry: { calendar: 'monthly', min_dte: 400, max_dte: 420 },
            entry: { ladder: { enabled: true, day: 1 } }, max_capital_pct: 100, starting_cash: 20000, exit: { take_profit_pct: null },
            covered_calls: { enabled: true, dte: 30, mode: 'delta', delta: 0.3, floor_at_cost: true, min_premium: 0.01 },
        } });
        assert.ok(r.assignments.length >= 1, 'assigned');
        const calls = r.trades.filter((t) => t.type === 'call');
        assert.ok(calls.length >= 1, 'calls sold');
        for (const c of calls) assert.ok(c.strike >= c.cost_basis - 1e-9, `call ${c.strike} below cost ${c.cost_basis}`);
        assert.ok(r.summary.covered_calls.called_away >= 1, JSON.stringify(r.summary.covered_calls));
        for (const e of r.stock_events) assert.ok(e.vs_cost >= 0);
        for (const e of r.equity) assert.ok(Math.abs(e.equity - (e.cash + e.stock_value - e.option_liability)) < 0.05);
    });

    it('wheel without the cost floor sells calls near the market, even below cost', () => {
        const bars = makeBars('2020-01-01', 700, (i) => (i < 20 ? 100 : 40));
        const r = runBacktest({ bars, market: market(), params: {
            size_mode: 'contracts', strike: { mode: 'pct', pct: 40, min_discount_pct: 0 }, expiry: { calendar: 'monthly', min_dte: 400, max_dte: 420 },
            max_capital_pct: 100, starting_cash: 20000, exit: { take_profit_pct: null },
            covered_calls: { enabled: true, dte: 30, mode: 'pct', pct: 10, floor_at_cost: false, min_premium: 0.01 },
        } });
        const calls = r.trades.filter((t) => t.type === 'call');
        assert.ok(calls.length >= 3);
        assert.ok(calls.every((c) => c.strike < 60 && c.strike >= 44), calls.map((c) => c.strike).join(','));
        assert.ok(r.summary.covered_calls.premium > 0);
    });

    it('re-enters right after a take profit', () => {
        const bars = makeBars('2020-01-01', 300, (i) => 100 + i * 0.3);
        const base = { size_mode: 'contracts', strike: { mode: 'pct', pct: 40, min_discount_pct: 0 }, expiry: { calendar: 'monthly' }, entry: { ladder: { enabled: true, day: 1 } }, max_capital_pct: 100 };
        const on = runBacktest({ bars, market: market(), params: { ...base, exit: { take_profit_pct: 30, after_tp: 'reenter' } } });
        const off = runBacktest({ bars, market: market(), params: { ...base, exit: { take_profit_pct: 30, after_tp: 'none' } } });
        const re = on.trades.filter((t) => t.trigger === 'reenter');
        assert.ok(re.length > 0);
        for (const t of re) assert.ok(on.trades.some((x) => x.reason === 'take_profit' && x.closed === t.opened));
        assert.ok(on.trades.length > off.trades.length);
    });

    it('after a take profit, rolls to a later expiry with the strike 70% below the price then', () => {
        const bars = makeBars('2020-01-01', 400, (i) => 100 + i * 0.3); // rising: puts hit 30% profit
        const r = runBacktest({ bars, market: market(), params: {
            size_mode: 'contracts', contracts: 2, strike: { mode: 'pct', pct: 40, min_discount_pct: 0 }, expiry: { calendar: 'monthly' },
            entry: { ladder: { enabled: true, day: 1 } }, max_capital_pct: 100, exit: { take_profit_pct: 30, after_tp: 'roll', roll_discount_pct: 70 },
        } });
        const rolls = r.trades.filter((t) => t.trigger === 'roll_out');
        assert.ok(rolls.length > 0);
        for (const t of rolls) {
            const from = r.trades.find((x) => x.id === t.rolled_from);
            assert.ok(from && from.reason === 'take_profit' && from.closed === t.opened);
            assert.ok(t.strike <= t.S_entry * 0.3 + 1e-9, `${t.strike} vs price ${t.S_entry}`); // at least 70% below the price then
            assert.ok(t.strike > t.S_entry * 0.3 - 1); // …and snapped close to it
            assert.equal(t.contracts, from.contracts); // size kept
            assert.ok(t.expiry > from.expiry); // further out
        }
    });

    it('weekly calendar and selling the next put when one expires', () => {
        const fridays = expiryCalendar(2026, 2026, 'weekly');
        assert.equal(fridays.length, 52);
        assert.ok(fridays.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5));
        const bars = makeBars('2020-01-01', 260, () => 100);
        const r = runBacktest({ bars, market: market(), params: {
            size_mode: 'contracts', strike: { mode: 'pct', pct: 35, min_discount_pct: 0 }, expiry: { min_dte: 30, max_dte: 40, calendar: 'weekly' },
            entry: { ladder: { enabled: true, day: 1 } }, max_capital_pct: 100, exit: { take_profit_pct: null, after_expiry: 'reenter' },
        } });
        const next = r.trades.filter((t) => t.trigger === 'after_expiry');
        assert.ok(next.length > 3);
        for (const t of r.trades) assert.ok(t.dte >= 30 && t.dte <= 40);
        for (const t of next) assert.ok(r.trades.some((x) => x.reason === 'expired' && x.closed === t.opened));
    });

    it('fees are charged per real contract before a split', () => {
        const bars = makeBars('2020-01-01', 120, () => 100);
        const params = { starting_cash: 1000000, max_capital_pct: 100, size_mode: 'contracts', contracts: 15, strike: { mode: 'pct', pct: 35, min_discount_pct: 0 }, expiry: { min_dte: 30, max_dte: 40, calendar: 'weekly' }, fee_per_contract: 1, slippage_pct: 0, exit: { take_profit_pct: null } };
        const plain = runBacktest({ bars, market: market(), params });
        // 1 real contract before a 15:1 split = 15 split-adjusted contracts
        const split = runBacktest({ bars, market: { ...market(), contractScale: () => 1 / 15 }, params: { ...params, contracts: 1 } });
        const t0 = plain.trades.find((t) => t.reason === 'expired'), t1 = split.trades.find((t) => t.reason === 'expired');
        // 15 backtest contracts = 1 real contract before a 15:1 split → $1 fee instead of $15
        assert.ok(Math.abs((t1.pnl - t0.pnl) - 14) < 0.01, `${t0.pnl} vs ${t1.pnl}`);
    });

    it('keeps fractions of a cent on low split-adjusted prices', () => {
        const bars = makeBars('2015-01-01', 120, () => 2); // SOXL ~$2 split-adjusted
        const r = runBacktest({ bars, market: market(0.8), params: {
            starting_cash: 100000, size_pct: 50, max_capital_pct: 95, strike: { mode: 'pct', pct: 35, min_discount_pct: 0 },
            expiry: { min_dte: 30, max_dte: 40, calendar: 'weekly' }, fee_per_contract: 0, slippage_pct: 0, min_put_premium: 0, exit: { take_profit_pct: null, after_expiry: 'reenter' },
        } });
        const expired = r.trades.filter((t) => t.reason === 'expired');
        assert.ok(expired.length > 0);
        for (const t of expired) {
            assert.ok(t.entry_price > 0 && t.entry_price < 0.05, `${t.entry_price}`);
            assert.ok(t.pnl > 0); // a put that expires worthless with no fees is a win
        }
    });

    it('skips puts paying less than the minimum premium (per real share)', () => {
        const bars = makeBars('2015-01-01', 120, () => 2);
        const base = { starting_cash: 100000, size_pct: 50, max_capital_pct: 95, strike: { mode: 'pct', pct: 35, min_discount_pct: 0 }, expiry: { min_dte: 30, max_dte: 40, calendar: 'weekly' }, exit: { take_profit_pct: null, after_expiry: 'reenter' } };
        const exact = { ...market(0.8), snapStrike: (_d, _e, K) => K }; // keep the 1.30 strike at a $2 price
        const r = runBacktest({ bars, market: exact, params: { ...base, min_put_premium: 0.05 } });
        assert.equal(r.trades.length, 0);
        assert.ok(r.summary.skipped.low_premium > 0);
        // Before a 15:1 split the real premium is 15× the adjusted one (~$0.09), so the same puts pass
        const split = runBacktest({ bars, market: { ...exact, contractScale: () => 1 / 15 }, params: { ...base, min_put_premium: 0.05 } });
        assert.ok(split.trades.length > 0);
    });

    it('your routine: one put at a time, ≤ 200 shares, calls at cost + 5%', () => {
        // Sold near 100, crash to 50 (assigned at 65), sideways, then recovery to 80
        const bars = makeBars('2020-01-01', 500, (i) => (i < 30 ? 100 : i < 60 ? 100 - (i - 30) * (50 / 30) : i < 300 ? 50 : Math.min(80, 50 + (i - 300) * 0.3)));
        const r = runBacktest({ bars, market: market(), params: {
            starting_cash: 100000, size_mode: 'contracts', contracts: 1, max_capital_pct: 100, min_put_premium: 0,
            entry: { ladder: { enabled: false }, continuous: { enabled: true } },
            limits: { max_open_puts: 1, max_units: 2 },
            expiry: { min_dte: 35, max_dte: 40, calendar: 'weekly' },
            strike: { mode: 'pct', pct: 35, min_discount_pct: 35 },
            exit: { take_profit_pct: 80, after_tp: 'none', after_expiry: 'none' },
            covered_calls: { enabled: true, dte: 35, mode: 'cost_pct', pct: 5, min_premium: 0 },
        } });
        // Never more than one put open, never more than 200 shares + puts combined
        for (const e of r.equity) {
            assert.ok(e.open_puts <= 1);
            assert.ok(e.stock_value / bars.find((b) => b.date === e.date).close / 100 + e.open_puts <= 2 + 1e-4, e.date); // stock_value is rounded to cents
        }
        for (const t of r.trades.filter((x) => x.type !== 'call')) assert.ok(t.strike <= t.S_entry * 0.65 + 1e-9 && t.contracts === 1 && t.dte >= 35 && t.dte <= 40);
        assert.ok(r.assignments.length >= 1 && r.assignments.length <= 2);
        const calls = r.trades.filter((x) => x.type === 'call');
        assert.ok(calls.length > 0);
        // First listed strike at or above cost + 5% ($65 → $68.25 → $69 with $1 strikes)
        for (const c of calls) assert.ok(c.strike >= c.cost_basis * 1.05 - 1e-9 && c.strike <= c.cost_basis * 1.05 + 1, `${c.strike} vs cost ${c.cost_basis}`);
        assert.ok(r.trades.some((x) => x.reason === 'take_profit'));
    });

    it('assigned shares: held (no calls) and sold once the price is back above cost', () => {
        // Sold at 100 (strike 60), crash to 40 through expiry, recover to 90
        const bars = makeBars('2020-01-01', 900, (i) => (i < 20 ? 100 : i < 420 ? 40 : Math.min(90, 40 + (i - 420) * 0.5)));
        const r = runBacktest({ bars, market: market(), params: {
            size_mode: 'contracts', strike: { mode: 'pct', pct: 40, min_discount_pct: 0 }, expiry: { calendar: 'monthly', min_dte: 400, max_dte: 420 },
            entry: { ladder: { enabled: true, day: 1 } }, max_capital_pct: 100, starting_cash: 20000, exit: { take_profit_pct: null }, slippage_pct: 2,
            sell_at_recovery: { enabled: true, above_pct: 0 },
        } });
        assert.ok(r.assignments.length >= 1);
        assert.equal(r.trades.filter((t) => t.type === 'call').length, 0); // no covered calls
        const sold = r.trades.filter((t) => t.reason === 'sold_at_recovery');
        assert.ok(sold.length >= 1);
        for (const t of sold) {
            assert.ok(t.close_price >= t.cost_basis - 1e-9, `${t.close_price} < cost ${t.cost_basis}`);
            assert.ok(r.equity.find((e) => e.date === t.closed).stock_value === 0);
        }
        assert.equal(r.summary.sold_at_recovery.times, sold.length);
        assert.ok(r.summary.sold_at_recovery.vs_cost >= 0);
        for (const e of r.equity) assert.ok(Math.abs(e.equity - (e.cash + e.stock_value - e.option_liability)) < 0.05);
    });

    it('yield strikes: furthest strike paying the target; closer when premiums are thin; skips when none pays', () => {
        const bars = makeBars('2020-01-01', 60, () => 100);
        const base = { size_mode: 'contracts', slippage_pct: 0, min_put_premium: 0, expiry: { min_dte: 400, max_dte: 500, calendar: 'monthly' }, exit: { take_profit_pct: null } };
        const rich = runBacktest({ bars, market: market(1.0), params: { ...base, strike: { mode: 'yield', target_annual_pct: 10, min_discount_pct: 30, max_discount_pct: 80 } } });
        const thin = runBacktest({ bars, market: market(0.75), params: { ...base, strike: { mode: 'yield', target_annual_pct: 10, min_discount_pct: 30, max_discount_pct: 80 } } });
        const kr = rich.trades[0], kt = thin.trades[0];
        assert.ok(kr && kt);
        assert.ok(kr.annual_return_pct >= 10 && kt.annual_return_pct >= 10);
        assert.ok(kr.strike < kt.strike, `rich ${kr.strike} should be further below than thin ${kt.strike}`); // calmer → closer
        for (const t of [kr, kt]) assert.ok(t.strike >= 20 - 1e-9 && t.strike <= 70 + 1e-9);
        // The next strike further down would pay less than the target
        const none = runBacktest({ bars, market: market(0.15), params: { ...base, strike: { mode: 'yield', target_annual_pct: 30, min_discount_pct: 30, max_discount_pct: 80 } } });
        assert.equal(none.trades.length, 0);
        assert.ok(none.summary.skipped.low_return > 0);
    });
});
