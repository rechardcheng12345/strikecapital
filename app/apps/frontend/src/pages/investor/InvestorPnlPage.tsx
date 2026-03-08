import { useState } from 'react';
import {
  BarChart3,
  DollarSign,
  PieChart,
} from 'lucide-react';
import { investorApi, type InvestorPnl } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Skeleton, ErrorAlert, EmptyState } from '../../components/ui';

function formatCurrency(value: number): string {
  return (value < 0 ? '-' : '') + '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}

const PERIOD_TABS = [
  { key: '1m', label: '1M' },
  { key: '3m', label: '3M' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All' },
] as const;

export function InvestorPnlPage() {
  const [period, setPeriod] = useState('all');

  const {
    data: pnl,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<InvestorPnl>({
    queryKey: ['investor', 'pnl', period],
    queryFn: () => investorApi.getPnl(period),
  });

  const pnlColor = pnl && pnl.total_pnl_share >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div>
      <h1
        className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <BarChart3 className="w-6 h-6 text-[#F06010]" />
        P&L
      </h1>

      {isError && (
        <div className="mb-6">
          <ErrorAlert
            message={error?.message || 'Failed to load P&L data.'}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {/* Period tabs */}
      <div className="flex gap-1 mb-6 border-b-2 border-[#0D2654]/10">
        {PERIOD_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPeriod(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors rounded-none border-b-2 -mb-[2px] ${
              period === tab.key
                ? 'border-[#F06010] text-[#F06010]'
                : 'border-transparent text-gray-500 hover:text-[#0D2654]'
            }`}
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-3">
            <Skeleton variant="rectangular" width={40} height={40} className="rounded-none" />
            <Skeleton variant="text" width="60%" height={14} />
            <Skeleton variant="text" width="80%" height={28} />
          </div>
          <div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-3">
            <Skeleton variant="rectangular" width={40} height={40} className="rounded-none" />
            <Skeleton variant="text" width="60%" height={14} />
            <Skeleton variant="text" width="80%" height={28} />
          </div>
        </div>
      ) : pnl ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="rounded-none border-2 border-[#F06010] bg-white p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 rounded-none bg-[#F06010]/10 text-[#F06010]">
                <DollarSign className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">My Share</span>
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">Total P&L Share</p>
            <p
              className={`text-2xl font-bold ${pnlColor}`}
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              {formatCurrency(pnl.total_pnl_share)}
            </p>
          </div>
          <div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5 hover:border-[#0D2654]/40 transition-all duration-150">
            <div className="flex items-start justify-between mb-3">
              <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                <PieChart className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Fund</span>
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">Allocation %</p>
            <p
              className="text-2xl font-bold text-[#0D2654]"
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}
            >
              {formatPercent(pnl.allocation_pct)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Records table */}
      <div className="bg-white rounded-none border-2 border-[#0D2654]/20 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton variant="text" width="25%" height={16} />
                <Skeleton variant="text" width="25%" height={16} />
                <Skeleton variant="text" width="25%" height={16} />
              </div>
            ))}
          </div>
        ) : !pnl || pnl.records.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No P&L records"
            description="No P&L records found for this period."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0D2654] text-white">
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Ticker</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>P&L Share</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {pnl.records.map((record, idx) => (
                  <tr
                    key={`${record.position_id}-${record.record_date}`}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="px-4 py-3 font-semibold text-[#0D2654]">{record.ticker}</td>
                    <td className={`px-4 py-3 text-right font-medium ${record.pnl_share >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(record.pnl_share)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {new Date(record.record_date).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
