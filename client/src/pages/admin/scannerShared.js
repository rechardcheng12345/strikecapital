// Shared helpers for the Option Scanner page and its detail panel.

export const SCAN_PRESETS = [
    { key: '30-45', label: '30–45 DTE', params: { minDays: 30, maxDays: 45, expiryTargets: '30,38,45', targetDelta: 0.20, minDelta: 0.10, maxDelta: 0.30, minDiscount: 3, maxDiscount: 35 } },
    { key: '45-60', label: '45–60 DTE', params: { minDays: 45, maxDays: 60, expiryTargets: '45,52,60', targetDelta: 0.20, minDelta: 0.10, maxDelta: 0.30, minDiscount: 3, maxDiscount: 35 } },
    { key: '30-60', label: '30–60 DTE', params: { minDays: 30, maxDays: 60, expiryTargets: '30,45,60', targetDelta: 0.20, minDelta: 0.10, maxDelta: 0.30, minDiscount: 3, maxDiscount: 35 } },
    { key: '14-28', label: '14–28 DTE', params: { minDays: 14, maxDays: 28, expiryTargets: '', targetDelta: 0.16, minDelta: 0, maxDelta: 1, minDiscount: 10, maxDiscount: 20 } },
];

export const FIT_LABELS = {
    NO_CAPITAL: 'Not enough available capital',
    OVER_UTILIZATION: 'Would exceed max capital utilization',
    OVER_POSITION_LIMIT: 'Exceeds per-position limit',
    OVER_CONCENTRATION: 'Exceeds ticker concentration limit',
    ALREADY_HELD: 'Already holding this ticker',
};

/**
 * Final score = quant score × (1 − aiWeight × Jev penalty). A Jev veto zeroes it.
 * Without Jev context (not loaded / failed) the quant score is used as-is.
 */
export function finalScore(row, ctx, aiWeight) {
    if (row.score == null) return null;
    if (!ctx || ctx.loading || ctx.error) return row.score;
    if (ctx.veto) return 0;
    return Math.round(row.score * (1 - aiWeight * (ctx.penalty || 0)));
}

export function scoreColor(score) {
    if (score >= 70) return 'text-green-600 font-semibold';
    if (score >= 50) return 'text-yellow-600 font-semibold';
    return 'text-gray-400';
}

export function formatCurrency(v) {
    if (v == null) return '—';
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "2026-10-30" → "Fri 30 Oct 2026" (expiry dates are calendar dates — format in UTC so they never shift). */
export function formatExpiry(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
