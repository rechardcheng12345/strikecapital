// Paper-trading (simulation) math — pure functions, no DB I/O.
// A sim portfolio is a cash-secured-put account: selling a put adds the premium to cash and locks
// strike × 100 × contracts as collateral; assignment buys the shares with that cash.
// Conventions match the live fund: an option's P&L is net of its fees, prices are per share.

const r2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v == null || v === '' ? null : Number(v));

/** Mid of bid/ask; falls back to the last trade when a side is missing. */
export function quoteMid({ bid, ask, last } = {}) {
    const b = num(bid), a = num(ask), l = num(last);
    if (b > 0 && a > 0) return { price: Math.round(((b + a) / 2) * 10000) / 10000, source: 'mid' };
    if (l > 0) return { price: l, source: 'last' };
    return { price: null, source: null };
}

export function optionFees(portfolio, contracts) {
    return r2((Number(portfolio.fee_per_contract) || 0) * (Number(contracts) || 0));
}
export function stockFees(portfolio) {
    return r2(Number(portfolio.fee_per_stock_trade) || 0);
}

export function collateralFor(pos) {
    if (pos.position_type !== 'option' || pos.status !== 'OPEN') return 0;
    return Number(pos.strike) * 100 * Number(pos.contracts);
}

/** Unrealized P&L of an open position, net of its entry fees (0 when it has no price yet). */
export function unrealizedPnl(pos) {
    if (pos.status !== 'OPEN') return 0;
    const fees = Number(pos.entry_fees) || 0;
    if (pos.position_type === 'stock') {
        const px = num(pos.current_price) ?? Number(pos.entry_price);
        return r2((px - Number(pos.entry_price)) * Number(pos.shares) - fees);
    }
    const px = num(pos.current_price) ?? Number(pos.entry_price);
    return r2((Number(pos.entry_price) - px) * 100 * Number(pos.contracts) - fees);
}

/** What the position is worth in the account: shares are an asset, a short put is a liability. */
export function marketValue(pos) {
    if (pos.status !== 'OPEN') return 0;
    if (pos.position_type === 'stock') {
        const px = num(pos.current_price) ?? Number(pos.entry_price);
        return px * Number(pos.shares);
    }
    const px = num(pos.current_price) ?? Number(pos.entry_price);
    return -px * 100 * Number(pos.contracts);
}

/** Realized P&L when a short put is bought back (or expires at 0). */
export function closedPutPnl({ entryPrice, closePrice, contracts, entryFees, exitFees }) {
    return r2((Number(entryPrice) - Number(closePrice)) * 100 * Number(contracts) - (Number(entryFees) || 0) - (Number(exitFees) || 0));
}
export function closedStockPnl({ costBasis, salePrice, shares, entryFees, exitFees }) {
    return r2((Number(salePrice) - Number(costBasis)) * Number(shares) - (Number(entryFees) || 0) - (Number(exitFees) || 0));
}

/**
 * Account totals. cash = starting cash + every ledger amount.
 * total value = cash + market value of positions = starting cash + realized + unrealized.
 */
export function portfolioTotals(portfolio, positions, ledgerSum) {
    const start = Number(portfolio.starting_cash) || 0;
    const cash = r2(start + (Number(ledgerSum) || 0));
    const open = positions.filter((p) => p.status === 'OPEN');
    const collateral = r2(open.reduce((s, p) => s + collateralFor(p), 0));
    const value = r2(cash + open.reduce((s, p) => s + marketValue(p), 0));
    const unrealized = r2(open.reduce((s, p) => s + unrealizedPnl(p), 0));
    const realized = r2(positions.filter((p) => p.status === 'CLOSED').reduce((s, p) => s + (Number(p.realized_pnl) || 0), 0));
    return {
        starting_cash: start,
        cash,
        collateral,
        free_cash: r2(cash - collateral),
        total_value: value,
        realized,
        unrealized,
        total_return_pct: start > 0 ? r2(((value - start) / start) * 100) : 0,
        open_positions: open.length,
    };
}

/** Largest peak-to-trough fall of a value series, as a positive % (0 when it never fell). */
export function maxDrawdownPct(values) {
    let peak = -Infinity, worst = 0;
    for (const v of values.map(Number)) {
        if (v > peak) peak = v;
        if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
    }
    return r2(worst * 100);
}

/** Compound annual return; null until the portfolio has run 30 days (short runs annualize wildly). */
export function annualizedPct(startValue, endValue, days) {
    if (!(startValue > 0) || !(days >= 30)) return null;
    return r2((Math.pow(endValue / startValue, 365 / days) - 1) * 100);
}

const DAY = 86400000;
function toDate(d) {
    return d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
}

/** Closed-trade statistics. Rolled legs count as trades; assignments are counted separately. */
export function tradeStats(positions) {
    const closed = positions.filter((p) => p.status === 'CLOSED' && p.realized_pnl != null);
    const pnls = closed.map((p) => Number(p.realized_pnl));
    const wins = pnls.filter((v) => v > 0), losses = pnls.filter((v) => v < 0);
    const options = closed.filter((p) => p.position_type === 'option');
    const held = closed.filter((p) => p.open_date && p.close_date)
        .map((p) => Math.max(0, Math.round((toDate(p.close_date) - toDate(p.open_date)) / DAY)));
    const premium = options.reduce((s, p) => s + Number(p.entry_price) * 100 * Number(p.contracts), 0);
    const optionPnl = options.reduce((s, p) => s + Number(p.realized_pnl), 0);
    const avg = (a) => (a.length ? r2(a.reduce((s, v) => s + v, 0) / a.length) : null);
    return {
        closed_trades: closed.length,
        wins: wins.length,
        losses: losses.length,
        win_rate_pct: closed.length ? r2((wins.length / closed.length) * 100) : null,
        avg_win: avg(wins),
        avg_loss: avg(losses),
        avg_days_held: held.length ? r2(held.reduce((s, v) => s + v, 0) / held.length) : null,
        premium_captured_pct: premium > 0 ? r2((optionPnl / premium) * 100) : null,
        assignments: options.filter((p) => p.close_reason === 'assigned').length,
        assignment_rate_pct: options.length ? r2((options.filter((p) => p.close_reason === 'assigned').length / options.length) * 100) : null,
    };
}

/** New York calendar date and minutes since midnight for `now`. */
export function nyClock(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value]));
    const hour = Number(parts.hour) % 24;
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: hour * 60 + Number(parts.minute), weekday: parts.weekday };
}

/** US regular session, with a 15-minute tail so the closing marks are captured. */
export function isMarketOpen(now = new Date()) {
    const { minutes, weekday } = nyClock(now);
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    return minutes >= 9 * 60 + 30 && minutes <= 16 * 60 + 15;
}

/** An option is settled once its expiry date has passed in New York, or at 16:15 NY on the day. */
export function isExpiryDue(expirationDate, now = new Date()) {
    if (!expirationDate) return false;
    const exp = String(expirationDate instanceof Date ? expirationDate.toISOString() : expirationDate).slice(0, 10);
    const { date, minutes } = nyClock(now);
    return exp < date || (exp === date && minutes >= 16 * 60 + 15);
}

/** A put finishes in the money (assigned) when the underlying closes below the strike. */
export function expiryOutcome(strike, underlyingPrice) {
    return Number(underlyingPrice) < Number(strike) ? 'assigned' : 'expired';
}
