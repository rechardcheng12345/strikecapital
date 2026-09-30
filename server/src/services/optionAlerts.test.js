import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normListDate, firstSeenKind, listedKind, listingInfo, isNewWithin, putMetrics } from './optionAlerts.js';

describe('normListDate', () => {
    it('keeps the date part', () => {
        assert.equal(normListDate('2026-09-24'), '2026-09-24');
        assert.equal(normListDate('2026-09-24 00:00:00'), '2026-09-24');
    });
    it('treats blanks and placeholders as unknown', () => {
        assert.equal(normListDate(''), null);
        assert.equal(normListDate(null), null);
        assert.equal(normListDate('1970-01-01'), null);
    });
});

describe('first-seen classification', () => {
    const knownExpiries = new Set(['2028-01-21']);
    it('first check of a ticker is only a baseline', () => {
        assert.equal(firstSeenKind({ tickerSeenBefore: false, knownExpiries, expiry: '2028-01-21' }), 'baseline');
    });
    it('unknown expiry → new expiry; known expiry → new strike', () => {
        assert.equal(firstSeenKind({ tickerSeenBefore: true, knownExpiries, expiry: '2028-02-18' }), 'expiry');
        assert.equal(firstSeenKind({ tickerSeenBefore: true, knownExpiries, expiry: '2028-01-21' }), 'strike');
    });
});

describe('listing kind from Moomoo dates', () => {
    it('listed with the expiry vs added later', () => {
        assert.equal(listedKind('2026-09-24', '2026-09-24'), 'expiry');
        assert.equal(listedKind('2026-09-25', '2026-09-24'), 'expiry');
        assert.equal(listedKind('2026-09-28', '2026-09-24'), 'strike');
        assert.equal(listedKind(null, '2026-09-24'), null);
    });
});

describe('what counts as new', () => {
    const today = '2026-09-30';
    it('prefers Moomoo listing date', () => {
        const c = { listed_on: '2026-09-25', listed_kind: 'strike', first_seen_kind: 'baseline', first_seen_on: '2026-09-30' };
        assert.deepEqual(listingInfo(c), { new_on: '2026-09-25', source: 'moomoo', kind: 'strike' });
        assert.equal(isNewWithin(c, 7, today), true);
        assert.equal(isNewWithin(c, 3, today), false);
    });
    it('falls back to first seen, but never for the baseline', () => {
        assert.equal(isNewWithin({ first_seen_kind: 'expiry', first_seen_on: '2026-09-29' }, 7, today), true);
        assert.equal(isNewWithin({ first_seen_kind: 'baseline', first_seen_on: '2026-09-30' }, 7, today), false);
    });
});

describe('putMetrics', () => {
    it('premium, return and distance at the mid', () => {
        const m = putMetrics({ bid: 17.5, ask: 18, last: 17, strike: 60, expiry: '2028-01-21' }, 147, '2026-09-30');
        assert.equal(m.mid, 17.75);
        assert.equal(m.mid_source, 'mid');
        assert.equal(m.premium, 1775);
        assert.equal(m.collateral, 6000);
        assert.equal(m.dte, 478);
        assert.equal(m.return_pct, 29.58);
        assert.equal(m.annual_pct, 22.59);
        assert.equal(m.below_pct, 59.18);
        assert.equal(m.spread_pct, 2.82);
    });
    it('falls back to the last trade without a two-sided quote', () => {
        const m = putMetrics({ bid: 0, ask: 2, last: 1.5, strike: 50, expiry: '2028-01-21' }, null, '2026-09-30');
        assert.equal(m.mid, 1.5);
        assert.equal(m.mid_source, 'last');
        assert.equal(m.below_pct, null);
        assert.equal(m.spread_pct, null);
    });
});
