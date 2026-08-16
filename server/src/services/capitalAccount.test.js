import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocationPctFromInvested, restatedOwnership, realizedShareForInvestor } from './capitalAccount.js';

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
