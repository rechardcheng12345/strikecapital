// 0DTE credit spreads (SPY / QQQ) — pure math, no I/O.
// Forecast today's high / low three ways (option-implied move, VIX, 2-year history of moves from the
// open), then list call spreads above and put spreads below the price with their live credit and how often
// history reached each short strike. Jev only judges the day's event risk (zeroDteService.js).

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const r4 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10000) / 10000);

/** Yahoo chart result → [{ date, open, high, low, close }] (complete bars only). */
export function dailyBars(result) {
    const ts = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const out = [];
    for (let i = 0; i < ts.length; i++) {
        const [o, h, l, c] = [q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i]];
        if (![o, h, l, c].every((v) => v != null && v > 0)) continue;
        out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c });
    }
    return out;
}

export function percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
}

const PCTS = [50, 80, 90, 95, 98];

/**
 * Moves from the open, as fractions: up = (high − open) / open, down = (open − low) / open.
 * `regime` keeps days whose previous VIX close was within ±band of today's VIX (similar volatility).
 */
export function moveStats(bars, { vixByDate = null, currentVix = null, band = 0.2, excludeDate = null } = {}) {
    const days = bars.filter((b) => b.date !== excludeDate);
    const describe = (list) => {
        const up = list.map((b) => (b.high - b.open) / b.open).sort((a, b) => a - b);
        const down = list.map((b) => (b.open - b.low) / b.open).sort((a, b) => a - b);
        return {
            n: list.length,
            up: Object.fromEntries(PCTS.map((p) => [`p${p}`, percentile(up, p)])),
            down: Object.fromEntries(PCTS.map((p) => [`p${p}`, percentile(down, p)])),
            upSorted: up,
            downSorted: down,
        };
    };
    const all = describe(days);
    let regime = null;
    if (vixByDate && currentVix > 0) {
        const vixDates = [...vixByDate.keys()].sort();
        const prevVix = (date) => {
            let lo = 0, hi = vixDates.length - 1, best = null;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (vixDates[mid] < date) {
                    best = vixDates[mid];
                    lo = mid + 1;
                } else hi = mid - 1;
            }
            return best ? vixByDate.get(best) : null;
        };
        const similar = days.filter((b) => {
            const v = prevVix(b.date);
            return v != null && Math.abs(v - currentVix) / currentVix <= band;
        });
        if (similar.length >= 40) regime = describe(similar);
    }
    return { all, regime };
}

/** Share of days (0–1) whose move from the open reached `fraction` (sorted ascending list of moves). */
export function hitRate(sortedMoves, fraction) {
    if (!sortedMoves?.length) return null;
    let lo = 0, hi = sortedMoves.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sortedMoves[mid] < fraction) lo = mid + 1;
        else hi = mid;
    }
    return (sortedMoves.length - lo) / sortedMoves.length;
}

/** Minutes until the 16:00 New York close, 0 … 390. */
export function minutesLeft(nyMinutes) {
    return Math.max(0, Math.min(390, 16 * 60 - nyMinutes));
}

/** VIX → expected move for the rest of the day: price × VIX% × √(minutes left / 390) / √252. */
export function vixMove(vix, price, minsLeft) {
    if (!(vix > 0) || !(price > 0)) return null;
    return price * (vix / 100) * Math.sqrt(Math.max(minsLeft, 1) / 390) / Math.sqrt(252);
}

export function optionMid(o) {
    if (!o) return null;
    if (o.bid > 0 && o.ask > 0) return (o.bid + o.ask) / 2;
    return o.last > 0 ? o.last : null;
}

/** At-the-money straddle (call mid + put mid at the strike nearest the price) ≈ the move priced in for today. */
export function impliedMove(calls, puts, price) {
    const strikes = calls.map((c) => c.strike).filter((k) => puts.some((p) => p.strike === k));
    if (!strikes.length) return null;
    const atm = strikes.reduce((a, b) => (Math.abs(b - price) < Math.abs(a - price) ? b : a));
    const c = optionMid(calls.find((x) => x.strike === atm)), p = optionMid(puts.find((x) => x.strike === atm));
    if (c == null || p == null) return null;
    return { strike: atm, move: c + p };
}

/**
 * Today's expected high / low by each method, and a combined (widest) range that also contains what
 * has already traded today.
 */
export function forecastRange({ price, open, high, low, implied, vix, stats, pct = 95 }) {
    const methods = [];
    if (implied?.move > 0) methods.push({ key: 'implied', label: `Options market (today's ${implied.strike} straddle)`, high: price + implied.move, low: price - implied.move });
    if (vix > 0) methods.push({ key: 'vix', label: 'VIX (rest of day)', high: price + vix, low: price - vix });
    const hist = stats?.regime || stats?.all;
    if (hist && open > 0) {
        methods.push({
            key: 'history',
            label: `History, ${pct}th percentile from the open${stats?.regime ? ' (similar-VIX days)' : ''}`,
            high: open * (1 + hist.up[`p${pct}`]),
            low: open * (1 - hist.down[`p${pct}`]),
        });
    }
    const highs = methods.map((m) => m.high).concat(high > 0 ? [high] : []);
    const lows = methods.map((m) => m.low).concat(low > 0 ? [low] : []);
    return {
        methods: methods.map((m) => ({ ...m, high: r2(m.high), low: r2(m.low) })),
        high: highs.length ? r2(Math.max(...highs)) : null,
        low: lows.length ? r2(Math.min(...lows)) : null,
    };
}

/**
 * Credit spreads on one side: calls above the price (short below long) or puts below (short above long).
 * Each: live credit at the mids, natural credit, max loss, the win rate needed to break even, and the
 * share of past days whose move from the open reached the short strike (all days and similar-VIX days).
 */
export function spreadCandidates(side, chain, { price, open, width, forecast, stats, targetCredit = 10, limit = 12 }) {
    const byStrike = new Map(chain.map((o) => [Number(o.strike).toFixed(2), o]));
    const shorts = chain
        .filter((o) => (side === 'call' ? o.strike > price : o.strike < price))
        .sort((a, b) => (side === 'call' ? a.strike - b.strike : b.strike - a.strike))
        .slice(0, limit * 3);
    const out = [];
    for (const s of shorts) {
        const longStrike = side === 'call' ? s.strike + width : s.strike - width;
        const l = byStrike.get(longStrike.toFixed(2));
        if (!l) continue;
        const sm = optionMid(s), lm = optionMid(l);
        if (sm == null || lm == null) continue;
        const credit = sm - lm;
        if (!(credit > 0)) continue;
        const credit$ = credit * 100;
        const maxLoss = (width - credit) * 100;
        const fromOpen = open > 0 ? (side === 'call' ? (s.strike - open) / open : (open - s.strike) / open) : null;
        const moves = (st) => (side === 'call' ? st?.upSorted : st?.downSorted);
        const hit = fromOpen != null ? hitRate(moves(stats?.all), fromOpen) : null;
        const hitRegime = fromOpen != null && stats?.regime ? hitRate(moves(stats.regime), fromOpen) : null;
        const p = hitRegime ?? hit;
        out.push({
            side,
            short_strike: s.strike,
            long_strike: longStrike,
            short: { bid: s.bid, ask: s.ask, mid: r4(sm), delta: s.delta, iv: s.implied_volatility, oi: s.open_interest },
            long: { bid: l.bid, ask: l.ask, mid: r4(lm) },
            credit: r4(credit),
            credit_dollars: r2(credit$),
            natural_credit: s.bid != null && l.ask != null ? r4(s.bid - l.ask) : null,
            max_loss: r2(maxLoss),
            breakeven_win_rate: r2((maxLoss / (maxLoss + credit$)) * 100),
            distance_pct: r2(((side === 'call' ? s.strike - price : price - s.strike) / price) * 100),
            from_open_pct: fromOpen != null ? r2(fromOpen * 100) : null,
            hist_hit_pct: hit != null ? r2(hit * 100) : null,
            hist_hit_regime_pct: hitRegime != null ? r2(hitRegime * 100) : null,
            // Rough expected value per spread if every hit were a full loss (conservative)
            expected_value: p != null ? r2((1 - p) * credit$ - p * maxLoss) : null,
            beyond_forecast: forecast?.[side === 'call' ? 'high' : 'low'] != null
                ? (side === 'call' ? s.strike >= forecast.high : s.strike <= forecast.low)
                : false,
            meets_target: credit$ >= targetCredit,
        });
        if (out.length >= limit) break;
    }
    // Suggestion: outside the forecast and meeting the credit target, the richest credit; else the nearest outside the forecast
    const ok = out.filter((c) => c.beyond_forecast && c.meets_target);
    const pick = ok.sort((a, b) => b.credit - a.credit)[0] || out.find((c) => c.beyond_forecast) || null;
    for (const c of out) c.suggested = pick ? c.short_strike === pick.short_strike : false;
    return out;
}
