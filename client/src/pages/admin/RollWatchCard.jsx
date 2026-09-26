import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Repeat } from 'lucide-react';
import { scannerApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { RollFinderModal } from './RollFinderModal';
import { formatCurrency } from './scannerShared';
import { rollPrefillFromCandidate } from './rollPrefill';

const REASONS = {
    ITM: { label: 'ITM', cls: 'bg-red-600 text-white', tip: 'Strike is above the stock price' },
    CLOSE_TO_STRIKE: { label: 'Near strike', cls: 'bg-red-100 text-red-700', tip: 'Less than 5% cushion above the strike' },
    SHORT_DTE: { label: 'Short DTE', cls: 'bg-amber-100 text-amber-800', tip: '21 days or less and under 50% captured' },
    LOSING: { label: 'Losing', cls: 'bg-red-100 text-red-700', tip: 'Option now costs more than it was sold for' },
    TAKE_PROFIT: { label: 'Take profit', cls: 'bg-green-100 text-green-800', tip: '80%+ captured — close rather than roll' },
};

// Open puts that may need rolling (or closing), with a Roll Finder per position.
export function RollWatchCard() {
    const navigate = useNavigate();
    const [openId, setOpenId] = useState(null);
    const { data, isLoading, refetch, isFetching } = useApiQuery({
        queryKey: ['admin', 'scanner', 'roll-watch'],
        queryFn: () => scannerApi.getRollWatch(),
    });
    const positions = data?.positions || [];
    const attention = positions.filter(p => p.needs_attention).length;

    return (
        <div className="border-2 border-[#0D2654]/20 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-[#F06010]" />
                    Roll Watch
                    {attention > 0 && <span className="px-1.5 py-0.5 text-[10px] bg-[#F06010] text-white normal-case tracking-normal">{attention} need attention</span>}
                </h2>
                <button type="button" onClick={() => refetch()} className="text-gray-400 hover:text-[#0D2654]" title="Refresh">
                    <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                </button>
            </div>
            {isLoading ? (
                <p className="text-xs text-gray-400">Loading…</p>
            ) : positions.length === 0 ? (
                <p className="text-xs text-gray-400">No open put positions.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-left text-gray-500 border-b border-[#0D2654]/10">
                                <th className="py-1.5 pr-3 font-medium">Position</th>
                                <th className="py-1.5 pr-3 font-medium text-right">DTE</th>
                                <th className="py-1.5 pr-3 font-medium text-right">Stock / cushion</th>
                                <th className="py-1.5 pr-3 font-medium text-right">Captured</th>
                                <th className="py-1.5 pr-3 font-medium">Status</th>
                                <th className="py-1.5"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#0D2654]/5">
                            {positions.map(p => (
                                <tr key={p.id}>
                                    <td className="py-2 pr-3 whitespace-nowrap">
                                        <button type="button" onClick={() => navigate(`/admin/positions/${p.id}`)} className="font-semibold text-[#0D2654] hover:text-[#F06010]">
                                            {p.ticker} {formatCurrency(p.strike)}P
                                        </button>
                                        <span className="text-gray-400"> · {p.expiry}{p.contracts > 1 ? ` · ×${p.contracts}` : ''}</span>
                                    </td>
                                    <td className="py-2 pr-3 text-right">{p.dte ?? '—'}d</td>
                                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                                        {p.stock_price != null ? formatCurrency(p.stock_price) : '—'}
                                        {p.cushion_pct != null && <span className={p.cushion_pct < 5 ? 'text-red-600' : 'text-gray-400'}> · {p.cushion_pct.toFixed(1)}%</span>}
                                    </td>
                                    <td className={`py-2 pr-3 text-right font-medium ${p.profit_captured_pct == null ? 'text-gray-400' : p.profit_captured_pct >= 80 ? 'text-green-600' : p.profit_captured_pct < 0 ? 'text-red-600' : 'text-[#0D2654]'}`}>
                                        {p.profit_captured_pct != null ? `${p.profit_captured_pct.toFixed(1)}%` : '—'}
                                    </td>
                                    <td className="py-2 pr-3">
                                        <div className="flex flex-wrap gap-1">
                                            {p.reasons.length === 0
                                                ? <span className="text-gray-400">OK</span>
                                                : p.reasons.map(r => (
                                                    <span key={r} className={`px-1.5 py-0.5 text-[10px] font-semibold ${REASONS[r]?.cls || 'bg-gray-100'}`} title={REASONS[r]?.tip}>
                                                        {REASONS[r]?.label || r}
                                                    </span>
                                                ))}
                                        </div>
                                    </td>
                                    <td className="py-2 text-right">
                                        <button type="button" onClick={() => setOpenId(p.id)} className="px-2 py-1 border border-[#0D2654]/20 text-[#0D2654] font-medium hover:border-[#F06010] hover:text-[#F06010] whitespace-nowrap">
                                            Find rolls
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <RollFinderModal
                positionId={openId}
                isOpen={openId != null}
                onClose={() => setOpenId(null)}
                onUse={(c, result) => {
                    setOpenId(null);
                    navigate(`/admin/positions/${result.position.id}`, { state: { rollPrefill: rollPrefillFromCandidate(c, result) } });
                }}
            />
        </div>
    );
}
