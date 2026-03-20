import net from 'net';
import crypto from 'crypto';
import protobuf from 'protobufjs';
import Long from 'long';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_DIR = path.resolve(__dirname, '../../../node_modules/moomoo-api/proto');

const HEADER_SIZE = 44;
const PROTO_ID_INIT_CONNECT = 1001;
const PROTO_ID_GET_OPTION_CHAIN = 3209;
const PROTO_ID_GET_SECURITY_SNAPSHOT = 3203;
const PROTO_ID_GET_OPTION_EXPIRY = 3224;
const PROTO_ID_GET_ACC_LIST = 2001;
const PROTO_ID_UNLOCK_TRADE = 2005;
const PROTO_ID_GET_FUNDS = 2101;

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
                socket.connect(env.moomooPort, env.moomooHost, () => {
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
                c2s: { clientVer: 100, clientID: 'strikecapital-server', recvNotify: false, programmingLanguage: 'JavaScript' },
            })).finish();

            const resp = await sendRequest(PROTO_ID_INIT_CONNECT, initBody);
            const InitResp = protoRoot.lookupType('InitConnect.Response');
            const initResult = InitResp.decode(resp);
            if (initResult.retType !== 0) {
                throw new Error(`InitConnect failed: ${initResult.retMsg}`);
            }

            connected = true;
            console.log(`[Moomoo] Connected to OpenD at ${env.moomooHost}:${env.moomooPort}`);
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

/**
 * Format a date value as YYYY-MM-DD using local timezone (avoids UTC shift from toISOString).
 */
function toLocalDateStr(d) {
    if (d instanceof Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    return String(d).split('T')[0];
}

/**
 * Extract the base stock symbol from a ticker that may include suffixes like " PUT", " CALL".
 * e.g. "NVDA PUT" -> "NVDA", "AAPL" -> "AAPL"
 */
function baseSymbol(ticker) {
    return ticker.replace(/\s+(PUT|CALL|P|C)$/i, '').trim().toUpperCase();
}

/**
 * Get valid option expiry dates for a ticker, cached per session.
 */
const expiryCache = new Map();
async function getValidExpiryDates(ticker) {
    ticker = baseSymbol(ticker);
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

/**
 * Find the closest valid expiry date to a target date.
 * Looks within ±3 days of the target.
 */
function findClosestExpiry(validDates, targetDate) {
    if (validDates.includes(targetDate)) return targetDate;

    const target = new Date(targetDate).getTime();
    let closest = null;
    let minDiff = Infinity;

    for (const d of validDates) {
        const diff = Math.abs(new Date(d).getTime() - target);
        if (diff < minDiff && diff <= 3 * 24 * 60 * 60 * 1000) { // within 3 days
            minDiff = diff;
            closest = d;
        }
    }
    return closest;
}

/**
 * Get option chain for a ticker on a specific expiry date.
 * Returns put option codes matching the given positions.
 * @param {string} ticker - e.g. "NVDA"
 * @param {string} expiryDate - e.g. "2026-03-21" (YYYY-MM-DD)
 * @returns {Array<{code: string, market: number, strikePrice: number}>}
 */
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

/**
 * Get security snapshots for a list of securities.
 * @param {Array<{market: number, code: string}>} securityList
 * @returns {Array} snapshot results
 */
async function getSnapshots(securityList) {
    // API limits to 400 per request, batch if needed
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

/**
 * Fetch option quotes for positions.
 * For each position (ticker + strike + expiry), finds the matching option contract
 * and returns its current price, IV, and Greeks.
 *
 * @param {Array<{ticker: string, strike_price: number, expiration_date: string}>} positions
 * @returns {Array<{ticker: string, strike_price: number, expiration_date: string, option_price: number, prev_close: number, implied_volatility: number, delta: number, underlying_price: number}>}
 */
export async function getOptionQuotes(positions) {
    if (!positions || positions.length === 0) return [];

    const isConnected = await ensureConnected();
    if (!isConnected) {
        console.warn('[Moomoo] OpenD not available — returning empty quotes');
        return [];
    }

    try {
        // Get unique base symbols to prefetch expiry dates
        const tickers = [...new Set(positions.map(p => baseSymbol(p.ticker)))];
        for (const ticker of tickers) {
            await getValidExpiryDates(ticker);
        }

        // Group positions by ticker + resolved expiry to minimize API calls
        const groups = new Map();
        for (const pos of positions) {
            if (!pos.expiration_date) continue;
            const rawExpiry = toLocalDateStr(pos.expiration_date);

            // Find closest valid expiry date (position date may be off by a day)
            const symbol = baseSymbol(pos.ticker);
            const validDates = expiryCache.get(symbol) || [];
            const expiry = findClosestExpiry(validDates, rawExpiry);
            if (!expiry) {
                console.warn(`[Moomoo] No valid expiry near ${rawExpiry} for ${symbol}`);
                continue;
            }

            const key = `${symbol}|${expiry}`;
            if (!groups.has(key)) {
                groups.set(key, { ticker: symbol, expiry, positions: [] });
            }
            groups.get(key).positions.push({ ...pos, resolvedExpiry: expiry });
        }

        // For each group, get the option chain and find matching contracts
        const optionSecurities = [];
        const optionMap = new Map(); // code -> { ticker, strike_price, expiration_date, positionIds: [] }

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
                    console.warn(`[Moomoo] No matching option for ${pos.ticker} $${strike} Put exp ${group.expiry}`);
                }
            }
        }

        if (optionSecurities.length === 0) return [];

        // Get snapshots for all matched option contracts
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

        return results;
    } catch (error) {
        console.error('[Moomoo] Error fetching option quotes:', error.message);
        return [];
    }
}

/**
 * Unlock trade access (required before GetFunds on live accounts).
 */
let tradeUnlockedFirms = new Set();
async function unlockTrade(securityFirm) {
    if (tradeUnlockedFirms.has(securityFirm)) return true;
    if (!env.moomooTradePwdMd5) {
        console.warn('[Moomoo] MOOMOO_TRADE_PWD_MD5 not configured, skipping unlock');
        return false;
    }

    const c2s = { unlock: true, pwdMD5: env.moomooTradePwdMd5 };
    if (securityFirm) c2s.securityFirm = securityFirm;

    const Req = protoRoot.lookupType('Trd_UnlockTrade.Request');
    const body = Req.encode(Req.create({ c2s })).finish();

    const resp = await sendRequest(PROTO_ID_UNLOCK_TRADE, body);
    const Resp = protoRoot.lookupType('Trd_UnlockTrade.Response');
    const result = Resp.decode(resp);

    if (result.retType !== 0) {
        console.warn(`[Moomoo] UnlockTrade(firm=${securityFirm}) failed: ${result.retMsg}`);
        return false;
    }

    tradeUnlockedFirms.add(securityFirm);
    console.log(`[Moomoo] Trade unlocked for securityFirm=${securityFirm}`);
    return true;
}

/**
 * Get list of trading accounts.
 */
export async function getAccList() {
    const isConnected = await ensureConnected();
    if (!isConnected) return [];

    try {
        const Req = protoRoot.lookupType('Trd_GetAccList.Request');
        const body = Req.encode(Req.create({ c2s: { userID: 0, needGeneralSecAccount: true } })).finish();

        const resp = await sendRequest(PROTO_ID_GET_ACC_LIST, body);
        const Resp = protoRoot.lookupType('Trd_GetAccList.Response');
        const result = Resp.decode(resp);

        if (result.retType !== 0) {
            console.warn(`[Moomoo] GetAccList failed: ${result.retMsg}`);
            return [];
        }

        const accounts = (result.s2c?.accList || []).map(acc => ({
            accID: acc.accID?.toString() || '',
            accType: acc.accType,
            accStatus: acc.accStatus,
            securityFirm: acc.securityFirm,
            trdMarketAuthList: acc.trdMarketAuthList || [],
            simAccType: acc.simAccType,
            cardNum: acc.cardNum || '',
            uniCardNum: acc.uniCardNum || '',
        }));

        console.log('[Moomoo] Available accounts:', JSON.stringify(accounts, null, 2));
        return accounts;
    } catch (error) {
        console.error('[Moomoo] GetAccList error:', error.message);
        return [];
    }
}

/**
 * Get account funds from Moomoo.
 * @returns {Object|null} funds data or null on failure
 */
/**
 * Try GetFunds with a specific accID and trdMarket.
 * @returns {Object|null}
 */
async function tryGetFunds(accID, trdMarket, currency) {
    // accID is uint64 — use Long to avoid precision loss for large values
    const accIDLong = typeof accID === 'string' ? Long.fromString(accID, true) : Long.fromNumber(accID, true);

    const c2s = {
        header: {
            trdEnv: 1,  // REAL
            accID: accIDLong,
            trdMarket: trdMarket,
        },
        refreshCache: true,
    };
    if (currency) c2s.currency = currency;

    const Req = protoRoot.lookupType('Trd_GetFunds.Request');
    const body = Req.encode(Req.create({ c2s })).finish();

    const resp = await sendRequest(PROTO_ID_GET_FUNDS, body);
    const Resp = protoRoot.lookupType('Trd_GetFunds.Response');
    const result = Resp.decode(resp);

    if (result.retType !== 0) {
        console.warn(`[Moomoo] GetFunds(accID=${accID}, market=${trdMarket}) failed: ${result.retMsg}`);
        return null;
    }

    return result.s2c?.funds || null;
}

function mapFundsToResponse(f) {
    return {
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

export async function getAccountFunds() {
    const isConnected = await ensureConnected();
    if (!isConnected) return null;

    try {
        // Unlock trade for configured security firm
        await unlockTrade(env.moomooSecurityFirm);

        const configuredAccID = env.moomooAccountId;
        const trdMarket = env.moomooTrdMarket;
        const currency = env.moomooCurrency;

        if (configuredAccID) {
            // Use exact configured values
            console.log(`[Moomoo] GetFunds: accID=${configuredAccID}, market=${trdMarket}, currency=${currency}`);
            const funds = await tryGetFunds(configuredAccID, trdMarket, currency);
            if (funds) {
                return { ...mapFundsToResponse(funds), accID: configuredAccID, trdMarket };
            }
        }

        // Fallback: auto-discover from account list
        const accounts = await getAccList();
        const realAccounts = accounts.filter(a => a.accStatus === 0 && !a.simAccType);
        for (const acc of realAccounts) {
            if (acc.securityFirm && acc.securityFirm !== env.moomooSecurityFirm) {
                await unlockTrade(acc.securityFirm);
            }
            const markets = acc.trdMarketAuthList?.length > 0 ? acc.trdMarketAuthList : [trdMarket];
            for (const market of markets) {
                const funds = await tryGetFunds(acc.accID, market, currency);
                if (funds) {
                    console.log(`[Moomoo] GetFunds success (auto): accID=${acc.accID}, market=${market}`);
                    return { ...mapFundsToResponse(funds), accID: acc.accID, trdMarket: market };
                }
            }
        }

        console.warn('[Moomoo] GetFunds failed for all accounts');
        return null;
    } catch (error) {
        console.error('[Moomoo] GetFunds error:', error.message);
        return null;
    }
}

export function disconnect() {
    if (socket) {
        socket.destroy();
        socket = null;
        connected = false;
    }
    tradeUnlockedFirms.clear();
    expiryCache.clear();
}
