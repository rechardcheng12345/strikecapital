// 0DTE spread scan for SPY / QQQ: live Moomoo chain + underlying, Yahoo history and VIX, the range
// forecast and spread candidates (zeroDte.js), and Jev's read of today's event risk (words in, judgment
// out — Jev never sees or does the maths).
import { fetchZeroDteChain, fetchStockQuotes, fetchYahooPrice } from './priceService.js';
import { askJev, jevConfigured } from './jevService.js';
import { nyClock, isMarketOpen } from './simMath.js';
import { dailyBars, moveStats, minutesLeft, vixMove, impliedMove, forecastRange, spreadCandidates } from './zeroDte.js';

export const ZERO_DTE_TICKERS = ['SPY', 'QQQ'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cache = new Map(); // key → { at, value }

async function cached(key, ttlMs, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await loader();
    if (value != null) cache.set(key, { at: Date.now(), value });
    return value;
}

async function yahooDaily(symbol, range = '2y') {
    return cached(`bars:${symbol}:${range}`, 6 * 3600 * 1000, async () => {
        const resp = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`, {
            headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
        });
        if (!resp.ok) return null;
        return dailyBars((await resp.json())?.chart?.result?.[0]);
    });
}

/** Today's market headlines (last ~24h) for the day verdict. */
async function marketHeadlines(ticker) {
    return cached(`odte-news:${ticker}`, 15 * 60 * 1000, async () => {
        try {
            const resp = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=20&quotesCount=0`, {
                headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000),
            });
            const data = await resp.json();
            const cutoff = Date.now() / 1000 - 30 * 3600;
            return (data?.news || []).filter((n) => n.providerPublishTime >= cutoff).slice(0, 12)
                .map((n) => ({ title: n.title, publisher: n.publisher, link: n.link, published: new Date(n.providerPublishTime * 1000).toISOString() }));
        } catch {
            return [];
        }
    });
}

// ─── Jev: how eventful is today? ──────────────────────────────

const Q_DAY_RISK = {
    type: 'score',
    instructions: 'We plan to sell a same-day out-of-the-money option spread on the index fund in `fund`. It makes money only if the fund stays inside a range until today\'s close. Using `market_today` and `headlines`, how likely is an outsized move before today\'s close?',
    criteria: [
        'Calm: no market-moving event today and quiet conditions.',
        'Normal: ordinary news flow and nothing scheduled today that usually moves the whole market.',
        'Eventful: a scheduled market-moving release or event today, such as a Federal Reserve decision or press conference, CPI inflation data, the monthly jobs report, or results from a mega-cap technology company.',
        'Turbulent: the market is already in a sharp move or under stress today, such as a sell-off, a geopolitical shock or an emergency policy action.',
    ],
};

function pctWords(x) {
    return `${Math.abs(x).toFixed(1)}%`;
}

/** Turn today's numbers into plain sentences (Jev reads words, not maths). */
function describeDay({ ticker, price, open, high, low, prevClose, vix, vixAvg, rangeTypical }) {
    const out = [];
    if (open > 0 && prevClose > 0) {
        const gap = ((open - prevClose) / prevClose) * 100;
        out.push(Math.abs(gap) < 0.15 ? `${ticker} opened flat versus yesterday's close.` : `${ticker} opened ${pctWords(gap)} ${gap > 0 ? 'above' : 'below'} yesterday's close${Math.abs(gap) >= 1 ? ', a large gap' : ''}.`);
    }
    if (price > 0 && open > 0) {
        const chg = ((price - open) / open) * 100;
        out.push(Math.abs(chg) < 0.15 ? `Since the open it is roughly unchanged.` : `Since the open it is ${chg > 0 ? 'up' : 'down'} ${pctWords(chg)}.`);
    }
    if (high > 0 && low > 0 && open > 0 && rangeTypical > 0) {
        const range = ((high - low) / open) * 100;
        out.push(range > rangeTypical * 1.5 ? `Today's range so far (${pctWords(range)}) is already wider than usual.` : `Today's range so far (${pctWords(range)}) is within normal.`);
    }
    if (vix > 0) {
        const level = vix < 14 ? 'low' : vix < 20 ? 'moderate' : vix < 28 ? 'elevated' : 'high';
        let s = `The VIX volatility index is ${vix.toFixed(1)}, which is ${level}`;
        if (vixAvg > 0) s += vix > vixAvg * 1.2 ? ' and above its recent average' : vix < vixAvg * 0.85 ? ' and below its recent average' : ' and near its recent average';
        out.push(`${s}.`);
    }
    return out;
}

async function dayVerdict(ticker, words, headlines) {
    if (!jevConfigured()) return { verdict: null, note: 'Jev is not configured (TYPESAFE_API_KEY).' };
    const key = `odte-jev:${ticker}:${nyClock().date}:${words.join('|')}:${headlines.map((h) => h.title).join('|')}`;
    try {
        return await cached(key, 20 * 60 * 1000, async () => {
            const resp = await askJev({
                fund: ticker === 'QQQ' ? 'QQQ — Invesco QQQ Trust, tracking the Nasdaq-100 index' : 'SPY — SPDR S&P 500 ETF, tracking the S&P 500 index',
                market_today: words,
                headlines: headlines.length ? headlines.map((h) => `${h.title} (${h.publisher})`) : ['No market headlines found for the last day.'],
            }, { day_risk: Q_DAY_RISK });
            const a = resp.answers?.day_risk;
            if (!a) return null;
            const score = a.score;
            const verdict = score < 1.5 ? 'trade' : score < 2.5 ? 'smaller' : 'skip';
            return {
                verdict,
                score: Math.round(score * 100) / 100,
                confidence: a.confidence,
                label: a.legend?.[String(Math.round(score))] || null,
                review: a.confidence != null && a.confidence < 0.5,
            };
        });
    } catch (err) {
        return { verdict: null, note: `Jev unavailable: ${err.message}` };
    }
}

// ─── Scan ─────────────────────────────────────────────────────

/**
 * One scan: underlying now, today's expected high / low by three methods, call and put spread
 * candidates (live credit, historical hit rates, suggestion) and Jev's day verdict.
 */
export async function scanZeroDte({ ticker = 'SPY', width = 2, targetCredit = 10, percentileUsed = 95 } = {}) {
    const T = String(ticker).toUpperCase();
    if (!ZERO_DTE_TICKERS.includes(T)) {
        const err = new Error(`0DTE scan supports ${ZERO_DTE_TICKERS.join(' and ')}`);
        err.status = 400;
        throw err;
    }
    const clock = nyClock();
    const [[uq], bars, vixBars, vixNow] = await Promise.all([
        fetchStockQuotes([T]),
        yahooDaily(T),
        yahooDaily('^VIX'),
        fetchYahooPrice('^VIX'),
    ]);
    const price = uq?.price;
    if (!(price > 0)) {
        const err = new Error(`No live price for ${T}`);
        err.status = 424;
        throw err;
    }
    const chain = await fetchZeroDteChain(T, { strikeLow: Math.floor(price * 0.95), strikeHigh: Math.ceil(price * 1.05) });
    const u = chain.underlying?.price > 0 ? chain.underlying : uq;
    const open = u.open > 0 ? u.open : null;
    const isToday = chain.expiry === clock.date;

    const vix = vixNow?.price ?? null;
    const vixByDate = new Map((vixBars || []).map((b) => [b.date, b.close]));
    const stats = moveStats(bars || [], { vixByDate, currentVix: vix, excludeDate: clock.date });
    const mins = isToday ? minutesLeft(clock.minutes) : 390;
    const implied = impliedMove(chain.calls, chain.puts, u.price);
    const forecast = forecastRange({
        price: u.price, open: open ?? u.price, high: isToday ? u.high : null, low: isToday ? u.low : null,
        implied, vix: vixMove(vix, u.price, mins), stats, pct: percentileUsed,
    });
    const opts = { price: u.price, open: open ?? u.price, width, forecast, stats, targetCredit };
    const calls = spreadCandidates('call', chain.calls, opts);
    const puts = spreadCandidates('put', chain.puts, opts);

    const recent = (bars || []).slice(-60);
    const rangeTypical = recent.length ? (recent.map((b) => (b.high - b.low) / b.open).sort((a, b) => a - b)[Math.floor(recent.length / 2)] * 100) : null;
    const vixRecent = (vixBars || []).slice(-60).map((b) => b.close);
    const words = describeDay({
        ticker: T, price: u.price, open, high: u.high, low: u.low, prevClose: u.prev_close, vix,
        vixAvg: vixRecent.length ? vixRecent.reduce((a, b) => a + b, 0) / vixRecent.length : null, rangeTypical,
    });
    const headlines = await marketHeadlines(T);
    const jev = await dayVerdict(T, words, headlines);

    const strip = (s) => (s ? { n: s.n, up: s.up, down: s.down } : null);
    return {
        ticker: T,
        expiry: chain.expiry,
        is_0dte: isToday,
        market_open: isMarketOpen(),
        minutes_left: mins,
        scanned_at: new Date().toISOString(),
        underlying: { price: u.price, open, high: u.high, low: u.low, prev_close: u.prev_close, source: u.source || 'moomoo' },
        vix,
        implied_move: implied,
        forecast,
        history: { all: strip(stats.all), regime: strip(stats.regime), percentile: percentileUsed, typical_range_pct: rangeTypical != null ? Math.round(rangeTypical * 100) / 100 : null },
        settings: { width, target_credit: targetCredit },
        calls,
        puts,
        ai: { ...jev, day_summary: words, headlines },
    };
}
