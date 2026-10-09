export const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function parseBrokerSecurity(code) {
    const symbol = String(code || '').replace(/^US\./, '').toUpperCase();
    const option = symbol.match(/^([A-Z]+)(\d{6})([PC])(\d+)$/);
    if (option) {
        if (option[3] !== 'P') return null;
        const expiry = `20${option[2].slice(0, 2)}-${option[2].slice(2, 4)}-${option[2].slice(4, 6)}`;
        const date = new Date(`${expiry}T12:00:00Z`);
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expiry) return null;
        return { ticker: option[1], position_type: 'option', strike_price: Number(option[4]) / 1000, expiration_date: expiry };
    }
    if (/^[A-Z][A-Z.]{0,19}$/.test(symbol)) return { ticker: symbol, position_type: 'stock' };
    return null;
}

export function groupBrokerFills(fills, consumed = new Set()) {
    const groups = new Map();
    const seen = new Set();
    const warnings = [];
    for (const fill of fills) {
        const id = String(fill.fillId || '');
        if (fill.status !== 0) throw new Error(`Broker execution ${id} was corrected or cancelled; review manually before syncing`);
        if (!id || consumed.has(id) || seen.has(id)) continue;
        seen.add(id);
        const security = parseBrokerSecurity(fill.code);
        if (!security || ![1, 2, 3, 4].includes(fill.side) || !Number.isInteger(fill.qty) || fill.qty <= 0 || !Number.isFinite(fill.price) || fill.price < 0 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(fill.time || '')) {
            warnings.push(`Unsupported execution ${fill.code || id}; review manually`);
            continue;
        }
        const buy = [1, 4].includes(fill.side);
        const opening = security.position_type === 'stock' ? buy : !buy;
        if (security.position_type === 'stock' && [3, 4].includes(fill.side)) {
            warnings.push(`Short stock execution ${fill.code} requires manual review`);
            continue;
        }
        const key = `${fill.code}:${opening ? 'open' : 'close'}:${opening ? fill.orderId : ''}`;
        if (!groups.has(key)) groups.set(key, { security, opening, qty: 0, value: 0, fills: [], firstTime: fill.time, lastTime: fill.time });
        const group = groups.get(key);
        group.qty += fill.qty;
        group.value += fill.qty * fill.price;
        group.fills.push(fill);
        if (fill.time < group.firstTime) group.firstTime = fill.time;
        if (fill.time > group.lastTime) group.lastTime = fill.time;
    }
    return { groups: [...groups.values()].sort((a, b) => a.firstTime.localeCompare(b.firstTime)), warnings };
}

export function matchesBrokerSecurity(position, security) {
    const ticker = position.ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').toUpperCase();
    if (ticker !== security.ticker || position.position_type !== security.position_type) return false;
    if (security.position_type === 'stock') return true;
    const expiry = position.expiration_date instanceof Date ? position.expiration_date.toISOString().slice(0, 10) : String(position.expiration_date).slice(0, 10);
    return Number(position.strike_price) === security.strike_price && expiry === security.expiration_date;
}

export function closingValues(position, group) {
    const quantity = Number(position.position_type === 'stock' ? position.shares : position.contracts);
    if (quantity !== group.qty) return null;
    const closePrice = group.value / group.qty;
    const pnl = position.position_type === 'stock'
        ? group.value - Number(position.cost_basis) * quantity
        : Number(position.premium_received) - group.value * 100;
    return { status: 'RESOLVED', resolution_type: position.position_type === 'stock' ? 'sold' : 'bought_to_close', close_premium: roundMoney(closePrice), close_date: group.lastTime.slice(0, 10), realized_pnl: roundMoney(pnl) };
}
