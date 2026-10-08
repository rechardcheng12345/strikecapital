import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Star, ExternalLink, AlertTriangle } from 'lucide-react';
import { zeroDteApi, simApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input } from '../../components/ui';
import { money, pct } from './simShared';

const VERDICT = {
    trade: { label: 'Trade', cls: 'bg-green-100 text-green-800 border-green-300' },
    smaller: { label: 'Trade smaller', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
    skip: { label: 'Skip today', cls: 'bg-red-100 text-red-800 border-red-300' },
};

function Box({ title, children, right }) {
    return (
        <section className="min-w-0 bg-white border border-ink/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-ink uppercase tracking-wider">{title}</h2>
                {right}
            </div>
            <div className="min-w-0 overflow-x-auto">{children}</div>
        </section>
    );
}

function Fact({ label, value, sub }) {
    return (
        <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
            <p className="text-lg font-bold text-ink" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</p>
            {sub && <p className="text-xs text-gray-500">{sub}</p>}
        </div>
    );
}

function CandidateTable({ side, rows, selected, onSelect }) {
    const td = 'px-2 py-1.5 text-right font-mono whitespace-nowrap';
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-ink/10">
                        {['', 'Spread', 'From price', 'Credit', 'Natural', 'Max loss', 'Need win', 'Hit (2y)', 'Hit (sim. VIX)', 'EV', 'Δ short', ''].map((h, i) => (
                            <th key={i} className={`px-2 py-2 font-medium ${i > 1 ? 'text-right' : ''}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((c) => {
                        const on = selected?.short_strike === c.short_strike;
                        return (
                            <tr key={c.short_strike} onClick={() => onSelect(on ? null : c)} className={`border-b border-gray-100 cursor-pointer ${on ? 'bg-accent/10' : c.beyond_forecast ? 'hover:bg-paper' : 'text-gray-400 hover:bg-paper'}`}>
                                <td className="px-2 py-1.5"><input type="radio" readOnly checked={on} /></td>
                                <td className="px-2 py-1.5 whitespace-nowrap font-semibold text-ink">
                                    {c.short_strike}/{c.long_strike}{side === 'call' ? 'C' : 'P'}
                                    {c.suggested && <Star className="inline w-3.5 h-3.5 ml-1 text-accent fill-accent" />}
                                </td>
                                <td className={td}>{pct(c.distance_pct)}</td>
                                <td className={`${td} font-semibold ${c.meets_target ? 'text-green-700' : ''}`}>{money(c.credit_dollars)}</td>
                                <td className={td}>{c.natural_credit != null ? money(c.natural_credit * 100) : '—'}</td>
                                <td className={`${td} text-red-600`}>{money(c.max_loss)}</td>
                                <td className={td}>{pct(c.breakeven_win_rate, 1)}</td>
                                <td className={td}>{c.hist_hit_pct != null ? pct(c.hist_hit_pct, 1) : '—'}</td>
                                <td className={td}>{c.hist_hit_regime_pct != null ? pct(c.hist_hit_regime_pct, 1) : '—'}</td>
                                <td className={`${td} ${c.expected_value > 0 ? 'text-green-700' : 'text-red-600'}`}>{money(c.expected_value)}</td>
                                <td className={td}>{c.short.delta != null ? Math.abs(c.short.delta).toFixed(2) : '—'}</td>
                                <td className="px-2 py-1.5 text-right whitespace-nowrap text-[10px]">
                                    {c.beyond_forecast ? <span className="text-green-700">outside range</span> : <span className="text-amber-700">inside range</span>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {!rows.length && <p className="text-sm text-gray-400 text-center py-6">No {side} spreads with a credit.</p>}
        </div>
    );
}

function TradePanel({ scan, put, call }) {
    const queryClient = useQueryClient();
    const { data } = useApiQuery({ queryKey: ['sim', 'portfolios'], queryFn: () => simApi.listPortfolios() });
    const portfolios = (data?.portfolios || []).filter((p) => p.is_active);
    const [portfolioId, setPortfolioId] = useState('');
    const [contracts, setContracts] = useState(1);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);
    useEffect(() => {
        if (!portfolioId && portfolios.length === 1) setPortfolioId(String(portfolios[0].id));
    }, [portfolios, portfolioId]);
    const legs = [put, call].filter(Boolean);
    const credit = legs.reduce((a, c) => a + c.credit_dollars, 0) * contracts;
    const width = scan.settings.width;
    // Only one side of a condor can finish in the money, so the worst case is one width minus all credit
    const maxLoss = legs.length ? width * 100 * contracts - credit : 0;
    const chosen = portfolios.find((p) => String(p.id) === String(portfolioId));

    const submit = async () => {
        setBusy(true);
        const res = await simApi.openSpreads(Number(portfolioId), {
            ticker: scan.ticker,
            expiration_date: scan.expiry,
            contracts,
            legs: legs.map((c) => ({ option_type: c.side, short_strike: c.short_strike, long_strike: c.long_strike })),
            entry_context: {
                source: '0dte_scan', price: scan.underlying.price, vix: scan.vix, forecast_high: scan.forecast.high, forecast_low: scan.forecast.low,
                ai_verdict: scan.ai?.verdict || null, ai_score: scan.ai?.score ?? null,
                legs: legs.map((c) => ({ side: c.side, short: c.short_strike, hit_pct: c.hist_hit_pct, hit_regime_pct: c.hist_hit_regime_pct, credit: c.credit, suggested: c.suggested })),
            },
        });
        setBusy(false);
        if (res.error) return toast.error(res.error);
        const got = res.data.reduce((a, x) => a + x.entry_price * 100 * x.contracts, 0);
        toast.success(`Paper trade: ${legs.length === 2 ? 'iron condor' : `${legs[0].side} spread`} on ${scan.ticker}, credit ${money(got)} at live mids`);
        setDone(Number(portfolioId));
        queryClient.invalidateQueries({ queryKey: ['sim'] });
    };

    return (
        <Box title="Paper trade">
            {!legs.length ? (
                <p className="text-sm text-gray-500">Pick a put spread and/or a call spread above — one of each makes an iron condor.</p>
            ) : (
                <div className="space-y-3">
                    <p className="text-sm">
                        {legs.map((c) => `${scan.ticker} ${c.short_strike}/${c.long_strike}${c.side === 'call' ? 'C' : 'P'}`).join(' + ')}
                        {legs.length === 2 && <span className="text-gray-500"> (iron condor)</span>}
                    </p>
                    <div className="grid sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio</label>
                            <select value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)} className="block w-full px-3 py-2 border border-gray-300 rounded-lg sm:text-sm">
                                <option value="">Choose…</option>
                                {portfolios.map((p) => <option key={p.id} value={p.id}>{p.name} — free {money(p.free_cash)}</option>)}
                            </select>
                        </div>
                        <Input label="Contracts" type="number" min={1} value={contracts} onChange={(e) => setContracts(Math.max(1, parseInt(e.target.value, 10) || 1))} />
                        <div className="text-sm pt-6">
                            Credit ≈ <strong className="text-green-700">{money(credit)}</strong> · max loss ≈ <strong className="text-red-600">{money(maxLoss)}</strong>
                        </div>
                    </div>
                    {chosen && <p className="text-xs text-gray-500">Exit rule in this portfolio: {chosen.spread_exit_rule === 'loss2x' ? 'close at 2× credit loss' : chosen.spread_exit_rule === 'hold' ? 'hold to expiry' : 'close when the price touches the short strike'} (change it in the portfolio settings).</p>}
                    <div className="flex items-center gap-3">
                        <Button size="sm" onClick={submit} loading={busy} disabled={!portfolioId}>Sell at live mids</Button>
                        {done && <Link to={`/admin/simulation/${done}`} className="text-sm text-accent hover:underline">Open portfolio →</Link>}
                    </div>
                    {!portfolios.length && <p className="text-xs text-gray-500">No active paper portfolio — create one under Simulation.</p>}
                </div>
            )}
        </Box>
    );
}

export function ZeroDtePage() {
    const [ticker, setTicker] = useState('SPY');
    const [width, setWidth] = useState(2);
    const [target, setTarget] = useState(10);
    const [scan, setScan] = useState(null);
    const [busy, setBusy] = useState(false);
    const [put, setPut] = useState(null);
    const [call, setCall] = useState(null);

    const run = async () => {
        setBusy(true);
        const res = await zeroDteApi.scan({ ticker, width: Number(width) || 2, target_credit: Number(target) || 0 });
        setBusy(false);
        if (res.error) return toast.error(res.error);
        setScan(res.data);
        setPut(res.data.puts.find((c) => c.suggested) || null);
        setCall(res.data.calls.find((c) => c.suggested) || null);
    };
    const v = scan?.ai?.verdict ? VERDICT[scan.ai.verdict] : null;
    const u = scan?.underlying;
    const timeLeft = useMemo(() => (scan ? `${Math.floor(scan.minutes_left / 60)}h ${scan.minutes_left % 60}m` : ''), [scan]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>0DTE Spreads</h1>
                    <p className="text-sm text-gray-500">Same-day credit spreads on SPY / QQQ. Scan after the first 30 minutes (≈10:00 New York, 22:00 Singapore in US summer time).</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                    <div className="flex border border-line">
                        {['SPY', 'QQQ'].map((t) => (
                            <button key={t} type="button" onClick={() => setTicker(t)} className={`px-4 py-2 text-sm font-semibold ${ticker === t ? 'bg-ink text-white' : 'text-ink'}`}>{t}</button>
                        ))}
                    </div>
                    <div className="w-24"><Input label="Width ($)" type="number" min={1} value={width} onChange={(e) => setWidth(e.target.value)} /></div>
                    <div className="w-28"><Input label="Min credit ($)" type="number" min={0} value={target} onChange={(e) => setTarget(e.target.value)} /></div>
                    <Button onClick={run} loading={busy}><Search className="w-4 h-4 mr-1.5" />Scan</Button>
                </div>
            </div>

            {!scan && !busy && (
                <div className="bg-white border border-ink/10 p-6 text-sm text-gray-600 space-y-2">
                    <p><strong>How it works:</strong> the scan predicts today&apos;s high and low three ways — the options market (today&apos;s at-the-money straddle), the VIX, and 2 years of how far {ticker} moved from its open — and lists call spreads above and put spreads below with their live credit and how often history reached each short strike.</p>
                    <p>A $10 credit on a $2 spread risks about $190: you need to win roughly 19 of every 20 trades just to break even. Paper-trade it first and watch the &ldquo;wins lost per loss&rdquo; number in the portfolio.</p>
                </div>
            )}

            {scan && (
                <>
                    {!scan.is_0dte && (
                        <div className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                            <AlertTriangle className="w-4 h-4" /> No expiry today — showing the next one ({scan.expiry}). Forecast uses a full day.
                        </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 bg-white border border-ink/10 p-4">
                        <Fact label={`${scan.ticker} now`} value={money(u.price)} sub={u.prev_close ? `${(((u.price - u.prev_close) / u.prev_close) * 100).toFixed(2)}% vs yesterday` : null} />
                        <Fact label="Open" value={money(u.open)} sub={u.open && u.prev_close ? `gap ${(((u.open - u.prev_close) / u.prev_close) * 100).toFixed(2)}%` : null} />
                        <Fact label="Today high / low" value={`${u.high ?? '—'} / ${u.low ?? '—'}`} />
                        <Fact label="VIX" value={scan.vix?.toFixed(2) ?? '—'} />
                        <Fact label="Expiry" value={scan.expiry} sub={scan.is_0dte ? `${timeLeft} to the close` : null} />
                        <Fact label="Priced-in move" value={scan.implied_move ? `±${money(scan.implied_move.move)}` : '—'} sub={scan.implied_move ? `${scan.implied_move.strike} straddle` : null} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Box title="Today's range forecast">
                            <table className="w-full text-sm">
                                <tbody>
                                    {scan.forecast.methods.map((m) => (
                                        <tr key={m.key} className="border-b border-gray-100">
                                            <td className="py-1.5 pr-2 text-gray-600">{m.label}</td>
                                            <td className="py-1.5 text-right font-mono whitespace-nowrap">{m.low} – {m.high}</td>
                                        </tr>
                                    ))}
                                    <tr>
                                        <td className="py-2 pr-2 font-semibold text-ink">Combined (widest)</td>
                                        <td className="py-2 text-right font-mono font-semibold text-ink whitespace-nowrap">{scan.forecast.low} – {scan.forecast.high}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <p className="text-xs text-gray-500 mt-2">
                                History: {scan.history.all?.n} days{scan.history.regime ? `, ${scan.history.regime.n} with a similar VIX` : ''}. Typical daily range {scan.history.typical_range_pct}%.
                            </p>
                        </Box>
                        <div className="lg:col-span-2">
                            <Box title="AI day check (Jev)" right={v && <span className={`px-3 py-1 text-sm font-bold border ${v.cls}`}>{v.label}</span>}>
                                {scan.ai?.note && <p className="text-sm text-amber-700 mb-2">{scan.ai.note}</p>}
                                {scan.ai?.label && <p className="text-sm text-ink mb-2">{scan.ai.label} <span className="text-xs text-gray-400">(score {scan.ai.score} of 3{scan.ai.review ? ', low confidence — review' : ''})</span></p>}
                                <ul className="text-sm text-gray-600 list-disc pl-5 space-y-0.5">
                                    {scan.ai?.day_summary?.map((w) => <li key={w}>{w}</li>)}
                                </ul>
                                {scan.ai?.headlines?.length > 0 && (
                                    <div className="mt-3">
                                        <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Headlines (last day)</p>
                                        <ul className="text-xs space-y-0.5">
                                            {scan.ai.headlines.slice(0, 6).map((h) => (
                                                <li key={h.link}><a href={h.link} target="_blank" rel="noreferrer" className="text-ink hover:underline">{h.title}</a> <span className="text-gray-400">· {h.publisher}</span> <ExternalLink className="inline w-3 h-3 text-gray-300" /></li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </Box>
                        </div>
                    </div>

                    <Box title={`Call spreads above ${money(u.price)}`} right={<span className="text-xs text-gray-400">★ suggestion · green credit = meets your minimum</span>}>
                        <CandidateTable side="call" rows={scan.calls} selected={call} onSelect={setCall} />
                    </Box>
                    <Box title={`Put spreads below ${money(u.price)}`}>
                        <CandidateTable side="put" rows={scan.puts} selected={put} onSelect={setPut} />
                    </Box>
                    <p className="text-xs text-gray-500 -mt-3">
                        Hit = share of past days whose high (calls) or low (puts) reached the short strike&apos;s distance from the open. EV assumes every hit is a full loss (conservative). Need win = win rate required to break even.
                    </p>
                    <TradePanel scan={scan} put={put} call={call} />
                </>
            )}
        </div>
    );
}
