import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBrokerSecurity, groupBrokerFills, closingValues, matchesBrokerSecurity } from './brokerTradePolicy.js';

const fill = (id, qty, price, extra = {}) => ({ fillId: id, orderId: 'order1', code: 'AAPL261016P200000', side: 2, qty, price, time: '2026-10-09 10:00:00', status: 0, ...extra });
test('parses broker puts and stocks and rejects calls or invalid expiration dates', () => {
    assert.deepEqual(parseBrokerSecurity('US.AAPL261016P200000'), { ticker: 'AAPL', position_type: 'option', strike_price: 200, expiration_date: '2026-10-16' });
    assert.equal(parseBrokerSecurity('AAPL261016C200000'), null);
    assert.equal(parseBrokerSecurity('AAPL260231P200000'), null);
    assert.equal(parseBrokerSecurity('BRK.B').position_type, 'stock');
});
test('aggregates partial fills with weighted values and skips duplicate and consumed fills', () => {
    const { groups } = groupBrokerFills([fill('1', 1, 2), fill('2', 2, 3), fill('2', 2, 3), fill('3', 1, 5)], new Set(['3']));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].qty, 3);
    assert.equal(groups[0].value, 8);
    assert.equal(groups[0].fills.length, 2);
});
test('requires exact contract and computes gross option close P&L', () => {
    const position = { ticker: 'AAPL PUT', position_type: 'option', strike_price: '200.00', expiration_date: '2026-10-16', contracts: 3, premium_received: '900.00' };
    assert.ok(matchesBrokerSecurity(position, parseBrokerSecurity('AAPL261016P200000')));
    const { groups } = groupBrokerFills([fill('1', 1, 1, { side: 1 }), fill('2', 2, 2, { side: 1 })]);
    assert.equal(closingValues(position, groups[0]).realized_pnl, 400);
    assert.equal(closingValues({ ...position, contracts: 4 }, groups[0]), null);
});
test('stock close uses actual execution proceeds and cost basis', () => {
    assert.equal(closingValues({ position_type: 'stock', shares: 10, cost_basis: 100 }, { qty: 10, value: 1100, lastTime: '2026-10-09 11:00:00' }).realized_pnl, 100);
});
test('corrected executions stop sync and unsupported short stocks are skipped', () => {
    assert.throws(() => groupBrokerFills([fill('1', 1, 2, { status: 2 })]), /corrected/);
    const result = groupBrokerFills([fill('1', 1, 2, { code: 'AAPL', side: 3 })]);
    assert.equal(result.groups.length, 0);
    assert.equal(result.warnings.length, 1);
});
