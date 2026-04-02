/**
 * Scanner Proxy — Standalone HTTP server
 *
 * Copy this folder to the always-on PC that has Moomoo OpenD running.
 * Run:  npm install && node index.js
 *
 * Cloudflare tunnel should point to http://localhost:3001
 *
 * Required env vars (create a .env file):
 *   MOOMOO_OPEND_HOST=127.0.0.1       (default)
 *   MOOMOO_OPEND_PORT=11111            (default)
 *   SCANNER_PROXY_PORT=3001            (default)
 *   SCANNER_PROXY_SECRET=yourSecret    (optional but recommended)
 */

import 'dotenv/config';
import net from 'net';
import crypto from 'crypto';
import protobuf from 'protobufjs';
import Long from 'long';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ──────────────────────────────────────────────────────────────────
const MOOMOO_HOST = process.env.MOOMOO_OPEND_HOST || '127.0.0.1';
const MOOMOO_PORT = parseInt(process.env.MOOMOO_OPEND_PORT || '11111');
const PORT = parseInt(process.env.SCANNER_PROXY_PORT || '3001');
const SECRET = process.env.SCANNER_PROXY_SECRET || '';

// ─── Moomoo TCP Layer ─────────────────────────────────────────────────────────
const PROTO_DIR = path.resolve(__dirname, 'node_modules/moomoo-api/proto');
const HEADER_SIZE = 44;
const PROTO_ID_INIT_CONNECT = 1001;
const PROTO_ID_GET_OPTION_CHAIN = 3209;
const PROTO_ID_GET_SECURITY_SNAPSHOT = 3203;
const PROTO_ID_GET_OPTION_EXPIRY = 3224;
const PROTO_ID_GET_ACC_LIST = 2001;
const PROTO_ID_UNLOCK_TRADE = 2005;
const PROTO_ID_GET_FUNDS = 2101;

const MOOMOO_ACCOUNT_ID = process.env.MOOMOO_ACCOUNT_ID || '';
const MOOMOO_TRADE_PWD_MD5 = process.env.MOOMOO_TRADE_PWD_MD5 || '';
const MOOMOO_SECURITY_FIRM = parseInt(process.env.MOOMOO_SECURITY_FIRM || '3');
const MOOMOO_TRD_MARKET = parseInt(process.env.MOOMOO_TRD_MARKET || '2');
const MOOMOO_CURRENCY = parseInt(process.env.MOOMOO_CURRENCY || '2');

let socket = null;
let connected = false;
let connectPromise = null;
let serialNo = 0;
let protoRoot = null;
const pendingRequests = new Map();
let recvBuffer = Buffer.alloc(0);

async function loadProtos() {
    if (protoRoot) return protoRoot;
    protoRoot = await protobuf.load([
        path.join(PROTO_DIR, 'Common.proto'),
        path.join(PROTO_DIR, 'InitConnect.proto'),
        path.join(PROTO_DIR, 'Qot_Common.proto'),
        path.join(PROTO_DIR, 'Qot_GetOptionChain.proto'),
        path.join(PROTO_DIR, 'Qot_GetSecuritySnapshot.proto'),
        path.join(PROTO_DIR, 'Qot_GetOptionExpirationDate.proto'),
        path.join(PROTO_DIR, 'Trd_Common.proto'),
        path.join(PROTO_DIR, 'Trd_GetAccList.proto'),
        path.join(PROTO_DIR, 'Trd_GetFunds.proto'),
        path.join(PROTO_DIR, 'Trd_UnlockTrade.proto'),
    ]);
    return protoRoot;
}

function packMessage(protoID, body) {
    const sn = ++serialNo;
    const sha1 = crypto.createHash('sha1').update(body).digest();
    const header = Buffer.alloc(HEADER_SIZE);
    header.write('FT', 0, 'ascii');
    header.writeUInt32LE(protoID, 2);
    header.writeUInt8(0, 6);
    header.writeUInt8(0, 7);
    header.writeUInt32LE(sn, 8);
    header.writeUInt32LE(body.length, 12);
    sha1.copy(header, 16);
    return { sn, packet: Buffer.concat([header, Buffer.from(body)]) };
}

function onData(data) {
    recvBuffer = Buffer.concat([recvBuffer, data]);
    while (recvBuffer.length >= HEADER_SIZE) {
        const bodyLen = recvBuffer.readUInt32LE(12);
        const total = HEADER_SIZE + bodyLen;
        if (recvBuffer.length < total) break;
        const sn = recvBuffer.readUInt32LE(8);
        const body = recvBuffer.subarray(HEADER_SIZE, total);
        recvBuffer = recvBuffer.subarray(total);
        const p = pendingRequests.get(sn);
        if (p) {
            pendingRequests.delete(sn);
            clearTimeout(p.timer);
            p.resolve(body);
        }
    }
}

function sendRequest(protoID, bodyBuf, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const { sn, packet } = packMessage(protoID, bodyBuf);
        const timer = setTimeout(() => {
            pendingRequests.delete(sn);
            reject(new Error(`Request timeout (protoID=${protoID})`));
        }, timeoutMs);
        pendingRequests.set(sn, { sn, resolve, reject, timer });
        socket.write(packet);
    });
}

async function ensureConnected() {
    if (connected && socket) return true;
    if (connectPromise) return connectPromise;

    connectPromise = (async () => {
        try {
            await loadProtos();

            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('TCP connection timeout')), 10000);
                socket = new net.Socket();
                socket.connect(MOOMOO_PORT, MOOMOO_HOST, () => {
                    clearTimeout(timeout);
                    resolve();
                });
                socket.on('data', onData);
                socket.on('error', (err) => {
                    clearTimeout(timeout);
                    connected = false;
                    console.error('[Moomoo] Socket error:', err.message);
                    reject(err);
                });
                socket.on('close', () => {
                    connected = false;
                    socket = null;
                    for (const [, p] of pendingRequests) {
                        clearTimeout(p.timer);
                        p.reject(new Error('Connection closed'));
                    }
                    pendingRequests.clear();
                    console.warn('[Moomoo] Disconnected from OpenD');
                });
            });

            const InitReq = protoRoot.lookupType('InitConnect.Request');
            const initBody = InitReq.encode(InitReq.create({
                c2s: { clientVer: 100, clientID: 'scanner-proxy', recvNotify: false, programmingLanguage: 'JavaScript' },
            })).finish();

            const resp = await sendRequest(PROTO_ID_INIT_CONNECT, initBody);
            const InitResp = protoRoot.lookupType('InitConnect.Response');
            const initResult = InitResp.decode(resp);
            if (initResult.retType !== 0) {
                throw new Error(`InitConnect failed: ${initResult.retMsg}`);
            }

            connected = true;
            console.log(`[Moomoo] Connected to OpenD at ${MOOMOO_HOST}:${MOOMOO_PORT}`);
            return true;
        } catch (error) {
            connected = false;
            if (socket) { socket.destroy(); socket = null; }
            console.warn('[Moomoo] Could not connect to OpenD:', error.message);
            return false;
        } finally {
            connectPromise = null;
        }
    })();

    return connectPromise;
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────
function toLocalDateStr(d) {
    if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    return String(d).split('T')[0];
}

function baseSymbol(ticker) {
    return ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
}

function findClosestExpiry(validDates, targetDate) {
    if (validDates.includes(targetDate)) return targetDate;
    const target = new Date(targetDate).getTime();
    let closest = null;
    let minDiff = Infinity;
    for (const d of validDates) {
        const diff = Math.abs(new Date(d).getTime() - target);
        if (diff < minDiff && diff <= 3 * 24 * 60 * 60 * 1000) {
            minDiff = diff;
            closest = d;
        }
    }
    return closest;
}

// ─── Scanner Logic ────────────────────────────────────────────────────────────
const expiryCache = new Map();

async function getValidExpiryDates(ticker) {
    if (expiryCache.has(ticker)) return expiryCache.get(ticker);

    const Req = protoRoot.lookupType('Qot_GetOptionExpirationDate.Request');
    const body = Req.encode(Req.create({
        c2s: { owner: { market: 11, code: ticker.toUpperCase() } },
    })).finish();

    const resp = await sendRequest(PROTO_ID_GET_OPTION_EXPIRY, body);
    const Resp = protoRoot.lookupType('Qot_GetOptionExpirationDate.Response');
    const result = Resp.decode(resp);

    if (result.retType !== 0) {
        console.warn(`[Moomoo] GetOptionExpirationDate failed for ${ticker}: ${result.retMsg}`);
        return [];
    }

    const dates = (result.s2c?.dateList || []).map(d => d.strikeTime);
    expiryCache.set(ticker, dates);
    return dates;
}

async function getOptionChain(ticker, expiryDate) {
    const ChainReq = protoRoot.lookupType('Qot_GetOptionChain.Request');
    const body = ChainReq.encode(ChainReq.create({
        c2s: {
            owner: { market: 11, code: ticker.toUpperCase() },
            type: 2, // OptionType_Put
            beginTime: expiryDate,
            endTime: expiryDate,
        },
    })).finish();

    const resp = await sendRequest(PROTO_ID_GET_OPTION_CHAIN, body);
    const ChainResp = protoRoot.lookupType('Qot_GetOptionChain.Response');
    const result = ChainResp.decode(resp);

    if (result.retType !== 0) {
        console.warn(`[Moomoo] GetOptionChain failed for ${ticker} ${expiryDate}: ${result.retMsg}`);
        return [];
    }

    const options = [];
    for (const chain of (result.s2c?.optionChain || [])) {
        for (const opt of (chain.option || [])) {
            if (opt.put?.basic?.security) {
                options.push({
                    code: opt.put.basic.security.code,
                    market: opt.put.basic.security.market,
                    strikePrice: opt.put.optionExData?.strikePrice ?? 0,
                });
            }
        }
    }
    return options;
}

async function getSnapshots(securityList) {
    const results = [];
    for (let i = 0; i < securityList.length; i += 400) {
        const batch = securityList.slice(i, i + 400);
        const SnapReq = protoRoot.lookupType('Qot_GetSecuritySnapshot.Request');
        const body = SnapReq.encode(SnapReq.create({ c2s: { securityList: batch } })).finish();

        const resp = await sendRequest(PROTO_ID_GET_SECURITY_SNAPSHOT, body);
        const SnapResp = protoRoot.lookupType('Qot_GetSecuritySnapshot.Response');
        const result = SnapResp.decode(resp);

        if (result.retType !== 0) {
            console.warn(`[Moomoo] GetSecuritySnapshot failed: ${result.retMsg}`);
            continue;
        }
        results.push(...(result.s2c?.snapshotList || []));
    }
    return results;
}

async function scanPutOptions(
    tickers, stockPrices,
    minDays = 14, maxDays = 28,
    minDiscount = 10, maxDiscount = 20,
    minDelta = 0, maxDelta = 1,
    minReturn = 0, minOI = 0, minVolume = 0
) {
    console.log('[Scanner] scanPutOptions called, tickers:', tickers);

    const isConnected = await ensureConnected();
    if (!isConnected) return { results: [], error: 'Moomoo OpenD not available', debug: {} };

    const today = new Date();
    const optionSecurities = [];
    const debug = {};

    for (const ticker of tickers) {
        const stockPrice = stockPrices[ticker];
        debug[ticker] = { stockPrice: stockPrice ?? null };
        if (!stockPrice) {
            debug[ticker].skipped = 'no stock price';
            continue;
        }

        const minStrike = stockPrice * (1 - maxDiscount / 100);
        const maxStrike = stockPrice * (1 - minDiscount / 100);
        debug[ticker].strikeRange = { min: Math.round(minStrike * 100) / 100, max: Math.round(maxStrike * 100) / 100 };

        let expiryDates = [];
        try {
            expiryDates = await getValidExpiryDates(ticker);
        } catch (e) {
            debug[ticker].expiryError = e?.message ?? String(e);
            continue;
        }
        debug[ticker].allExpiries = expiryDates.slice(0, 10);

        const filteredExpiries = expiryDates.filter(d => {
            const days = Math.round((new Date(d) - today) / (1000 * 60 * 60 * 24));
            return days >= minDays && days <= maxDays;
        });
        debug[ticker].filteredExpiries = filteredExpiries;

        for (const expiry of filteredExpiries) {
            let chain = [];
            try { chain = await getOptionChain(ticker, expiry); } catch (e) {
                debug[ticker][`chainError_${expiry}`] = e.message;
                continue;
            }

            for (const opt of chain) {
                if (opt.strikePrice >= minStrike && opt.strikePrice <= maxStrike) {
                    optionSecurities.push({
                        market: opt.market,
                        code: opt.code,
                        ticker,
                        strike: opt.strikePrice,
                        expiry,
                        stockPrice,
                    });
                }
            }
        }
    }

    console.log('[Scanner] optionSecurities count:', optionSecurities.length);
    if (optionSecurities.length === 0) return { results: [], debug };

    const secList = optionSecurities.map(o => ({ market: o.market, code: o.code }));
    const snapshots = await getSnapshots(secList);
    const snapMap = new Map(snapshots.map(s => [s.basic?.security?.code, s]));

    const results = [];
    for (const opt of optionSecurities) {
        const snap = snapMap.get(opt.code);
        if (!snap) continue;
        const daysToExpiry = Math.round((new Date(opt.expiry) - today) / (1000 * 60 * 60 * 24));
        const discountPct = Math.round(((opt.stockPrice - opt.strike) / opt.stockPrice) * 10000) / 100;
        const premium = snap.basic?.curPrice ?? 0;
        const delta = snap.optionExData?.delta ?? null;
        const openInterest = snap.optionExData?.openInterest ?? null;
        const volume = Number(snap.basic?.volume) || 0;
        const returnPct = opt.strike > 0 ? Math.round((premium / opt.strike) * 10000) / 100 : 0;
        const annualReturnPct = daysToExpiry > 0 ? Math.round(returnPct * (365 / daysToExpiry) * 100) / 100 : 0;
        const absDelta = delta != null ? Math.abs(delta) : 0;
        const score = Math.round(
            Math.min(returnPct / 1.5, 1) * 40 +
            Math.min(discountPct / 15, 1) * 30 +
            Math.max(0, 1 - Math.abs(absDelta - 0.25) / 0.15) * 20 +
            Math.min((openInterest ?? 0) / 5000, 1) * 10
        );
        results.push({
            ticker: opt.ticker,
            option_code: opt.code,
            stock_price: opt.stockPrice,
            strike: opt.strike,
            discount_pct: discountPct,
            expiry: opt.expiry,
            days_to_expiry: daysToExpiry,
            premium,
            iv: snap.optionExData?.impliedVolatility ?? null,
            delta,
            theta: snap.optionExData?.theta ?? null,
            open_interest: openInterest,
            volume,
            return_pct: returnPct,
            annual_return_pct: annualReturnPct,
            score,
        });
    }

    const filtered = results.filter(r => {
        const abs = r.delta != null ? Math.abs(r.delta) : null;
        if (abs != null && abs < minDelta) return false;
        if (abs != null && abs > maxDelta) return false;
        if (r.return_pct < minReturn) return false;
        if (minOI > 0 && (r.open_interest == null || r.open_interest < minOI)) return false;
        if (minVolume > 0 && r.volume < minVolume) return false;
        return true;
    });
    filtered.sort((a, b) => b.score - a.score);
    return { results: filtered, debug };
}

// ─── Option Quotes (for live price refresh) ──────────────────────────────────
/**
 * Accepts positions [{id, ticker, strike_price, expiration_date}]
 * Returns quotes in the same shape as moomooService.getOptionQuotes()
 */
async function getOptionQuotes(positions) {
    if (!positions || positions.length === 0) return [];

    const isConnected = await ensureConnected();
    if (!isConnected) return [];

    try {
        // Prefetch expiry dates for all unique base symbols
        const tickers = [...new Set(positions.map(p => baseSymbol(p.ticker)))];
        for (const ticker of tickers) {
            await getValidExpiryDates(ticker);
        }

        // Group by ticker + resolved expiry
        const groups = new Map();
        for (const pos of positions) {
            if (!pos.expiration_date) continue;
            const rawExpiry = toLocalDateStr(pos.expiration_date);
            const symbol = baseSymbol(pos.ticker);
            const validDates = expiryCache.get(symbol) || [];
            const expiry = findClosestExpiry(validDates, rawExpiry);
            if (!expiry) {
                console.warn(`[Quotes] No valid expiry near ${rawExpiry} for ${symbol}`);
                continue;
            }
            const key = `${symbol}|${expiry}`;
            if (!groups.has(key)) groups.set(key, { ticker: symbol, expiry, positions: [] });
            groups.get(key).positions.push({ ...pos, resolvedExpiry: expiry });
        }

        // Find matching option contracts
        const optionSecurities = [];
        const optionMap = new Map();

        for (const [, group] of groups) {
            const chain = await getOptionChain(group.ticker, group.expiry);
            for (const pos of group.positions) {
                const strike = parseFloat(pos.strike_price);
                const match = chain.find(opt => Math.abs(opt.strikePrice - strike) < 0.01);
                if (match) {
                    const posExpiry = toLocalDateStr(pos.expiration_date);
                    if (!optionMap.has(match.code)) {
                        optionSecurities.push({ market: match.market, code: match.code });
                        optionMap.set(match.code, {
                            ticker: pos.ticker,
                            strike_price: strike,
                            expiration_date: posExpiry,
                            positionIds: [],
                        });
                    }
                    optionMap.get(match.code).positionIds.push(pos.id);
                } else {
                    console.warn(`[Quotes] No match for ${pos.ticker} $${strike} exp ${group.expiry}`);
                }
            }
        }

        if (optionSecurities.length === 0) return [];

        const snapshots = await getSnapshots(optionSecurities);
        const results = [];

        for (const snap of snapshots) {
            const code = snap.basic?.security?.code;
            const posInfo = optionMap.get(code);
            if (!posInfo) continue;
            results.push({
                ticker: posInfo.ticker,
                strike_price: posInfo.strike_price,
                expiration_date: posInfo.expiration_date,
                positionIds: posInfo.positionIds,
                option_code: code,
                option_price: snap.basic?.curPrice ?? 0,
                prev_close: snap.basic?.lastClosePrice ?? 0,
                implied_volatility: snap.optionExData?.impliedVolatility ?? null,
                delta: snap.optionExData?.delta ?? null,
                theta: snap.optionExData?.theta ?? null,
                open_interest: snap.optionExData?.openInterest ?? null,
                volume: Number(snap.basic?.volume) || 0,
            });
        }

        console.log(`[Quotes] Returning ${results.length} option quotes`);
        return results;
    } catch (error) {
        console.error('[Quotes] Error:', error.message);
        return [];
    }
}

// ─── Account Funds ────────────────────────────────────────────────────────────
const tradeUnlockedFirms = new Set();

async function unlockTrade(securityFirm) {
    if (tradeUnlockedFirms.has(securityFirm)) return true;
    if (!MOOMOO_TRADE_PWD_MD5) {
        console.warn('[Moomoo] MOOMOO_TRADE_PWD_MD5 not configured, skipping unlock');
        return false;
    }
    const c2s = { unlock: true, pwdMD5: MOOMOO_TRADE_PWD_MD5 };
    if (securityFirm) c2s.securityFirm = securityFirm;
    const Req = protoRoot.lookupType('Trd_UnlockTrade.Request');
    const body = Req.encode(Req.create({ c2s })).finish();
    const resp = await sendRequest(PROTO_ID_UNLOCK_TRADE, body);
    const Resp = protoRoot.lookupType('Trd_UnlockTrade.Response');
    const result = Resp.decode(resp);
    if (result.retType !== 0) {
        console.warn(`[Moomoo] UnlockTrade failed: ${result.retMsg}`);
        return false;
    }
    tradeUnlockedFirms.add(securityFirm);
    return true;
}

async function getAccList() {
    const Req = protoRoot.lookupType('Trd_GetAccList.Request');
    const body = Req.encode(Req.create({ c2s: { userID: 0, needGeneralSecAccount: true } })).finish();
    const resp = await sendRequest(PROTO_ID_GET_ACC_LIST, body);
    const Resp = protoRoot.lookupType('Trd_GetAccList.Response');
    const result = Resp.decode(resp);
    if (result.retType !== 0) return [];
    return (result.s2c?.accList || []).map(acc => ({
        accID: acc.accID?.toString() || '',
        accType: acc.accType,
        accStatus: acc.accStatus,
        securityFirm: acc.securityFirm,
        trdMarketAuthList: acc.trdMarketAuthList || [],
        simAccType: acc.simAccType,
    }));
}

async function tryGetFunds(accID, trdMarket, currency) {
    const accIDLong = typeof accID === 'string' ? Long.fromString(accID, true) : Long.fromNumber(accID, true);
    const c2s = {
        header: { trdEnv: 1, accID: accIDLong, trdMarket },
        refreshCache: true,
    };
    if (currency) c2s.currency = currency;
    const Req = protoRoot.lookupType('Trd_GetFunds.Request');
    const body = Req.encode(Req.create({ c2s })).finish();
    const resp = await sendRequest(PROTO_ID_GET_FUNDS, body);
    const Resp = protoRoot.lookupType('Trd_GetFunds.Response');
    const result = Resp.decode(resp);
    if (result.retType !== 0) {
        console.warn(`[Moomoo] GetFunds(accID=${accID}) failed: ${result.retMsg}`);
        return null;
    }
    return result.s2c?.funds || null;
}

function mapFunds(f, accID, trdMarket) {
    return {
        accID, trdMarket,
        power: f.power ?? 0,
        totalAssets: f.totalAssets ?? 0,
        cash: f.cash ?? 0,
        marketVal: f.marketVal ?? 0,
        frozenCash: f.frozenCash ?? 0,
        debtCash: f.debtCash ?? 0,
        avlWithdrawalCash: f.avlWithdrawalCash ?? 0,
        maxPowerShort: f.maxPowerShort ?? null,
        netCashPower: f.netCashPower ?? null,
        longMv: f.longMv ?? null,
        shortMv: f.shortMv ?? null,
        pendingAsset: f.pendingAsset ?? null,
        maxWithdrawal: f.maxWithdrawal ?? null,
        riskLevel: f.riskLevel ?? null,
        riskStatus: f.riskStatus ?? null,
        marginCallMargin: f.marginCallMargin ?? null,
        unrealizedPL: f.unrealizedPL ?? null,
        realizedPL: f.realizedPL ?? null,
        initialMargin: f.initialMargin ?? null,
        maintenanceMargin: f.maintenanceMargin ?? null,
        isPdt: f.isPdt ?? false,
        pdtSeq: f.pdtSeq ?? null,
        beginningDTBP: f.beginningDTBP ?? null,
        remainingDTBP: f.remainingDTBP ?? null,
        dtCallAmount: f.dtCallAmount ?? null,
        dtStatus: f.dtStatus ?? null,
        securitiesAssets: f.securitiesAssets ?? null,
        fundAssets: f.fundAssets ?? null,
        bondAssets: f.bondAssets ?? null,
        currency: f.currency ?? null,
        fetchedAt: new Date().toISOString(),
    };
}

async function getAccountFunds() {
    const isConnected = await ensureConnected();
    if (!isConnected) return null;

    try {
        await unlockTrade(MOOMOO_SECURITY_FIRM);

        if (MOOMOO_ACCOUNT_ID) {
            const funds = await tryGetFunds(MOOMOO_ACCOUNT_ID, MOOMOO_TRD_MARKET, MOOMOO_CURRENCY);
            if (funds) return mapFunds(funds, MOOMOO_ACCOUNT_ID, MOOMOO_TRD_MARKET);
        }

        // Auto-discover from account list
        const accounts = await getAccList();
        const realAccounts = accounts.filter(a => a.accStatus === 0 && !a.simAccType);
        for (const acc of realAccounts) {
            if (acc.securityFirm && acc.securityFirm !== MOOMOO_SECURITY_FIRM) {
                await unlockTrade(acc.securityFirm);
            }
            const markets = acc.trdMarketAuthList?.length > 0 ? acc.trdMarketAuthList : [MOOMOO_TRD_MARKET];
            for (const market of markets) {
                const funds = await tryGetFunds(acc.accID, market, MOOMOO_CURRENCY);
                if (funds) return mapFunds(funds, acc.accID, market);
            }
        }

        console.warn('[Moomoo] GetFunds failed for all accounts');
        return null;
    } catch (error) {
        console.error('[Moomoo] GetFunds error:', error.message);
        return null;
    }
}

// ─── Express HTTP Server ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Optional shared-secret auth
app.use((req, res, next) => {
    if (SECRET && req.headers['x-proxy-secret'] !== SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', connected, timestamp: new Date().toISOString() });
});

app.post('/scan', async (req, res) => {
    try {
        const {
            tickers, stockPrices,
            minDays = 14, maxDays = 28,
            minDiscount = 10, maxDiscount = 20,
            minDelta = 0, maxDelta = 1,
            minReturn = 0, minOI = 0, minVolume = 0,
        } = req.body || {};
        if (!tickers || !stockPrices) {
            return res.status(400).json({ error: 'tickers and stockPrices are required' });
        }
        const result = await scanPutOptions(tickers, stockPrices, minDays, maxDays, minDiscount, maxDiscount, minDelta, maxDelta, minReturn, minOI, minVolume);
        res.json(result);
    } catch (err) {
        console.error('[ScannerProxy] /scan error:', err.message);
        res.status(500).json({ error: err.message, results: [], debug: {} });
    }
});

app.post('/quotes', async (req, res) => {
    try {
        const { positions } = req.body || {};
        if (!Array.isArray(positions)) {
            return res.status(400).json({ error: 'positions array is required' });
        }
        const quotes = await getOptionQuotes(positions);
        res.json({ quotes });
    } catch (err) {
        console.error('[ScannerProxy] /quotes error:', err.message);
        res.status(500).json({ error: err.message, quotes: [] });
    }
});

app.get('/funds', async (req, res) => {
    try {
        const funds = await getAccountFunds();
        if (!funds) return res.status(503).json({ error: 'Moomoo OpenD unavailable or no accounts found' });
        res.json(funds);
    } catch (err) {
        console.error('[ScannerProxy] /funds error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`[ScannerProxy] Listening on port ${PORT}`);
    console.log(`[ScannerProxy] Moomoo OpenD: ${MOOMOO_HOST}:${MOOMOO_PORT}`);
    console.log(`[ScannerProxy] Secret auth: ${SECRET ? 'enabled' : 'disabled'}`);
    console.log(`[ScannerProxy] Health: http://localhost:${PORT}/health`);
});
