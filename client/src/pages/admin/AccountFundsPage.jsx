import { Wallet, RefreshCw, DollarSign, TrendingUp, TrendingDown, Shield } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
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
                            <span>Data fetched: {new Date(funds.fetchedAt).toLocaleString()}</span>
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
