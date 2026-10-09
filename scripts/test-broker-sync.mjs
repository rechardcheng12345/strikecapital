// Local MySQL integration verification. All test data is rolled back.
process.env.NODE_ENV = 'staging';
const { env } = await import('../server/src/config/env.js');
if (!['localhost', '127.0.0.1'].includes(env.dbHost) || env.dbName !== 'strikecapital_staging') throw new Error('Integration checks require the local staging database');
const { db } = await import('../server/src/config/database.js');
const { syncBrokerTrades } = await import('../server/src/services/brokerTradeSync.js');
const { default: assert } = await import('node:assert/strict');
const rollback = new Error('rollback test data');
try {
    await db.transaction(async trx => {
        await trx('broker_synced_fills').del();
        await trx('broker_sync_state').where({ id: 'moomoo' }).update({ account_id: null, start_date: null });
        const user = await trx('users').where({ role: 'admin' }).first();
        const opening = { fillId: '9000000000000001', orderId: '9000000000000002', code: 'QZZSYN261016P100000', side: 2, qty: 2, price: 1.5, time: '2026-10-09 10:00:00', status: 0 };
        const feed = { accountId: '9000000000000000', fills: [opening], holdings: [{ code: opening.code, qty: 2, side: 1 }] };
        const events = [];
        const options = { database: trx, startDate: '2026-10-09', fetchTrades: async () => feed, notify: async (...event) => events.push(event) };
        let result = await syncBrokerTrades(user.id, options);
        assert.equal(result.error, undefined);
        assert.equal(result.added, 1);
        result = await syncBrokerTrades(user.id, options);
        assert.equal(result.added, 0);
        feed.fills.push({ ...opening, fillId: '9000000000000003', orderId: '9000000000000004', side: 1, qty: 1, price: 0.5, time: '2026-10-09 11:00:00' });
        feed.holdings[0].qty = 1;
        result = await syncBrokerTrades(user.id, options);
        assert.equal(result.closed, 0);
        assert.ok(result.warnings.length);
        feed.fills.push({ ...feed.fills[1], fillId: '9000000000000005', price: 0.7, time: '2026-10-09 12:00:00' });
        feed.holdings = [];
        result = await syncBrokerTrades(user.id, options);
        assert.equal(result.closed, 1);
        const position = await trx('positions').where({ ticker: 'QZZSYN' }).first();
        assert.equal(Number(position.realized_pnl), 180);
        assert.equal(Number(position.close_premium), 0.6);
        assert.equal(await trx('pnl_records').where({ position_id: position.id }).count('* as n').then(r => Number(r[0].n)), 1);
        result = await syncBrokerTrades(user.id, options);
        assert.equal(result.closed, 0);
        assert.equal(events.length, 2);
        const failure = await syncBrokerTrades(user.id, { ...options, fetchTrades: async () => { throw new Error('offline'); } });
        assert.equal(failure.error, 'offline');
        feed.accountId = '999';
        assert.match((await syncBrokerTrades(user.id, options)).error, /account changed/);
        console.log('Broker sync integration passed: import, deduplication, partial close deferral, weighted full close, P&L record, notifications, offline, account isolation.');
        throw rollback;
    });
} catch (error) {
    if (error !== rollback) throw error;
} finally {
    await db.destroy();
}
