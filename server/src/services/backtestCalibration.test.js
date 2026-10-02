import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bsPut } from './bsModel.js';
import { calibrate, multiplierAt, modelSigma } from './backtestCalibration.js';

// Synthetic "real" prices from a known skew: IV = hv × (1.6 − 0.6·k), so deep puts are pricier.
function synth() {
    const pts = [];
    for (let d = 0; d < 120; d++) {
        const date = `2026-${String(1 + Math.floor(d / 28)).padStart(2, '0')}-${String(1 + (d % 28)).padStart(2, '0')}`;
        const S = 100 + 20 * Math.sin(d / 10);
        // 252-day vol drives the real prices; the shorter lookbacks wander independently
        const hv = { 60: 0.9 + 0.3 * Math.sin(d / 3), 120: 0.8 + 0.2 * Math.cos(d / 5), 252: 0.6 + 0.2 * Math.sin(d / 17) };
        for (const K of [20, 35, 50, 65, 80, 95]) {
            const k = K / S;
            const iv = hv[252] * (1.6 - 0.6 * k);
            pts.push({ date, S, K, T: 1.2, r: 0.04, price: bsPut(S, K, 1.2, 0.04, iv), hv });
        }
    }
    return pts;
}

describe('calibration', () => {
    it('recovers a known skew and the right lookback', () => {
        const cal = calibrate(synth());
        assert.equal(cal.calibrated, true);
        assert.equal(cal.lookback, 252);
        assert.ok(cal.holdout.median_abs_pct < 3, JSON.stringify(cal.holdout));
        // Deep puts get a higher multiplier than near-the-money ones
        assert.ok(multiplierAt(cal, 0.3) > multiplierAt(cal, 0.9));
        const k = 0.5;
        assert.ok(Math.abs(modelSigma(cal, 0.7, k) - 0.7 * (1.6 - 0.6 * k)) < 0.06);
    });
    it('refuses with too little data', () => {
        const cal = calibrate(synth().slice(0, 30));
        assert.equal(cal.calibrated, false);
        assert.match(cal.reason, /need at least 60/);
    });
    it('ignores short-dated and cheap contracts', () => {
        const pts = synth().map((p) => ({ ...p, T: 0.2 }));
        assert.equal(calibrate(pts).calibrated, false);
    });
});
