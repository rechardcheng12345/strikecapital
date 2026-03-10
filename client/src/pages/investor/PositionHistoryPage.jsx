import { useState } from 'react';
import { History, ChevronLeft, ChevronRight, Trophy, DollarSign, CheckCircle, } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Skeleton, ErrorAlert, EmptyState } from '../../components/ui';
import { RESOLUTION_TYPE } from '../../lib/constants';
function formatCurrency(value) {
    return (value < 0 ? '-' : '') + '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPercent(value) {
    return value.toFixed(1) + '%';
}
function StatCard({ title, value, icon, valueColor }) {
    return (<div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5 hover:border-[#0D2654]/40 transition-all duration-150">
      <div className="flex items-start mb-3">
        <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
          {icon}
        </div>
      </div>
      <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
      <p className={`text-2xl font-bold ${valueColor || 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        {value}
      </p>
    </div>);
}
function StatCardSkeleton() {
    return (<div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-3">
      <Skeleton variant="rectangular" width={40} height={40} className="rounded-none"/>
      <Skeleton variant="text" width="60%" height={14}/>
      <Skeleton variant="text" width="80%" height={28}/>
    </div>);
}
export function PositionHistoryPage() {
    const [page, setPage] = useState(1);
    const limit = 20;
    const { data, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['investor', 'history', page],
        queryFn: () => investorApi.getHistory(page, limit),
    });
    const positions = data?.positions || [];
    const stats = data?.stats;
    const pagination = data?.pagination;
    const pnlColor = stats && stats.total_realized_pnl >= 0 ? 'text-green-600' : 'text-red-600';
    return (<div>
      <h1 className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        <History className="w-6 h-6 text-[#F06010]"/>
        Position History
      </h1>

      {isError && (<div className="mb-6">
          <ErrorAlert message={error?.message || 'Failed to load position history.'} onRetry={() => refetch()}/>
        </div>)}

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {isLoading ? (<>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>) : stats ? (<>
            <StatCard title="Total Resolved" value={stats.total_resolved.toLocaleString()} icon={<CheckCircle className="w-5 h-5"/>}/>
            <StatCard title="Win Rate" value={formatPercent(stats.win_rate)} icon={<Trophy className="w-5 h-5"/>}/>
            <StatCard title="Total Realized P&L" value={formatCurrency(stats.total_realized_pnl)} icon={<DollarSign className="w-5 h-5"/>} valueColor={pnlColor}/>
          </>) : null}
      </div>

      {/* Table */}
      <div className="bg-white rounded-none border-2 border-[#0D2654]/20 overflow-hidden">
        {isLoading ? (<div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (<div key={i} className="flex gap-4">
                <Skeleton variant="text" width="15%" height={16}/>
                <Skeleton variant="text" width="12%" height={16}/>
                <Skeleton variant="text" width="12%" height={16}/>
                <Skeleton variant="text" width="15%" height={16}/>
                <Skeleton variant="text" width="15%" height={16}/>
                <Skeleton variant="text" width="15%" height={16}/>
              </div>))}
          </div>) : positions.length === 0 ? (<EmptyState icon={History} title="No resolved positions" description="There are no resolved positions in your history yet."/>) : (<div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0D2654] text-white">
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Ticker</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Strike</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Premium</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Resolution Type</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Realized P&L</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Resolution Date</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => {
                const resConfig = pos.resolution_type
                    ? RESOLUTION_TYPE[pos.resolution_type]
                    : null;
                const realizedPnl = pos.realized_pnl ?? 0;
                return (<tr key={pos.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-3 font-semibold text-[#0D2654]">{pos.ticker}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(pos.strike_price)}</td>
                      <td className="px-4 py-3 text-right text-green-600">{formatCurrency(pos.premium_received)}</td>
                      <td className="px-4 py-3">
                        {resConfig ? (<span className={`font-medium ${resConfig.color}`}>{resConfig.label}</span>) : (<span className="text-gray-400">--</span>)}
                      </td>
                      <td className={`px-4 py-3 text-right font-medium ${realizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(realizedPnl)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {pos.resolution_date ? new Date(pos.resolution_date).toLocaleDateString() : '--'}
                      </td>
                    </tr>);
            })}
              </tbody>
            </table>
          </div>)}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (<div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagination.page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-none">
              <ChevronLeft className="w-4 h-4"/>
            </Button>
            <Button variant="outline" size="sm" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-none">
              <ChevronRight className="w-4 h-4"/>
            </Button>
          </div>
        </div>)}
    </div>);
}
