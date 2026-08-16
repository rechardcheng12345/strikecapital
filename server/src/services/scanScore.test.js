import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachScoreParts, computeScanScore, resolveScanTickers } from './scanScore.js';

describe('computeScanScore', () => {
    it('caps each part and totals 100 at the sweet spot', () => {
        const { score, score_parts } = computeScanScore({
            returnPct: 1.5,
            discountPct: 15,
            absDelta: 0.16,
            openInterest: 5000,
            targetDelta: 0.16,
        });
        assert.equal(score_parts.return, 40);
        assert.equal(score_parts.discount, 30);
        assert.equal(score_parts.delta, 20);
        assert.equal(score_parts.oi, 10);
        assert.equal(score, 100);
    });

    it('scores zero when there is no premium, cushion, delta, or open interest', () => {
        const { score, score_parts } = computeScanScore({
            returnPct: 0,
            discountPct: 0,
            absDelta: null,
            openInterest: 0,
        });
        assert.equal(score_parts.return, 0);
        assert.equal(score_parts.discount, 0);
        assert.equal(score_parts.delta, 0);
        assert.equal(score_parts.oi, 0);
        assert.equal(score, 0);
    });

    it('zeros the delta part when |Δ| is outside the ±0.12 band', () => {
        const { score_parts } = computeScanScore({
            returnPct: 0,
            discountPct: 0,
            absDelta: 0.40,
            openInterest: 0,
            targetDelta: 0.16,
        });
        assert.equal(score_parts.delta, 0);
    });
});

describe('attachScoreParts', () => {
    it('adds score_parts to each row using the row greeks', () => {
        const [row] = attachScoreParts([{
            return_pct: 1.5,
            discount_pct: 15,
            delta: -0.16,
            open_interest: 5000,
        }]);
        assert.equal(row.score, 100);
        assert.equal(row.score_parts.return, 40);
        assert.equal(row.score_parts.delta, 20);
    });
});

describe('resolveScanTickers', () => {
    it('uses the full watchlist when no tickers are requested', () => {
        assert.deepEqual(
            resolveScanTickers(['AAPL', 'NVDA'], undefined),
            ['AAPL', 'NVDA'],
        );
        assert.deepEqual(
            resolveScanTickers(['AAPL', 'NVDA'], []),
            ['AAPL', 'NVDA'],
        );
    });

    it('uppercases and de-dupes an explicit ticker list', () => {
        assert.deepEqual(
            resolveScanTickers(['AAPL', 'NVDA'], ['nvda', 'NVDA', ' msft ']),
            ['NVDA', 'MSFT'],
        );
    });
});
