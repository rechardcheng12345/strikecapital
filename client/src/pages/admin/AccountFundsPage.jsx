import { useState } from 'react';
import { Wallet, RefreshCw, DollarSign, TrendingUp, TrendingDown, Shield, Sparkles, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDateTime } from '../../lib/constants';
import { Skeleton, ErrorAlert } from '../../components/ui';

function formatCurrency(value) {
    if (value == null) return '--';
    return '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function FundItem({ label, value, valueColor }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
            <span className={`text-sm font-semibold ${valueColor || 'text-[#0D2654]'}`}>
                {value ?? '--'}
            </span>
        </div>
    );
}

function FundCard({ title, icon, children }) {
    return (
        <div className="rounded-none border-2 border-[#0D2654]/15 bg-white">
            <div className="px-5 py-3 border-b-2 border-[#0D2654]/10 flex items-center gap-2">
                <div className="p-1.5 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                    {icon}
                </div>
                <h3 className="text-sm font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    {title}
                </h3>
            </div>
            <div className="p-5">
                {children}
            </div>
        </div>
    );
}

function HeroMetric({ label, value, valueColor }) {
    return (
        <div className="text-center">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-2xl font-bold ${valueColor || 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {value}
            </p>
        </div>
    );
}

function FundsSkeleton() {
    return (
        <div className="space-y-6">
            <div className="rounded-none border-2 border-gray-200 bg-white p-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="text-center space-y-2">
                            <Skeleton variant="text" width="60%" height={12} className="mx-auto" />
                            <Skeleton variant="text" width="80%" height={28} className="mx-auto" />
                        </div>
                    ))}
                </div>
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-4">
                    <Skeleton variant="text" width="30%" height={16} />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {Array.from({ length: 3 }).map((_, j) => (
                            <div key={j} className="space-y-1">
                                <Skeleton variant="text" width="50%" height={10} />
                                <Skeleton variant="text" width="70%" height={16} />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function ReconciliationPanel() {
    const [open, setOpen] = useState(false);
    const { data: recon, isLoading, isError, error } = useApiQuery({
        queryKey: ['admin', 'earnings', 'reconciliation'],
        queryFn: () => adminApi.getEarningsReconciliation(),
        enabled: open,
    });

    const plColor = (val) => {
        if (val == null) return 'text-[#0D2654]';
        return Number(val) >= 0 ? 'text-green-600' : 'text-red-600';
    };

    return (
        <div className="rounded-none border-2 border-[#0D2654]/15 bg-white">
            <button
                onClick={() => setOpen(v => !v)}
                className="w-full px-5 py-3 border-b-2 border-[#0D2654]/10 flex items-center gap-2 hover:bg-gray-50"
            >
                <div className="p-1.5 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                    <AlertTriangle className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    Earnings Reconciliation
                </h3>
                <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider hidden sm:block">
                    Line-by-line breakdown to identify P&L mismatches
                </span>
                {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {open && (
                <div className="p-5 space-y-6">
                    {isLoading && <div className="text-sm text-gray-500">Loading reconciliation...</div>}
                    {isError && <ErrorAlert message={error?.message || 'Failed to load reconciliation'} />}
                    {recon && (
                        <>
                            {/* Formula terms */}
                            <div>
                                <h4 className="text-xs font-bold text-[#0D2654] uppercase tracking-wider mb-2">Formula Terms</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Total Assets</p>
                                        <p className="font-semibold text-[#0D2654]">{formatCurrency(recon.terms.totalAssets)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Market Value</p>
                                        <p className={`font-semibold ${plColor(recon.terms.marketVal)}`}>{formatCurrency(recon.terms.marketVal)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Gross Fund Value</p>
                                        <p className="font-semibold text-[#0D2654]">{formatCurrency(recon.terms.grossFundValue)}</p>
                                        <p className="text-[9px] text-gray-400">TA − MV</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Fund Capital</p>
                                        <p className="font-semibold text-[#0D2654]">{formatCurrency(recon.terms.totalCapital)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Open Premium (net)</p>
                                        <p className="font-semibold text-green-600">{formatCurrency(recon.terms.openPremiumNet)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Realized (gross)</p>
                                        <p className={`font-semibold ${plColor(recon.terms.realizedGross)}`}>{formatCurrency(recon.terms.realizedGross)}</p>
                                        <p className="text-[9px] text-gray-400">SUM(pnl_amount)</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Realized (net of fees)</p>
                                        <p className={`font-semibold ${plColor(recon.terms.realizedNetFees)}`}>{formatCurrency(recon.terms.realizedNetFees)}</p>
                                        <p className="text-[9px] text-gray-400">Dashboard uses this</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase">Additional Earnings</p>
                                        <p className={`font-semibold ${plColor(recon.terms.additionalEarningsGross)}`}>{formatCurrency(recon.terms.additionalEarningsGross)}</p>
                                        <p className="text-[9px] text-gray-400">gross / net: {formatCurrency(recon.terms.additionalEarningsNet)}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Duplicate warning */}
                            {recon.duplicatePositions?.length > 0 && (
                                <div className="border-2 border-red-300 bg-red-50 p-3">
                                    <p className="text-xs font-bold text-red-700 uppercase tracking-wider mb-2">
                                        Positions with multiple P&L rows (possible double-count)
                                    </p>
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-left text-red-700">
                                                <th className="py-1 pr-2">Position ID</th>
                                                <th className="py-1 pr-2">Ticker</th>
                                                <th className="py-1 pr-2">Status</th>
                                                <th className="py-1 pr-2">Resolution</th>
                                                <th className="py-1 pr-2 text-right">Row Count</th>
                                                <th className="py-1 pr-2 text-right">Total P&L</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {recon.duplicatePositions.map(g => (
                                                <tr key={g.position_id} className="border-t border-red-200">
                                                    <td className="py-1 pr-2">{g.position_id}</td>
                                                    <td className="py-1 pr-2 font-semibold">{g.ticker}</td>
                                                    <td className="py-1 pr-2">{g.position_status}</td>
                                                    <td className="py-1 pr-2">{g.resolution_type || '—'}</td>
                                                    <td className="py-1 pr-2 text-right">{g.row_count}</td>
                                                    <td className={`py-1 pr-2 text-right font-semibold ${plColor(g.total_pnl)}`}>{formatCurrency(g.total_pnl)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {/* Open premium detail */}
                            <div>
                                <h4 className="text-xs font-bold text-[#0D2654] uppercase tracking-wider mb-2">
                                    Open Option Positions ({recon.openPremiumDetail.length}) — contributing {formatCurrency(recon.terms.openPremiumNet)}
                                </h4>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="text-left text-gray-500 border-b border-gray-200">
                                                <th className="py-1 pr-2">ID</th>
                                                <th className="py-1 pr-2">Ticker</th>
                                                <th className="py-1 pr-2 text-right">Strike</th>
                                                <th className="py-1 pr-2 text-right">Contracts</th>
                                                <th className="py-1 pr-2">Expiry</th>
                                                <th className="py-1 pr-2 text-right">Premium (gross)</th>
                                                <th className="py-1 pr-2 text-right">Fees</th>
                                                <th className="py-1 pr-2 text-right">Premium (net)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {recon.openPremiumDetail.map(p => (
                                                <tr key={p.id} className="border-b border-gray-100">
                                                    <td className="py-1 pr-2">{p.id}</td>
                                                    <td className="py-1 pr-2 font-semibold">{p.ticker}</td>
                                                    <td className="py-1 pr-2 text-right">{formatCurrency(p.strike_price)}</td>
                                                    <td className="py-1 pr-2 text-right">{p.contracts}</td>
                                                    <td className="py-1 pr-2">{p.expiration_date}</td>
                                                    <td className="py-1 pr-2 text-right">{formatCurrency(p.premium_gross)}</td>
                                                    <td className="py-1 pr-2 text-right text-gray-500">{formatCurrency(p.commission + p.platform_fee)}</td>
                                                    <td className="py-1 pr-2 text-right font-semibold text-green-600">{formatCurrency(p.premium_net)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* All P&L records */}
                            <div>
                                <h4 className="text-xs font-bold text-[#0D2654] uppercase tracking-wider mb-2">
                                    All P&L Records ({recon.pnlDetail.length}) — SUM = {formatCurrency(recon.terms.realizedGross)}
                                </h4>
                                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                                    <table className="w-full text-xs">
                                        <thead className="sticky top-0 bg-white">
                                            <tr className="text-left text-gray-500 border-b border-gray-200">
                                                <th className="py-1 pr-2">Date</th>
                                                <th className="py-1 pr-2">Ticker</th>
                                                <th className="py-1 pr-2">Type</th>
                                                <th className="py-1 pr-2">Pos Status</th>
                                                <th className="py-1 pr-2">Resolution</th>
                                                <th className="py-1 pr-2 text-right">Strike</th>
                                                <th className="py-1 pr-2 text-right">Premium In</th>
                                                <th className="py-1 pr-2 text-right">Close Prem</th>
                                                <th className="py-1 pr-2 text-right">Fees</th>
                                                <th className="py-1 pr-2 text-right">P&L Amount</th>
                                                <th className="py-1 pr-2">Roll</th>
                                                <th className="py-1 pr-2">Description</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {recon.pnlDetail.map(r => (
                                                <tr key={r.pnl_id} className="border-b border-gray-100">
                                                    <td className="py-1 pr-2">{r.record_date}</td>
                                                    <td className="py-1 pr-2 font-semibold">{r.ticker || '—'}</td>
                                                    <td className="py-1 pr-2">{r.position_type}</td>
                                                    <td className="py-1 pr-2">{r.position_status}</td>
                                                    <td className="py-1 pr-2">{r.resolution_type || '—'}</td>
                                                    <td className="py-1 pr-2 text-right">{r.strike_price != null ? formatCurrency(r.strike_price) : '—'}</td>
                                                    <td className="py-1 pr-2 text-right text-green-600">{r.premium_received != null ? formatCurrency(r.premium_received) : '—'}</td>
                                                    <td className="py-1 pr-2 text-right">{r.close_premium != null ? formatCurrency(r.close_premium) : '—'}</td>
                                                    <td className="py-1 pr-2 text-right text-gray-500">{formatCurrency(r.commission + r.platform_fee)}</td>
                                                    <td className={`py-1 pr-2 text-right font-semibold ${plColor(r.pnl_amount)}`}>{formatCurrency(r.pnl_amount)}</td>
                                                    <td className="py-1 pr-2 text-gray-500">
                                                        {r.rolled_from_id ? `←${r.rolled_from_id}` : ''}{r.rolled_to_id ? ` →${r.rolled_to_id}` : ''}
                                                    </td>
                                                    <td className="py-1 pr-2 text-gray-500 max-w-xs truncate">{r.description || '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export function AccountFundsPage() {
    const { data: funds, isLoading, isError, error, refetch, isFetching } = useApiQuery({
        queryKey: ['admin', 'moomoo', 'funds'],
        queryFn: () => adminApi.getMoomooFunds(),
    });

    const plColor = (val) => {
        if (val == null) return 'text-[#0D2654]';
        return Number(val) >= 0 ? 'text-green-600' : 'text-red-600';
    };

    return (
        <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    <Wallet className="w-6 h-6 text-[#F06010]" />
                    Account Funds
                </h1>
                <button
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-2 border-[#0D2654]/20 bg-white text-[#0D2654] hover:border-[#0D2654]/40 transition-colors disabled:opacity-50"
                >
                    <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {isError && (
                <div className="mb-6">
                    <ErrorAlert message={error?.message || 'Failed to fetch account funds. Ensure Moomoo OpenD is running.'} onRetry={() => refetch()} />
                </div>
            )}

            {isLoading && <FundsSkeleton />}

            {funds && (
                <div className="space-y-6">
                    {/* Fetched timestamp & source */}
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                        {funds.fetchedAt && (
                            <span>Data fetched: {formatDateTime(funds.fetchedAt)}</span>
                        )}
                        {funds.source && (
                            <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${
                                funds.source === 'live'
                                    ? 'border-green-300 bg-green-50 text-green-700'
                                    : 'border-yellow-300 bg-yellow-50 text-yellow-700'
                            }`}>
                                {funds.source === 'live' ? 'Live' : 'Cached'}
                            </span>
                        )}
                    </div>

                    {/* Hero metrics */}
                    <div className="rounded-none border-2 border-[#F06010] bg-white p-4 sm:p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                            <HeroMetric label="Total Assets" value={formatCurrency(funds.totalAssets)} />
                            <HeroMetric label="Cash" value={formatCurrency(funds.cash)} />
                            <HeroMetric label="Market Value" value={formatCurrency(funds.marketVal)} />
                            <HeroMetric label="Buying Power" value={formatCurrency(funds.power)} />
                        </div>
                    </div>

                    {/* Earnings Analysis */}
                    {funds.additionalEarnings !== null && funds.additionalEarnings !== undefined && (
                        <div className="rounded-none border-2 border-[#F06010] bg-white">
                            <div className="px-5 py-3 border-b-2 border-[#F06010]/20 flex items-center gap-2 bg-[#F06010]/5">
                                <div className="p-1.5 rounded-none bg-[#F06010]/10 text-[#F06010]">
                                    <Sparkles className="w-4 h-4" />
                                </div>
                                <h3 className="text-sm font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                                    Earnings Analysis
                                </h3>
                                <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider hidden sm:block">
                                    (Total Assets − Mkt Value) − Capital − Premium − Realized P&L
                                </span>
                            </div>
                            <div className="p-5 space-y-4">
                                {/* Main row */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                                    <div className="text-center">
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Gross Fund Value</p>
                                        <p className="text-xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                                            {formatCurrency(funds.grossFundValue ?? funds.totalAssets)}
                                        </p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                            {formatCurrency(funds.totalAssets)} − ({formatCurrency(funds.marketVal ?? 0)})
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Fund Capital</p>
                                        <p className="text-xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                                            {formatCurrency(funds.totalCapital)}
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Options Income</p>
                                        <p className={`text-xl font-bold ${plColor((funds.openPremiumCollected ?? 0) + (funds.dbRealizedPnl ?? 0))}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                                            {formatCurrency((funds.openPremiumCollected ?? 0) + (funds.dbRealizedPnl ?? 0))}
                                        </p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                            {formatCurrency(funds.openPremiumCollected ?? 0)} premium + {formatCurrency(funds.dbRealizedPnl ?? 0)} realized
                                        </p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Additional Earnings</p>
                                        <p className={`text-xl font-bold ${plColor(funds.additionalEarnings)}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                                            {formatCurrency(funds.additionalEarnings)}
                                        </p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">Interest & other income</p>
                                    </div>
                                </div>
                                {/* Market value detail row */}
                                <div className="border-t border-gray-100 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 text-center">
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Total Assets</p>
                                        <p className="text-sm font-semibold text-[#0D2654]">{formatCurrency(funds.totalAssets)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Options Mkt Value</p>
                                        <p className={`text-sm font-semibold ${plColor(funds.marketVal ?? 0)}`}>{formatCurrency(funds.marketVal ?? 0)}</p>
                                        <p className="text-[10px] text-gray-400">current obligation</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Open Premium (net)</p>
                                        <p className="text-sm font-semibold text-green-600">{formatCurrency(funds.openPremiumCollected ?? 0)}</p>
                                        <p className="text-[10px] text-gray-400">collected, after fees</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Unrealized P&L</p>
                                        <p className={`text-sm font-semibold ${plColor(funds.dbUnrealizedPnl ?? 0)}`}>{formatCurrency(funds.dbUnrealizedPnl ?? 0)}</p>
                                        <p className="text-[10px] text-gray-400">premium + mkt value</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <ReconciliationPanel />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Cash & Withdrawals */}
                        <FundCard title="Cash & Withdrawals" icon={<DollarSign className="w-4 h-4" />}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                                <FundItem label="Cash" value={formatCurrency(funds.cash)} />
                                <FundItem label="Frozen Cash" value={formatCurrency(funds.frozenCash)} />
                                <FundItem label="Available Withdrawal" value={formatCurrency(funds.avlWithdrawalCash)} />
                                <FundItem label="Max Withdrawal" value={formatCurrency(funds.maxWithdrawal)} />
                                <FundItem label="Net Cash Power" value={formatCurrency(funds.netCashPower)} />
                                <FundItem label="Pending Assets" value={formatCurrency(funds.pendingAsset)} />
                                <FundItem label="Debt Cash" value={formatCurrency(funds.debtCash)} />
                            </div>
                        </FundCard>

                        {/* Buying Power & Margins */}
                        <FundCard title="Buying Power & Margins" icon={<Shield className="w-4 h-4" />}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                                <FundItem label="Buying Power (Long)" value={formatCurrency(funds.power)} />
                                <FundItem label="Buying Power (Short)" value={formatCurrency(funds.maxPowerShort)} />
                                <FundItem label="Initial Margin" value={formatCurrency(funds.initialMargin)} />
                                <FundItem label="Maintenance Margin" value={formatCurrency(funds.maintenanceMargin)} />
                                <FundItem label="Margin Call" value={formatCurrency(funds.marginCallMargin)} />
                            </div>
                        </FundCard>

                        {/* P&L */}
                        <FundCard title="Profit & Loss" icon={<TrendingUp className="w-4 h-4" />}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                                <FundItem label="Unrealized P&L" value={formatCurrency(funds.unrealizedPL)} valueColor={plColor(funds.unrealizedPL)} />
                                <FundItem label="Realized P&L" value={formatCurrency(funds.realizedPL)} valueColor={plColor(funds.realizedPL)} />
                            </div>
                        </FundCard>

                        {/* Market Value Breakdown */}
                        <FundCard title="Market Value Breakdown" icon={<TrendingDown className="w-4 h-4" />}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                                <FundItem label="Long Market Value" value={formatCurrency(funds.longMv)} />
                                <FundItem label="Short Market Value" value={formatCurrency(funds.shortMv)} />
                                <FundItem label="Securities Assets" value={formatCurrency(funds.securitiesAssets)} />
                                <FundItem label="Fund Assets" value={formatCurrency(funds.fundAssets)} />
                                <FundItem label="Bond Assets" value={formatCurrency(funds.bondAssets)} />
                            </div>
                        </FundCard>

                    </div>

                </div>
            )}
        </div>
    );
}
