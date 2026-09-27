import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocationPctFromInvested, restatedOwnership, realizedShareForInvestor, positionShareForInvestor } from './capitalAccount.js';

describe('allocationPctFromInvested', () => {
    it('is invested divided by fund capital', () => {
        assert.equal(allocationPctFromInvested(4698, 16176), 29.04);
        assert.equal(allocationPctFromInvested(9358, 16176), 57.85);
        assert.equal(allocationPctFromInvested(1060, 16176), 6.55);
        assert.equal(allocationPctFromInvested(0, 16176), 0);
    });
});

describe('restatedOwnership', () => {
    it('keeps 100% for a solo top-up and grows that sleeve by the cash', () => {
        const next = restatedOwnership({
            sleeves: [{ userId: 1, equity: 22000 }],
            targetUserId: 1,
            amount: 10000,
            navBefore: 22000,
        });
        assert.equal(next.length, 1);
        assert.equal(next[0].capitalAccount, 32000);
        assert.equal(next[0].ownershipPct, 100);
    });

    it('gives a new investor none of the old equity', () => {
        const next = restatedOwnership({
            sleeves: [{ userId: 1, equity: 22000 }],
            targetUserId: 2,
            amount: 10000,
            navBefore: 22000,
        });
        const a = next.find(s => s.userId === 1);
        const b = next.find(s => s.userId === 2);
        assert.equal(a.capitalAccount, 22000);
        assert.equal(b.capitalAccount, 10000);
        assert.equal(a.ownershipPct, 68.75);
        assert.equal(b.ownershipPct, 31.25);
    });
});

describe('realizedShareForInvestor', () => {
    it('keeps pre-add profit with the original owner', () => {
        const periods = [
            { userId: 1, startOn: '2026-01-01', endOn: '2026-08-15', ownershipPct: 100 },
            { userId: 1, startOn: '2026-08-15', endOn: null, ownershipPct: 68.75 },
            { userId: 2, startOn: '2026-08-15', endOn: null, ownershipPct: 31.25 },
        ];
        const records = [
            { recordDate: '2026-06-01', amount: 2000 },
            { recordDate: '2026-08-20', amount: 100 },
        ];
        assert.equal(realizedShareForInvestor(periods, records, 1), 2068.75);
        assert.equal(realizedShareForInvestor(periods, records, 2), 31.25);
    });
});

describe('positionShareForInvestor (snapshot at capital add)', () => {
    // User 1 owned 100% until 2026-08-15, when user 2 added cash → 68.75% / 31.25%.
    const periods = [
        { userId: 1, startOn: '2026-01-01', endOn: '2026-08-15', ownershipPct: 100 },
        { userId: 1, startOn: '2026-08-15', endOn: null, ownershipPct: 68.75 },
        { userId: 2, startOn: '2026-08-15', endOn: null, ownershipPct: 31.25 },
    ];
    // Put sold before the add, already $300 in profit at the add, expires after it for $400.
    const marks = [{ movedOn: '2026-08-15', mark: 300, pctBefore: { 1: 100 } }];

    it('keeps profit earned before the add with the original owner', () => {
        const a = positionShareForInvestor({ amount: 400, asOf: '2026-09-01', periods, userId: 1, marks });
        const b = positionShareForInvestor({ amount: 400, asOf: '2026-09-01', periods, userId: 2, marks });
        assert.equal(a, 300 + 100 * 0.6875);
        assert.equal(b, 100 * 0.3125);
        assert.equal(a + b, 400);
    });

    it('charges a later loss only to the post-add split', () => {
        const b = positionShareForInvestor({ amount: 100, asOf: '2026-09-01', periods, userId: 2, marks });
        assert.equal(b, (100 - 300) * 0.3125); // new money shares the drop from +300 to +100
    });

    it('ignores snapshots dated after the record', () => {
        const a = positionShareForInvestor({ amount: 50, asOf: '2026-08-01', periods, userId: 1, marks });
        assert.equal(a, 50);
    });

    it('realizedShareForInvestor applies marks by position', () => {
        const records = [
            { recordDate: '2026-06-01', amount: 2000, positionId: 1 },
            { recordDate: '2026-09-01', amount: 400, positionId: 2 },
        ];
        const byPos = new Map([[2, marks]]);
        assert.equal(realizedShareForInvestor(periods, records, 1, byPos), 2000 + 300 + 68.75);
        assert.equal(realizedShareForInvestor(periods, records, 2, byPos), 31.25);
    });
});
