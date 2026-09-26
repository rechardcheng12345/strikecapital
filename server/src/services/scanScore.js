// Scoring for the put scanner, tuned for 30–60 DTE cash-secured puts managed at an 80% profit take.
// All numbers are computed here in code; Jev only adds qualitative context on top (see jevService.js).
const DELTA_TOLERANCE_HALF_WIDTH = 0.12;
export const PROFIT_TAKE = 0.8;          // close at 80% of max profit
export const EARNINGS_MULTIPLIER = 0.85; // score haircut when earnings land before expiry

function round(value, dp = 2) {
    if (value == null || !Number.isFinite(value)) return null;
    const f = 10 ** dp;
    return Math.round(value * f) / f;
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * ax);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return 0.5 * (1.0 + sign * y);
}
export function bsPutPrice(S, K, T, sigma, r) {
    if (T <= 0) return Math.max(K - S, 0);
    if (sigma <= 0 || S <= 0 || K <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

/**
 * Days until the put is worth (1 − PROFIT_TAKE) of today's model value, assuming the stock
 * and IV stay where they are (pure time decay). Returns dte when it only gets there at expiry.
 */
export function estimateDaysToProfitTake(S, K, dte, sigma, r) {
    if (!(dte > 0) || !(sigma > 0)) return null;
    const p0 = bsPutPrice(S, K, dte / 365, sigma, r);
    if (!(p0 > 0.005)) return null;
    const target = p0 * (1 - PROFIT_TAKE);
    for (let d = 1; d < dte; d++) {
        if (bsPutPrice(S, K, (dte - d) / 365, sigma, r) <= target) return d;
    }
    return dte;
}

/**
 * Score (0–100):
 *   35  managed annualized yield (return if closed at 80%, annualized over the estimated days) — full at 40%
 *   20  |Δ| sweet-spot around targetDelta
 *   15  cushion: strike distance below spot in expected-move units (σ√T) — full at 1σ
 *   20  premium richness: IV ÷ 20-day realized vol — neutral (10) when unknown, full at 1.4×
 *   10  liquidity: open interest (5) + bid/ask spread (5)
 * ×0.85 when the next earnings date falls on or before expiry.
 */
export function computeScanScore({
    managedAnnPct, absDelta, sigmaOtm, ivHvRatio, openInterest, spreadPct,
    earningsBeforeExpiry, targetDelta = 0.2,
} = {}) {
    const deltaScore = absDelta != null
        ? Math.max(0, 1 - Math.abs(absDelta - targetDelta) / DELTA_TOLERANCE_HALF_WIDTH)
        : 0;
    const parts = {
        yield: clamp01((managedAnnPct || 0) / 40) * 35,
        delta: deltaScore * 20,
        cushion: clamp01((sigmaOtm || 0) / 1.0) * 15,
        iv: ivHvRatio == null ? 10 : clamp01((ivHvRatio - 0.8) / 0.6) * 20,
        liquidity: clamp01((openInterest ?? 0) / 1000) * 5
            + (spreadPct == null ? 2.5 : clamp01((25 - spreadPct) / 20) * 5),
    };
    const raw = parts.yield + parts.delta + parts.cushion + parts.iv + parts.liquidity;
    const mult = earningsBeforeExpiry ? EARNINGS_MULTIPLIER : 1;
    return {
        score: Math.round(raw * mult),
        score_parts: {
            yield: round(parts.yield),
            delta: round(parts.delta),
            cushion: round(parts.cushion),
            iv: round(parts.iv),
            liquidity: round(parts.liquidity),
            earnings_multiplier: mult,
        },
    };
}

/**
 * Adds the derived 30–60 DTE metrics and the score to one raw scanner row
 * (raw rows come from the local scanner or the remote scanner proxy — same shape).
 * @param {object} ctx { targetDelta, riskFreeRate, vol: getVolatilityStats(), earnings: getEarningsDate() }
 */
export function enrichScanRow(row, { targetDelta = 0.2, riskFreeRate = 0.0525, vol = null, earnings = null } = {}) {
    const S = row.stock_price;
    const K = row.strike;
    const dte = row.days_to_expiry;
    const sigma = row.iv != null ? row.iv / 100 : null;
    const T = dte / 365;
    const midPx = row.mid ?? row.premium ?? 0;

    const expectedMove = sigma && T > 0 ? S * sigma * Math.sqrt(T) : null;
    const sigmaOtm = sigma && T > 0 && K > 0 ? Math.log(S / K) / (sigma * Math.sqrt(T)) : null;
    const daysTo80 = sigma ? estimateDaysToProfitTake(S, K, dte, sigma, riskFreeRate) : null;
    const returnPct = K > 0 ? (midPx / K) * 100 : 0;
    const managedAnnPct = daysTo80 ? (PROFIT_TAKE * returnPct) * 365 / daysTo80 : null;
    const hv20 = vol?.hv20 ?? null;
    const ivHvRatio = row.iv != null && hv20 ? row.iv / hv20 : null;
    const costIfAssigned = K - midPx;
    const earningsDate = earnings?.date ?? null;
    const earningsBeforeExpiry = earningsDate ? earningsDate <= row.expiry : false;

    const { score, score_parts } = computeScanScore({
        managedAnnPct,
        absDelta: row.delta != null ? Math.abs(row.delta) : null,
        sigmaOtm,
        ivHvRatio,
        openInterest: row.open_interest,
        spreadPct: row.spread_pct,
        earningsBeforeExpiry,
        targetDelta,
    });

    return {
        ...row,
        return_pct: round(returnPct),
        annual_return_pct: dte > 0 ? round(returnPct * 365 / dte) : 0,
        expected_move: round(expectedMove),
        expected_move_low: expectedMove != null ? round(S - expectedMove) : null,
        sigma_otm: round(sigmaOtm),
        days_to_80: daysTo80,
        managed_ann_pct: round(managedAnnPct),
        theta_per_day: row.theta != null ? round(Math.abs(row.theta) * 100) : null, // $/contract/day
        hv20,
        iv_hv_ratio: round(ivHvRatio),
        collateral: round(K * 100),
        cost_if_assigned: round(costIfAssigned),
        cost_vs_ma200_pct: vol?.ma200 ? round((costIfAssigned / vol.ma200 - 1) * 100) : null,
        cost_vs_52w_low_pct: vol?.low52 ? round((costIfAssigned / vol.low52 - 1) * 100) : null,
        earnings_date: earningsDate,
        earnings_estimated: earnings?.estimated ?? null,
        earnings_before_expiry: earningsBeforeExpiry,
        score,
        score_parts,
    };
}

/**
 * For 30–60 DTE scans there are 5–9 weekly expiries in the window; loading every chain is slow
 * and adds little. Keep the listed expiry nearest to each target DTE (deduplicated).
 * Empty/absent targets → keep all expiries in the window (old behaviour).
 */
export function pickExpiries(expiryDates, today, minDays, maxDays, targets) {
    const withDays = expiryDates
        .map(d => ({ d, days: Math.round((new Date(d) - today) / 86400000) }))
        .filter(x => x.days >= minDays && x.days <= maxDays);
    if (!Array.isArray(targets) || targets.length === 0) return withDays.map(x => x.d);
    const picked = new Set();
    for (const t of targets) {
        let best = null;
        for (const x of withDays) {
            if (!best || Math.abs(x.days - t) < Math.abs(best.days - t)) best = x;
        }
        if (best) picked.add(best.d);
    }
    return [...picked].sort();
}

/** Empty / missing request → full watchlist. Otherwise the explicit list, uppercased and unique. */
export function resolveScanTickers(watchlistTickers, requested) {
    const watchlist = (watchlistTickers || []).map((t) => String(t).toUpperCase());
    if (!Array.isArray(requested) || requested.length === 0) return watchlist;
    return [...new Set(
        requested
            .map((t) => String(t).toUpperCase().trim())
            .filter(Boolean),
    )];
}
