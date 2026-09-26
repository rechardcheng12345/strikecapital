import { useEffect, useState } from 'react';
import { X, PlusCircle, CheckCircle, Brain, Ban, ExternalLink } from 'lucide-react';
import { FIT_LABELS, finalScore } from './scannerShared';

function formatCurrency(v) {
    if (v == null) return '—';
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPct(v) {
    if (v == null) return '—';
    return Number(v).toFixed(2) + '%';
}
function formatNum(v, dec = 4) {
    if (v == null) return '—';
    return Number(v).toFixed(dec);
}
function scoreColor(score) {
    if (score >= 70) return 'text-green-600 font-semibold';
    if (score >= 50) return 'text-yellow-600 font-semibold';
    return 'text-gray-400';
}
function deltaColor(delta) {
    if (delta == null) return 'text-gray-500';
    const abs = Math.abs(delta);
    if (abs <= 0.20) return 'text-green-600';
    if (abs <= 0.30) return 'text-yellow-600';
    return 'text-red-600';
}
function popColor(pct) {
    if (pct == null) return 'text-gray-500';
    if (pct >= 80) return 'text-green-600 font-semibold';
    if (pct >= 70) return 'text-yellow-600';
    return 'text-red-600';
}
function edgeColor(edge) {
    if (edge == null) return 'text-gray-500';
    if (edge >= 10) return 'text-green-600 font-semibold';
    if (edge >= 0) return 'text-green-700';
    if (edge >= -10) return 'text-yellow-600';
    return 'text-red-600';
}
function spreadColor(pct) {
    if (pct == null) return 'text-gray-500';
    if (pct <= 5) return 'text-green-600';
    if (pct <= 15) return 'text-yellow-600';
    return 'text-red-600';
}

function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
}

function bsPutPrice(S, K, T, sigma, r = 0.045) {
    if (T <= 0 || sigma <= 0 || S <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

function PremiumEstimator({ row }) {
    const [targetPrice, setTargetPrice] = useState('');
    const iv = (row.iv ?? 0) / 100;
    const T = (row.days_to_expiry ?? 0) / 365;
    const estimate = targetPrice && Number(targetPrice) > 0
        ? bsPutPrice(Number(targetPrice), row.strike, T, iv)
        : null;
    const currentBSPrice = bsPutPrice(row.stock_price, row.strike, T, iv);

    return (
        <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-500 font-medium">If {row.ticker} drops to</span>
                <input
                    type="number"
                    step="0.5"
                    value={targetPrice}
                    onChange={e => setTargetPrice(e.target.value)}
                    placeholder={`e.g. ${Math.floor(row.stock_price * 0.95)}`}
                    className="w-24 px-2 py-1 border border-gray-300 text-xs focus:outline-none focus:border-[#F06010]"
                />
            </div>
            {estimate !== null && (
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-500">est. premium:</span>
                    <span className="font-bold text-[#0D2654]">${(estimate * 100).toFixed(2)}/contract</span>
                    <span className="text-gray-400">(${estimate.toFixed(4)}/sh)</span>
                    {row.premium > 0 && (
                        <span className={`font-medium ${estimate > row.premium ? 'text-green-600' : 'text-red-600'}`}>
                            {estimate > row.premium ? '+' : ''}{((estimate - row.premium) / row.premium * 100).toFixed(1)}% vs current
                        </span>
                    )}
                </div>
            )}
            {currentBSPrice > 0 && (
                <p className="text-gray-400">
                    BS model @ current: ${(currentBSPrice * 100).toFixed(2)} vs market: ${(row.premium * 100).toFixed(2)}
                </p>
            )}
        </div>
    );
}

function LevelsBlock({ levels, strike }) {
    const l = levels;
    const allSupport = [...(l.swingSupport || [])];
    if (l.ma50) allSupport.push(l.ma50);
    if (l.ma200) allSupport.push(l.ma200);
    const supportBelow = allSupport.filter(s => s < strike).sort((a, b) => b - a);
    const supportAbove = allSupport.filter(s => s >= strike);
    let ctx = null;
    if (supportAbove.length > 0) {
        ctx = { color: 'text-yellow-700 bg-yellow-50', text: `Strike overlaps support at $${supportAbove[0].toFixed(2)} — watch closely` };
    } else if (supportBelow.length > 0) {
        ctx = { color: 'text-green-700 bg-green-50', text: `Strike below nearest support at $${supportBelow[0].toFixed(2)} — good cushion` };
    }

    return (
        <div className="space-y-1.5 text-xs text-gray-600">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <span><strong className="text-[#0D2654]">52W High:</strong> {l.fiftyTwoWeekHigh ? formatCurrency(l.fiftyTwoWeekHigh) : '—'}</span>
                <span><strong className="text-[#0D2654]">52W Low:</strong> {l.fiftyTwoWeekLow ? formatCurrency(l.fiftyTwoWeekLow) : '—'}</span>
                <span><strong className="text-[#0D2654]">MA50:</strong> {l.ma50 ? formatCurrency(l.ma50) : '—'}</span>
                <span><strong className="text-[#0D2654]">MA200:</strong> {l.ma200 ? formatCurrency(l.ma200) : '—'}</span>
            </div>
            {l.swingSupport?.length > 0 && (
                <p><strong className="text-green-700">Support:</strong> {l.swingSupport.map(p => '$' + p.toFixed(2)).join(', ')}</p>
            )}
            {ctx && (
                <p className={`inline-block px-2 py-0.5 rounded font-medium ${ctx.color}`}>{ctx.text}</p>
            )}
        </div>
    );
}

// Horizontal bar for a Jev Score answer; `good` = which end is favourable.
function JevScoreBar({ label, answer, good = 'low' }) {
    if (!answer) return null;
    const pct = Math.max(0, Math.min(1, answer.score / answer.max));
    const badness = good === 'low' ? pct : 1 - pct;
    const color = badness >= 0.6 ? '#dc2626' : badness >= 0.3 ? '#F06010' : '#16a34a';
    return (
        <div className="text-xs">
            <div className="flex justify-between mb-0.5">
                <span className="text-gray-500">{label}</span>
                <span className="text-gray-400" title="How concentrated Jev's answer is (1.0 = certain)">
                    conf {answer.confidence != null ? answer.confidence.toFixed(2) : '—'}
                </span>
            </div>
            <div className="h-1.5 bg-gray-200">
                <div className="h-full" style={{ width: `${Math.max(pct * 100, 3)}%`, backgroundColor: color }} />
            </div>
            {answer.label && <p className="text-[11px] text-gray-600 mt-1 leading-snug">{answer.label}</p>}
        </div>
    );
}

function AiContextBlock({ ctx, row, aiWeight }) {
    if (!ctx) return <p className="text-xs text-gray-400">Not loaded.</p>;
    if (ctx.loading) return <p className="text-xs text-gray-500">Asking Jev…</p>;
    if (ctx.error) return <p className="text-xs text-red-500">{ctx.error}</p>;
    const fs = finalScore(row, ctx, aiWeight);
    return (
        <div className="space-y-3">
            {ctx.veto && (
                <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 text-xs text-red-700">
                    <Ban className="w-4 h-4 flex-shrink-0" />
                    <div><strong>Vetoed.</strong> {ctx.veto_reasons.join(' · ')}</div>
                </div>
            )}
            {!ctx.veto && ctx.warnings.length > 0 && (
                <ul className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 list-disc pl-6">
                    {ctx.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
            )}
            {ctx.review && <p className="text-xs text-gray-500">Jev is unsure about at least one answer — review manually.</p>}
            <JevScoreBar label="Event risk in window" answer={ctx.event_risk} good="low" />
            <JevScoreBar label="Damage to the business" answer={ctx.thesis_break} good="low" />
            <JevScoreBar label="Comfort owning if assigned" answer={ctx.owner_comfort} good="high" />
            {!ctx.event_risk && <p className="text-[11px] text-gray-400">No recent headlines — event and damage checks skipped.</p>}
            {ctx.rules?.length > 0 && (
                <div className="text-xs">
                    <p className="text-gray-500 mb-1">My rules</p>
                    <ul className="space-y-0.5">
                        {ctx.rules.map(r => (
                            <li key={r.id} className="flex justify-between gap-2">
                                <span className="text-gray-700">{r.rule}</span>
                                <span className={`font-medium ${r.prob >= 0.5 ? (r.action === 'block' ? 'text-red-600' : 'text-amber-700') : 'text-green-700'}`}>
                                    {r.prob == null ? '—' : r.prob >= 0.5 ? `matches (${Math.round(r.prob * 100)}%)` : 'ok'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <p className="text-xs text-gray-600">
                Score: quant {row.score} × (1 − {Math.round(aiWeight * 100)}% × penalty {ctx.penalty.toFixed(2)}) = <strong className="text-[#0D2654]">{fs}</strong>
            </p>
            {ctx.headlines?.length > 0 && (
                <div className="text-xs">
                    <p className="text-gray-500 mb-1">Headlines Jev read</p>
                    <ul className="space-y-1">
                        {ctx.headlines.map((h, i) => (
                            <li key={i} className="leading-snug">
                                <a href={h.link} target="_blank" rel="noreferrer" className="text-[#0D2654] hover:text-[#F06010] inline-flex gap-1">
                                    <span>{h.title}</span><ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                                </a>
                                <span className="text-gray-400"> · {h.publisher}, {h.published}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {ctx.profile?.industry && (
                <p className="text-[11px] text-gray-400">{ctx.profile.name} · {ctx.profile.sector} / {ctx.profile.industry}</p>
            )}
        </div>
    );
}

function Metric({ label, children }) {
    return (
        <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">{label}</div>
            <div className="text-sm text-[#0D2654] font-medium">{children}</div>
        </div>
    );
}

export function OptionScannerDetailPanel({
    row,
    aiContext,
    aiWeight = 1,
    onClose,
    levelsState,
    onNeedLevels,
    added,
    adding,
    onAddToMonitoring,
}) {
    useEffect(() => {
        if (row?.ticker) onNeedLevels(row.ticker);
    }, [row?.ticker, onNeedLevels]);

    if (!row) return null;

    const parts = row.score_parts || {};
    const midPerContract = row.mid != null ? row.mid * 100 : (row.premium != null ? row.premium * 100 : null);

    return (
        <>
            <button
                type="button"
                className="fixed inset-0 bg-black/40 z-30 md:hidden"
                aria-label="Close details"
                onClick={onClose}
            />
            <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-white shadow-xl overflow-y-auto md:static md:z-auto md:w-[420px] md:max-w-none md:shadow-none md:border-l-2 md:border-[#0D2654]/10">
                <div className="sticky top-0 bg-white border-b border-[#0D2654]/10 px-4 py-3 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs uppercase tracking-wider text-gray-400">Contract</p>
                        <h3 className="text-lg font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                            {row.ticker} {formatCurrency(row.strike)} PUT
                        </h3>
                        <p className="text-xs text-gray-500">{row.expiry} · {row.days_to_expiry}d · <span className={scoreColor(finalScore(row, aiContext, aiWeight))}>Score {finalScore(row, aiContext, aiWeight) ?? '—'}</span></p>
                    </div>
                    <button type="button" onClick={onClose} className="text-gray-400 hover:text-[#0D2654] p-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="px-4 py-4 space-y-5">
                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Quote</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Metric label="Mid / contract">{midPerContract != null ? formatCurrency(midPerContract) : '—'}</Metric>
                            <Metric label="Last">{row.premium != null ? formatCurrency(row.premium) : '—'}</Metric>
                            <Metric label="Bid / Ask">
                                {row.bid != null && row.ask != null ? `${formatCurrency(row.bid)} / ${formatCurrency(row.ask)}` : '—'}
                            </Metric>
                            <Metric label="Spread">
                                <span className={spreadColor(row.spread_pct)}>{row.spread_pct != null ? row.spread_pct.toFixed(1) + '%' : '—'}</span>
                            </Metric>
                        </div>
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Greeks</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Metric label="Delta"><span className={deltaColor(row.delta)}>{row.delta != null ? formatNum(row.delta, 3) : '—'}</span></Metric>
                            <Metric label="POP"><span className={popColor(row.pop_keep_premium)}>{row.pop_keep_premium != null ? row.pop_keep_premium.toFixed(1) + '%' : '—'}</span></Metric>
                            <Metric label="Theta">{row.theta != null ? formatNum(row.theta, 4) : '—'}</Metric>
                            <Metric label="IV">{row.iv != null ? formatPct(row.iv) : '—'}</Metric>
                        </div>
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Edge vs Black-Scholes</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Metric label="Edge">
                                <span className={edgeColor(row.premium_edge_pct)}>
                                    {row.premium_edge_pct != null
                                        ? (row.premium_edge_pct >= 0 ? '+' : '') + row.premium_edge_pct.toFixed(1) + '%'
                                        : '—'}
                                </span>
                            </Metric>
                            <Metric label="BS Fair">{row.bs_fair_value != null ? '$' + Number(row.bs_fair_value).toFixed(2) : '—'}</Metric>
                        </div>
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Liquidity</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Metric label="Open interest">{row.open_interest != null ? Number(row.open_interest).toLocaleString() : '—'}</Metric>
                            <Metric label="Volume">{row.volume != null ? Number(row.volume).toLocaleString() : '—'}</Metric>
                        </div>
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">30–60 DTE view</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Metric label="Days to 80% (flat stock)">{row.days_to_80 != null ? `~${row.days_to_80}d of ${row.days_to_expiry}d` : '—'}</Metric>
                            <Metric label="Managed ann. return">{row.managed_ann_pct != null ? row.managed_ann_pct.toFixed(1) + '%' : '—'}</Metric>
                            <Metric label="Expected move (1σ)">{row.expected_move != null ? `±${formatCurrency(row.expected_move)}` : '—'}</Metric>
                            <Metric label="Strike vs move">
                                <span className={row.sigma_otm >= 1 ? 'text-green-600' : row.sigma_otm >= 0.6 ? '' : 'text-red-600'}>
                                    {row.sigma_otm != null ? `${row.sigma_otm.toFixed(2)}σ below` : '—'}
                                </span>
                            </Metric>
                            <Metric label="IV / 20d realized">{row.iv_hv_ratio != null ? `${row.iv_hv_ratio.toFixed(2)}× (${formatPct(row.iv)} / ${formatPct(row.hv20)})` : '—'}</Metric>
                            <Metric label="Theta / contract / day">{row.theta_per_day != null ? formatCurrency(row.theta_per_day) : '—'}</Metric>
                            <Metric label="Cost if assigned">{formatCurrency(row.cost_if_assigned)}</Metric>
                            <Metric label="vs 200-day avg · 52w low">
                                {row.cost_vs_ma200_pct != null ? `${row.cost_vs_ma200_pct > 0 ? '+' : ''}${row.cost_vs_ma200_pct.toFixed(1)}%` : '—'}
                                {' · '}
                                {row.cost_vs_52w_low_pct != null ? `${row.cost_vs_52w_low_pct > 0 ? '+' : ''}${row.cost_vs_52w_low_pct.toFixed(1)}%` : '—'}
                            </Metric>
                        </div>
                        <p className={`mt-2 text-xs px-2 py-1 inline-block ${row.earnings_before_expiry ? 'bg-purple-50 text-purple-800' : 'bg-gray-50 text-gray-600'}`}>
                            {row.earnings_date
                                ? `Earnings ${row.earnings_date}${row.earnings_estimated ? ' (est.)' : ''} — ${row.earnings_before_expiry ? 'BEFORE expiry (score ×0.85)' : 'after expiry'}`
                                : 'No earnings date found'}
                        </p>
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Portfolio fit (1 contract)</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <Metric label="Collateral">{formatCurrency(row.collateral)}</Metric>
                            <Metric label="% of capital base">{row.collateral_pct_of_base != null ? formatPct(row.collateral_pct_of_base) : '—'}</Metric>
                            <Metric label="Ticker exposure now → after">
                                {row.ticker_exposure_pct != null ? `${formatPct(row.ticker_exposure_pct)} → ${formatPct(row.ticker_exposure_after_pct)}` : '—'}
                            </Metric>
                            <Metric label="Max contracts affordable">{row.max_contracts ?? '—'}</Metric>
                        </div>
                        {(row.fit_flags || []).length > 0 && (
                            <ul className="mt-2 text-xs space-y-0.5">
                                {row.fit_flags.map(f => (
                                    <li key={f} className={f === 'ALREADY_HELD' ? 'text-gray-500' : 'text-red-600'}>• {FIT_LABELS[f] || f}</li>
                                ))}
                            </ul>
                        )}
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <Brain className="w-3.5 h-3.5 text-[#F06010]" /> Jev AI context
                        </h4>
                        <AiContextBlock ctx={aiContext} row={row} aiWeight={aiWeight} />
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Quant score breakdown</h4>
                        <ul className="text-xs space-y-1 text-gray-600">
                            <li className="flex justify-between"><span>Managed yield (max 35)</span><span className="font-medium text-[#0D2654]">{parts.yield ?? '—'}</span></li>
                            <li className="flex justify-between"><span>Delta sweet-spot (max 20)</span><span className="font-medium text-[#0D2654]">{parts.delta ?? '—'}</span></li>
                            <li className="flex justify-between"><span>Cushion vs expected move (max 15)</span><span className="font-medium text-[#0D2654]">{parts.cushion ?? '—'}</span></li>
                            <li className="flex justify-between"><span>IV richness (max 20)</span><span className="font-medium text-[#0D2654]">{parts.iv ?? '—'}</span></li>
                            <li className="flex justify-between"><span>Liquidity (max 10)</span><span className="font-medium text-[#0D2654]">{parts.liquidity ?? '—'}</span></li>
                            {parts.earnings_multiplier != null && parts.earnings_multiplier !== 1 && (
                                <li className="flex justify-between text-purple-700"><span>Earnings before expiry</span><span className="font-medium">×{parts.earnings_multiplier}</span></li>
                            )}
                            <li className="flex justify-between border-t border-[#0D2654]/10 pt-1 font-semibold text-[#0D2654]"><span>Quant score</span><span>{row.score ?? '—'}</span></li>
                        </ul>
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Support / resistance</h4>
                        {!levelsState || levelsState.loading ? (
                            <p className="text-xs text-gray-500">Loading levels…</p>
                        ) : levelsState.error ? (
                            <p className="text-xs text-red-500">{levelsState.error}</p>
                        ) : levelsState.data ? (
                            <LevelsBlock levels={levelsState.data} strike={row.strike} />
                        ) : (
                            <p className="text-xs text-gray-400">No level data.</p>
                        )}
                    </section>

                    <section>
                        <h4 className="text-xs font-semibold text-[#0D2654] uppercase tracking-wider mb-2">Premium estimator</h4>
                        <PremiumEstimator row={row} />
                    </section>

                    <button
                        type="button"
                        onClick={() => !added && onAddToMonitoring(row)}
                        disabled={adding || added}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#F06010] text-white text-sm font-medium hover:bg-[#F06010]/90 disabled:opacity-60 transition-colors"
                    >
                        {added
                            ? <><CheckCircle className="w-4 h-4" /> Added to Monitoring</>
                            : adding
                                ? <><PlusCircle className="w-4 h-4 animate-pulse" /> Adding…</>
                                : <><PlusCircle className="w-4 h-4" /> Add to Monitoring</>}
                    </button>
                </div>
            </aside>
        </>
    );
}
