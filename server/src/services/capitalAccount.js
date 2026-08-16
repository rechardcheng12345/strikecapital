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

/** Fund realized $ in each ownership window × that investor's % for the window. */
export function realizedShareForInvestor(periods, records, userId) {
    const mine = (periods || []).filter((p) => p.userId === userId);
    let sum = 0;
    for (const rec of records || []) {
        const period = mine.find((p) => dateInPeriod(rec.recordDate, p.startOn, p.endOn));
        if (!period) continue;
        sum += (Number(rec.amount) || 0) * ((Number(period.ownershipPct) || 0) / 100);
    }
    return Math.round(sum * 100) / 100;
}
