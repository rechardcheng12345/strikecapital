// Shared read-only OpenD execution query. No order placement or trade unlock.
export async function readTradeExecutions({ root, sendRequest, Long, accountId, market, beginDate }) {
    if (!/^\d+$/.test(accountId || '') || accountId === '0') throw new Error('Set MOOMOO_ACCOUNT_ID to the fund account before syncing trades');
    if (market !== 2) throw new Error('Automatic position sync supports the US trading market only');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(beginDate || '')) throw new Error('Invalid trade sync start date');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (beginDate > today) throw new Error('Trade sync start date must not be in the future');
    const AccountsRequest = root.lookupType('Trd_GetAccList.Request');
    const accounts = root.lookupType('Trd_GetAccList.Response').decode(await sendRequest(2001, AccountsRequest.encode(AccountsRequest.create({ c2s: { userID: 0, needGeneralSecAccount: true } })).finish()));
    if (accounts.retType !== 0 || !accounts.s2c?.accList?.some(a => a.accID.toString() === accountId && a.trdEnv === 1 && a.trdMarketAuthList.includes(market))) throw new Error('Configured fund account is unavailable or does not support real US trades');
    const header = { trdEnv: 1, accID: Long.fromString(accountId, true), trdMarket: market };
    const fills = new Map();
    async function query(name, id, c2s) {
        const Request = root.lookupType(`${name}.Request`);
        const result = root.lookupType(`${name}.Response`).decode(await sendRequest(id, Request.encode(Request.create({ c2s })).finish()));
        if (result.retType !== 0 || !result.s2c) throw new Error(result.retMsg || 'Broker execution query failed');
        if (result.s2c.header.accID.toString() !== accountId) throw new Error('Broker returned a different trading account');
        for (const f of result.s2c.orderFillList || []) {
            fills.set(f.fillID.toString(), { fillId: f.fillID.toString(), orderId: f.orderID?.toString() || f.fillID.toString(), code: f.code, side: f.trdSide, qty: f.qty, price: f.price, time: f.createTime, status: f.status ?? 0 });
        }
    }
    // History requests are bounded to monthly windows; include today's cache separately.
    let cursor = beginDate;
    while (cursor < today) {
        const end = new Date(`${cursor}T12:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 29);
        const last = end.toISOString().slice(0, 10) < today ? end.toISOString().slice(0, 10) : today;
        await query('Trd_GetHistoryOrderFillList', 2222, { header, filterConditions: { filterMarket: market, beginTime: `${cursor} 00:00:00`, endTime: `${last} 23:59:59` } });
        end.setTime(new Date(`${last}T12:00:00Z`).getTime());
        end.setUTCDate(end.getUTCDate() + 1);
        cursor = end.toISOString().slice(0, 10);
    }
    await query('Trd_GetOrderFillList', 2211, { header, filterConditions: { filterMarket: market }, refreshCache: false });
    const Request = root.lookupType('Trd_GetPositionList.Request');
    const response = root.lookupType('Trd_GetPositionList.Response').decode(await sendRequest(2102, Request.encode(Request.create({ c2s: { header, filterConditions: { filterMarket: market }, refreshCache: true } })).finish()));
    if (response.retType !== 0 || !response.s2c || response.s2c.header.accID.toString() !== accountId) throw new Error(response.retMsg || 'Broker holdings query failed');
    const holdings = (response.s2c.positionList || []).map(p => ({ code: p.code, qty: p.qty, side: p.positionSide }));
    return { accountId, holdings, fills: [...fills.values()].filter(f => f.time.slice(0, 10) >= beginDate) };
}
