import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeScanScore, enrichScanRow, estimateDaysToProfitTake, pickExpiries, resolveScanTickers,
} from './scanScore.js';

describe('computeScanScore', () => {
    it('caps each part and totals 100 at the sweet spot', () => {
        const { score, score_parts } = computeScanScore({
            managedAnnPct: 40,
            absDelta: 0.2,
            sigmaOtm: 1.0,
            ivHvRatio: 1.4,
            openInterest: 1000,
            spreadPct: 5,
            targetDelta: 0.2,
        });
        assert.equal(score_parts.yield, 35);
        assert.equal(score_parts.delta, 20);
        assert.equal(score_parts.cushion, 15);
        assert.equal(score_parts.iv, 20);
        assert.equal(score_parts.liquidity, 10);
        assert.equal(score, 100);
    });

    it('gives neutral IV credit when realized vol is unknown', () => {
        const { score_parts } = computeScanScore({ ivHvRatio: null });
        assert.equal(score_parts.iv, 10);
    });

    it('zeros the delta part when |Δ| is outside the ±0.12 band', () => {
        const { score_parts } = computeScanScore({ absDelta: 0.40, targetDelta: 0.2 });
        assert.equal(score_parts.delta, 0);
    });

    it('applies the earnings haircut', () => {
        const base = { managedAnnPct: 40, absDelta: 0.2, sigmaOtm: 1, ivHvRatio: 1.4, openInterest: 1000, spreadPct: 5 };
        assert.equal(computeScanScore({ ...base, earningsBeforeExpiry: true }).score, 85);
    });
});

describe('estimateDaysToProfitTake', () => {
    it('reaches 80% before expiry for an OTM put with flat stock', () => {
        const d = estimateDaysToProfitTake(100, 90, 45, 0.35, 0.05);
        assert.ok(d > 5 && d < 45, `got ${d}`);
    });
});

describe('enrichScanRow', () => {
    it('adds expected move, sigma distance, managed yield and earnings flag', () => {
        const row = enrichScanRow({
            ticker: 'X', stock_price: 100, strike: 90, days_to_expiry: 45, expiry: '2026-11-10',
            mid: 1.2, iv: 35, delta: -0.18, open_interest: 800, spread_pct: 6,
        }, { vol: { hv20: 25, ma200: 95, low52: 80 }, earnings: { date: '2026-11-01' } });
        assert.ok(row.sigma_otm > 0.8 && row.sigma_otm < 1.0, `sigma ${row.sigma_otm}`);
        assert.equal(row.iv_hv_ratio, 1.4);
        assert.equal(row.earnings_before_expiry, true);
        assert.equal(row.collateral, 9000);
        assert.ok(row.managed_ann_pct > row.annual_return_pct);
    });
});

describe('pickExpiries', () => {
    const today = new Date('2026-09-01T00:00:00Z');
    const dates = ['2026-09-26', '2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07'];
    it('keeps the expiry nearest each target', () => {
        assert.deepEqual(pickExpiries(dates, today, 30, 70, [30, 45, 60]), ['2026-10-03', '2026-10-17', '2026-10-31']);
    });
    it('keeps all in-window expiries without targets', () => {
        assert.equal(pickExpiries(dates, today, 30, 70, []).length, 6);
    });
});

describe('resolveScanTickers', () => {
    it('uses the full watchlist when no tickers are requested', () => {
        assert.deepEqual(resolveScanTickers(['AAPL', 'NVDA'], undefined), ['AAPL', 'NVDA']);
        assert.deepEqual(resolveScanTickers(['AAPL', 'NVDA'], []), ['AAPL', 'NVDA']);
    });

    it('uppercases and de-dupes an explicit ticker list', () => {
        assert.deepEqual(
            resolveScanTickers(['AAPL', 'NVDA'], ['nvda', 'NVDA', ' msft ']),
            ['NVDA', 'MSFT'],
        );
    });
});
