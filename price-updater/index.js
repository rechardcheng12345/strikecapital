/**
 * StrikeCapital Price Updater
 *
 * Standalone program that runs on the PC where Moomoo OpenD is installed.
 * Connects to Moomoo OpenD locally, fetches option prices, and updates
 * the remote StrikeCapital database.
 *
 * Usage:
 *   node index.js           # Run once
 *   node index.js --loop    # Run continuously every N minutes
 */

import dotenv from 'dotenv';
import fs from 'fs';
import net from 'net';
import crypto from 'crypto';
import protobuf from 'protobufjs';
import Long from 'long';
import path from 'path';
import { fileURLToPath } from 'url';
import knex from 'knex';

// Load .env — try exe directory first (for packaged exe), then cwd
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const exeDir = path.dirname(process.execPath);
dotenv.config({ path: path.join(exeDir, '.env') });
dotenv.config({ path: path.join(scriptDir, '.env') });
dotenv.config(); // also try cwd

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, 'proto');

// ─── Config ────────────────────────────────────────────
const config = {
    db: {
        host: process.env.DB_HOST || '194.59.164.108',
        port: parseInt(process.env.DB_PORT || '3306'),
        database: process.env.DB_NAME || 'u190181258_strikecapital',
        user: process.env.DB_USER || 'u190181258_strike_user',
        password: process.env.DB_PASSWORD || 'Strikeuser12345',
    },
    moomoo: {
        host: process.env.MOOMOO_OPEND_HOST || '127.0.0.1',
        port: parseInt(process.env.MOOMOO_OPEND_PORT || '11111'),
        accountId: process.env.MOOMOO_ACCOUNT_ID || '',
        tradePwdMd5: process.env.MOOMOO_TRADE_PWD_MD5 || '',
        securityFirm: parseInt(process.env.MOOMOO_SECURITY_FIRM || '3'),
        trdMarket: parseInt(process.env.MOOMOO_TRD_MARKET || '2'),
        currency: parseInt(process.env.MOOMOO_CURRENCY || '2'),
    },
    refreshIntervalMinutes: parseInt(process.env.REFRESH_INTERVAL_MINUTES || '5'),
};

// ─── Database ──────────────────────────────────────────
const db = knex({
    client: 'mysql2',
    connection: config.db,
    pool: { min: 1, max: 5 },
});

// ─── Moomoo TCP Client ─────────────────────────────────
const HEADER_SIZE = 44;
const PROTO_ID_INIT_CONNECT = 1001;
const PROTO_ID_GET_OPTION_CHAIN = 3209;
const PROTO_ID_GET_SECURITY_SNAPSHOT = 3203;
const PROTO_ID_GET_OPTION_EXPIRY = 3224;
const PROTO_ID_UNLOCK_TRADE = 2005;
const PROTO_ID_GET_FUNDS = 2101;

let socket = null;
let connected = false;
let serialNo = 0;
let protoRoot = null;
const pendingRequests = new Map();
let recvBuffer = Buffer.alloc(0);

async function loadProtos() {
    if (protoRoot) return protoRoot;

    // When built as exe, use embedded proto bundle (injected by build.js via globalThis)
    if (globalThis.__PROTO_BUNDLE__) {
        protoRoot = protobuf.Root.fromJSON(globalThis.__PROTO_BUNDLE__);
        return protoRoot;
    }

    // Dev mode: load .proto files from disk
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

async function connectToOpenD() {
    if (connected && socket) return true;

    try {
        await loadProtos();

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('TCP connection timeout')), 10000);
            socket = new net.Socket();
            socket.connect(config.moomoo.port, config.moomoo.host, () => {
                clearTimeout(timeout);
                resolve();
            });
            socket.on('data', onData);
            socket.on('error', (err) => {
                clearTimeout(timeout);
                connected = false;
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
            });
        });

        const InitReq = protoRoot.lookupType('InitConnect.Request');
        const initBody = InitReq.encode(InitReq.create({
            c2s: { clientVer: 100, clientID: 'strikecapital-price-updater', recvNotify: false, programmingLanguage: 'JavaScript' },
        })).finish();

        const resp = await sendRequest(PROTO_ID_INIT_CONNECT, initBody);
        const InitResp = protoRoot.lookupType('InitConnect.Response');
        const initResult = InitResp.decode(resp);
        if (initResult.retType !== 0) {
            throw new Error(`InitConnect failed: ${initResult.retMsg}`);
        }

        connected = true;
        log(`Connected to OpenD at ${config.moomoo.host}:${config.moomoo.port}`);
        return true;
    } catch (error) {
        connected = false;
        if (socket) { socket.destroy(); socket = null; }
        log(`Could not connect to OpenD: ${error.message}`, 'ERROR');
        return false;
    }
}

function disconnectOpenD() {
    if (socket) {
        socket.destroy();
        socket = null;
        connected = false;
    }
}

// ─── Helpers ───────────────────────────────────────────
function log(msg, level = 'INFO') {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${level}] ${msg}`);
}

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

// ─── Moomoo API Functions ──────────────────────────────
const expiryCache = new Map();

async function getValidExpiryDates(ticker) {
    ticker = baseSymbol(ticker);
    if (expiryCache.has(ticker)) return expiryCache.get(ticker);

    const Req = protoRoot.lookupType('Qot_GetOptionExpirationDate.Request');
    const body = Req.encode(Req.create({
        c2s: { owner: { market: 11, code: ticker } },
    })).finish();

    const resp = await sendRequest(PROTO_ID_GET_OPTION_EXPIRY, body);
    const Resp = protoRoot.lookupType('Qot_GetOptionExpirationDate.Response');
    const result = Resp.decode(resp);

    if (result.retType !== 0) {
        log(`GetOptionExpirationDate failed for ${ticker}: ${result.retMsg}`, 'WARN');
        return [];
    }

    const dates = (result.s2c?.dateList || []).map(d => d.strikeTime);
    expiryCache.set(ticker, dates);
    return dates;
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

async function getOptionChain(ticker, expiryDate) {
    const ChainReq = protoRoot.lookupType('Qot_GetOptionChain.Request');
    const body = ChainReq.encode(ChainReq.create({
        c2s: {
            owner: { market: 11, code: ticker.toUpperCase() },
            type: 2, // Put
            beginTime: expiryDate,
            endTime: expiryDate,
        },
    })).finish();

    const resp = await sendRequest(PROTO_ID_GET_OPTION_CHAIN, body);
    const ChainResp = protoRoot.lookupType('Qot_GetOptionChain.Response');
    const result = ChainResp.decode(resp);

    if (result.retType !== 0) {
        log(`GetOptionChain failed for ${ticker} ${expiryDate}: ${result.retMsg}`, 'WARN');
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
            log(`GetSecuritySnapshot failed: ${result.retMsg}`, 'WARN');
            continue;
        }
        results.push(...(result.s2c?.snapshotList || []));
    }
    return results;
}

// ─── Yahoo Finance ─────────────────────────────────────
async function fetchYahooPrice(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 StrikeCapital/1.0' },
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return null;
        return {
            price: meta.regularMarketPrice,
            previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
        };
    } catch (err) {
        log(`Yahoo Finance failed for ${symbol}: ${err.message}`, 'WARN');
        return null;
    }
}

async function refreshStockPrices() {
    // Get unique base symbols from active option positions
    const positions = await db('positions')
        .whereIn('status', ['OPEN', 'MONITORING'])
        .where('position_type', 'option')
        .whereNotNull('expiration_date')
        .select('ticker', 'strike_price');

    const symbolMap = new Map(); // symbol -> [positions]
    for (const pos of positions) {
        const symbol = baseSymbol(pos.ticker);
        if (!symbolMap.has(symbol)) symbolMap.set(symbol, []);
        symbolMap.get(symbol).push(pos);
    }

    if (symbolMap.size === 0) return;

    log(`Fetching stock prices for ${symbolMap.size} ticker(s) from Yahoo Finance...`);
    const now = new Date();

    for (const [symbol, posList] of symbolMap) {
        const quote = await fetchYahooPrice(symbol);
        if (!quote) continue;

        const stockPrice = quote.price;
        const prevClose = quote.previousClose;

        // Upsert market_data_cache with stock price (keyed by base symbol)
        const cacheData = {
            current_price: stockPrice,
            previous_close: prevClose,
            day_change_pct: prevClose > 0
                ? ((stockPrice - prevClose) / prevClose * 100)
                : null,
            fetched_at: now,
            source: 'yahoo',
        };

        try {
            const existing = await db('market_data_cache').where('ticker', symbol).first();
            if (existing) {
                await db('market_data_cache').where('ticker', symbol).update(cacheData);
            } else {
                await db('market_data_cache').insert({ ticker: symbol, ...cacheData });
            }
        } catch (err) {
            log(`Cache update failed for stock ${symbol}: ${err.message}`, 'WARN');
        }

        log(`  ${symbol} stock price: $${stockPrice.toFixed(2)} (prev close: $${prevClose?.toFixed(2) ?? 'N/A'})`);
    }
}

// ─── Account Funds (Trade API) ──────────────────────────
let tradeUnlockedFirms = new Set();

async function unlockTrade(securityFirm) {
    if (tradeUnlockedFirms.has(securityFirm)) return true;
    if (!config.moomoo.tradePwdMd5) {
        log('MOOMOO_TRADE_PWD_MD5 not configured, skipping unlock', 'WARN');
        return false;
    }
    const c2s = { unlock: true, pwdMD5: config.moomoo.tradePwdMd5 };
    if (securityFirm) c2s.securityFirm = securityFirm;

    const Req = protoRoot.lookupType('Trd_UnlockTrade.Request');
    const body = Req.encode(Req.create({ c2s })).finish();
    const resp = await sendRequest(PROTO_ID_UNLOCK_TRADE, body);
    const Resp = protoRoot.lookupType('Trd_UnlockTrade.Response');
    const result = Resp.decode(resp);

    if (result.retType !== 0) {
        log(`UnlockTrade(firm=${securityFirm}) failed: ${result.retMsg}`, 'WARN');
        return false;
    }
    tradeUnlockedFirms.add(securityFirm);
    log(`Trade unlocked for securityFirm=${securityFirm}`);
    return true;
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
        log(`GetFunds(accID=${accID}, market=${trdMarket}) failed: ${result.retMsg}`, 'WARN');
        return null;
    }
    return result.s2c?.funds || null;
}

function fundsToDbRow(funds, accID) {
    return {
        acc_id: accID,
        trd_market: config.moomoo.trdMarket,
        power: funds.power ?? 0,
        total_assets: funds.totalAssets ?? 0,
        cash: funds.cash ?? 0,
        market_val: funds.marketVal ?? 0,
        frozen_cash: funds.frozenCash ?? 0,
        debt_cash: funds.debtCash ?? 0,
        avl_withdrawal_cash: funds.avlWithdrawalCash ?? 0,
        max_power_short: funds.maxPowerShort ?? null,
        net_cash_power: funds.netCashPower ?? null,
        long_mv: funds.longMv ?? null,
        short_mv: funds.shortMv ?? null,
        pending_asset: funds.pendingAsset ?? null,
        max_withdrawal: funds.maxWithdrawal ?? null,
        risk_level: funds.riskLevel ?? null,
        risk_status: funds.riskStatus ?? null,
        margin_call_margin: funds.marginCallMargin ?? null,
        unrealized_pl: funds.unrealizedPL ?? null,
        realized_pl: funds.realizedPL ?? null,
        initial_margin: funds.initialMargin ?? null,
        maintenance_margin: funds.maintenanceMargin ?? null,
        is_pdt: funds.isPdt ?? false,
        pdt_seq: funds.pdtSeq ?? null,
        beginning_dtbp: funds.beginningDTBP ?? null,
        remaining_dtbp: funds.remainingDTBP ?? null,
        dt_call_amount: funds.dtCallAmount ?? null,
        dt_status: funds.dtStatus ?? null,
        securities_assets: funds.securitiesAssets ?? null,
        fund_assets: funds.fundAssets ?? null,
        bond_assets: funds.bondAssets ?? null,
        currency: funds.currency ?? null,
        fetched_at: new Date(),
    };
}

async function refreshAccountFunds() {
    if (!config.moomoo.accountId) {
        log('MOOMOO_ACCOUNT_ID not configured, skipping funds refresh', 'WARN');
        return;
    }

    log('Fetching account funds...');
    const isConnected = await connectToOpenD();
    if (!isConnected) {
        log('Cannot fetch funds: OpenD not available', 'WARN');
        return;
    }

    await unlockTrade(config.moomoo.securityFirm);

    const funds = await tryGetFunds(config.moomoo.accountId, config.moomoo.trdMarket, config.moomoo.currency);
    if (!funds) {
        log('GetFunds returned no data', 'WARN');
        return;
    }

    const dbRow = fundsToDbRow(funds, config.moomoo.accountId);
    try {
        const existing = await db('account_funds_cache').where('acc_id', config.moomoo.accountId).first();
        if (existing) {
            await db('account_funds_cache').where('acc_id', config.moomoo.accountId).update(dbRow);
        } else {
            await db('account_funds_cache').insert(dbRow);
        }
    } catch (err) {
        log(`Failed to save account funds to DB: ${err.message}`, 'WARN');
    }

    log(`  Account funds: totalAssets=$${(funds.totalAssets ?? 0).toFixed(2)}, cash=$${(funds.cash ?? 0).toFixed(2)}, power=$${(funds.power ?? 0).toFixed(2)}`);
}

// ─── Main Refresh Logic ────────────────────────────────
async function refreshPrices() {
    log('Starting price refresh...');

    // 1. Get active option positions from DB
    const positions = await db('positions')
        .whereIn('status', ['OPEN', 'MONITORING'])
        .where('position_type', 'option')
        .whereNotNull('expiration_date')
        .select('id', 'ticker', 'strike_price', 'expiration_date');

    if (positions.length === 0) {
        log('No active option positions found');
        return { updated: 0, prices: [] };
    }

    log(`Found ${positions.length} active option position(s)`);

    // 2. Connect to OpenD
    const isConnected = await connectToOpenD();
    if (!isConnected) {
        throw new Error('Cannot connect to Moomoo OpenD');
    }

    // 3. Prefetch expiry dates
    const tickers = [...new Set(positions.map(p => baseSymbol(p.ticker)))];
    for (const ticker of tickers) {
        await getValidExpiryDates(ticker);
    }

    // 4. Group positions by ticker + resolved expiry
    const groups = new Map();
    for (const pos of positions) {
        if (!pos.expiration_date) continue;
        const rawExpiry = toLocalDateStr(pos.expiration_date);
        const symbol = baseSymbol(pos.ticker);
        const validDates = expiryCache.get(symbol) || [];
        const expiry = findClosestExpiry(validDates, rawExpiry);
        if (!expiry) {
            log(`No valid expiry near ${rawExpiry} for ${symbol}`, 'WARN');
            continue;
        }
        const key = `${symbol}|${expiry}`;
        if (!groups.has(key)) {
            groups.set(key, { ticker: symbol, expiry, positions: [] });
        }
        groups.get(key).positions.push({ ...pos, resolvedExpiry: expiry });
    }

    // 5. Get option chains and match contracts
    const optionSecurities = [];
    const optionMap = new Map();

    for (const [, group] of groups) {
        const chain = await getOptionChain(group.ticker, group.expiry);
        for (const pos of group.positions) {
            const strike = parseFloat(pos.strike_price);
            const match = chain.find(opt => Math.abs(opt.strikePrice - strike) < 0.01);
            if (match) {
                optionSecurities.push({ market: match.market, code: match.code });
                const posExpiry = toLocalDateStr(pos.expiration_date);
                optionMap.set(match.code, {
                    ticker: pos.ticker,
                    strike_price: strike,
                    expiration_date: posExpiry,
                });
            } else {
                log(`No matching option for ${pos.ticker} $${strike} Put exp ${group.expiry}`, 'WARN');
            }
        }
    }

    if (optionSecurities.length === 0) {
        log('No option contracts matched');
        return { updated: 0, prices: [] };
    }

    // 6. Get snapshots
    const snapshots = await getSnapshots(optionSecurities);
    const now = new Date();
    let updated = 0;
    const prices = [];

    for (const snap of snapshots) {
        const code = snap.basic?.security?.code;
        const posInfo = optionMap.get(code);
        if (!posInfo) continue;

        const optionPrice = snap.basic?.curPrice ?? 0;
        const prevClose = snap.basic?.lastClosePrice ?? 0;
        const iv = snap.optionExData?.impliedVolatility ?? null;
        const delta = snap.optionExData?.delta ?? null;

        // 7. Upsert market_data_cache
        const cacheKey = code;
        const cacheData = {
            current_price: optionPrice,
            previous_close: prevClose || null,
            day_change_pct: prevClose > 0
                ? ((optionPrice - prevClose) / prevClose * 100)
                : null,
            implied_volatility: iv,
            delta: delta,
            fetched_at: now,
            source: 'moomoo',
        };

        try {
            const existing = await db('market_data_cache').where('ticker', cacheKey).first();
            if (existing) {
                await db('market_data_cache').where('ticker', cacheKey).update(cacheData);
            } else {
                await db('market_data_cache').insert({ ticker: cacheKey, ...cacheData });
            }
        } catch (err) {
            log(`Cache update failed for ${cacheKey}: ${err.message}`, 'WARN');
        }

        // 8. Update matching positions
        const updateData = {
            current_price: optionPrice,
            last_price_update: now,
        };
        if (iv != null) updateData.implied_volatility = iv;

        const count = await db('positions')
            .whereIn('status', ['OPEN', 'MONITORING'])
            .where('ticker', posInfo.ticker)
            .where('strike_price', posInfo.strike_price)
            .where('expiration_date', posInfo.expiration_date)
            .update(updateData);

        updated += count;
        prices.push({
            ticker: posInfo.ticker,
            strike: posInfo.strike_price,
            expiry: posInfo.expiration_date,
            option_code: code,
            price: optionPrice,
            iv,
            delta,
        });

        log(`  ${posInfo.ticker} $${posInfo.strike_price} exp ${posInfo.expiration_date} => $${optionPrice} (IV: ${iv != null ? iv.toFixed(1) + '%' : 'N/A'}, Delta: ${delta != null ? delta.toFixed(3) : 'N/A'})`);
    }

    log(`Refresh complete: ${prices.length} quote(s), ${updated} position(s) updated`);
    return { updated, prices };
}

// ─── Entry Point ───────────────────────────────────────
async function main() {
    const isLoop = process.argv.includes('--loop');

    log('=== StrikeCapital Price Updater ===');
    log(`Database: ${config.db.host}:${config.db.port}/${config.db.database}`);
    log(`OpenD: ${config.moomoo.host}:${config.moomoo.port}`);
    log(`Mode: ${isLoop ? `Loop (every ${config.refreshIntervalMinutes} min)` : 'Single run'}`);
    log('');

    // Test DB connection
    try {
        await db.raw('SELECT 1');
        log('Database connection OK');
    } catch (err) {
        log(`Database connection failed: ${err.message}`, 'ERROR');
        process.exit(1);
    }

    if (isLoop) {
        // Run immediately, then on interval
        await runOnce();
        const intervalMs = config.refreshIntervalMinutes * 60 * 1000;
        setInterval(async () => {
            await runOnce();
        }, intervalMs);
        log(`Next refresh in ${config.refreshIntervalMinutes} minute(s)`);
    } else {
        await runOnce();
        disconnectOpenD();
        await db.destroy();
        process.exit(0);
    }
}

async function runOnce() {
    // 1. Fetch stock prices from Yahoo Finance (always works, no OpenD needed)
    try {
        await refreshStockPrices();
    } catch (err) {
        log(`Stock price refresh failed: ${err.message}`, 'ERROR');
    }

    // 2. Fetch option prices from Moomoo OpenD
    try {
        const result = await refreshPrices();
        if (result.prices.length === 0) {
            log('No option prices updated this cycle');
        }
    } catch (err) {
        log(`Option price refresh failed: ${err.message}`, 'ERROR');
    }
    // 3. Fetch account funds from Moomoo OpenD (Trade API)
    try {
        await refreshAccountFunds();
    } catch (err) {
        log(`Account funds refresh failed: ${err.message}`, 'ERROR');
    }

    // Clear expiry cache between runs so it stays fresh
    expiryCache.clear();
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    log('Shutting down...');
    disconnectOpenD();
    await db.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    log('Shutting down...');
    disconnectOpenD();
    await db.destroy();
    process.exit(0);
});

main().catch(err => {
    log(`Fatal error: ${err.message}`, 'ERROR');
    process.exit(1);
});
