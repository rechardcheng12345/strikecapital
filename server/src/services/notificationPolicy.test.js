import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedEvents, wantsEvent, parseEvents, summaryPeriod, publishNtfy } from './notificationPolicy.js';

test('investors cannot subscribe to admin-only research events', () => {
    assert.ok(!allowedEvents('investor').some((e) => e.value === 'simulation_result'));
    assert.equal(wantsEvent({ enabled: 1, events: '["simulation_result"]' }, 'investor', 'simulation_result'), false);
    assert.equal(wantsEvent({ enabled: 1, events: '["backtest_result"]' }, 'investor', 'backtest_result'), false);
    assert.equal(wantsEvent({ enabled: 1, events: '["simulation_result"]' }, 'admin', 'simulation_result'), true);
});
test('delivery requires opt-in and a selected event', () => {
    assert.equal(wantsEvent(null, 'admin', 'position_opened'), false);
    assert.equal(wantsEvent({ enabled: false, events: ['position_opened'] }, 'admin', 'position_opened'), false);
    assert.equal(wantsEvent({ enabled: true, events: [] }, 'admin', 'position_opened'), false);
    assert.equal(wantsEvent({ enabled: true, events: ['position_opened'] }, 'investor', 'position_opened'), true);
    assert.equal(wantsEvent({ enabled: true, events: ['unknown'] }, 'admin', 'unknown'), false);
});
test('preferences accept MySQL JSON arrays or strings, and tolerate corrupt data', () => {
    assert.deepEqual(parseEvents('["account_summary"]'), ['account_summary']);
    assert.deepEqual(parseEvents(['account_summary']), ['account_summary']);
    assert.deepEqual(parseEvents('invalid'), []);
    assert.deepEqual(parseEvents('null'), []);
    assert.deepEqual(parseEvents('{"event":"account_summary"}'), []);
});
test('weekly summaries wait until Friday 17:00 New York in daylight saving time', () => {
    assert.equal(summaryPeriod('weekly', new Date('2026-10-09T20:59:00Z')), null);
    assert.equal(summaryPeriod('weekly', new Date('2026-10-09T21:00:00Z')), 'weekly:2026-10-09');
    assert.equal(summaryPeriod('weekly', new Date('2026-10-08T22:00:00Z')), null);
    assert.equal(summaryPeriod('weekly', new Date('2026-10-10T22:00:00Z')), null);
});
test('weekly summaries use New York date and follow winter time', () => {
    assert.equal(summaryPeriod('weekly', new Date('2026-12-04T21:59:00Z')), null);
    assert.equal(summaryPeriod('weekly', new Date('2026-12-04T22:00:00Z')), 'weekly:2026-12-04');
    assert.equal(summaryPeriod('weekly', new Date('2026-10-10T02:00:00Z')), 'weekly:2026-10-09');
});
test('manual summaries never schedule; daily summaries skip weekends', () => {
    assert.equal(summaryPeriod('manual', new Date('2026-10-09T22:00:00Z')), null);
    assert.equal(summaryPeriod('daily', new Date('2026-10-08T22:00:00Z')), 'daily:2026-10-08');
    assert.equal(summaryPeriod('daily', new Date('2026-10-10T22:00:00Z')), null);
});
test('ntfy sends JSON with Unicode support and server-side bearer authentication', async () => {
    let request;
    await publishNtfy({ serverUrl: 'https://ntfy.example/', token: 'secret', topic: 'private-topic', title: 'Résumé', message: 'Summary ready', click: 'https://app.example/profile' }, async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200 };
    });
    assert.equal(request.url, 'https://ntfy.example');
    assert.equal(request.options.headers.Authorization, 'Bearer secret');
    assert.equal(request.options.redirect, 'error');
    assert.deepEqual(JSON.parse(request.options.body), { topic: 'private-topic', title: 'Résumé', message: 'Summary ready', click: 'https://app.example/profile' });
});
test('ntfy provider errors and network timeouts are surfaced for retry', async () => {
    const input = { serverUrl: 'https://ntfy.sh', topic: 'test-topic', title: 'Test', message: 'Ready' };
    await assert.rejects(publishNtfy(input, async () => ({ ok: false, status: 429 })), /HTTP 429/);
    await assert.rejects(publishNtfy(input, async () => { throw new Error('timeout'); }), /timeout/);
});
test('ntfy rate limiting honors Retry-After and otherwise waits an hour', async () => {
    const input = { serverUrl: 'https://ntfy.sh', topic: 'test-topic', title: 'Test', message: 'Ready' };
    await assert.rejects(publishNtfy(input, async () => ({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '3600' }) })), (error) => error.retryAfterMs === 3600000);
    await assert.rejects(publishNtfy(input, async () => ({ ok: false, status: 429 })), (error) => error.retryAfterMs === 3600000);
});
