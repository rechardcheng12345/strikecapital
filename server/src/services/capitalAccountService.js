import { db } from '../config/database.js';
import { allocationPctFromInvested, restatedOwnership, realizedShareForInvestor, positionShareForInvestor, pctBeforeForRecord, timeWeightedReturn } from './capitalAccount.js';

/** ALLOC % follows contributed cash, not NAV sleeves. */
export async function syncAllocationPctFromInvested(trx = db) {
    const settings = await trx('fund_settings').first();
    const totalCapital = parseFloat(settings?.total_fund_capital || '0') || 0;
    const rows = await trx('investor_allocations').where({ is_active: true });
    for (const row of rows) {
        const pct = allocationPctFromInvested(row.invested_amount, totalCapital);
        await trx('investor_allocations').where({ id: row.id }).update({
            allocation_pct: pct,
            updated_at: trx.fn.now(),
        });
    }
}

function ymd(d) {
    if (!d) return new Date().toISOString().slice(0, 10);
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
}

export async function sumFundRealizedPnl() {
    const row = await db('pnl_records')
        .join('positions', 'pnl_records.position_id', 'positions.id')
        .select(db.raw('SUM(pnl_records.pnl_amount - COALESCE(positions.commission, 0) - COALESCE(positions.platform_fee, 0)) as total'))
        .first();
    return parseFloat(row?.total || '0') || 0;
}

/** Unrealized P&L (net of fees) of each open position that has a price: [{ id, pnl }]. */
export async function openPositionUnrealized(trx = db) {
    const open = await trx('positions')
        .where('status', 'OPEN')
        .whereNotNull('current_price')
        .select('id', 'premium_received', 'commission', 'platform_fee', 'current_price', 'contracts', 'position_type', 'shares', 'cost_basis');
    const out = [];
    for (const pos of open) {
        if (pos.position_type === 'stock' && pos.shares) {
            out.push({ id: pos.id, pnl: (parseFloat(pos.current_price) - parseFloat(pos.cost_basis)) * pos.shares });
        } else if (pos.contracts > 0) {
            const fees = (parseFloat(pos.commission) || 0) + (parseFloat(pos.platform_fee) || 0);
            out.push({ id: pos.id, pnl: parseFloat(pos.premium_received) - fees - (parseFloat(pos.current_price) * pos.contracts * 100) });
        }
    }
    return out;
}

export async function sumFundUnrealizedPnl() {
    return (await openPositionUnrealized()).reduce((sum, p) => sum + p.pnl, 0);
}

// capital_movement_marks / capital_movements.undo_info come from migration 20260928000001.
// Until it runs, adds work as before (no snapshots, no undo). Re-checked until it succeeds.
let marksReady = false;
export async function marksSupported(trx = db) {
    if (marksReady) return true;
    marksReady = (await trx.schema.hasTable('capital_movement_marks'))
        && (await trx.schema.hasColumn('capital_movements', 'undo_info'));
    return marksReady;
}

/** Map(positionId → [{ movedOn, mark, pctBefore }]) from the snapshots taken at each capital add. */
export async function loadMarksByPosition() {
    if (!(await marksSupported())) return new Map();
    const rows = await db('capital_movement_marks as m')
        .join('capital_movements as c', 'c.id', 'm.movement_id')
        .select('m.position_id', 'm.unrealized_pnl', 'c.moved_on', 'c.undo_info');
    const map = new Map();
    for (const r of rows) {
        let pctBefore = {};
        try {
            pctBefore = JSON.parse(r.undo_info || '{}').pct_before || {};
        } catch {
            pctBefore = {};
        }
        if (!map.has(r.position_id)) map.set(r.position_id, []);
        map.get(r.position_id).push({ movedOn: ymd(r.moved_on), mark: parseFloat(r.unrealized_pnl) || 0, pctBefore });
    }
    return map;
}

/** Capital adds that noted the last realized record at the time — see pctBeforeForRecord. */
export async function loadAddsWithRecordCutoff() {
    if (!(await marksSupported())) return [];
    const rows = await db('capital_movements').whereNotNull('undo_info').select('id', 'moved_on', 'undo_info');
    const adds = [];
    for (const r of rows) {
        let info = {};
        try {
            info = JSON.parse(r.undo_info || '{}');
        } catch {
            info = {};
        }
        if (info.last_pnl_record_id == null) continue;
        adds.push({ id: r.id, movedOn: ymd(r.moved_on), lastPnlRecordId: Number(info.last_pnl_record_id), pctBefore: info.pct_before || {} });
    }
    return adds;
}

export async function loadPnlRecords() {
    const rows = await db('pnl_records')
        .join('positions', 'pnl_records.position_id', 'positions.id')
        .select('pnl_records.id', 'pnl_records.position_id', 'pnl_records.record_date', 'pnl_records.pnl_amount', 'positions.commission', 'positions.platform_fee');
    return rows.map((r) => {
        const fees = (parseFloat(r.commission) || 0) + (parseFloat(r.platform_fee) || 0);
        const recordDate = r.record_date instanceof Date
            ? r.record_date.toISOString().slice(0, 10)
            : String(r.record_date).slice(0, 10);
        return { id: r.id, positionId: r.position_id, recordDate, amount: parseFloat(r.pnl_amount) - fees };
    });
}

/** Everything needed to split fund P&L for one investor: their periods (with userId), snapshots and add cut-offs. */
export async function loadShareContext(userId) {
    const rows = await db('ownership_periods').where({ user_id: userId }).orderBy('start_on');
    const periods = rows.map((p) => ({
        userId: p.user_id,
        startOn: ymd(p.start_on),
        endOn: p.end_on ? ymd(p.end_on) : null,
        ownershipPct: parseFloat(p.ownership_pct),
    }));
    return { periods, marksByPosition: await loadMarksByPosition(), adds: await loadAddsWithRecordCutoff() };
}

export async function investorRealizedShare(userId) {
    const { periods, marksByPosition, adds } = await loadShareContext(userId);
    if (periods.length === 0) return 0;
    const records = await loadPnlRecords();
    return realizedShareForInvestor(periods, records, userId, marksByPosition, adds);
}

/** Investor's share of today's unrealized P&L, honouring snapshots taken at capital adds. */
export async function investorUnrealizedShare(userId) {
    const { periods, marksByPosition } = await loadShareContext(userId);
    if (periods.length === 0) return null; // caller falls back to Alloc % for legacy accounts
    const today = new Date().toISOString().slice(0, 10);
    let sum = 0;
    for (const p of await openPositionUnrealized()) {
        sum += positionShareForInvestor({ amount: p.pnl, asOf: today, periods, userId, marks: marksByPosition.get(p.id) || [] });
    }
    return Math.round(sum * 100) / 100;
}

const capitalError = (message) => Object.assign(new Error(message), { status: 400 });

export async function addCapital({ userId, amount, movedOn, note, createdBy }) {
    const contribution = Number(amount);
    if (!(contribution > 0)) throw capitalError('Amount must be greater than 0');
    return moveCapital({ userId, type: 'contribution', amount: contribution, movedOn, note, createdBy });
}

/**
 * Pay an investor out of the fund: `amount` dollars, or everything they own (`all`). Their current value is
 * their ownership % × the fund value (NAV) today, open positions at their latest prices. Everyone's ownership is
 * restated on the smaller fund, open positions are snapshotted so profit already earned stays with whoever owned
 * it then, and the investor's net invested amount and the fund capital go down by the payout (so net invested
 * can go below zero once they've taken out more than they put in — that's their profit). Undoable like an add.
 */
export async function withdrawCapital({ userId, amount, all = false, movedOn, note, createdBy }) {
    if (!all && !(Number(amount) > 0)) throw capitalError('Amount must be greater than 0');
    return moveCapital({ userId, type: 'withdrawal', amount: all ? null : Number(amount), movedOn, note, createdBy });
}

/** An investor's money in the fund now: net invested + their share of realized and open P&L. */
async function shareValue(userId, trx = db) {
    const alloc = await trx('investor_allocations').where({ user_id: userId, is_active: true }).first();
    const invested = parseFloat(alloc?.invested_amount || '0') || 0;
    return invested + (await investorRealizedShare(userId)) + ((await investorUnrealizedShare(userId)) ?? 0);
}

/** What an investor's share is worth today (what a full withdrawal would pay), with their ownership %. */
export async function investorValueNow(userId) {
    const open = await db('ownership_periods').where({ user_id: userId }).whereNull('end_on').first();
    return { value: Math.round((await shareValue(userId)) * 100) / 100, ownership_pct: parseFloat(open?.ownership_pct) || 0 };
}

/**
 * Contribution (amount > 0) or withdrawal (amount = dollars to pay out, null = everything). Restates every
 * investor's ownership from `movedOn` on the fund value at that moment, snapshots open positions, updates the
 * investor's net invested amount and the fund capital, and records an undoable capital movement.
 */
async function moveCapital({ userId, type, amount, movedOn, note, createdBy }) {
    const on = ymd(movedOn);

    return db.transaction(async (trx) => {
        // Ownership periods are a chain: an add dated before the latest one would overlap it.
        const latest = await trx('capital_movements').orderBy('moved_on', 'desc').first();
        if (latest && on < ymd(latest.moved_on)) {
            const err = new Error(`Date must be on or after the latest capital movement (${ymd(latest.moved_on)})`);
            err.status = 400;
            throw err;
        }
        const settings = await trx('fund_settings').first();
        const contributed = parseFloat(settings?.total_fund_capital || '0') || 0;
        const realized = await sumFundRealizedPnl();
        const unrealized = await sumFundUnrealizedPnl();
        const navBefore = Math.round((contributed + realized + unrealized) * 100) / 100;

        const openPeriods = await trx('ownership_periods').whereNull('end_on');
        // Each investor's money today = net invested + their share of realized and open P&L — exactly what their
        // statement shows. (Ownership % × NAV drifts by cents because older ownership was rounded to 2 decimals.)
        const sleeveValue = {};
        for (const p of openPeriods) sleeveValue[p.user_id] = await shareValue(p.user_id, trx);
        const withMarks = await marksSupported(trx);
        const openPnl = withMarks ? await openPositionUnrealized(trx) : [];
        // Realized P&L booked up to now stays with the current owners even if its date is on/after `on`.
        const lastRecord = withMarks ? await trx('pnl_records').max('id as id').first() : null;
        const pctBefore = Object.fromEntries(openPeriods.map((p) => [p.user_id, parseFloat(p.ownership_pct) || 0]));
        const sleeves = openPeriods.map((p) => ({ userId: p.user_id, equity: sleeveValue[p.user_id] }));
        let contribution = amount;
        if (type === 'withdrawal') {
            const own = sleeves.find((s) => s.userId === userId);
            const available = Math.round((own?.equity || 0) * 100) / 100;
            if (!(available > 0)) throw capitalError('This investor has no share of the fund to withdraw');
            const payout = amount == null ? available : Math.round(amount * 100) / 100;
            if (payout > available + 0.005) throw capitalError(`They can withdraw at most $${available.toFixed(2)} (their share of the fund today)`);
            contribution = -Math.min(payout, available);
        } else if (sleeves.length === 0) {
            sleeves.push({ userId, equity: navBefore });
        }

        const next = restatedOwnership({
            sleeves,
            targetUserId: userId,
            amount: contribution,
            navBefore: sleeves.reduce((sum, s) => sum + s.equity, 0),
        });

        await trx('ownership_periods').whereNull('end_on').update({ end_on: on });
        const createdPeriodIds = [];
        let allocationUndo = null;
        for (const s of next) {
            const [periodId] = await trx('ownership_periods').insert({
                user_id: s.userId,
                start_on: on,
                end_on: null,
                ownership_pct: s.ownershipPct,
                capital_account: s.capitalAccount,
            });
            createdPeriodIds.push(periodId);
            const alloc = await trx('investor_allocations').where({ user_id: s.userId, is_active: true }).first();
            if (s.userId === userId) {
                allocationUndo = alloc
                    ? { id: alloc.id, created: false, prev_invested: parseFloat(alloc.invested_amount || '0') || 0 }
                    : { created: true };
            }
            const invested = s.userId === userId
                ? (parseFloat(alloc?.invested_amount || '0') || 0) + contribution
                : (parseFloat(alloc?.invested_amount || '0') || 0);
            if (alloc) {
                await trx('investor_allocations').where({ id: alloc.id }).update({
                    invested_amount: invested,
                    updated_at: trx.fn.now(),
                });
            } else if (s.userId === userId) {
                const [allocId] = await trx('investor_allocations').insert({
                    user_id: userId,
                    invested_amount: contribution,
                    allocation_pct: 0,
                    start_date: on,
                    is_active: true,
                    created_by: createdBy || null,
                });
                allocationUndo = { id: allocId, created: true };
            }
        }

        const newCapital = Math.round((contributed + contribution) * 100) / 100;
        if (settings) {
            await trx('fund_settings').where({ id: settings.id }).update({
                total_fund_capital: newCapital,
                updated_by: createdBy || settings.updated_by,
                updated_at: trx.fn.now(),
            });
        }
        await syncAllocationPctFromInvested(trx);

        const movementRow = {
            user_id: userId,
            type,
            amount: contribution, // negative for a withdrawal
            moved_on: on,
            nav_before: navBefore,
            note: note || null,
            created_by: createdBy || null,
        };
        if (withMarks) {
            movementRow.undo_info = JSON.stringify({
                closed_period_ids: openPeriods.map((p) => p.id),
                created_period_ids: createdPeriodIds,
                pct_before: pctBefore,
                value_before: Object.fromEntries(sleeves.map((s) => [s.userId, Math.round(s.equity * 100) / 100])),
                allocation: allocationUndo,
                prev_total_capital: contributed,
                last_pnl_record_id: lastRecord?.id ?? 0,
            });
        }
        const [movementId] = await trx('capital_movements').insert(movementRow);
        if (withMarks && openPnl.length) {
            await trx('capital_movement_marks').insert(openPnl.map((p) => ({
                movement_id: movementId,
                position_id: p.id,
                unrealized_pnl: Math.round(p.pnl * 100) / 100,
            })));
        }

        return {
            id: movementId,
            user_id: userId,
            type,
            amount: contribution,
            moved_on: on,
            nav_before: navBefore,
            total_fund_capital: newCapital,
            total_realized_pnl: Math.round(realized * 100) / 100,
            open_positions_snapshotted: openPnl.length,
            undoable: withMarks,
            ownership: next,
        };
    });
}

/** The most recent capital movement and whether it can be undone. */
export async function getLastCapitalMovement() {
    const last = await db('capital_movements as c')
        .leftJoin('users as u', 'u.id', 'c.user_id')
        .whereNot('c.amount', 0) // $0 rows are opening-balance backfills; negative = withdrawal
        .orderBy('c.moved_on', 'desc').orderBy('c.id', 'desc')
        .select('c.*', 'u.full_name', 'u.email')
        .first();
    if (!last) return null;
    const supported = await marksSupported();
    const { undo_info: undoInfo, ...rest } = last;
    return {
        ...rest,
        moved_on: ymd(last.moved_on),
        undoable: supported && Boolean(undoInfo),
        reason: !supported ? 'Run the database migration to enable undo.'
            : !undoInfo ? 'This add was made before undo was available.' : null,
    };
}

/**
 * Reverse the most recent capital add exactly: remove the ownership rows it created, reopen the ones it
 * closed, restore the investor's invested amount and the fund capital, delete its snapshots and the movement.
 * Only the latest movement can be undone (a later add was calculated on top of it).
 */
export async function undoLastCapitalMovement() {
    if (!(await marksSupported())) {
        const err = new Error('Run the database migration to enable undo.');
        err.status = 400;
        throw err;
    }
    return db.transaction(async (trx) => {
        const last = await trx('capital_movements').whereNot('amount', 0).orderBy('moved_on', 'desc').orderBy('id', 'desc').first();
        if (!last) {
            const err = new Error('There is no capital movement to undo.');
            err.status = 400;
            throw err;
        }
        if (!last.undo_info) {
            const err = new Error('The latest capital add was made before undo was available — it cannot be undone automatically.');
            err.status = 400;
            throw err;
        }
        const info = JSON.parse(last.undo_info);
        const amount = parseFloat(last.amount) || 0;

        await trx('ownership_periods').whereIn('id', info.created_period_ids || []).del();
        if ((info.closed_period_ids || []).length) {
            await trx('ownership_periods').whereIn('id', info.closed_period_ids).update({ end_on: null });
        }

        const a = info.allocation;
        if (a?.created && a.id) {
            await trx('investor_allocations').where({ id: a.id }).del();
        } else if (a?.id) {
            await trx('investor_allocations').where({ id: a.id }).update({ invested_amount: a.prev_invested, updated_at: trx.fn.now() });
        }

        // Subtract rather than restore the old figure, so an unrelated manual edit since then is kept.
        const settings = await trx('fund_settings').first();
        if (settings) {
            const current = parseFloat(settings.total_fund_capital || '0') || 0;
            await trx('fund_settings').where({ id: settings.id }).update({
                total_fund_capital: Math.max(0, Math.round((current - amount) * 100) / 100),
                updated_at: trx.fn.now(),
            });
        }
        await syncAllocationPctFromInvested(trx);

        await trx('capital_movement_marks').where({ movement_id: last.id }).del();
        await trx('capital_movements').where({ id: last.id }).del();

        return { id: last.id, user_id: last.user_id, type: last.type, amount, moved_on: ymd(last.moved_on) };
    });
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * One investor's P&L statement — what they'd be owed if they cashed out today and how it was earned:
 * contributions (with the fund value at each), their share of every realized trade and open position
 * (ownership periods + snapshots, same rules as the investor pages), P&L by month, and a time-weighted
 * return that top-ups don't dilute.
 */
export async function investorStatement(userId) {
    const user = await db('users').where({ id: userId }).first('id', 'full_name', 'email', 'role');
    if (!user) {
        const err = new Error('Investor not found');
        err.status = 404;
        throw err;
    }
    const alloc = await db('investor_allocations').where({ user_id: userId, is_active: true }).first();
    const invested = parseFloat(alloc?.invested_amount || '0') || 0;
    const { periods, marksByPosition, adds } = await loadShareContext(userId);
    const today = new Date().toISOString().slice(0, 10);

    // Realized: their share of each P&L record
    const records = await db('pnl_records as r').join('positions as p', 'p.id', 'r.position_id')
        .select('r.id', 'r.position_id', 'r.record_date', 'r.pnl_amount', 'p.ticker', 'p.strike_price', 'p.expiration_date', 'p.contracts', 'p.position_type', 'p.commission', 'p.platform_fee')
        .orderBy('r.record_date').orderBy('r.id');
    const byPosition = new Map();
    const byMonth = new Map();
    let realized = 0;
    for (const r of records) {
        const date = ymd(r.record_date);
        const net = parseFloat(r.pnl_amount) - ((parseFloat(r.commission) || 0) + (parseFloat(r.platform_fee) || 0));
        const share = periods.length
            ? positionShareForInvestor({ amount: net, asOf: date, periods, userId, marks: marksByPosition.get(r.position_id) || [], pctBefore: pctBeforeForRecord(r.id, date, adds) })
            : 0;
        realized += share;
        const month = date.slice(0, 7);
        byMonth.set(month, (byMonth.get(month) || 0) + share);
        const row = byPosition.get(r.position_id) || {
            position_id: r.position_id, ticker: r.ticker, strike: parseFloat(r.strike_price), expiry: ymd(r.expiration_date),
            contracts: r.contracts, type: r.position_type, closed_on: date, fund_pnl: 0, share: 0,
        };
        row.fund_pnl += net;
        row.share += share;
        row.closed_on = date;
        byPosition.set(r.position_id, row);
    }

    // Unrealized: their share of each open position at today's price
    const openRows = await openPositionUnrealized();
    const info = new Map((await db('positions').whereIn('id', openRows.map((x) => x.id))
        .select('id', 'ticker', 'strike_price', 'expiration_date', 'contracts', 'position_type', 'shares', 'current_price'))
        .map((p) => [p.id, p]));
    let unrealized = 0;
    const open = openRows.map((x) => {
        const p = info.get(x.id) || {};
        const share = periods.length ? positionShareForInvestor({ amount: x.pnl, asOf: today, periods, userId, marks: marksByPosition.get(x.id) || [] }) : 0;
        unrealized += share;
        return {
            position_id: x.id, ticker: p.ticker, strike: p.strike_price != null ? parseFloat(p.strike_price) : null, expiry: ymd(p.expiration_date),
            contracts: p.contracts, shares: p.shares, type: p.position_type, current_price: p.current_price != null ? parseFloat(p.current_price) : null,
            fund_pnl: r2(x.pnl), share: r2(share),
        };
    });
    const value = invested + realized + unrealized;

    // Capital movements, and the growth of their money between them (time-weighted)
    const { moves, ownRows, segments, twr, firstDay, annualized } = await returnSegments(userId, value);
    const contributions = moves.filter((m) => m.user_id === userId && parseFloat(m.amount) !== 0).map((m) => {
        let pctBefore = 0;
        try {
            pctBefore = Number(JSON.parse(m.undo_info || '{}').pct_before?.[userId]) || 0;
        } catch {
            pctBefore = 0;
        }
        const after = ownRows.find((p) => ymd(p.start_on) === ymd(m.moved_on));
        return {
            id: m.id, type: m.type, moved_on: ymd(m.moved_on), amount: r2(m.amount), note: m.note, fund_value_before: r2(m.nav_before),
            their_value_before: r2((parseFloat(m.nav_before) || 0) * (pctBefore / 100)), ownership_after_pct: after ? parseFloat(after.ownership_pct) : null,
        };
    });
    const current = ownRows.find((p) => !p.end_on);

    return {
        investor: { id: user.id, full_name: user.full_name, email: user.email },
        as_of: today,
        invested: r2(invested),
        realized: r2(realized),
        unrealized: r2(unrealized),
        value: r2(value),
        profit: r2(realized + unrealized),
        simple_return_pct: invested > 0 ? r2(((realized + unrealized) / invested) * 100) : null,
        twr_pct: segments.some((s) => s.start > 0) ? twr.pct : null,
        twr_annualized_pct: annualized,
        since: firstDay || null,
        ownership_pct: current ? parseFloat(current.ownership_pct) : 0,
        contributions,
        periods: segments,
        open_positions: open,
        realized_by_month: [...byMonth.entries()].map(([month, share]) => ({ month, share: r2(share) })),
        realized_by_position: [...byPosition.values()]
            .map((x) => ({ ...x, fund_pnl: r2(x.fund_pnl), share: r2(x.share) }))
            .sort((a, b) => (a.closed_on < b.closed_on ? 1 : a.closed_on > b.closed_on ? -1 : b.position_id - a.position_id)),
    };
}

/**
 * An investor's ownership periods as growth segments — their money at each period's start (including that
 * day's top-up or after a withdrawal) → at its end (ownership % × the fund value when the next movement closed
 * it, or `valueNow` for the open period) — chained into a time-weighted return.
 */
export async function returnSegments(userId, valueNow) {
    const moves = await db('capital_movements').orderBy('moved_on').orderBy('id');
    const closedBy = (periodId) => moves.find((m) => {
        try {
            return (JSON.parse(m.undo_info || '{}').closed_period_ids || []).includes(periodId);
        } catch {
            return false;
        }
    });
    const ownRows = await db('ownership_periods').where({ user_id: userId }).orderBy('start_on').orderBy('id');
    const segments = ownRows.map((p) => {
        const start = parseFloat(p.capital_account) || 0;
        let end = valueNow;
        if (p.end_on) {
            const closer = closedBy(p.id) || moves.find((m) => ymd(m.moved_on) === ymd(p.end_on) && parseFloat(m.amount) !== 0);
            let recorded = null;
            try {
                recorded = JSON.parse(closer?.undo_info || '{}').value_before?.[userId];
            } catch {
                recorded = null;
            }
            end = recorded != null ? Number(recorded)
                : closer ? (parseFloat(closer.nav_before) || 0) * ((parseFloat(p.ownership_pct) || 0) / 100) : start;
        }
        return {
            start_on: ymd(p.start_on), end_on: p.end_on ? ymd(p.end_on) : null, ownership_pct: parseFloat(p.ownership_pct),
            start: r2(start), end: r2(end), return_pct: start > 0 ? r2(((end / start) - 1) * 100) : null,
        };
    });
    const twr = timeWeightedReturn(segments);
    const firstDay = segments.find((x) => x.start > 0)?.start_on || null;
    const today = new Date().toISOString().slice(0, 10);
    const days = firstDay ? Math.max(1, Math.round((Date.parse(today) - Date.parse(firstDay)) / 86400000)) : 0;
    const annualized = days >= 90 ? r2((Math.pow(twr.factor, 365 / days) - 1) * 100) : null;
    return { moves, ownRows, segments, twr, firstDay, annualized, has: segments.some((x) => x.start > 0) };
}
