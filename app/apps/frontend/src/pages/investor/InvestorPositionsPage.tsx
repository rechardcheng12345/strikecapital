import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Briefcase,
} from 'lucide-react';
import { investorApi, type PositionsResponse } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Skeleton, ErrorAlert, EmptyState } from '../../components/ui';
import { POSITION_STATUS } from '../../lib/constants';

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'MONITORING', label: 'Monitoring' },
  { key: 'RESOLVED', label: 'Resolved' },
] as const;

export function InvestorPositionsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const limit = 20;

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<PositionsResponse>({
    queryKey: ['investor', 'positions', page, status],
    queryFn: () => investorApi.getPositions(page, limit, status || undefined),
  });

  const positions = data?.positions || [];
  const pagination = data?.pagination;

  function handleStatusChange(newStatus: string) {
    setStatus(newStatus);
    setPage(1);
  }

  return (
    <div>
      <h1
        className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <TrendingUp className="w-6 h-6 text-[#F06010]" />
        My Positions
      </h1>

      {isError && (
        <div className="mb-6">
          <ErrorAlert
            message={error?.message || 'Failed to load positions.'}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-6 border-b-2 border-[#0D2654]/10">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleStatusChange(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors rounded-none border-b-2 -mb-[2px] ${
              status === tab.key
                ? 'border-[#F06010] text-[#F06010]'
                : 'border-transparent text-gray-500 hover:text-[#0D2654]'
            }`}
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-none border-2 border-[#0D2654]/20 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <Skeleton variant="text" width="15%" height={16} />
                <Skeleton variant="text" width="12%" height={16} />
                <Skeleton variant="text" width="12%" height={16} />
                <Skeleton variant="text" width="8%" height={16} />
                <Skeleton variant="text" width="15%" height={16} />
                <Skeleton variant="text" width="12%" height={16} />
                <Skeleton variant="text" width="15%" height={16} />
              </div>
            ))}
          </div>
        ) : positions.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No positions found"
            description={status ? `No ${status.toLowerCase()} positions to display.` : 'There are no positions to display yet.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0D2654] text-white">
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Ticker</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Type</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Strike</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Premium</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Contracts</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Expiration</th>
                  <th className="text-left px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Status</th>
                  <th className="text-right px-4 py-3 font-medium" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Collateral</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => {
                  const statusConfig = POSITION_STATUS[pos.status as keyof typeof POSITION_STATUS];
                  return (
                    <tr
                      key={pos.id}
                      onClick={() => navigate(`/positions/${pos.id}`)}
                      className={`cursor-pointer transition-colors hover:bg-[#F5F3EF] ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold text-[#0D2654]">{pos.ticker}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-none text-xs font-medium ${
                          pos.position_type === 'stock' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {pos.position_type === 'stock' ? 'Stock' : 'Put'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(pos.strike_price)}</td>
                      <td className="px-4 py-3 text-right text-green-600">{formatCurrency(pos.premium_received)}</td>
                      <td className="px-4 py-3 text-right">{pos.position_type === 'stock' ? (pos.shares || '--') : pos.contracts}</td>
                      <td className="px-4 py-3">{pos.position_type === 'stock' ? '--' : (pos.expiration_date ? new Date(pos.expiration_date).toLocaleDateString() : '--')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-none text-xs font-medium ${statusConfig?.color || 'bg-gray-100 text-gray-800'}`}>
                          {statusConfig?.label || pos.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(pos.collateral)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-500">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-none"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-none"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
