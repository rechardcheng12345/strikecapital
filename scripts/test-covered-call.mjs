// Covered-call scenario — run ONLY against the local staging server (npm run server:staging, port 3100)
// after `npm run db:migrate:staging` and setting the staging admin's password to test123.
// Drives the real API: open a call on held shares, refuse uncovered calls and selling covered shares,
// call away the whole position and part of a larger one, and roll a call. Test rows use ticker QZZCC and are removed.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';

const BASE = process.env.STAGING_API || 'http://localhost:3100/api';
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error('Refusing to run against a non-local server');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envS = dotenv.parse(fs.readFileSync(path.join(root, '.env.staging')));
if (!/^(localhost|127\.0\.0\.1)$/.test(envS.DB_HOST) || !/staging/.test(envS.DB_NAME)) throw new Error('.env.staging must point at a local staging DB');
const sql = await mysql.createConnection({ host: envS.DB_HOST, port: +envS.DB_PORT, user: envS.DB_USER, password: envS.DB_PASSWORD, database: envS.DB_NAME });
const T = 'QZZCC';

const [[admin]] = await sql.query("SELECT email FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
const auth = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'test123' }) }).then((r) => r.json());
if (!auth.token) throw new Error('Admin login failed — reset staging passwords to test123');

async function call(method, p, body) {
    const r = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j };
}
const ok = async (...a) => {
    const r = await call(...a);
    if (r.status >= 400) throw new Error(`${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
};
const row = async (id) => (await sql.query('SELECT * FROM positions WHERE id = ?', [id]))[0][0];
const expiry = '2026-12-18';

async function cleanup() {
    const [ids] = await sql.query('SELECT id FROM positions WHERE ticker LIKE ?', [`${T}%`]);
    if (!ids.length) return;
    const list = ids.map((r) => r.id);
    await sql.query('DELETE FROM pnl_records WHERE position_id IN (?)', [list]);
    await sql.query('UPDATE positions SET covers_position_id = NULL, assigned_to_id = NULL, assigned_from_id = NULL, rolled_to_id = NULL, rolled_from_id = NULL WHERE id IN (?)', [list]);
    await sql.query('DELETE FROM positions WHERE id IN (?)', [list]);
}

try {
    await cleanup();
    // 1. Shares, then a call written on them: no cash set aside, linked to the shares
    const stock = await ok('POST', '/positions', { ticker: T, position_type: 'stock', strike_price: 50, premium_received: 0, shares: 100, cost_basis: 50 });
    const callA = await ok('POST', '/positions', { ticker: T, position_type: 'option', option_type: 'call', strike_price: 55, premium_received: 120, contracts: 1, expiration_date: expiry });
    assert.equal(callA.option_type, 'call');
    assert.equal(callA.covers_position_id, stock.id);
    assert.equal(Number(callA.collateral), 0);
    assert.equal(Number(callA.break_even), 56.2);

    // 2. No second call on the same 100 shares; shares under an open call cannot be sold
    assert.equal((await call('POST', '/positions', { ticker: T, position_type: 'option', option_type: 'call', strike_price: 60, premium_received: 80, contracts: 1, expiration_date: expiry })).status, 400);
    assert.equal((await call('POST', `/positions/${stock.id}/resolve`, { resolution_type: 'sold', realized_pnl: 0 })).status, 400);
    assert.equal((await call('DELETE', `/positions/${stock.id}`)).status, 400);

    // 3. Roll the call: the new call keeps the same cover, the old one realizes premium − buyback
    const rolled = await ok('POST', `/positions/${callA.id}/roll`, { close_premium: 0.5, strike_price: 57, premium_received: 150, expiration_date: '2027-01-15' });
    const callB = rolled.new_position;
    assert.equal(callB.option_type, 'call');
    assert.equal(callB.covers_position_id, stock.id);
    assert.equal(Number(callB.collateral), 0);
    assert.equal(rolled.realized_pnl, 70);

    // 4. Called away: call keeps its premium, all 100 shares sold at $57 → +$700 on the shares
    const res = await ok('POST', `/positions/${callB.id}/resolve`, { resolution_type: 'assigned', realized_pnl: 150 });
    assert.equal(res.position.resolution_type, 'called_away');
    assert.equal(res.stock_position, null);
    const sold = await row(stock.id);
    assert.equal(sold.status, 'RESOLVED');
    assert.equal(sold.resolution_type, 'called_away');
    assert.equal(Number(sold.realized_pnl), 700);
    assert.equal((await row(callB.id)).assigned_to_id, stock.id);
    const [[pnl]] = await sql.query('SELECT SUM(pnl_amount) s FROM pnl_records WHERE position_id = ?', [stock.id]);
    assert.equal(Number(pnl.s), 700);

    // 5. Partial: 200 shares, one call → 100 split off and sold, 100 stay open (cost basis $50, strike $45 → −$500)
    const big = await ok('POST', '/positions', { ticker: T, position_type: 'stock', strike_price: 50, premium_received: 0, shares: 200, cost_basis: 50 });
    const callC = await ok('POST', '/positions', { ticker: T, position_type: 'option', option_type: 'call', strike_price: 45, premium_received: 300, contracts: 1, expiration_date: expiry });
    assert.equal(callC.covers_position_id, big.id);
    const part = await ok('POST', `/positions/${callC.id}/resolve`, { resolution_type: 'called_away', realized_pnl: 300 });
    const left = await row(big.id);
    assert.equal(left.status, 'OPEN');
    assert.equal(left.shares, 100);
    assert.equal(Number(left.collateral), 5000);
    assert.equal(part.called_away.shares, 100);
    assert.equal(Number(part.called_away.realized_pnl), -500);
    assert.equal(part.called_away.resolution_type, 'called_away');

    // 6. Not covered by any shares → refused; a put can't be "called away"
    assert.equal((await call('POST', '/positions', { ticker: 'QZZNONE', position_type: 'option', option_type: 'call', strike_price: 10, premium_received: 20, contracts: 1, expiration_date: expiry })).status, 400);
    const put = await ok('POST', '/positions', { ticker: T, position_type: 'option', strike_price: 40, premium_received: 100, contracts: 1, expiration_date: expiry });
    assert.equal(put.option_type, 'put');
    assert.equal(Number(put.collateral), 4000);
    assert.equal((await call('POST', `/positions/${put.id}/resolve`, { resolution_type: 'called_away', realized_pnl: 100 })).status, 400);

    console.log('Covered call scenario passed: open on held shares, no double cover, shares locked while covered, roll, called away (whole and partial), uncovered refused, put unaffected.');
} finally {
    await cleanup();
    await sql.end();
}
