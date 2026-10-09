import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { getTradeExecutions } from './moomooService.js';
import { groupBrokerFills, matchesBrokerSecurity, closingValues, roundMoney, parseBrokerSecurity } from './brokerTradePolicy.js';
import { calculateCollateral, calculateBreakEven, calculateMaxProfit, calculateStockCollateral } from './pnlEngine.js';
import { notifyAllInvestors } from './notificationEngine.js';

function newYorkDate() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function fetchExecutions(beginDate) {
    if (!env.scannerProxyUrl) return getTradeExecutions(beginDate);
    if (!env.scannerProxySecret) throw new Error('Set SCANNER_PROXY_SECRET to sync broker trades');
    const response = await fetch(`${env.scannerProxyUrl.replace(/\/$/, '')}/trade-executions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-proxy-secret': env.scannerProxySecret },
        body: JSON.stringify({ beginDate }), signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Broker execution endpoint returned ${response.status}; update the scanner proxy`);
    }
    const feed = await response.json();
    if (env.moomooAccountId && feed.accountId !== env.moomooAccountId) throw new Error('Proxy account does not match MOOMOO_ACCOUNT_ID on the platform');
    return feed;
}

// Dependency injection lets integration tests use an isolated database and synthetic fills.
export async function syncBrokerTrades(userId, { database = db, fetchTrades = fetchExecutions, notify = notifyAllInvestors, startDate = process.env.MOOMOO_SYNC_START_DATE } = {}) {
    const result = { added: 0, closed: 0, matched: 0, warnings: [] };
    try {
        let state = await database('broker_sync_state').where({ id: 'moomoo' }).first();
        if (!state) throw new Error('Apply the broker trade sync database migration');
        const beginDate = state.start_date || startDate || newYorkDate();
        const feed = await fetchTrades(beginDate);
        if (!/^\d+$/.test(feed?.accountId || '') || !Array.isArray(feed.fills) || !Array.isArray(feed.holdings)) throw new Error('Invalid broker execution response');
        if (state.account_id && state.account_id !== feed.accountId) throw new Error('Broker account changed; review sync configuration before importing');
        const events = [];
        await database.transaction(async trx => {
            state = await trx('broker_sync_state').where({ id: 'moomoo' }).forUpdate().first();
            if ((state.account_id && state.account_id !== feed.accountId) || (state.start_date && state.start_date !== beginDate)) throw new Error('Sync configuration changed; refresh again');
            const consumed = new Set((await trx('broker_synced_fills').where({ account_id: feed.accountId }).select('fill_id')).map(r => r.fill_id));
            const { groups, warnings } = groupBrokerFills(feed.fills.filter(f => String(f.time).slice(0, 10) >= beginDate), consumed);
            result.warnings.push(...warnings);
            let positions = await trx('positions').where({ status: 'OPEN' }).forUpdate();
            for (const group of groups) {
                const candidates = positions.filter(p => p.status === 'OPEN' && matchesBrokerSecurity(p, group.security));
                let position;
                let action;
                const brokerHoldings = feed.holdings.filter(h => {
                    const security = parseBrokerSecurity(h.code);
                    return security && matchesBrokerSecurity(security, group.security);
                });
                const brokerQuantity = brokerHoldings.reduce((sum, h) => sum + Math.abs(Number(h.qty)), 0);
                if (group.opening) {
                    if (candidates.length) {
                        const same = candidates.filter(p => {
                            const qty = Number(p.position_type === 'stock' ? p.shares : p.contracts);
                            const value = p.position_type === 'stock' ? Number(p.cost_basis) * qty : Number(p.premium_received) / 100;
                            const date = p.open_date instanceof Date ? p.open_date.toISOString().slice(0, 10) : String(p.open_date).slice(0, 10);
                            return qty === group.qty && Math.abs(value - group.value) < 0.01 && date === group.firstTime.slice(0, 10);
                        });
                        // Claim a manually entered trade once, never reuse it for another order.
                        if (same.length !== 1 || await trx('broker_synced_fills').where({ position_id: same[0]?.id, action: 'opened' }).first()) {
                            result.warnings.push(`${group.security.ticker}: opening trade overlaps an existing position; review manually`);
                            continue;
                        }
                        position = same[0]; action = 'opened'; result.matched++;
                    } else {
                        const expectedSide = group.security.position_type === 'stock' ? 0 : 1;
                        if (brokerQuantity !== group.qty || brokerHoldings.some(h => h.side !== expectedSide)) {
                            result.warnings.push(`${group.security.ticker}: opening fills do not match current broker holdings; review manually`);
                            continue;
                        }
                        const stock = group.security.position_type === 'stock';
                        const price = group.value / group.qty;
                        const premium = stock ? 0 : roundMoney(group.value * 100);
                        const fields = {
                            ...group.security, strike_price: stock ? roundMoney(price) : group.security.strike_price,
                            premium_received: premium, contracts: stock ? 0 : group.qty,
                            shares: stock ? group.qty : null, cost_basis: stock ? roundMoney(price) : null,
                            expiration_date: stock ? null : group.security.expiration_date,
                            open_date: group.firstTime.slice(0, 10), status: 'OPEN', created_by: userId,
                            commission: 0, platform_fee: 0,
                            collateral: stock ? calculateStockCollateral(group.qty, price) : calculateCollateral(group.security.strike_price, group.qty),
                            break_even: stock ? roundMoney(price) : calculateBreakEven(group.security.strike_price, premium, group.qty),
                            max_profit: stock ? 0 : calculateMaxProfit(premium),
                            notes: 'Imported from Moomoo executions. Broker fees are not supplied by the execution API; enter fees manually.',
                        };
                        const [id] = await trx('positions').insert(fields);
                        position = { ...fields, id }; positions.push(position); action = 'opened'; result.added++;
                        events.push({ type: 'position_opened', position, message: `${group.qty} ${stock ? 'share(s)' : 'contract(s)'} opened at $${price.toFixed(3)} through broker sync.` });
                    }
                } else {
                    if (candidates.length !== 1) {
                        result.warnings.push(`${group.security.ticker}: closing trade has ${candidates.length} matching open positions; review manually`);
                        continue;
                    }
                    position = candidates[0];
                    const openDate = position.open_date instanceof Date ? position.open_date.toISOString().slice(0, 10) : String(position.open_date).slice(0, 10);
                    const values = closingValues(position, group);
                    if (!values || brokerQuantity !== 0 || group.firstTime.slice(0, 10) < openDate) {
                        result.warnings.push(`${group.security.ticker}: partial or mismatched close requires review; position kept open`);
                        continue;
                    }
                    await trx('positions').where({ id: position.id }).update(values);
                    await trx('pnl_records').insert({ position_id: position.id, pnl_amount: values.realized_pnl, pnl_type: 'realized', record_date: values.close_date, description: `Broker sync: ${values.resolution_type}`, created_by: userId });
                    Object.assign(position, values); action = 'closed'; result.closed++;
                    events.push({ type: 'position_resolved', position, message: `Closed through broker sync. Realized P&L: $${values.realized_pnl.toFixed(2)} before fees.` });
                }
                await trx('broker_synced_fills').insert(group.fills.map(f => ({ account_id: feed.accountId, fill_id: String(f.fillId), position_id: position.id, action })));
                await trx('audit_logs').insert({ user_id: userId, action: `broker_position_${action}`, entity_type: 'position', entity_id: position.id, new_values: JSON.stringify({ account_id: feed.accountId, fill_ids: group.fills.map(f => f.fillId), position }) });
            }
            await trx('broker_sync_state').where({ id: 'moomoo' }).update({ account_id: feed.accountId, start_date: beginDate });
        });
        for (const event of events) await notify(event.type, `${event.type === 'position_opened' ? 'New Position' : 'Position Closed'}: ${event.position.ticker}`, event.message, { position_id: event.position.id });
        return result;
    } catch (error) {
        return { added: 0, closed: 0, matched: 0, warnings: [], error: error.message };
    }
}
