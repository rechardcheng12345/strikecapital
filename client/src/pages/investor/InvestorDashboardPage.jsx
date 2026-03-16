import { LayoutDashboard, DollarSign, TrendingUp, Activity, Bell, PieChart, } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDateTime } from '../../lib/constants';
import { Skeleton, ErrorAlert } from '../../components/ui';
function formatCurrency(value) {
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPercent(value) {
    return value.toFixed(1) + '%';
}
function MetricCard({ title, value, icon, subtitle, accent, valueColor }) {
    return (<div className={`rounded-none border-2 p-5 transition-all duration-150 ${accent
            ? 'border-[#F06010] bg-white'
            : 'border-[#0D2654]/20 bg-white hover:border-[#0D2654]/40'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-none ${accent ? 'bg-[#F06010]/10 text-[#F06010]' : 'bg-[#0D2654]/5 text-[#0D2654]'}`}>
          {icon}
        </div>
        {subtitle && (<span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {subtitle}
          </span>)}
      </div>
      <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${valueColor || 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        {value}
      </p>
    </div>);
}
function MetricCardSkeleton() {
    return (<div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton variant="rectangular" width={40} height={40} className="rounded-none"/>
        <Skeleton variant="text" width={60} height={12}/>
      </div>
      <Skeleton variant="text" width="60%" height={14}/>
      <Skeleton variant="text" width="80%" height={28}/>
    </div>);
}
export function InvestorDashboardPage() {
    const { data: dashboard, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['investor', 'dashboard'],
        queryFn: () => investorApi.getDashboard(),
    });
    const pnlColor = dashboard && dashboard.total_pnl_share >= 0 ? 'text-green-600' : 'text-red-600';
    const unrealizedPnlColor = dashboard && dashboard.unrealized_pnl_share >= 0 ? 'text-green-600' : 'text-red-600';
    return (<div>
      <h1 className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        <LayoutDashboard className="w-6 h-6 text-[#F06010]"/>
        My Dashboard
      </h1>

      {isError && (<div className="mb-6">
          <ErrorAlert message={error?.message || 'Failed to load dashboard.'} onRetry={() => refetch()}/>
        </div>)}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (<>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>) : dashboard ? (<>
            <MetricCard title="My Allocation" value={formatCurrency(dashboard.allocation.allocation_amount)} icon={<DollarSign className="w-5 h-5"/>} subtitle={formatPercent(dashboard.allocation.allocation_pct) + ' of fund'} accent/>
            <MetricCard title="Realized P&L Share" value={formatCurrency(dashboard.total_pnl_share)} icon={<TrendingUp className="w-5 h-5"/>} subtitle="My share" valueColor={pnlColor}/>
            <MetricCard title="Unrealized P&L Share" value={formatCurrency(dashboard.unrealized_pnl_share ?? 0)} icon={<DollarSign className="w-5 h-5"/>} subtitle={dashboard.last_price_update ? `Updated ${formatDateTime(dashboard.last_price_update)}` : 'No price data'} valueColor={unrealizedPnlColor}/>
            <MetricCard title="Win Rate" value={formatPercent(dashboard.win_rate)} icon={<PieChart className="w-5 h-5"/>} subtitle="Resolved"/>
            <MetricCard title="Active Positions" value={dashboard.active_positions.toLocaleString()} icon={<Activity className="w-5 h-5"/>} subtitle="Current"/>
            <MetricCard title="Unread Notifications" value={dashboard.unread_notifications.toLocaleString()} icon={<Bell className="w-5 h-5"/>} subtitle="New" accent={dashboard.unread_notifications > 0}/>
          </>) : null}
      </div>
    </div>);
}
