/** Display / stored ALLOC % = contributed cash ÷ fund capital. */
export function allocationPctFromInvested(invested, totalCapital) {
    const i = Number(invested) || 0;
    const t = Number(totalCapital) || 0;
    if (t <= 0 || i <= 0) return 0;
    return Math.round((i / t) * 10000) / 100;
}

/**
 * Restate sleeves after a contribution (amount > 0) or withdrawal (amount < 0). New cash takes none of the old
 * equity. Ownership % is kept to 4 decimals.
 */
export function restatedOwnership({ sleeves, targetUserId, amount, navBefore }) {
    const contribution = Number(amount) || 0;
    const nav = Number(navBefore) || 0;
    const totalAfter = nav + contribution;
    const byId = new Map(sleeves.map((s) => [s.userId, { userId: s.userId, equity: Number(s.equity) || 0 }]));
    if (!byId.has(targetUserId)) {
        byId.set(targetUserId, { userId: targetUserId, equity: 0 });
    }
    const next = [...byId.values()].map((s) => {
        const equity = s.userId === targetUserId ? s.equity + contribution : s.equity;
        return {
            userId: s.userId,
            capitalAccount: Math.round(equity * 100) / 100,
            ownershipPct: totalAfter > 0 ? Math.round((equity / totalAfter) * 1000000) / 10000 : 0,
        };
    });
    return next;
}

function dateInPeriod(recordDate, startOn, endOn) {
    if (recordDate < startOn) return false;
    if (endOn != null && recordDate >= endOn) return false;
    return true;
}

/** Ownership % (0–100) for a user on a YYYY-MM-DD date, or 0 when they held no share then. */
export function pctOnDate(periods, userId, date) {
    const p = (periods || []).find((x) => x.userId === userId && dateInPeriod(date, x.startOn, x.endOn));
    return p ? Number(p.ownershipPct) || 0 : 0;
}

/**
 * One investor's share of one position's P&L.
 *
 * `marks` are snapshots of this position's unrealized P&L taken at each capital add while it was open:
 * [{ movedOn, mark, pctBefore: { [userId]: pct } }]. The P&L earned up to each snapshot belongs to the
 * ownership in force *before* that add; only the change after the last snapshot uses the ownership on
 * `asOf` (the record date for realized P&L, today for open positions). So new money never shares in
 * profit that was already earned when it arrived — even if the position closes later.
 *
 * `pctBefore` (optional) overrides the ownership on `asOf` — used for realized P&L that was booked before
 * a capital add dated on or before its record date (see pctBeforeForRecord).
 */
export function positionShareForInvestor({ amount, asOf, periods, userId, marks = [], pctBefore = null }) {
    const total = Number(amount) || 0;
    const applicable = (marks || [])
        .filter((m) => m.movedOn <= asOf)
        .sort((a, b) => (a.movedOn < b.movedOn ? -1 : a.movedOn > b.movedOn ? 1 : 0));
    let share = 0;
    let prev = 0;
    for (const m of applicable) {
        const mark = Number(m.mark) || 0;
        share += (mark - prev) * ((Number(m.pctBefore?.[userId]) || 0) / 100);
        prev = mark;
    }
    const pct = pctBefore ? (Number(pctBefore[userId]) || 0) : pctOnDate(periods, userId, asOf);
    share += (total - prev) * (pct / 100);
    return share;
}

/**
 * Realized P&L records only carry a date, so one booked earlier on the day of a capital add (or after a
 * backdated add's date) would otherwise be split by the new ownership. `adds` are capital adds that noted the
 * last pnl_records id at the time: [{ id, movedOn, lastPnlRecordId, pctBefore }]. A record booked before
 * such an add whose date the add covers belongs to the ownership in force when it was booked — the
 * pct_before of the first add made after it. Returns that map, or null when the ownership by date applies.
 */
export function pctBeforeForRecord(recordId, recordDate, adds = []) {
    if (recordId == null) return null;
    const first = (adds || [])
        .filter((a) => a.lastPnlRecordId != null && recordId <= a.lastPnlRecordId && a.movedOn <= recordDate)
        .sort((a, b) => a.id - b.id)[0];
    return first ? first.pctBefore : null;
}

/**
 * Fund realized $ × the investor's ownership, record by record.
 * records: [{ id?, recordDate, amount, positionId? }]; marksByPosition: Map(positionId → marks) — optional;
 * adds: see pctBeforeForRecord — optional.
 */
export function realizedShareForInvestor(periods, records, userId, marksByPosition = null, adds = []) {
    let sum = 0;
    for (const rec of records || []) {
        sum += positionShareForInvestor({
            amount: rec.amount,
            asOf: rec.recordDate,
            periods,
            userId,
            marks: marksByPosition?.get(rec.positionId) || [],
            pctBefore: pctBeforeForRecord(rec.id, rec.recordDate, adds),
        });
    }
    return Math.round(sum * 100) / 100;
}

/**
 * Time-weighted return across an investor's ownership periods: each period's growth (end ÷ start value of
 * their sleeve) chained together, so a top-up doesn't dilute the return the earlier money earned.
 * segments: [{ start, end }] in order; periods starting at 0 are skipped. → { pct, factor } (pct rounded to 0.01).
 */
export function timeWeightedReturn(segments = []) {
    let factor = 1;
    for (const s of segments) {
        const start = Number(s.start) || 0;
        if (start <= 0) continue;
        factor *= (Number(s.end) || 0) / start;
    }
    return { factor, pct: Math.round((factor - 1) * 10000) / 100 };
}
