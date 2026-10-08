import { useState } from 'react';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Skeleton, ErrorAlert, EmptyState, PageHeader, Ledger, Money, toneClass } from '../../components/ui';
import { RESOLUTION_TYPE } from '../../lib/constants';
function formatCurrency(value) {
    return (value < 0 ? '-' : '') + '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    return (<div>
      <PageHeader eyebrow="My account" title="History" description="Every position the fund has closed, and how it ended."/>

      {isError && <div className="mb-6"><ErrorAlert message={error?.message || 'Failed to load position history.'} onRetry={() => refetch()}/></div>}

      {isLoading ? <Skeleton height={130} className="mb-8"/> : stats ? (<Ledger columns={3} className="mb-8" items={[
            { label: 'Positions closed', value: stats.total_resolved.toLocaleString(), caption: 'Expired, bought back or assigned' },
            { label: 'Win rate', value: `${Number(stats.win_rate || 0).toFixed(1)}%`, caption: 'Closed with a profit' },
            { label: 'Realized P&L', value: <Money value={stats.total_realized_pnl} signed/>, tone: toneClass(stats.total_realized_pnl), caption: 'Fund total, after fees' },
        ]}/>) : null}

      {/* Table */}
      <div className="bg-white border border-line overflow-hidden">
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
                <tr>
                  <th className="text-left px-4 py-3.5">Ticker</th>
                  <th className="text-right px-4 py-3.5">Strike</th>
                  <th className="text-right px-4 py-3.5">Premium</th>
                  <th className="text-left px-4 py-3.5">Resolution Type</th>
                  <th className="text-right px-4 py-3.5">Realized P&L</th>
                  <th className="text-left px-4 py-3.5">Resolution Date</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => {
                const resConfig = pos.resolution_type
                    ? RESOLUTION_TYPE[pos.resolution_type]
                    : null;
                const realizedPnl = pos.realized_pnl ?? 0;
                return (<tr key={pos.id} className={'border-b border-line/70 last:border-b-0'}>
                      <td className="px-4 py-3 font-medium text-ink whitespace-nowrap">{String(pos.ticker).replace(/ PUT$/i, '')}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.strike_price)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.premium_received)}</td>
                      <td className="px-4 py-3">
                        {resConfig ? (<span className="text-ink/80">{resConfig.label}</span>) : (<span className="text-gray-400">--</span>)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${realizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(realizedPnl)}
                      </td>
                      <td className="px-4 py-3 text-muted whitespace-nowrap">
                        {(pos.close_date || pos.resolution_date) ? new Date(pos.close_date || pos.resolution_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '--'}
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
