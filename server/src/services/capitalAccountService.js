import { db } from '../config/database.js';
import { allocationPctFromInvested, restatedOwnership, realizedShareForInvestor, positionShareForInvestor } from './capitalAccount.js';

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

export async function loadPnlRecords() {
    const rows = await db('pnl_records')
        .join('positions', 'pnl_records.position_id', 'positions.id')
        .select('pnl_records.position_id', 'pnl_records.record_date', 'pnl_records.pnl_amount', 'positions.commission', 'positions.platform_fee');
    return rows.map((r) => {
        const fees = (parseFloat(r.commission) || 0) + (parseFloat(r.platform_fee) || 0);
        const recordDate = r.record_date instanceof Date
            ? r.record_date.toISOString().slice(0, 10)
            : String(r.record_date).slice(0, 10);
        return { positionId: r.position_id, recordDate, amount: parseFloat(r.pnl_amount) - fees };
    });
}

/** Everything needed to split fund P&L for one investor: their periods (with userId) + snapshots. */
export async function loadShareContext(userId) {
    const rows = await db('ownership_periods').where({ user_id: userId }).orderBy('start_on');
    const periods = rows.map((p) => ({
        userId: p.user_id,
        startOn: ymd(p.start_on),
        endOn: p.end_on ? ymd(p.end_on) : null,
        ownershipPct: parseFloat(p.ownership_pct),
    }));
    return { periods, marksByPosition: await loadMarksByPosition() };
}

export async function investorRealizedShare(userId) {
    const { periods, marksByPosition } = await loadShareContext(userId);
    if (periods.length === 0) return 0;
    const records = await loadPnlRecords();
    return realizedShareForInvestor(periods, records, userId, marksByPosition);
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

export async function addCapital({ userId, amount, movedOn, note, createdBy }) {
    const contribution = Number(amount);
    if (!(contribution > 0)) {
        const err = new Error('Amount must be greater than 0');
        err.status = 400;
        throw err;
    }
    const on = ymd(movedOn);

    return db.transaction(async (trx) => {
        const settings = await trx('fund_settings').first();
        const contributed = parseFloat(settings?.total_fund_capital || '0') || 0;
        const realized = await sumFundRealizedPnl();
        const unrealized = await sumFundUnrealizedPnl();
        const navBefore = Math.round((contributed + realized + unrealized) * 100) / 100;

        const openPeriods = await trx('ownership_periods').whereNull('end_on');
        const withMarks = await marksSupported(trx);
        const openPnl = withMarks ? await openPositionUnrealized(trx) : [];
        const pctBefore = Object.fromEntries(openPeriods.map((p) => [p.user_id, parseFloat(p.ownership_pct) || 0]));
        const sleeves = openPeriods.map((p) => ({
            userId: p.user_id,
            equity: navBefore * ((parseFloat(p.ownership_pct) || 0) / 100),
        }));
        if (sleeves.length === 0) {
            sleeves.push({ userId, equity: navBefore });
        }

        const next = restatedOwnership({
            sleeves,
            targetUserId: userId,
            amount: contribution,
            navBefore,
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
            type: 'contribution',
            amount: contribution,
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
                allocation: allocationUndo,
                prev_total_capital: contributed,
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
        .where('c.amount', '>', 0) // $0 rows are opening-balance backfills, not adds
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
        const last = await trx('capital_movements').where('amount', '>', 0).orderBy('moved_on', 'desc').orderBy('id', 'desc').first();
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

        return { id: last.id, user_id: last.user_id, amount, moved_on: ymd(last.moved_on) };
    });
}
