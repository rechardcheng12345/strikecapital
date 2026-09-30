// Capital-add scenario test — run ONLY against the local staging server (NODE_ENV=staging, port 3100).
// Drives the real API: add capital → move prices → close positions → roll → undo, and after every step
// checks each investor's realized / unrealized / return % against economic invariants.
const BASE = process.env.STAGING_API || 'http://localhost:3100/api';
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error('Refusing to run against a non-local server');
const PW = 'test123';
const USERS = { 1: 'admin@strikecapital.com', 2: 'eddie88ncd@gmail.com', 3: 'rechard_c@hotmail.com', 4: 'yingxi48@gmail.com', 5: 'view@gmail.com' };
const NAMES = { 1: 'Alan', 2: 'Eddie', 3: 'Zhe', 4: 'Ying Shi', 5: 'Viewer' };
const CONTRIBUTOR = 2, AMOUNT = 2000;
const TOL = 0.05; // cents of rounding across 5 investors

const tokens = {};
async function call(method, path, body, uid = 1) {
    const r = await fetch(BASE + path, {
        method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[uid]}` },
        body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
    return j;
}
for (const [id, email] of Object.entries(USERS)) {
    const r = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
    tokens[id] = (await r.json()).token;
}

const r2 = (n) => Math.round(n * 100) / 100;
let failures = 0;
function check(label, actual, expected, tol = TOL) {
    const ok = Math.abs(actual - expected) <= tol;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${r2(actual)}, expected ${r2(expected)}`);
}

async function snap(label) {
    const inv = {};
    for (const id of Object.keys(USERS)) {
        const d = await call('GET', '/investor/dashboard', null, id);
        const hist = await call('GET', '/investor/pnl', null, id);
        inv[id] = { invested: d.allocation.allocation_amount, pct: d.allocation.allocation_pct, realized: d.total_pnl_share, unrealized: d.unrealized_pnl_share, ret: d.total_return_pct, pnlPage: hist.total_pnl_share };
    }
    const a = await call('GET', '/admin/dashboard/stats');
    const s = { label, inv, fund: { capital: a.total_capital, realized: a.total_realized_pnl, unrealized: a.total_unrealized_pnl, ret: a.total_return_pct } };
    console.log(`\n=== ${label}`);
    console.log(`  fund: capital ${s.fund.capital}  realized ${s.fund.realized}  unrealized ${s.fund.unrealized}  admin return% ${s.fund.ret}`);
    console.table(Object.fromEntries(Object.entries(inv).map(([id, v]) => [NAMES[id], v])));
    return s;
}
const sum = (s, k) => Object.values(s.inv).reduce((t, v) => t + (v[k] || 0), 0);
function conservation(s) {
    check('Σ investor realized = fund realized', sum(s, 'realized'), s.fund.realized, 0.5);
    check('Σ investor unrealized = fund unrealized', sum(s, 'unrealized'), s.fund.unrealized, 0.5);
    for (const [id, v] of Object.entries(s.inv)) {
        check(`${NAMES[id]} P&L page total = dashboard realized`, v.pnlPage, v.realized, 0.05);
        if (v.invested > 0) check(`${NAMES[id]} return% = (realized+unrealized)/invested`, v.ret, ((v.realized + v.unrealized) / v.invested) * 100, 0.01);
    }
}

const today = new Date().toISOString().slice(0, 10);
const open = (await call('GET', '/positions?status=OPEN&limit=100')).positions.filter((p) => p.position_type === 'option');
if (open.length < 2) throw new Error('Need at least 2 open option positions in staging');
const [P1, P2] = open;
console.log(`Open positions used: #${P1.id} ${P1.ticker} x${P1.contracts} prem ${P1.premium_received} px ${P1.current_price} | #${P2.id} ${P2.ticker} x${P2.contracts} prem ${P2.premium_received} px ${P2.current_price}`);

// ── Step 0: baseline
const S0 = await snap('S0 baseline (live data copy)');
conservation(S0);

// ── Step 1: add capital (a date before the latest movement must be refused)
let refused = false;
try {
    await call('POST', `/admin/investors/${CONTRIBUTOR}/capital`, { amount: AMOUNT, moved_on: '2026-01-01' });
} catch (e) {
    refused = /400/.test(e.message);
}
check('add dated before the latest movement is refused', refused ? 1 : 0, 1, 0);
const add = await call('POST', `/admin/investors/${CONTRIBUTOR}/capital`, { amount: AMOUNT, moved_on: today, note: 'staging test' });
const newPct = Object.fromEntries(add.ownership.map((o) => [o.userId, o.ownershipPct]));
console.log(`\nAdded $${AMOUNT} for ${NAMES[CONTRIBUTOR]} — NAV before ${add.nav_before}, snapshotted ${add.open_positions_snapshotted} open positions`);
console.log('  new ownership %:', Object.fromEntries(add.ownership.map((o) => [NAMES[o.userId], o.ownershipPct])));
const S1 = await snap('S1 after capital add');
console.log('  Rule: adding money must not change anyone\'s $ P&L — only invested and %');
for (const id of Object.keys(USERS)) {
    check(`${NAMES[id]} realized unchanged`, S1.inv[id].realized, S0.inv[id].realized);
    check(`${NAMES[id]} unrealized unchanged`, S1.inv[id].unrealized, S0.inv[id].unrealized);
    check(`${NAMES[id]} invested`, S1.inv[id].invested, S0.inv[id].invested + (+id === CONTRIBUTOR ? AMOUNT : 0));
}
check('fund capital +amount', S1.fund.capital, S0.fund.capital + AMOUNT);
check('ownership % sums to 100', Object.values(newPct).reduce((a, b) => a + b, 0), 100, 0.05);
conservation(S1);

// ── Step 2: price move after the add (short put: price down = gain)
const px1 = r2(Math.max(0.05, parseFloat(P1.current_price) - 0.5));
const d1 = (parseFloat(P1.current_price) - px1) * P1.contracts * 100;
await call('PUT', `/positions/${P1.id}`, { current_price: px1 });
const S2 = await snap(`S2 #${P1.id} price ${P1.current_price} → ${px1} (fund gain ${r2(d1)})`);
console.log('  Rule: gain earned after the add is split by NEW ownership %');
for (const id of Object.keys(USERS)) {
    check(`${NAMES[id]} unrealized +Δ×newPct`, S2.inv[id].unrealized - S1.inv[id].unrealized, d1 * (newPct[id] || 0) / 100);
}
conservation(S2);

// ── Step 3: buy to close P1 at the new price
const fees1 = (parseFloat(P1.commission) || 0) + (parseFloat(P1.platform_fee) || 0);
const gross1 = r2(parseFloat(P1.premium_received) - px1 * P1.contracts * 100);
await call('POST', `/positions/${P1.id}/resolve`, { resolution_type: 'bought_to_close', close_premium: px1, realized_pnl: gross1 });
const S3 = await snap(`S3 #${P1.id} bought to close (gross ${gross1}, net ${r2(gross1 - fees1)})`);
console.log('  Rule: closing converts unrealized → realized 1:1 for every investor (no value created or lost)');
for (const id of Object.keys(USERS)) {
    check(`${NAMES[id]} realized+unrealized unchanged`, S3.inv[id].realized + S3.inv[id].unrealized, S2.inv[id].realized + S2.inv[id].unrealized);
}
check('fund realized +net', S3.fund.realized - S2.fund.realized, gross1 - fees1);
conservation(S3);

// ── Step 4: new trade opened and closed entirely after the add
const created = await call('POST', '/positions', { ticker: 'TEST', strike_price: 50, premium_received: 300, contracts: 1, expiration_date: '2026-11-20', commission: 1.5, platform_fee: 1 });
await call('PUT', `/positions/${created.id}`, { current_price: 1.2 });
const S4 = await snap(`S4 opened TEST #${created.id} prem 300, px 1.20 (unrealized ${300 - 2.5 - 120})`);
for (const id of Object.keys(USERS)) {
    check(`${NAMES[id]} unrealized +177.5×newPct`, S4.inv[id].unrealized - S3.inv[id].unrealized, 177.5 * (newPct[id] || 0) / 100);
}
await call('POST', `/positions/${created.id}/resolve`, { resolution_type: 'expired_worthless', realized_pnl: 300 });
const S5 = await snap('S5 TEST expired worthless (net 297.50)');
console.log('  Rule: profit from a trade opened after the add is split entirely by NEW ownership %');
for (const id of Object.keys(USERS)) {
    check(`${NAMES[id]} realized +297.5×newPct`, S5.inv[id].realized - S4.inv[id].realized, 297.5 * (newPct[id] || 0) / 100);
}
conservation(S5);

// ── Step 5: roll P2 (buy back at current price, sell a new put for 400)
const fees2 = (parseFloat(P2.commission) || 0) + (parseFloat(P2.platform_fee) || 0);
const rollGain = parseFloat(P2.premium_received) - fees2 - parseFloat(P2.current_price) * P2.contracts * 100;
const rolled = await call('POST', `/positions/${P2.id}/roll`, { close_premium: parseFloat(P2.current_price), strike_price: parseFloat(P2.strike_price), premium_received: 400, expiration_date: '2026-12-18' });
await call('PUT', `/positions/${rolled.new_position.id}`, { current_price: 4.0 });
const S6 = await snap(`S6 rolled #${P2.id} → #${rolled.new_position.id} (old leg P&L at current price ${r2(rollGain)}; new leg prem 400 px 4.00)`);
console.log('  Rule: the closed leg of a roll should become realized P&L');
check('fund realized + old leg P&L', S6.fund.realized - S5.fund.realized, rollGain);
for (const id of Object.keys(USERS)) {
    check(`${NAMES[id]} realized+unrealized unchanged by roll`, S6.inv[id].realized + S6.inv[id].unrealized, S5.inv[id].realized + S5.inv[id].unrealized);
}
conservation(S6);

// ── Step 6: undo the add (now that trades happened on top of it)
const undone = await call('POST', '/admin/capital/undo-last');
const S7 = await snap(`S7 undo capital add #${undone.undone.id}`);
check('fund capital back to baseline', S7.fund.capital, S0.fund.capital);
check(`${NAMES[CONTRIBUTOR]} invested back`, S7.inv[CONTRIBUTOR].invested, S0.inv[CONTRIBUTOR].invested);
conservation(S7);

console.log(`\n${failures ? `${failures} FAILED check(s)` : 'All checks passed'}`);
process.exit(failures ? 1 : 0);
