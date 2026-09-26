// Jev (TypeSafe System One) context layer for the option scanner.
// Jev answers qualitative questions about a ticker from text (profile + headlines); every number,
// date comparison and the final ranking stay in code. Docs: https://docs.typesafe.ai
import { env } from '../config/env.js';
import { db } from '../config/database.js';
import { getCompanyProfile, getRecentHeadlines, getEarningsDate, getVolatilityStats } from './marketContext.js';

const API_URL = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // key -> { at, value }

// Policy — kept in code so it can be tuned without touching the questions.
export const AI_POLICY = {
    weights: { event: 0.15, comfort: 0.15, thesis: 0.10 }, // max penalty 0.40 → modifier 0.6–1.0
    thesisVetoProb: 0.6,   // P(top "damaged" level) at or above this → veto
    ruleBlockProb: 0.7,    // block-rule noul at or above this → veto
    ruleWarnProb: 0.5,     // any rule noul at or above this → warning
    lowConfidence: 0.5,    // Score confidence below this → "review" badge
};

export function jevConfigured() {
    return Boolean(env.typesafeApiKey);
}

export async function askJev(state, questions, attempt = 0) {
    const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.typesafeApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, state, questions }),
        signal: AbortSignal.timeout(30000),
    });
    if ((resp.status === 429 || resp.status === 529) && attempt < 3) {
        await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
        return askJev(state, questions, attempt + 1);
    }
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`Jev ${resp.status}: ${body.slice(0, 200)}`);
    }
    return resp.json();
}

/** Active plain-English scanner rules. Tolerates the table not existing yet (migration not run). */
export async function getActiveRules() {
    try {
        return await db('scanner_rules').where({ is_active: true }).orderBy('id');
    } catch {
        return [];
    }
}

// ─── Questions ───────────────────────────────────────────────────────────────
export const Q_EVENT = {
    type: 'score',
    instructions: 'We plan to sell a cash-secured put on the company in `company`, expiring in one to two months. Leaving aside the regular quarterly earnings report described in `scheduled_earnings`, do the `headlines` point to an upcoming event inside that window that could move the stock sharply?',
    criteria: [
        'No upcoming event is mentioned beyond normal business and market news.',
        'A minor scheduled event is mentioned, such as a product launch, a conference presentation or an investor day.',
        'A significant pending event is mentioned, such as a major contract award, an index inclusion or removal, a shareholder vote on a large deal, or an important regulatory review.',
        'A make-or-break event is pending, such as an FDA or clinical trial decision, a court ruling or lawsuit verdict, a merger closing or collapsing, or a bankruptcy or delisting deadline.',
    ],
};
export const Q_THESIS = {
    type: 'score',
    instructions: 'Based on the `headlines`, has something happened recently that damages the long-term investment case for the company in `company`?',
    criteria: [
        'The headlines are routine: market commentary, analyst price targets, product news, or moves with the whole sector.',
        'The headlines report a setback the business can absorb, such as a missed quarter, an analyst downgrade, a product delay or an executive departure.',
        'The headlines report damage that can permanently impair the company, such as accounting fraud, a going-concern warning, delisting, losing its main customer or product, or a guidance cut that resets the investment case.',
    ],
};
export const Q_COMFORT = {
    type: 'score',
    instructions: 'If the put is assigned we must buy 100 shares of the company in `company` and hold them while selling covered calls. How comfortable would a conservative long-term investor be owning this stock, given the business in `company` and the facts in `price_context`?',
    criteria: [
        'Speculative: an unprofitable or early-stage company, a meme or heavily shorted stock, or a leveraged or inverse fund.',
        'Volatile: a real business, but highly cyclical, commodity-driven, heavily indebted, or dependent on one product or customer.',
        'Solid: an established, profitable company or a sector fund that would recover from a normal downturn.',
        'Core holding: a dominant, highly profitable market leader or a broad-market index fund that investors are glad to buy on dips.',
    ],
};
export function ruleQuestion(ruleText) {
    return {
        type: 'noul',
        instructions: `Our trading rule says: "${ruleText}". Using \`company\` and \`headlines\`, would selling a put on this stock go against that rule?`,
        criteria: {
            true: 'Yes, this stock is the kind of stock the rule forbids or warns against.',
            false: 'No, the rule does not apply to this stock.',
        },
    };
}

function priceContext(vol) {
    if (!vol?.lastClose) return [];
    const out = [];
    if (vol.ma200) out.push(vol.lastClose >= vol.ma200 ? 'The stock trades above its 200-day average (long-term uptrend).' : 'The stock trades below its 200-day average (long-term downtrend).');
    if (vol.high52 && vol.low52 && vol.high52 > vol.low52) {
        const pos = (vol.lastClose - vol.low52) / (vol.high52 - vol.low52);
        out.push(pos < 0.2 ? 'The stock is near its 52-week low.' : pos > 0.8 ? 'The stock is near its 52-week high.' : 'The stock is in the middle of its 52-week range.');
    }
    return out;
}

function levelProb(answer, level) {
    return answer?.probabilities?.[String(level)] ?? 0;
}

/**
 * Qualitative context for one ticker. `latestExpiry` (YYYY-MM-DD) is the furthest expiry being
 * considered — only used to phrase whether scheduled earnings fall inside the holding window.
 */
export async function getTickerAiContext(ticker, latestExpiry) {
    const T = ticker.toUpperCase();
    const rules = await getActiveRules();
    const key = `${T}|${latestExpiry || ''}|${rules.map(r => `${r.id}:${r.action}:${r.rule_text}`).join('|')}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

    const [profile, headlines, earnings, vol] = await Promise.all([
        getCompanyProfile(T), getRecentHeadlines(T), getEarningsDate(T), getVolatilityStats(T),
    ]);

    let scheduledEarnings = 'No upcoming earnings date is known.';
    if (earnings?.date) {
        const inWindow = latestExpiry ? earnings.date <= latestExpiry : null;
        scheduledEarnings = inWindow == null
            ? 'The company has a regular quarterly earnings report coming up.'
            : inWindow
                ? 'The regular quarterly earnings report falls inside the option holding window.'
                : 'The regular quarterly earnings report falls after the options expire.';
    }

    const state = {
        company: {
            ticker: T,
            name: profile?.name || T,
            sector: profile?.sector || 'unknown',
            industry: profile?.industry || 'unknown',
            description: profile?.description || 'No description available.',
        },
        headlines: (headlines || []).map(h => `${h.title} (${h.publisher})`),
        scheduled_earnings: scheduledEarnings,
        price_context: priceContext(vol),
    };

    const hasNews = state.headlines.length > 0;
    const questions = { owner_comfort: Q_COMFORT };
    if (hasNews) {
        questions.event_risk = Q_EVENT;
        questions.thesis_break = Q_THESIS;
    }
    rules.forEach(r => { questions[`rule_${r.id}`] = ruleQuestion(r.rule_text); });

    const resp = await askJev(state, questions);
    const a = resp.answers || {};
    const P = AI_POLICY;

    const event = a.event_risk ? { score: a.event_risk.score, max: 3, confidence: a.event_risk.confidence, label: a.event_risk.legend?.[String(Math.round(a.event_risk.score))] } : null;
    const thesis = a.thesis_break ? { score: a.thesis_break.score, max: 2, confidence: a.thesis_break.confidence, damage_prob: levelProb(a.thesis_break, 2), label: a.thesis_break.legend?.[String(Math.round(a.thesis_break.score))] } : null;
    const comfort = a.owner_comfort ? { score: a.owner_comfort.score, max: 3, confidence: a.owner_comfort.confidence, label: a.owner_comfort.legend?.[String(Math.round(a.owner_comfort.score))] } : null;
    const ruleResults = rules.map(r => ({
        id: r.id, rule: r.rule_text, action: r.action,
        prob: a[`rule_${r.id}`]?.noul ?? null,
    }));

    const penalty =
        P.weights.event * (event ? event.score / 3 : 0)
        + P.weights.comfort * (comfort ? 1 - comfort.score / 3 : 0.5)
        + P.weights.thesis * (thesis ? thesis.score / 2 : 0);

    const warnings = [];
    const vetoReasons = [];
    if (thesis && thesis.damage_prob >= P.thesisVetoProb) vetoReasons.push('Headlines suggest lasting damage to the business');
    else if (thesis && thesis.score >= 1) warnings.push('Recent setback in the headlines');
    if (event && event.score >= 2) warnings.push('Pending event in the headlines');
    if (comfort && comfort.score < 1) warnings.push('Speculative to own if assigned');
    for (const r of ruleResults) {
        if (r.prob == null) continue;
        if (r.action === 'block' && r.prob >= P.ruleBlockProb) vetoReasons.push(`Rule: ${r.rule}`);
        else if (r.prob >= P.ruleWarnProb) warnings.push(`Rule: ${r.rule}`);
    }
    const review = [event, comfort, thesis].some(x => x && x.confidence != null && x.confidence < P.lowConfidence);

    const value = {
        ticker: T,
        model: resp.model,
        penalty: Math.round(penalty * 1000) / 1000,
        veto: vetoReasons.length > 0,
        veto_reasons: vetoReasons,
        warnings,
        review,
        event_risk: event,
        thesis_break: thesis,
        owner_comfort: comfort,
        rules: ruleResults,
        profile,
        headlines: headlines || [],
        earnings: earnings || null,
        generated_at: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), value });
    return value;
}

/** Run a list of tickers with limited concurrency; failures come back as { ticker, error }. */
export async function getAiContextForTickers(items, concurrency = 4) {
    const out = [];
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const { ticker, latest_expiry } = items[i++];
            try {
                out.push(await getTickerAiContext(ticker, latest_expiry));
            } catch (err) {
                console.warn(`[Jev] context failed for ${ticker}:`, err.message);
                out.push({ ticker: String(ticker).toUpperCase(), error: err.message });
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return out;
}
