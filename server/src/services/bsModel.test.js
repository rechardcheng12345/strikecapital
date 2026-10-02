import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normCdf, bsPut, bsPutDelta, impliedVolPut, strikeForDelta, histVol } from './bsModel.js';

const near = (a, b, t) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);

describe('Black-Scholes put', () => {
    it('normal CDF', () => {
        near(normCdf(0), 0.5, 1e-7);
        near(normCdf(1.96), 0.975, 1e-4);
    });
    it('matches a textbook value', () => {
        // S=100 K=100 T=1 r=5% σ=20% → put ≈ 5.5735
        near(bsPut(100, 100, 1, 0.05, 0.2), 5.5735, 0.001);
        near(bsPutDelta(100, 100, 1, 0.05, 0.2), -0.3632, 0.001);
    });
    it('put-call parity holds', () => {
        const S = 120, K = 100, T = 1.3, r = 0.04, v = 0.7;
        const put = bsPut(S, K, T, r, v);
        const [d1, d2] = [(Math.log(S / K) + (r + v * v / 2) * T) / (v * Math.sqrt(T)), 0];
        const call = S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d1 - v * Math.sqrt(T));
        near(call - put, S - K * Math.exp(-r * T), 1e-6);
        assert.equal(d2, 0);
    });
    it('implied volatility round-trips', () => {
        const p = bsPut(147, 60, 1.3, 0.04, 0.85);
        near(impliedVolPut(p, 147, 60, 1.3, 0.04), 0.85, 1e-6);
        assert.equal(impliedVolPut(80, 147, 60, 1.3, 0.04), null); // above any possible put price (K·e^−rT ≈ 57)
    });
    it('strike for a target delta', () => {
        const K = strikeForDelta(100, 1.2, 0.04, () => 0.6, 0.25);
        near(bsPutDelta(100, K, 1.2, 0.04, 0.6), -0.25, 1e-6);
        assert.ok(K < 100);
    });
    it('historical volatility', () => {
        const closes = [100];
        for (let i = 1; i <= 300; i++) closes.push(closes[i - 1] * (i % 2 ? 1.01 : 1 / 1.01));
        near(histVol(closes, 300, 252), 0.01 * Math.sqrt(252), 0.002);
        assert.equal(histVol(closes, 10, 252), null);
    });
});

describe('Black-Scholes call', async () => {
    const { bsCall, bsCallDelta, strikeForCallDelta } = await import('./bsModel.js');
    it('put-call parity and delta', () => {
        const S = 50, K = 60, T = 0.1, r = 0.04, v = 0.9;
        near(bsCall(S, K, T, r, v) - bsPut(S, K, T, r, v), S - K * Math.exp(-r * T), 1e-9);
        near(bsCallDelta(S, K, T, r, v) - 1, bsPutDelta(S, K, T, r, v), 1e-9);
    });
    it('strike for a target call delta', () => {
        const K = strikeForCallDelta(50, 30 / 365, 0.04, () => 0.9, 0.25);
        near(bsCallDelta(50, K, 30 / 365, 0.04, 0.9), 0.25, 1e-6);
        assert.ok(K > 50);
    });
});
