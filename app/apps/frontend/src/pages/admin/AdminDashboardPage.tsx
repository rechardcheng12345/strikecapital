import {
  LayoutDashboard,
  TrendingUp,
  DollarSign,
  Users,
  Clock,
  BarChart3,
  Activity,
} from 'lucide-react';
import { adminApi, type AdminDashboardStats } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Skeleton } from '../../components/ui';
import { ErrorAlert } from '../../components/ui';

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  subtitle?: string;
  accent?: boolean;
  progressBar?: { value: number };
}

function MetricCard({ title, value, icon, subtitle, accent, progressBar }: MetricCardProps) {
  return (
    <div
      className={`rounded-none border-2 p-5 transition-all duration-150 ${
        accent
          ? 'border-[#F06010] bg-white'
          : 'border-[#0D2654]/20 bg-white hover:border-[#0D2654]/40'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className={`p-2 rounded-none ${
            accent ? 'bg-[#F06010]/10 text-[#F06010]' : 'bg-[#0D2654]/5 text-[#0D2654]'
          }`}
        >
          {icon}
        </div>
        {subtitle && (
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            {subtitle}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
      <p
        className="text-2xl font-bold text-[#0D2654]"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        {value}
      </p>
      {progressBar && (
        <div className="mt-3">
          <div className="w-full h-2 bg-[#0D2654]/10 rounded-none overflow-hidden">
            <div
              className="h-full rounded-none transition-all duration-500"
              style={{
                width: `${Math.min(progressBar.value, 100)}%`,
                backgroundColor:
                  progressBar.value > 80
                    ? '#EF4444'
                    : progressBar.value > 60
                    ? '#F06010'
                    : '#0D2654',
              }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-400">0%</span>
            <span className="text-[10px] text-gray-400">100%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton variant="rectangular" width={40} height={40} className="rounded-none" />
        <Skeleton variant="text" width={60} height={12} />
      </div>
      <Skeleton variant="text" width="60%" height={14} />
      <Skeleton variant="text" width="80%" height={28} />
    </div>
  );
}

export function AdminDashboardPage() {
  const {
    data: stats,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<AdminDashboardStats>({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: () => adminApi.getDashboardStats(),
  });

  return (
    <div>
      <h1
        className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <LayoutDashboard className="w-6 h-6 text-[#F06010]" />
        Admin Dashboard
      </h1>

      {isError && (
        <div className="mb-6">
          <ErrorAlert
            message={error?.message || 'Failed to load dashboard stats.'}
            onRetry={() => refetch()}
          />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : stats ? (
          <>
            <MetricCard
              title="Total Positions"
              value={stats.total_positions.toLocaleString()}
              icon={<BarChart3 className="w-5 h-5" />}
              subtitle="All time"
            />
            <MetricCard
              title="Open Positions"
              value={stats.open_positions.toLocaleString()}
              icon={<Activity className="w-5 h-5" />}
              subtitle="Active"
              accent
            />
            <MetricCard
              title="Total Premium Received"
              value={formatCurrency(stats.total_premium)}
              icon={<DollarSign className="w-5 h-5" />}
              subtitle="Income"
            />
            <MetricCard
              title="Capital Utilization"
              value={formatPercent(stats.capital_utilization)}
              icon={<TrendingUp className="w-5 h-5" />}
              subtitle="Deployed"
              progressBar={{ value: stats.capital_utilization }}
            />
            <MetricCard
              title="Total Investors"
              value={stats.total_investors.toLocaleString()}
              icon={<Users className="w-5 h-5" />}
              subtitle="Accounts"
            />
            <MetricCard
              title="Expiring Soon"
              value={stats.positions_expiring_soon.toLocaleString()}
              icon={<Clock className="w-5 h-5" />}
              subtitle="Next 7 days"
              accent={stats.positions_expiring_soon > 0}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
