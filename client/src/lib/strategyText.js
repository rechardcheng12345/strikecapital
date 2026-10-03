// Plain-English summary of a backtest setting (bt_presets params), for automatic Simulation portfolios.

const CAL = { jan: 'January', month: 'other months', week: 'weekly' };

function expiryText(e = {}) {
    const types = Array.isArray(e.calendars) && e.calendars.length ? e.calendars : ['jan'];
    const which = types.length === 3 ? 'any Friday' : types.map((t) => CAL[t] || t).join(' + ');
    return `${e.min_dte ?? '?'}–${e.max_dte ?? '?'} days out (${which})`;
}

function strikeText(s = {}) {
    if (s.mode === 'delta') return `delta ${s.delta}${s.min_discount_pct ? `, at least ${s.min_discount_pct}% below the price` : ''}`;
    if (s.mode === 'yield') return `the furthest strike paying ≥ ${s.target_annual_pct}%/yr (${s.min_discount_pct ?? 0}–${s.max_discount_pct ?? 80}% below the price)`;
    return `${s.pct}% below the price`;
}

/** [{ label, text }] rows describing what the strategy does. */
export function describeStrategy(p = {}, ticker = 'SOXL') {
    const rows = [];
    rows.push({ label: 'Sells', text: `${ticker} puts ${expiryText(p.expiry)}, strike ${strikeText(p.strike)}` });

    const entry = p.entry || {};
    const when = [];
    if (entry.ladder?.enabled) when.push(`monthly on day ${entry.ladder.day}`);
    if (entry.listing?.enabled) when.push('when a new expiry enters the window');
    if (entry.dip?.enabled) when.push(`on a ${entry.dip.pct}% dip from the 1-year high (every ${entry.dip.cooldown_days} days at most)`);
    if (entry.continuous?.enabled) when.push('whenever cash and limits allow');
    if (p.trend_filter?.enabled) when.push(`only while ${ticker} is above its ${p.trend_filter.ma_days}-day average`);
    rows.push({ label: 'When', text: when.join(' · ') || '—' });

    const size = p.size_mode === 'contracts'
        ? `${p.contracts} contract${p.contracts > 1 ? 's' : ''} per put`
        : `${p.size_pct}% of the account per put`;
    const lim = [];
    if (p.max_capital_pct != null) lim.push(`max ${p.max_capital_pct}% of the account tied up`);
    if (p.limits?.max_open_puts) lim.push(`≤ ${p.limits.max_open_puts} open puts`);
    if (p.limits?.max_units) lim.push(`≤ ${p.limits.max_units} × 100 shares + puts`);
    if (p.min_put_premium) lim.push(`skip puts under $${p.min_put_premium}`);
    if (p.min_annual_return_pct) lim.push(`skip under ${p.min_annual_return_pct}%/yr`);
    rows.push({ label: 'Size', text: [size, ...lim].join(' · ') });

    const x = p.exit || {};
    const exits = [];
    if (x.take_profit_pct != null) {
        const then = x.after_tp === 'roll'
            ? (x.roll_strike === 'entry' ? 'roll to a later expiry (entry strike rule)' : `roll to a later expiry ${x.roll_discount_pct}% below the price`)
            : x.after_tp === 'reenter' ? 'sell a new put' : 'wait for the next entry';
        exits.push(`take profit at ${x.take_profit_pct}%, then ${then}`);
    } else exits.push('hold to expiry');
    if (x.stop_loss?.enabled) exits.push(`stop loss at ${x.stop_loss.multiple}× the premium`);
    if (x.early_close?.enabled) exits.push(`close early at ≤ ${x.early_close.remaining_pct}% left with ≥ ${x.early_close.min_days_left} days to go`);
    if (x.roll_when_tested?.enabled) exits.push(`roll when the price is within ${x.roll_when_tested.buffer_pct}% of the strike`);
    if (x.after_expiry === 'reenter') exits.push('sell the next put when one expires worthless');
    rows.push({ label: 'Exits', text: exits.join(' · ') });

    const assigned = p.sell_at_recovery?.enabled
        ? `hold the shares, sell once back above cost${p.sell_at_recovery.above_pct ? ` + ${p.sell_at_recovery.above_pct}%` : ''}`
        : p.covered_calls?.enabled ? 'sell covered calls (not automated yet — shares are held)' : 'hold the shares';
    rows.push({ label: 'If assigned', text: `${assigned}${p.share_stop?.enabled ? ` · cut the loss at ${p.share_stop.pct}% below cost` : ''}` });
    return rows;
}

/** A New York HH:MM as Singapore time: 12 h ahead in US summer time, 13 h in winter. */
export function sgtRange(runAt = '15:30') {
    const [h, m] = runAt.split(':').map(Number);
    const fmt = (hh) => `${((hh + 11) % 12) + 1}:${String(m).padStart(2, '0')}${hh < 12 ? 'am' : 'pm'}`;
    return `${fmt((h + 12) % 24)} / ${fmt((h + 13) % 24)} Singapore (US summer / winter time)`;
}
