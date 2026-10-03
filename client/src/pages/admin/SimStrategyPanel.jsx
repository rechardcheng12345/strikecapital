import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Play, CheckCircle2, XCircle } from 'lucide-react';
import { simApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, ErrorAlert, Skeleton } from '../../components/ui';
import { describeStrategy, sgtRange } from '../../lib/strategyText';
import { EquityChart, money, pct, signColor } from './simShared';

const TRIGGER_LABEL = { auto: 'Daily run', manual: 'Run now' };

/**
 * Automatic strategy portfolio: what it follows, when it runs, the decision log, and the Simulation's value
 * against the backtest of the same setting over the same days.
 */
export function SimStrategyPanel({ portfolio, snapshots }) {
    const queryClient = useQueryClient();
    const { data, isLoading, isError, error, refetch } = useApiQuery({ queryKey: ['sim', 'strategy', portfolio.id], queryFn: () => simApi.strategy(portfolio.id) });
    const [running, setRunning] = useState(false);
    const [runAt, setRunAt] = useState(null);
    const [saving, setSaving] = useState(false);
    const [showAll, setShowAll] = useState(false);

    const runNow = async () => {
        setRunning(true);
        const res = await simApi.runStrategy(portfolio.id);
        setRunning(false);
        if (res.error) return toast.error(res.error);
        (res.data.status === 'ok' ? toast.success : toast.error)(res.data.message);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
    };
    const saveRunAt = async () => {
        setSaving(true);
        const res = await simApi.updateStrategy(portfolio.id, { run_at: runAt });
        setSaving(false);
        if (res.error) return toast.error(res.error);
        toast.success(`Runs daily at ${runAt} New York`);
        setRunAt(null);
        queryClient.invalidateQueries({ queryKey: ['sim', 'strategy', portfolio.id] });
    };

    if (isLoading) return <Skeleton height={200} />;
    if (isError) return <ErrorAlert message={error?.message} onRetry={refetch} />;

    const { rules, notes, runs, backtest } = data;
    const scheduled = rules.run_at || '15:30';
    const series = [{ key: 'sim', name: 'Simulation (live fills)', points: snapshots.map((x) => ({ date: x.snap_date, value: x.total_value })) }];
    if (backtest?.equity?.length) series.push({ key: 'bt', name: 'Backtest, same setting', points: backtest.equity.map((e) => ({ date: e.date, value: e.equity })) });
    const shown = showAll ? runs : runs.slice(0, 15);

    return (
        <section className="bg-white border-2 border-[#F06010]/40 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider flex items-center gap-2"><Bot className="w-4 h-4 text-[#F06010]" />Automatic strategy</h2>
                    <p className="text-sm text-gray-700 mt-1">Follows the backtest setting <strong>{rules.preset_name}</strong> — the backtest engine decides, trades fill at the live Moomoo mid.</p>
                </div>
                <Button size="sm" onClick={runNow} loading={running} disabled={!portfolio.is_active}><Play className="w-4 h-4 mr-1.5" />Run now</Button>
            </div>

            <dl className="text-sm space-y-1">
                {describeStrategy(rules.params, rules.ticker).map((r) => (
                    <div key={r.label} className="flex gap-3"><dt className="w-24 shrink-0 text-xs uppercase tracking-wider text-gray-400 pt-0.5">{r.label}</dt><dd className="text-gray-700 min-w-0">{r.text}</dd></div>
                ))}
                <div className="flex gap-3 items-center flex-wrap">
                    <dt className="w-24 shrink-0 text-xs uppercase tracking-wider text-gray-400">Schedule</dt>
                    <dd className="text-gray-700 flex items-center gap-2 flex-wrap">
                        {runAt == null ? (
                            <>
                                <span>Every trading day at <strong>{scheduled}</strong> New York ({sgtRange(scheduled)})</span>
                                <button type="button" className="text-xs text-[#F06010] hover:underline" onClick={() => setRunAt(scheduled)}>change</button>
                            </>
                        ) : (
                            <>
                                <input type="time" value={runAt} onChange={(e) => setRunAt(e.target.value)} className="px-2 py-1 border border-gray-300 text-sm" />
                                <Button size="sm" onClick={saveRunAt} loading={saving}>Save</Button>
                                <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setRunAt(null)}>cancel</button>
                            </>
                        )}
                        {!portfolio.is_active && <span className="text-xs text-red-600">Paused — no daily runs</span>}
                    </dd>
                </div>
            </dl>
            {notes?.length > 0 && <ul className="text-xs text-gray-500 list-disc pl-5 space-y-0.5">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}

            <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-1">Simulation vs backtest (indexed to 100)</h3>
                <EquityChart series={series} height={220} />
                {backtest && !backtest.error && (
                    <p className="text-xs text-gray-500 mt-1">
                        Backtest of the same setting from this portfolio&apos;s start: <span className={signColor(backtest.total_return_pct)}>{backtest.total_return_pct > 0 ? '+' : ''}{pct(backtest.total_return_pct)}</span>
                        {' '}· {backtest.trades} closed · {backtest.open_puts} open · {pct(backtest.real_price_pct, 0)} real prices. A gap between the lines = live fills, timing and quotes vs the model.
                    </p>
                )}
                {backtest?.error && <p className="text-xs text-red-600 mt-1">Backtest comparison unavailable: {backtest.error}</p>}
            </div>

            <div>
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs uppercase tracking-wider text-gray-400">Decision log ({runs.length})</h3>
                    {runs.length > 15 && <button type="button" className="text-xs text-gray-500 hover:text-[#0D2654]" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show latest 15' : 'Show all'}</button>}
                </div>
                {runs.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">No runs yet — the first daily run is at {scheduled} New York, or press Run now.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-[#0D2654]/10">
                                    <th className="px-2 py-2 font-medium">Date</th>
                                    <th className="px-2 py-2 font-medium">Run</th>
                                    <th className="px-2 py-2 font-medium text-right">{rules.ticker || 'SOXL'}</th>
                                    <th className="px-2 py-2 font-medium">What happened</th>
                                </tr>
                            </thead>
                            <tbody>
                                {shown.map((r) => (
                                    <tr key={r.id} className="border-b border-gray-100 align-top">
                                        <td className="px-2 py-2 whitespace-nowrap">{r.run_date}</td>
                                        <td className="px-2 py-2 whitespace-nowrap text-xs text-gray-500">{TRIGGER_LABEL[r.trigger] || r.trigger}</td>
                                        <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{r.underlying_price != null ? money(r.underlying_price) : '—'}</td>
                                        <td className="px-2 py-2 min-w-[16rem]">
                                            <p className={r.status === 'ok' ? 'text-gray-700' : 'text-red-600'}>{r.message}</p>
                                            {r.actions.length > 0 && (
                                                <ul className="mt-1 space-y-0.5">
                                                    {r.actions.map((a, i) => (
                                                        <li key={i} className="flex gap-1.5 text-xs">
                                                            {a.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-px" /> : <XCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-px" />}
                                                            <span className={a.ok ? 'text-gray-700' : 'text-red-600'}>{a.text}{a.error ? ` — ${a.error}` : ''}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                            {r.details?.open_puts?.length > 0 && (
                                                <p className="mt-1 text-xs text-gray-400">
                                                    Holding: {r.details.open_puts.map((x) => `${x.contracts}× ${x.expiry} $${x.strike}P (${x.kept_pct ?? '—'}% kept)`).join(' · ')}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
}
