/** Display / stored ALLOC % = contributed cash ÷ fund capital. */
export function allocationPctFromInvested(invested, totalCapital) {
    const i = Number(invested) || 0;
    const t = Number(totalCapital) || 0;
    if (t <= 0 || i <= 0) return 0;
    return Math.round((i / t) * 10000) / 100;
}

/** Restate sleeves after a contribution. New cash does not take any of the old equity. */
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
            ownershipPct: totalAfter > 0 ? Math.round((equity / totalAfter) * 10000) / 100 : 0,
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
 */
export function positionShareForInvestor({ amount, asOf, periods, userId, marks = [] }) {
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
    share += (total - prev) * (pctOnDate(periods, userId, asOf) / 100);
    return share;
}

/**
 * Fund realized $ × the investor's ownership, record by record.
 * records: [{ recordDate, amount, positionId? }]; marksByPosition: Map(positionId → marks) — optional.
 */
export function realizedShareForInvestor(periods, records, userId, marksByPosition = null) {
    let sum = 0;
    for (const rec of records || []) {
        sum += positionShareForInvestor({
            amount: rec.amount,
            asOf: rec.recordDate,
            periods,
            userId,
            marks: marksByPosition?.get(rec.positionId) || [],
        });
    }
    return Math.round(sum * 100) / 100;
}
