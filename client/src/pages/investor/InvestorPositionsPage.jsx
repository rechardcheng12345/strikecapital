import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Briefcase } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Skeleton, ErrorAlert, EmptyState, ProfitCaptured, PageHeader } from '../../components/ui';
import { POSITION_STATUS } from '../../lib/constants';
function formatCurrency(value) {
    const n = Number(value) || 0;
    return (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const shortDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS_TABS = [
    { key: '', label: 'All' },
    { key: 'OPEN', label: 'Open' },
    { key: 'MONITORING', label: 'Monitoring' },
    { key: 'RESOLVED', label: 'Resolved' },
];
export function InvestorPositionsPage() {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState('');
    const limit = 20;
    const { data, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['investor', 'positions', page, status],
        queryFn: () => investorApi.getPositions(page, limit, status || undefined),
    });
    const positions = data?.positions || [];
    const pagination = data?.pagination;
    function handleStatusChange(newStatus) {
        setStatus(newStatus);
        setPage(1);
    }
    return (<div>
      <PageHeader eyebrow="My account" title="Positions" description="Every put the fund has sold. Your share of each is in proportion to your stake."/>

      {isError && (<div className="mb-6">
          <ErrorAlert message={error?.message || 'Failed to load positions.'} onRetry={() => refetch()}/>
        </div>)}

      {/* Status filter tabs */}
      <div className="flex gap-6 mb-6 border-b border-line">
        {STATUS_TABS.map((tab) => (<button key={tab.key} onClick={() => handleStatusChange(tab.key)} className={`py-2.5 text-[13.5px] font-medium transition-colors border-b-2 -mb-px ${status === tab.key
                ? 'border-accent text-ink'
                : 'border-transparent text-gray-500 hover:text-ink'}`}>
            {tab.label}
          </button>))}
      </div>

      {/* Table */}
      <div className="bg-white border border-line overflow-hidden">
        {isLoading ? (<div className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (<div key={i} className="flex gap-4">
                <Skeleton variant="text" width="15%" height={16}/>
                <Skeleton variant="text" width="12%" height={16}/>
                <Skeleton variant="text" width="12%" height={16}/>
                <Skeleton variant="text" width="8%" height={16}/>
                <Skeleton variant="text" width="15%" height={16}/>
                <Skeleton variant="text" width="12%" height={16}/>
                <Skeleton variant="text" width="15%" height={16}/>
              </div>))}
          </div>) : positions.length === 0 ? (<EmptyState icon={Briefcase} title="No positions found" description={status ? `No ${status.toLowerCase()} positions to display.` : 'There are no positions to display yet.'}/>) : (<div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3.5">Ticker</th>
                  <th className="text-left px-4 py-3.5">Type</th>
                  <th className="text-right px-4 py-3.5">Strike</th>
                  <th className="text-right px-4 py-3.5">Premium</th>
                  <th className="text-right px-4 py-3.5">Contracts</th>
                  <th className="text-left px-4 py-3.5">Expiration</th>
                  <th className="text-left px-4 py-3.5">Status</th>
                  <th className="text-right px-4 py-3.5">Collateral</th>
                  <th className="text-right px-4 py-3.5">Cur. Price</th>
                  <th className="text-right px-4 py-3.5">Unrealized P&L</th>
                  <th className="text-right px-4 py-3.5" title="% of premium (max profit) captured">Captured</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos, idx) => {
                const statusConfig = POSITION_STATUS[pos.status];
                return (<tr key={pos.id} onClick={() => navigate(`/positions/${pos.id}`)} className={`cursor-pointer border-b border-line/70 last:border-b-0`}>
                      <td className="px-4 py-3.5 font-medium text-ink whitespace-nowrap">{String(pos.ticker).replace(/ PUT$/i, '')}</td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
                          {pos.position_type === 'stock' ? 'Stock' : 'Put'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.strike_price)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.premium_received)}</td>
                      <td className="px-4 py-3 text-right">{pos.position_type === 'stock' ? (pos.shares || '--') : pos.contracts}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{pos.position_type === 'stock' ? '—' : (pos.expiration_date ? shortDate(pos.expiration_date) : '--')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-none text-xs font-medium ${statusConfig?.color || 'bg-gray-100 text-gray-800'}`}>
                          {statusConfig?.label || pos.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted">{formatCurrency(pos.collateral)}</td>
                      <td className="px-4 py-3 text-right font-mono">{pos.current_price != null ? formatCurrency(pos.current_price) : '--'}</td>
                      <td className={`px-4 py-3 text-right font-mono font-medium ${pos.unrealized_pnl != null ? (pos.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                        {pos.unrealized_pnl != null ? formatCurrency(pos.unrealized_pnl) : '--'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ProfitCaptured pct={pos.profit_captured_pct}/>
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
