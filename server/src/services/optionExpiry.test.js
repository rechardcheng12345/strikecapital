import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toCalendarDate, resolveExpiryCandidates } from './optionExpiry.js';

describe('toCalendarDate', () => {
    it('maps a Singapore DATE stored as 16:00 UTC to the next calendar day', () => {
        assert.equal(toCalendarDate('2026-09-24T16:00:00.000Z'), '2026-09-25');
        assert.equal(toCalendarDate(new Date('2026-08-27T16:00:00.000Z')), '2026-08-28');
    });

    it('keeps a plain YYYY-MM-DD string', () => {
        assert.equal(toCalendarDate('2026-09-25'), '2026-09-25');
    });
});

describe('resolveExpiryCandidates', () => {
    it('returns the closest listed expiry when it is within 3 days', () => {
        assert.deepEqual(
            resolveExpiryCandidates('2026-09-24', ['2026-09-18', '2026-09-25']),
            ['2026-09-25'],
        );
    });

    it('falls back to the calendar date when nothing is within 3 days', () => {
        assert.deepEqual(
            resolveExpiryCandidates('2026-09-25', ['2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18']),
            ['2026-09-25'],
        );
    });
});
