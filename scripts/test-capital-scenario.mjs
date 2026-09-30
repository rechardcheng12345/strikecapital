// Capital-add scenario test — run ONLY against the local staging server (npm run server:staging, port 3100)
// after `npm run db:clone-staging` and setting every staging user's password to test123.
// Drives the real API through capital adds (existing investor, new investor, second add the same day),
// winning / losing trades, a roll and an assignment, then undoes every add. After each step it checks every
// investor's realized / unrealized / return % against economic rules, not against the code's own formulas.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const BASE = process.env.STAGING_API || 'http://localhost:3100/api';
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error('Refusing to run against a non-local server');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envS = dotenv.parse(fs.readFileSync(path.join(root, '.env.staging')));
if (!/^(localhost|127\.0\.0\.1)$/.test(envS.DB_HOST)) throw new Error('.env.staging must point at a local DB');
const sql = await mysql.createConnection({ host: envS.DB_HOST, port: +envS.DB_PORT, user: envS.DB_USER, password: envS.DB_PASSWORD, database: envS.DB_NAME });

const PW = 'test123';
const TOL = 0.05;
const users = {}; // id → { name, token }

async function login(id, email, name) {
    const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
    const j = await r.json();
    if (!j.token) throw new Error(`Login failed for ${email} — reset staging passwords to ${PW}`);
    users[id] = { name, token: j.token };
}
const [dbUsers] = await sql.query('SELECT id, email, full_name FROM users ORDER BY id');
for (const u of dbUsers) await login(u.id, u.email, u.full_name);
const ADMIN = dbUsers.find((u) => u.email === 'admin@strikecapital.com')?.id ?? dbUsers[0].id;

async function call(method, p, body, uid = ADMIN) {
    const r = await fetch(BASE + p, {
        method, headers: { 'content-type': 'application/json', authorization: `Bearer ${users[uid].token}` },
        body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`);
    return j;
}
async function refused(fn) {
    try {
        await fn();
        return false;
    } catch (e) {
        return /→ 400/.test(e.message);
    }
}

const r2 = (n) => Math.round(n * 100) / 100;
let failures = 0, passes = 0;
function check(label, actual, expected, tol = TOL) {
    const ok = Math.abs(actual - expected) <= tol;
    if (ok) passes++; else failures++;
    if (!ok || process.env.VERBOSE) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${r2(actual)}, expected ${r2(expected)}`);
}
const name = (id) => users[id].name;
const ids = () => Object.keys(users).map(Number);

/** Current ownership % per user (open ownership periods). */
async function ownership() {
    const [rows] = await sql.query('SELECT user_id, ownership_pct FROM ownership_periods WHERE end_on IS NULL');
    return Object.fromEntries(rows.map((r) => [r.user_id, parseFloat(r.ownership_pct)]));
}

async function snap(label) {
    const inv = {};
    for (const id of ids()) {
        const d = await call('GET', '/investor/dashboard', null, id);
        const hist = await call('GET', '/investor/pnl', null, id);
        inv[id] = { invested: d.allocation.allocation_amount, realized: d.total_pnl_share, unrealized: d.unrealized_pnl_share, ret: d.total_return_pct, pnlPage: hist.total_pnl_share };
    }
    const a = await call('GET', '/admin/dashboard/stats');
    const s = { label, inv, fund: { capital: a.total_capital, realized: a.total_realized_pnl, unrealized: a.total_unrealized_pnl, ret: a.total_return_pct } };
    console.log(`\n=== ${label}`);
    console.log(`  fund: capital ${s.fund.capital} | realized ${s.fund.realized} | unrealized ${s.fund.unrealized} | return since last add ${s.fund.ret}%`);
    const pct = await ownership();
    console.table(Object.fromEntries(ids().map((id) => [name(id), { 'own %': pct[id] ?? 0, invested: inv[id].invested, realized: inv[id].realized, unrealized: inv[id].unrealized, 'return %': inv[id].ret }])));
    // Always-true rules
    const sum = (k) => ids().reduce((t, id) => t + (inv[id][k] || 0), 0);
    check('Σ investor realized = fund realized', sum('realized'), s.fund.realized, 0.6);
    check('Σ investor unrealized = fund unrealized', sum('unrealized'), s.fund.unrealized, 0.6);
    check('Σ invested = fund capital', sum('invested'), s.fund.capital, 0.01);
    for (const id of ids()) {
        const v = inv[id];
        check(`${name(id)} P&L page = dashboard realized`, v.pnlPage, v.realized, 0.05);
        if (v.invested > 0) check(`${name(id)} return% = (realized+unrealized)/invested`, v.ret, ((v.realized + v.unrealized) / v.invested) * 100, 0.01);
    }
    return s;
}
function sameMoney(before, after, what) {
    for (const id of ids()) {
        const b = before.inv[id] || { realized: 0, unrealized: 0 };
        check(`${name(id)} realized unchanged (${what})`, after.inv[id].realized, b.realized);
        check(`${name(id)} unrealized unchanged (${what})`, after.inv[id].unrealized, b.unrealized);
    }
}
function splitBy(before, after, field, amount, pct, what) {
    for (const id of ids()) {
        const b = before.inv[id]?.[field] || 0;
        check(`${name(id)} ${field} +${r2(amount)}×${pct[id] ?? 0}% (${what})`, after.inv[id][field] - b, amount * (pct[id] || 0) / 100);
    }
}
function sameTotal(before, after, what) {
    for (const id of ids()) {
        check(`${name(id)} realized+unrealized unchanged (${what})`, after.inv[id].realized + after.inv[id].unrealized, before.inv[id].realized + before.inv[id].unrealized);
    }
}
const step = (t) => console.log(`\n────────── ${t}`);
const today = new Date().toISOString().slice(0, 10);
const openOpts = (await call('GET', '/positions?status=OPEN&limit=100')).positions.filter((p) => p.position_type === 'option' && p.current_price != null);
if (openOpts.length < 2) throw new Error('Need at least 2 open, priced option positions in staging');
const [P1, P2] = openOpts;
const fees = (p) => (parseFloat(p.commission) || 0) + (parseFloat(p.platform_fee) || 0);
const [dbInvestors] = await sql.query("SELECT u.id FROM users u JOIN investor_allocations a ON a.user_id = u.id AND a.is_active = 1 WHERE a.invested_amount > 0 ORDER BY a.invested_amount ASC, u.id ASC");
const [EDDIE, YING] = [dbInvestors[0].id, dbInvestors[1].id];

// ── 0. Baseline
const S0 = await snap('S0 baseline (copy of live)');

// ── 1. Add funds for an existing investor
step(`1. Add $2,000 for ${name(EDDIE)}`);
check('add dated before the latest movement is refused', (await refused(() => call('POST', `/admin/investors/${EDDIE}/capital`, { amount: 2000, moved_on: '2026-01-01' }))) ? 1 : 0, 1, 0);
const add1 = await call('POST', `/admin/investors/${EDDIE}/capital`, { amount: 2000, moved_on: today, note: 'staging test 1' });
console.log(`  NAV before ${add1.nav_before}, ${add1.open_positions_snapshotted} open positions snapshotted`);
const S1 = await snap('S1 after add #1');
sameMoney(S0, S1, 'add #1');
check(`${name(EDDIE)} invested +2000`, S1.inv[EDDIE].invested, S0.inv[EDDIE].invested + 2000);
check('fund capital +2000', S1.fund.capital, S0.fund.capital + 2000);
check('return since add = 0 right after the add', S1.fund.ret, 0, 0);
const pct1 = await ownership();

// ── 2. Price moves after the add, then buy to close
step(`2. #${P1.id} ${P1.ticker}: price drops 0.50, then bought to close`);
const px1 = r2(Math.max(0.05, parseFloat(P1.current_price) - 0.5));
const d1 = (parseFloat(P1.current_price) - px1) * P1.contracts * 100;
await call('PUT', `/positions/${P1.id}`, { current_price: px1 });
const S2 = await snap(`S2 #${P1.id} price → ${px1}`);
splitBy(S1, S2, 'unrealized', d1, pct1, 'gain after add #1');
const gross1 = r2(parseFloat(P1.premium_received) - px1 * P1.contracts * 100);
await call('POST', `/positions/${P1.id}/resolve`, { resolution_type: 'bought_to_close', close_premium: px1, realized_pnl: gross1 });
const S3 = await snap(`S3 #${P1.id} closed, net ${r2(gross1 - fees(P1))}`);
sameTotal(S2, S3, 'close');
check('fund realized +net', S3.fund.realized - S2.fund.realized, gross1 - fees(P1));

// ── 3. Brand-new investor joins with starting capital
step('3. New investor joins with $1,500');
const newInv = await call('POST', '/admin/investors', { email: `staging.test.${Date.now()}@example.com`, password: PW, full_name: 'New Investor (test)', allocation_amount: 1500 });
await login(newInv.user.id, newInv.user.email, 'New Investor');
const NEW = newInv.user.id;
const S4 = await snap('S4 after new investor');
sameMoney(S3, S4, 'new investor');
check('new investor invested 1500', S4.inv[NEW].invested, 1500);
check('new investor realized 0 (earned nothing yet)', S4.inv[NEW].realized, 0);
check('new investor unrealized 0', S4.inv[NEW].unrealized, 0);

// ── 4. Second add for another investor, same day
step(`4. Add $1,000 for ${name(YING)} (same day)`);
await call('POST', `/admin/investors/${YING}/capital`, { amount: 1000, moved_on: today, note: 'staging test 3' });
const S5 = await snap('S5 after add #3');
sameMoney(S4, S5, 'add #3');
const pct3 = await ownership();
check('ownership sums to 100%', Object.values(pct3).reduce((a, b) => a + b, 0), 100, 0.05);

// ── 5. Winning trade opened and closed after all adds
step('5. Winning trade: sell put $300, expires worthless');
const win = await call('POST', '/positions', { ticker: 'TESTW', strike_price: 50, premium_received: 300, contracts: 1, expiration_date: '2026-11-20', commission: 1.5, platform_fee: 1 });
await call('PUT', `/positions/${win.id}`, { current_price: 1.2 });
const S6 = await snap('S6 TESTW open, px 1.20');
splitBy(S5, S6, 'unrealized', 300 - 2.5 - 120, pct3, 'new trade');
await call('POST', `/positions/${win.id}/resolve`, { resolution_type: 'expired_worthless', realized_pnl: 300 });
const S7 = await snap('S7 TESTW expired');
splitBy(S6, S7, 'realized', 297.5, pct3, 'win');

// ── 6. Losing trade
step('6. Losing trade: sell put $200, bought back at $5.00');
const loss = await call('POST', '/positions', { ticker: 'TESTL', strike_price: 40, premium_received: 200, contracts: 1, expiration_date: '2026-11-20', commission: 1, platform_fee: 1 });
await call('POST', `/positions/${loss.id}/resolve`, { resolution_type: 'bought_to_close', close_premium: 5, realized_pnl: -300 });
const S8 = await snap('S8 TESTL closed at a loss (net -302)');
splitBy(S7, S8, 'realized', -302, pct3, 'loss');
check('new investor shares the loss', S8.inv[NEW].realized - S7.inv[NEW].realized < 0 ? 1 : 0, 1, 0);

// ── 7. Roll the other position
step(`7. Roll #${P2.id} ${P2.ticker} at ${P2.current_price}`);
check('roll without buy-back price is refused', (await refused(() => call('POST', `/positions/${P2.id}/roll`, { strike_price: parseFloat(P2.strike_price), premium_received: 400, expiration_date: '2026-12-18' }))) ? 1 : 0, 1, 0);
const legPnl = parseFloat(P2.premium_received) - fees(P2) - parseFloat(P2.current_price) * P2.contracts * 100;
const rolled = await call('POST', `/positions/${P2.id}/roll`, { close_premium: parseFloat(P2.current_price), strike_price: parseFloat(P2.strike_price), premium_received: 400, expiration_date: '2026-12-18' });
await call('PUT', `/positions/${rolled.new_position.id}`, { current_price: 4.0 });
const S9 = await snap(`S9 rolled → #${rolled.new_position.id} (old leg ${r2(legPnl)})`);
check('fund realized + old leg P&L', S9.fund.realized - S8.fund.realized, legPnl);
sameTotal(S8, S9, 'roll');

// ── 8. Assignment
step('8. Put assigned: premium $150 kept, 100 shares at $20, stock then at $19');
const asg = await call('POST', '/positions', { ticker: 'TESTA', strike_price: 20, premium_received: 150, contracts: 1, expiration_date: '2026-10-16' });
const res = await call('POST', `/positions/${asg.id}/resolve`, { resolution_type: 'assigned', realized_pnl: 150 });
const S10 = await snap('S10 TESTA assigned');
splitBy(S9, S10, 'realized', 150, pct3, 'assigned premium');
await call('PUT', `/positions/${res.stock_position.id}`, { current_price: 19 });
const S11 = await snap('S11 TESTA stock at $19');
splitBy(S10, S11, 'unrealized', -100, pct3, 'stock down $1');

// ── 9. Undo every add, newest first
step('9. Undo all three adds');
for (let i = 0; i < 3; i++) await call('POST', '/admin/capital/undo-last');
const S12 = await snap('S12 after undoing all adds');
check('fund capital back to baseline', S12.fund.capital, S0.fund.capital);
for (const id of Object.keys(S0.inv)) check(`${name(id)} invested back`, S12.inv[id].invested, S0.inv[id].invested);
check('new investor has no allocation', S12.inv[NEW].invested, 0);
check('4th undo refused (only pre-undo adds left)', (await refused(() => call('POST', '/admin/capital/undo-last'))) ? 1 : 0, 1, 0);

await sql.end();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
