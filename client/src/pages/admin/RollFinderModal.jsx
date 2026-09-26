import { useEffect, useState, useCallback } from 'react';
import { Ban, Brain, CalendarClock, RefreshCw, Wallet } from 'lucide-react';
import { scannerApi } from '../../api/client';
import { Modal } from '../../components/ui';
import { formatCurrency, scoreColor } from './scannerShared';

const RULES_TEXT = 'Close cost uses the ask; new credit uses the bid (conservative fills). Effective cost counts the original premium plus the net credit.';

/**
 * Roll Finder: prices "buy to close this put, sell a later one" for an open position.
 * onUse(candidate, result) is called when the user picks a roll (e.g. to prefill the Roll form).
 */
export function RollFinderModal({ positionId, isOpen, onClose, onUse }) {
    const [opts, setOpts] = useState({ minDays: 28, maxDays: 63, maxStrikeDropPct: 20 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [showDebits, setShowDebits] = useState(false);

    const load = useCallback(async () => {
        if (!positionId) return;
        setLoading(true);
        setError(null);
        const res = await scannerApi.findRolls(positionId, opts);
        setLoading(false);
        if (res.error) {
            setError(res.error);
            setResult(null);
        } else {
            setResult(res.data);
        }
        // opts intentionally read at call time; reloading happens via the Search button.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [positionId]);

    useEffect(() => {
        if (isOpen) load();
    }, [isOpen, load]);

    const pos = result?.position;
    const ai = result?.ai;
    const candidates = (result?.candidates || []).filter(c => showDebits || c.net_credit >= 0);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Roll Finder" size="4xl">
            <div className="space-y-4">
                {pos && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-[#F5F3EF] p-3">
                        <div>
                            <div className="text-gray-400 uppercase tracking-wider text-[10px]">Current put</div>
                            <div className="font-semibold text-[#0D2654]">{pos.ticker} {formatCurrency(pos.strike)} · {pos.expiry}</div>
                            <div className="text-gray-500">{pos.dte}d left · {pos.contracts} contract{pos.contracts > 1 ? 's' : ''}</div>
                        </div>
                        <div>
                            <div className="text-gray-400 uppercase tracking-wider text-[10px]">Stock</div>
                            <div className="font-semibold text-[#0D2654]">{formatCurrency(pos.stock_price)}</div>
                            <div className={pos.cushion_pct < 0 ? 'text-red-600' : 'text-gray-500'}>
                                {pos.cushion_pct < 0 ? `${Math.abs(pos.cushion_pct).toFixed(1)}% ITM` : `${pos.cushion_pct.toFixed(1)}% above strike`}
                            </div>
                        </div>
                        <div>
                            <div className="text-gray-400 uppercase tracking-wider text-[10px]">Cost to close</div>
                            <div className="font-semibold text-red-600">{formatCurrency(result.close.cost)}</div>
                            <div className="text-gray-500">{formatCurrency(result.close.per_share)}/sh ({result.close.source})</div>
                        </div>
                        <div>
                            <div className="text-gray-400 uppercase tracking-wider text-[10px]">Original credit</div>
                            <div className="font-semibold text-green-700">{formatCurrency(pos.premium_received)}</div>
                            <div className="text-gray-500">{result.credit_count} credit roll{result.credit_count === 1 ? '' : 's'} found</div>
                        </div>
                    </div>
                )}

                {ai && !ai.error && (ai.veto || ai.warnings?.length > 0) && (
                    <div className={`flex items-start gap-2 p-3 text-xs border ${ai.veto ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                        {ai.veto ? <Ban className="w-4 h-4 flex-shrink-0" /> : <Brain className="w-4 h-4 flex-shrink-0" />}
                        <div>
                            {ai.veto
                                ? <><strong>Jev veto:</strong> {ai.veto_reasons.join(' · ')}. Consider taking the loss instead of rolling into a broken stock.</>
                                : <><strong>Jev:</strong> {ai.warnings.join(' · ')}</>}
                        </div>
                    </div>
                )}

                <div className="flex flex-wrap items-end gap-3 text-xs">
                    <label className="flex flex-col gap-1">
                        <span className="text-gray-500">New DTE</span>
                        <span className="flex items-center gap-1">
                            <input type="number" min={7} value={opts.minDays} onChange={e => setOpts(o => ({ ...o, minDays: parseInt(e.target.value) || 0 }))} className="w-16 border border-gray-300 px-2 py-1" />
                            to
                            <input type="number" min={7} value={opts.maxDays} onChange={e => setOpts(o => ({ ...o, maxDays: parseInt(e.target.value) || 0 }))} className="w-16 border border-gray-300 px-2 py-1" />
                        </span>
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-gray-500">Max strike drop %</span>
                        <input type="number" min={0} max={50} value={opts.maxStrikeDropPct} onChange={e => setOpts(o => ({ ...o, maxStrikeDropPct: parseFloat(e.target.value) || 0 }))} className="w-20 border border-gray-300 px-2 py-1" />
                    </label>
                    <button type="button" onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0D2654] text-white font-medium hover:bg-[#0D2654]/90 disabled:opacity-50">
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Pricing…' : 'Search'}
                    </button>
                    <label className="flex items-center gap-1.5 ml-auto">
                        <input type="checkbox" checked={showDebits} onChange={e => setShowDebits(e.target.checked)} />
                        Show net-debit rolls
                    </label>
                </div>

                {error && <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
                {loading && !result && <p className="text-sm text-gray-500">Pricing the chain…</p>}

                {result && (candidates.length === 0 ? (
                    <p className="text-sm text-gray-500">No {showDebits ? '' : 'net-credit '}rolls in this range. Try a longer DTE or a bigger strike drop.</p>
                ) : (
                    <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border border-[#0D2654]/10">
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-[#0D2654] text-white">
                                <tr>
                                    <th className="px-2 py-2 text-left">Score</th>
                                    <th className="px-2 py-2 text-left">New put</th>
                                    <th className="px-2 py-2 text-right">Net credit</th>
                                    <th className="px-2 py-2 text-right" title="Net credit ÷ new collateral, annualized over the extra days">Net ann.</th>
                                    <th className="px-2 py-2 text-right">Strike ↓</th>
                                    <th className="px-2 py-2 text-right">Cushion</th>
                                    <th className="px-2 py-2 text-right" title="New strike minus all premium collected on this position, per share">Eff. cost</th>
                                    <th className="px-2 py-2 text-left">Flags</th>
                                    <th className="px-2 py-2"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#0D2654]/10">
                                {candidates.map(c => (
                                    <tr key={c.option_code} className="hover:bg-[#F5F3EF]">
                                        <td className="px-2 py-2"><span className={scoreColor(c.roll_score)}>{c.roll_score}</span></td>
                                        <td className="px-2 py-2 whitespace-nowrap">
                                            <div className="font-semibold text-[#0D2654]">{formatCurrency(c.strike)} · {c.expiry}</div>
                                            <div className="text-gray-500">{c.days_to_expiry}d (+{c.extra_days}d) · bid {formatCurrency(c.bid)}</div>
                                        </td>
                                        <td className={`px-2 py-2 text-right font-semibold ${c.net_credit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(c.net_credit)}</td>
                                        <td className="px-2 py-2 text-right">{c.net_ann_pct != null ? `${c.net_ann_pct.toFixed(1)}%` : '—'}</td>
                                        <td className="px-2 py-2 text-right">{c.strike_drop_pct > 0 ? `${c.strike_drop_pct.toFixed(1)}%` : 'same'}</td>
                                        <td className="px-2 py-2 text-right whitespace-nowrap">
                                            <div>{c.sigma_otm != null ? `${c.sigma_otm.toFixed(2)}σ` : '—'}</div>
                                            <div className="text-gray-400">{c.delta != null ? `Δ ${Math.abs(c.delta).toFixed(2)}` : ''}</div>
                                        </td>
                                        <td className="px-2 py-2 text-right">{formatCurrency(c.effective_cost_if_assigned)}</td>
                                        <td className="px-2 py-2">
                                            <div className="flex flex-wrap gap-1">
                                                {c.earnings_before_expiry && (
                                                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] bg-purple-100 text-purple-800" title={`Earnings ${c.earnings_date}`}>
                                                        <CalendarClock className="w-3 h-3" /> Earn
                                                    </span>
                                                )}
                                                {!c.fits_capital && (
                                                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] bg-red-50 text-red-700" title={`Needs ${formatCurrency(c.extra_collateral)} more collateral than available`}>
                                                        <Wallet className="w-3 h-3" /> Capital
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-2 py-2 text-right">
                                            <button type="button" onClick={() => onUse(c, result)} className="px-2 py-1 bg-[#F06010] text-white font-medium hover:bg-[#F06010]/90">
                                                Use
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))}
                <p className="text-[11px] text-gray-400">{RULES_TEXT}</p>
            </div>
        </Modal>
    );
}
