import { useState } from 'react';
import { LayoutDashboard, TrendingUp, DollarSign, Users, Clock, BarChart3, Activity, Bell, PieChart, Sparkles } from 'lucide-react';
import { adminApi, investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDateTime } from '../../lib/constants';
import { Skeleton } from '../../components/ui';
import { ErrorAlert } from '../../components/ui';
function formatCurrency(value) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPercent(value) {
    return value.toFixed(1) + '%';
}
function MetricCard({ title, value, icon, subtitle, accent, progressBar, valueColor }) {
    return (<div className={`rounded-none border-2 p-3 transition-all duration-150 ${accent
            ? 'border-[#F06010] bg-white'
            : 'border-[#0D2654]/20 bg-white hover:border-[#0D2654]/40'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className={`p-1.5 rounded-none ${accent ? 'bg-[#F06010]/10 text-[#F06010]' : 'bg-[#0D2654]/5 text-[#0D2654]'}`}>
          {icon}
        </div>
        {subtitle && (<span className="text-xs font-medium text-gray-400 uppercase tracking-wider truncate ml-2 text-right">
            {subtitle}
          </span>)}
      </div>
      <p className="text-xs font-medium text-gray-500 mb-0.5">{title}</p>
      <p className={`text-xl font-bold ${valueColor || 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        {value}
      </p>
      {progressBar && (<div className="mt-3">
          <div className="w-full h-2 bg-[#0D2654]/10 rounded-none overflow-hidden">
            <div className="h-full rounded-none transition-all duration-500" style={{
                width: `${Math.min(progressBar.value, 100)}%`,
                backgroundColor: progressBar.value > 80
                    ? '#EF4444'
                    : progressBar.value > 60
                        ? '#F06010'
                        : '#0D2654',
            }}/>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">0%</span>
            <span className="text-[10px] text-gray-400">100%</span>
          </div>
        </div>)}
    </div>);
}
function MetricCardSkeleton() {
    return (<div className="rounded-none border-2 border-gray-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton variant="rectangular" width={32} height={32} className="rounded-none"/>
        <Skeleton variant="text" width={60} height={12}/>
      </div>
      <Skeleton variant="text" width="60%" height={12}/>
      <Skeleton variant="text" width="80%" height={24}/>
    </div>);
}
export function AdminDashboardPage() {
    const [view, setView] = useState('admin');

    const { data: stats, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['admin', 'dashboard', 'stats'],
        queryFn: () => adminApi.getDashboardStats(),
        refetchOnMount: 'always',
        staleTime: 0,
    });

    const { data: investorDashboard, isLoading: investorLoading, isError: investorIsError, error: investorError, refetch: investorRefetch, } = useApiQuery({
        queryKey: ['investor', 'dashboard'],
        queryFn: () => investorApi.getDashboard(),
        enabled: view === 'investor',
        refetchOnMount: 'always',
        staleTime: 0,
    });

    const pnlColor = investorDashboard && investorDashboard.total_pnl_share >= 0 ? 'text-green-600' : 'text-red-600';
    const unrealizedPnlColor = investorDashboard && investorDashboard.unrealized_pnl_share >= 0 ? 'text-green-600' : 'text-red-600';

    return (<div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <LayoutDashboard className="w-6 h-6 text-[#F06010]"/>
          Dashboard
        </h1>
        <div className="inline-flex border-2 border-[#0D2654]/20 rounded-none overflow-hidden">
          <button onClick={() => setView('admin')} className={`px-4 py-1.5 text-sm font-medium transition-colors ${view === 'admin' ? 'bg-[#0D2654] text-white' : 'bg-white text-[#0D2654] hover:bg-[#0D2654]/5'}`}>
            Admin View
          </button>
          <button onClick={() => setView('investor')} className={`px-4 py-1.5 text-sm font-medium transition-colors ${view === 'investor' ? 'bg-[#0D2654] text-white' : 'bg-white text-[#0D2654] hover:bg-[#0D2654]/5'}`}>
            Investor View
          </button>
        </div>
      </div>

      {view === 'admin' && (<>
        {isError && (<div className="mb-6">
            <ErrorAlert message={error?.message || 'Failed to load dashboard stats.'} onRetry={() => refetch()}/>
          </div>)}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {isLoading ? (<>
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </>) : stats ? (<>
              <MetricCard title="Open Positions" value={stats.total_positions.toLocaleString()} icon={<BarChart3 className="w-5 h-5"/>} subtitle="Active (excl. monitoring)" accent/>
              <MetricCard title="Total Premium Received" value={formatCurrency(stats.total_premium)} icon={<DollarSign className="w-5 h-5"/>} subtitle="Income"/>
              <MetricCard title="Total Realized P&L" value={formatCurrency(stats.total_realized_pnl)} icon={<DollarSign className="w-5 h-5"/>} subtitle="Net of fees" valueColor={stats.total_realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}/>
              <MetricCard title="Unrealized P&L" value={formatCurrency(stats.total_unrealized_pnl)} icon={<TrendingUp className="w-5 h-5"/>} subtitle={stats.last_price_update ? `Updated ${formatDateTime(stats.last_price_update)}` : 'No price data'} accent={stats.total_unrealized_pnl < 0}/>
              {stats.total_return_pct !== null && stats.total_return_pct !== undefined && (
                <MetricCard title="Total Return" value={formatPercent(stats.total_return_pct)} icon={<TrendingUp className="w-5 h-5"/>} subtitle="Realized + Unrealized / Capital" valueColor={stats.total_return_pct >= 0 ? 'text-green-600' : 'text-red-600'}/>
              )}
              <MetricCard title="Capital Utilization" value={formatPercent(stats.capital_utilization)} icon={<TrendingUp className="w-5 h-5"/>} subtitle="Deployed" progressBar={{ value: stats.capital_utilization }}/>
              <MetricCard title="Total Investors" value={stats.total_investors.toLocaleString()} icon={<Users className="w-5 h-5"/>} subtitle="Accounts"/>
              <MetricCard title="Expiring Soon" value={stats.positions_expiring_soon.toLocaleString()} icon={<Clock className="w-5 h-5"/>} subtitle="Next 7 days" accent={stats.positions_expiring_soon > 0}/>
              {stats.additional_earnings !== null && stats.additional_earnings !== undefined && (
                <MetricCard
                  title="Additional Earnings"
                  value={formatCurrency(stats.additional_earnings)}
                  icon={<Sparkles className="w-5 h-5"/>}
                  subtitle="Interest & other income"
                  valueColor={stats.additional_earnings >= 0 ? 'text-green-600' : 'text-red-600'}
                />
              )}
            </>) : null}
        </div>
      </>)}

      {view === 'investor' && (<>
        {investorIsError && (<div className="mb-6">
            <ErrorAlert message={investorError?.message || 'Failed to load investor dashboard.'} onRetry={() => investorRefetch()}/>
          </div>)}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {investorLoading ? (<>
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </>) : investorDashboard ? (<>
              <MetricCard title="My Allocation" value={formatCurrency(investorDashboard.allocation.allocation_amount)} icon={<DollarSign className="w-5 h-5"/>} subtitle={formatPercent(investorDashboard.allocation.allocation_pct) + ' of fund'} accent/>
              <MetricCard title="Realized P&L Share" value={formatCurrency(investorDashboard.total_pnl_share)} icon={<TrendingUp className="w-5 h-5"/>} subtitle="My share" valueColor={pnlColor}/>
              <MetricCard title="Unrealized P&L Share" value={formatCurrency(investorDashboard.unrealized_pnl_share ?? 0)} icon={<DollarSign className="w-5 h-5"/>} subtitle={investorDashboard.last_price_update ? `Updated ${formatDateTime(investorDashboard.last_price_update)}` : 'No price data'} valueColor={unrealizedPnlColor}/>
              {investorDashboard.total_return_pct !== null && investorDashboard.total_return_pct !== undefined && (
                <MetricCard title="Total Return" value={formatPercent(investorDashboard.total_return_pct)} icon={<TrendingUp className="w-5 h-5"/>} subtitle="On my allocation" valueColor={investorDashboard.total_return_pct >= 0 ? 'text-green-600' : 'text-red-600'}/>
              )}
              <MetricCard title="Win Rate" value={formatPercent(investorDashboard.win_rate)} icon={<PieChart className="w-5 h-5"/>} subtitle="Resolved"/>
              <MetricCard title="Active Positions" value={investorDashboard.active_positions.toLocaleString()} icon={<Activity className="w-5 h-5"/>} subtitle="Current"/>
              <MetricCard title="Unread Notifications" value={investorDashboard.unread_notifications.toLocaleString()} icon={<Bell className="w-5 h-5"/>} subtitle="New" accent={investorDashboard.unread_notifications > 0}/>
            </>) : null}
        </div>
      </>)}
    </div>);
}
