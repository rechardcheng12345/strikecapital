// Calibrates the backtest's option model on real prices (pure, no I/O).
// From real long-dated put prices it learns implied vol ÷ historical vol by moneyness (strike ÷ price),
// so model prices carry the skew deep out-of-the-money puts really have. Fitted on the earlier 70% of
// days and checked on the latest 30% (a holdout), then refitted on everything.
import { bsPut, impliedVolPut } from './bsModel.js';

export const BUCKET_EDGES = [0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.3];
export const LOOKBACKS = [60, 120, 252];
const MIN_BUCKET = 15;

function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(arr, q) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/** Volatility multiplier for moneyness k, linear between bucket centres, flat beyond the ends. */
export function multiplierAt(cal, k) {
    const b = cal?.buckets || [];
    if (!b.length) return cal?.overall ?? 1;
    if (k <= b[0].center) return b[0].mult;
    if (k >= b[b.length - 1].center) return b[b.length - 1].mult;
    for (let i = 1; i < b.length; i++) {
        if (k <= b[i].center) {
            const w = (k - b[i - 1].center) / (b[i].center - b[i - 1].center);
            return b[i - 1].mult + w * (b[i].mult - b[i - 1].mult);
        }
    }
    return b[b.length - 1].mult;
}

/** Model volatility for a put: multiplier(strike ÷ price) × historical vol, kept within 10% … 300%. */
export function modelSigma(cal, hv, k) {
    if (!(hv > 0)) return null;
    return Math.min(3, Math.max(0.1, multiplierAt(cal, k) * hv));
}

function fit(points, lookback) {
    const usable = points.filter((p) => p.hv?.[lookback] > 0);
    const ratios = usable.map((p) => ({ k: p.K / p.S, r: p.iv / p.hv[lookback] }));
    const overall = median(ratios.map((x) => x.r)) ?? 1;
    const buckets = [];
    for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
        const lo = BUCKET_EDGES[i], hi = BUCKET_EDGES[i + 1];
        const inB = ratios.filter((x) => x.k >= lo && x.k < hi).map((x) => x.r);
        if (inB.length >= MIN_BUCKET) buckets.push({ lo, hi, center: (lo + hi) / 2, mult: Math.round(median(inB) * 1000) / 1000, n: inB.length });
    }
    return { lookback, overall: Math.round(overall * 1000) / 1000, buckets };
}

function priceErrors(cal, points) {
    const errs = [];
    for (const p of points) {
        const sigma = modelSigma(cal, p.hv?.[cal.lookback], p.K / p.S);
        if (sigma == null) continue;
        const model = bsPut(p.S, p.K, p.T, p.r, sigma);
        errs.push(Math.abs(model - p.price) / p.price);
    }
    return {
        n: errs.length,
        median_abs_pct: errs.length ? Math.round(median(errs) * 10000) / 100 : null,
        p90_abs_pct: errs.length ? Math.round(quantile(errs, 0.9) * 10000) / 100 : null,
    };
}

/**
 * points: [{ date, S, K, T (years), r, price, hv: { 60, 120, 252 } }] — real long-dated put prices.
 * Keeps minYears ≤ T ≤ maxYears, price ≥ $0.25, moneyness 0.15–1.3 (short-dated puts get their own fit). Picks the historical-vol lookback whose model
 * prices best match the holdout, reports holdout and in-sample error, and returns the full-sample fit.
 */
export function calibrate(rawPoints, { minYears = 0.75, maxYears = Infinity, minPrice = 0.25 } = {}) {
    const points = [];
    for (const p of rawPoints) {
        const k = p.K / p.S;
        if (!(p.T >= minYears) || !(p.T <= maxYears) || !(p.price >= minPrice) || k < 0.15 || k > 1.3) continue;
        const iv = impliedVolPut(p.price, p.S, p.K, p.T, p.r);
        if (iv == null || iv < 0.05) continue;
        points.push({ ...p, iv });
    }
    if (points.length < 60) {
        return { calibrated: false, reason: `Only ${points.length} usable real prices — need at least 60.`, lookback: 252, overall: 1, buckets: [], points: points.length };
    }
    const dates = [...new Set(points.map((p) => p.date))].sort();
    const cut = dates[Math.floor(dates.length * 0.7)];
    const train = points.filter((p) => p.date < cut);
    const test = points.filter((p) => p.date >= cut);

    let best = null;
    for (const lb of LOOKBACKS) {
        const cal = fit(train, lb);
        const err = priceErrors(cal, test);
        if (err.n && (!best || err.median_abs_pct < best.err.median_abs_pct)) best = { lb, err };
    }
    const final = fit(points, best.lb);
    return {
        calibrated: true,
        ...final,
        points: points.length,
        days: dates.length,
        first_date: dates[0],
        last_date: dates[dates.length - 1],
        holdout: { from: cut, ...best.err },
        // Strikes 50–90% of the price — the range a 0.15–0.35 delta long-dated put usually lands in
        holdout_core: priceErrors(fit(train, best.lb), test.filter((p) => p.K / p.S >= 0.5 && p.K / p.S <= 0.9)),
        in_sample: priceErrors(final, points),
    };
}
