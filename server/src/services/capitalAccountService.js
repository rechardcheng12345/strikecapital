import { db } from '../config/database.js';
import { allocationPctFromInvested, restatedOwnership, realizedShareForInvestor } from './capitalAccount.js';

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

export async function sumFundUnrealizedPnl() {
    const open = await db('positions')
        .where('status', 'OPEN')
        .whereNotNull('current_price')
        .select('premium_received', 'commission', 'platform_fee', 'current_price', 'contracts', 'position_type', 'shares', 'cost_basis');
    let total = 0;
    for (const pos of open) {
        if (pos.position_type === 'stock' && pos.shares) {
            total += (parseFloat(pos.current_price) - parseFloat(pos.cost_basis)) * pos.shares;
        } else if (pos.contracts > 0) {
            const fees = (parseFloat(pos.commission) || 0) + (parseFloat(pos.platform_fee) || 0);
            total += parseFloat(pos.premium_received) - fees - (parseFloat(pos.current_price) * pos.contracts * 100);
        }
    }
    return total;
}

export async function loadPnlRecords() {
    const rows = await db('pnl_records')
        .join('positions', 'pnl_records.position_id', 'positions.id')
        .select('pnl_records.record_date', 'pnl_records.pnl_amount', 'positions.commission', 'positions.platform_fee');
    return rows.map((r) => {
        const fees = (parseFloat(r.commission) || 0) + (parseFloat(r.platform_fee) || 0);
        const recordDate = r.record_date instanceof Date
            ? r.record_date.toISOString().slice(0, 10)
            : String(r.record_date).slice(0, 10);
        return { recordDate, amount: parseFloat(r.pnl_amount) - fees };
    });
}

export async function investorRealizedShare(userId) {
    const periods = await db('ownership_periods').where({ user_id: userId }).orderBy('start_on');
    if (periods.length === 0) return 0;
    const records = await loadPnlRecords();
    return realizedShareForInvestor(
        periods.map((p) => ({
            userId: p.user_id,
            startOn: ymd(p.start_on),
            endOn: p.end_on ? ymd(p.end_on) : null,
            ownershipPct: parseFloat(p.ownership_pct),
        })),
        records,
        userId,
    );
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
        for (const s of next) {
            await trx('ownership_periods').insert({
                user_id: s.userId,
                start_on: on,
                end_on: null,
                ownership_pct: s.ownershipPct,
                capital_account: s.capitalAccount,
            });
            const alloc = await trx('investor_allocations').where({ user_id: s.userId, is_active: true }).first();
            const invested = s.userId === userId
                ? (parseFloat(alloc?.invested_amount || '0') || 0) + contribution
                : (parseFloat(alloc?.invested_amount || '0') || 0);
            if (alloc) {
                await trx('investor_allocations').where({ id: alloc.id }).update({
                    invested_amount: invested,
                    updated_at: trx.fn.now(),
                });
            } else if (s.userId === userId) {
                await trx('investor_allocations').insert({
                    user_id: userId,
                    invested_amount: contribution,
                    allocation_pct: 0,
                    start_date: on,
                    is_active: true,
                    created_by: createdBy || null,
                });
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

        const [movementId] = await trx('capital_movements').insert({
            user_id: userId,
            type: 'contribution',
            amount: contribution,
            moved_on: on,
            nav_before: navBefore,
            note: note || null,
            created_by: createdBy || null,
        });

        return {
            id: movementId,
            user_id: userId,
            amount: contribution,
            moved_on: on,
            nav_before: navBefore,
            total_fund_capital: newCapital,
            total_realized_pnl: Math.round(realized * 100) / 100,
            ownership: next,
        };
    });
}
