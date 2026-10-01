import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dailyBars, percentile, moveStats, hitRate, minutesLeft, vixMove, impliedMove, forecastRange, spreadCandidates } from './zeroDte.js';

const bar = (date, open, high, low) => ({ date, open, high, low, close: open });

describe('history of moves from the open', () => {
    it('parses Yahoo bars and skips gaps', () => {
        const bars = dailyBars({ timestamp: [1735740000, 1735826400], indicators: { quote: [{ open: [100, null], high: [101, 1], low: [99, 1], close: [100, 1] }] } });
        assert.equal(bars.length, 1);
        assert.equal(bars[0].high, 101);
    });
    it('percentiles and hit rates', () => {
        const sorted = [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009, 0.010];
        assert.equal(percentile(sorted, 50), 0.005);
        assert.equal(percentile(sorted, 90), 0.009);
        assert.equal(hitRate(sorted, 0.008), 0.3); // 0.008, 0.009, 0.010
        assert.equal(hitRate(sorted, 0.02), 0);
    });
    it('up / down moves and a similar-VIX regime', () => {
        const bars = [];
        const vix = new Map();
        for (let i = 0; i < 100; i++) {
            const d = `2026-01-${String(1 + (i % 28)).padStart(2, '0')}-${i}`; // unique, sortable
            bars.push(bar(d, 100, 100 + (i % 10) / 10, 100 - (i % 5) / 10));
            vix.set(d, i < 50 ? 15 : 30);
        }
        const st = moveStats(bars);
        assert.equal(st.all.n, 100);
        assert.equal(Math.round(st.all.up.p50 * 1e6) / 1e6, 0.004);
        assert.equal(st.regime, null);
        const withVix = moveStats(bars, { vixByDate: vix, currentVix: 15 });
        assert.ok(withVix.regime && withVix.regime.n >= 40 && withVix.regime.n < 100);
    });
});

describe('expected move today', () => {
    it('minutes to the close', () => {
        assert.equal(minutesLeft(10 * 60), 360);
        assert.equal(minutesLeft(17 * 60), 0);
        assert.equal(minutesLeft(8 * 60), 390);
    });
    it('VIX move scales with time left', () => {
        assert.equal(Math.round(vixMove(16, 500, 390) * 100) / 100, 5.04); // 500 × 16% / √252
        assert.ok(vixMove(16, 500, 97.5) < vixMove(16, 500, 390) / 1.9);
    });
    it('straddle at the strike nearest the price', () => {
        const calls = [{ strike: 500, bid: 1, ask: 1.2 }, { strike: 501, bid: 0.6, ask: 0.7 }];
        const puts = [{ strike: 500, bid: 1.3, ask: 1.5 }, { strike: 501, bid: 1.9, ask: 2.1 }];
        assert.deepEqual(impliedMove(calls, puts, 500.2), { strike: 500, move: 2.5 });
    });
    it('combined range is the widest and contains today so far', () => {
        const stats = { all: { up: { p95: 0.01 }, down: { p95: 0.012 } }, regime: null };
        const f = forecastRange({ price: 500, open: 499, high: 502, low: 497, implied: { strike: 500, move: 2.5 }, vix: 3, stats });
        assert.equal(f.methods.length, 3);
        assert.equal(f.high, 503.99); // history: 499 × 1.01
        assert.equal(f.low, 493.01); // history: 499 × 0.988
    });
});

describe('spread candidates', () => {
    const calls = [];
    const puts = [];
    for (let k = 490; k <= 510; k++) {
        const dist = Math.abs(k - 500);
        calls.push({ strike: k, bid: k > 500 ? Math.max(0.01, 1 - dist * 0.1) : 1 + dist, ask: k > 500 ? Math.max(0.02, 1.05 - dist * 0.1) : 1.05 + dist, delta: 0.2 });
        puts.push({ strike: k, bid: k < 500 ? Math.max(0.01, 1 - dist * 0.1) : 1 + dist, ask: k < 500 ? Math.max(0.02, 1.05 - dist * 0.1) : 1.05 + dist, delta: -0.2 });
    }
    const sorted = Array.from({ length: 100 }, (_, i) => i / 10000); // moves 0 … 0.99%
    const stats = { all: { upSorted: sorted, downSorted: sorted }, regime: null };
    const opts = { price: 500, open: 500, width: 2, forecast: { high: 504, low: 496 }, stats, targetCredit: 10 };
    it('calls above, puts below, $2 wide, with credit and odds', () => {
        const c = spreadCandidates('call', calls, opts);
        assert.equal(c[0].short_strike, 501);
        assert.equal(c[0].long_strike, 503);
        assert.equal(c[0].credit, 0.2); // 0.975 − 0.775
        assert.equal(c[0].max_loss, 180);
        assert.equal(c[0].breakeven_win_rate, 90);
        assert.equal(c[0].hist_hit_pct, 80); // moves ≥ 0.2% of 100 days
        const p = spreadCandidates('put', puts, opts);
        assert.equal(p[0].short_strike, 499);
        assert.equal(p[0].long_strike, 497);
    });
    it('suggests the richest spread outside the forecast that meets the credit target', () => {
        const c = spreadCandidates('call', calls, opts);
        const s = c.find((x) => x.suggested);
        assert.ok(s.beyond_forecast && s.meets_target);
        assert.equal(s.short_strike, 504);
    });
});
