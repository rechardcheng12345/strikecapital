const DELTA_TOLERANCE_HALF_WIDTH = 0.12;

function roundPart(value) {
    return Math.round(value * 100) / 100;
}

/**
 * CSP hunt score: 40 return + 30 discount + 20 |Δ| sweet-spot + 10 OI.
 * score is the rounded sum (same formula as the original inline scanner).
 */
export function computeScanScore({
    returnPct,
    discountPct,
    absDelta,
    openInterest,
    targetDelta = 0.16,
} = {}) {
    const deltaScore = absDelta != null
        ? Math.max(0, 1 - Math.abs(absDelta - targetDelta) / DELTA_TOLERANCE_HALF_WIDTH)
        : 0;
    const parts = {
        return: Math.min((returnPct || 0) / 1.5, 1) * 40,
        discount: Math.min((discountPct || 0) / 15, 1) * 30,
        delta: deltaScore * 20,
        oi: Math.min((openInterest ?? 0) / 5000, 1) * 10,
    };
    return {
        score: Math.round(parts.return + parts.discount + parts.delta + parts.oi),
        score_parts: {
            return: roundPart(parts.return),
            discount: roundPart(parts.discount),
            delta: roundPart(parts.delta),
            oi: roundPart(parts.oi),
        },
    };
}

export function attachScoreParts(results, targetDelta = 0.16) {
    return (results || []).map((row) => {
        const absDelta = row.delta != null ? Math.abs(row.delta) : null;
        const { score, score_parts } = computeScanScore({
            returnPct: row.return_pct,
            discountPct: row.discount_pct,
            absDelta,
            openInterest: row.open_interest,
            targetDelta,
        });
        return { ...row, score, score_parts };
    });
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
