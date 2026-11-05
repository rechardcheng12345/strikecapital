import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCallBreakEven, calculateOptionDistancePct, calculateCalledAway, uncoveredShares, calculateProfitCapturedPct } from './pnlEngine.js';

test('call break-even is the strike plus the net premium per share', () => {
    assert.equal(calculateCallBreakEven(80, 250, 1), 82.5);
    assert.equal(calculateCallBreakEven(80, 250, 1, 1, 1.5), 82.475);
});

test('distance to strike is positive while the short option is out of the money', () => {
    assert.equal(calculateOptionDistancePct(100, 90, 'put'), 10);
    assert.equal(calculateOptionDistancePct(100, 110, 'call'), 10);
    assert.equal(calculateOptionDistancePct(100, 95, 'call'), -5);
    assert.equal(calculateOptionDistancePct(0, 95, 'call'), null);
});

test('called away sells contracts × 100 shares at the strike', () => {
    assert.deepEqual(calculateCalledAway(80, 1, 95), { shares: 100, proceeds: 8000, realized_pnl: -1500 });
    assert.deepEqual(calculateCalledAway(100, 2, 95), { shares: 200, proceeds: 20000, realized_pnl: 1000 });
});

test('uncovered shares subtract every open call already written', () => {
    assert.equal(uncoveredShares(100, []), 100);
    assert.equal(uncoveredShares(300, [{ contracts: 1 }, { contracts: 1 }]), 100);
    assert.equal(uncoveredShares(100, [{ contracts: 1 }]), 0);
});

test('profit captured works the same for a short call', () => {
    assert.equal(calculateProfitCapturedPct(250, 0.5, 1), 80);
});
