import test from 'node:test';
import assert from 'node:assert/strict';
import protobuf from 'protobufjs';
import Long from 'long';
import { readTradeExecutions } from '../../../scanner-proxy/tradeExecutions.js';

const root = await protobuf.load(['Trd_GetAccList', 'Trd_GetOrderFillList', 'Trd_GetHistoryOrderFillList', 'Trd_GetPositionList'].map(name => new URL(`../../../node_modules/moomoo-api/proto/${name}.proto`, import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')));
const accountId = '9007199254740993';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const header = { trdEnv: 1, trdMarket: 2, accID: Long.fromString(accountId, true) };

test('OpenD transport preserves 64-bit account and fill IDs and queries holdings', async () => {
    const ids = [];
    const sendRequest = async (id, bytes) => {
        ids.push(id);
        if (id === 2001) {
            const Response = root.lookupType('Trd_GetAccList.Response');
            return Response.encode(Response.create({ retType: 0, s2c: { accList: [{ accID: header.accID, trdEnv: 1, trdMarketAuthList: [2] }] } })).finish();
        }
        const name = id === 2211 ? 'Trd_GetOrderFillList' : 'Trd_GetPositionList';
        const request = root.lookupType(`${name}.Request`).decode(bytes);
        assert.equal(request.c2s.header.accID.toString(), accountId);
        const body = id === 2211
            ? { orderFillList: [{ trdSide: 2, fillID: Long.fromString('9007199254740995'), fillIDEx: '', orderID: Long.fromString('9007199254740996'), code: 'AAPL261016P200000', name: 'AAPL put', qty: 1, price: 2, createTime: `${today} 10:00:00`, status: 0 }] }
            : { positionList: [{ positionID: Long.fromString('1'), positionSide: 1, code: 'AAPL261016P200000', name: 'AAPL put', qty: 1, canSellQty: 1, price: 2, costPrice: 2, val: -200, plVal: 0, plRatio: 0 }] };
        const Response = root.lookupType(`${name}.Response`);
        return Response.encode(Response.create({ retType: 0, s2c: { header, ...body } })).finish();
    };
    const result = await readTradeExecutions({ root, sendRequest, Long, accountId, market: 2, beginDate: today });
    assert.deepEqual(ids, [2001, 2211, 2102]);
    assert.equal(result.fills[0].fillId, '9007199254740995');
    assert.equal(result.holdings[0].side, 1);
});

test('OpenD query rejects missing accounts and broker errors instead of returning empty holdings', async () => {
    const args = { root, Long, accountId, market: 2, beginDate: today };
    await assert.rejects(readTradeExecutions({ ...args, accountId: '', sendRequest: async () => {} }), /MOOMOO_ACCOUNT_ID/);
    await assert.rejects(readTradeExecutions({ ...args, sendRequest: async () => root.lookupType('Trd_GetAccList.Response').encode({ retType: -1, retMsg: 'offline' }).finish() }), /unavailable/);
});
