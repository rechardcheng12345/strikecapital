import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, Plus, ChevronLeft, ChevronRight, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { positionApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { POSITION_STATUS } from '../../lib/constants';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { ErrorAlert } from '../../components/ui/ErrorAlert';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
const STATUS_TABS = [
    { key: 'ALL', label: 'All' },
    { key: 'OPEN', label: 'Opened' },
    { key: 'MONITORING', label: 'Monitoring' },
    { key: 'ROLLING', label: 'Rolling' },
    { key: 'EXPIRY', label: 'Expiry' },
    { key: 'RESOLVED', label: 'Resolved' },
];
const STATUS_BADGE_VARIANT = {
    OPEN: 'bg-green-100 text-green-800',
    MONITORING: 'bg-yellow-100 text-yellow-800',
    ROLLING: 'bg-blue-100 text-blue-800',
    EXPIRY: 'bg-orange-100 text-orange-800',
    RESOLVED: 'bg-gray-100 text-gray-800',
};
function formatCurrency(value) {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return '$' + (num || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPercent(value) {
    if (value === undefined || value === null)
        return '--';
    return value.toFixed(2) + '%';
}
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}
export function AdminPositionsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState('OPEN');
    const [page, setPage] = useState(1);
    const limit = 20;
    const [deleteTarget, setDeleteTarget] = useState(null);
    const statusParam = activeTab === 'ALL' ? undefined : activeTab;
    const { data, isLoading, isError, error, refetch } = useApiQuery({
        queryKey: ['positions', page, limit, statusParam ?? 'ALL'],
        queryFn: () => positionApi.list(page, limit, statusParam),
    });
    const refreshPricesMutation = useMutation({
        mutationFn: () => positionApi.refreshPrices(),
        onSuccess: (response) => {
            if (response.error) {
                toast.error(response.error);
                return;
            }
            const { updated, prices, source } = response.data;
            const sourceLabel = source === 'moomoo' ? 'Live API' : source === 'cache' ? 'Cached' : '';
            toast.success(`Refreshed ${prices.length} ticker${prices.length !== 1 ? 's' : ''}, updated ${updated} position${updated !== 1 ? 's' : ''}${sourceLabel ? ` (${sourceLabel})` : ''}`);
            queryClient.invalidateQueries({ queryKey: ['positions'] });
        },
        onError: () => {
            toast.error('Failed to refresh prices');
        },
    });
    const deleteMutation = useMutation({
        mutationFn: (id) => positionApi.delete(id),
        onSuccess: (response) => {
            if (response.error) {
                toast.error(response.error);
                return;
            }
            toast.success('Position deleted');
            setDeleteTarget(null);
            queryClient.invalidateQueries({ queryKey: ['positions'] });
        },
        onError: () => {
            toast.error('Failed to delete position');
        },
    });
    const positions = data?.positions ?? [];
    const pagination = data?.pagination;
    function handleTabChange(tab) {
        setActiveTab(tab);
        setPage(1);
    }
    return (<div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <TrendingUp className="w-6 h-6 text-[#F06010]"/>
          Positions
        </h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="rounded-none" loading={refreshPricesMutation.isPending} onClick={() => refreshPricesMutation.mutate()}>
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshPricesMutation.isPending ? 'animate-spin' : ''}`}/>
            Refresh Prices
          </Button>
          <Link to="/admin/positions/new">
            <Button variant="primary" className="bg-[#F06010] hover:bg-[#d9560e] rounded-none">
              <Plus className="w-4 h-4 mr-2"/>
              Add Position
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {STATUS_TABS.map((tab) => (<button key={tab.key} onClick={() => handleTabChange(tab.key)} className={`px-4 py-2 text-sm font-medium transition-colors rounded-none ${activeTab === tab.key
                ? 'text-[#F06010] border-b-2 border-[#F06010]'
                : 'text-gray-500 hover:text-gray-700'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {tab.label}
          </button>))}
      </div>

      {/* Error */}
      {isError && (<ErrorAlert message={error?.message || 'Failed to load positions'} onRetry={() => refetch()}/>)}

      {/* Loading Skeleton */}
      {isLoading && (<Card className="rounded-none">
          <CardBody>
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (<div key={i} className="flex items-center gap-4">
                  <Skeleton variant="text" className="w-16 h-5"/>
                  <Skeleton variant="text" className="w-20 h-5"/>
                  <Skeleton variant="text" className="w-24 h-5"/>
                  <Skeleton variant="text" className="w-16 h-5"/>
                  <Skeleton variant="text" className="w-24 h-5"/>
                  <Skeleton variant="text" className="w-20 h-5"/>
                  <Skeleton variant="text" className="w-28 h-5"/>
                  <Skeleton variant="text" className="w-24 h-5"/>
                  <Skeleton variant="text" className="w-20 h-5"/>
                </div>))}
            </div>
          </CardBody>
        </Card>)}

      {/* Empty State */}
      {!isLoading && !isError && positions.length === 0 && (<Card className="rounded-none">
          <CardBody>
            <EmptyState icon={TrendingUp} title="No positions found" description={activeTab === 'ALL'
                ? 'Get started by adding your first cash-secured put position.'
                : `No positions with status "${activeTab}".`} action={<Link to="/admin/positions/new">
                  <Button variant="primary" className="bg-[#F06010] hover:bg-[#d9560e] rounded-none">
                    <Plus className="w-4 h-4 mr-2"/>
                    Add Position
                  </Button>
                </Link>}/>
          </CardBody>
        </Card>)}

      {/* Positions Table */}
      {!isLoading && !isError && positions.length > 0 && (<Card className="rounded-none overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#0D2654] text-white">
                  <th className="text-left px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Ticker</th>
                  <th className="text-left px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Type</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Strike</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Premium</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Contracts</th>
                  <th className="text-left px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Expiration</th>
                  <th className="text-left px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Status</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Collateral</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Break-Even</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Cur. Price</th>
                  <th className="text-right px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Unrealized P&L</th>
                  <th className="text-center px-4 py-3 font-semibold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {positions.map((pos) => (<tr key={pos.id} onClick={() => navigate(`/admin/positions/${pos.id}`)} className="hover:bg-[#F5F3EF] cursor-pointer transition-colors">
                    <td className="px-4 py-3 font-semibold text-[#0D2654]">{pos.ticker}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-none text-xs font-medium ${pos.position_type === 'stock' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                        {pos.position_type === 'stock' ? 'Stock' : 'Put'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.strike_price)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.premium_received)}</td>
                    <td className="px-4 py-3 text-right">{pos.position_type === 'stock' ? (pos.shares || '--') : pos.contracts}</td>
                    <td className="px-4 py-3">{pos.position_type === 'stock' ? '--' : (pos.expiration_date ? formatDate(pos.expiration_date) : '--')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-none text-xs font-medium ${STATUS_BADGE_VARIANT[pos.status] || 'bg-gray-100 text-gray-800'}`}>
                        {POSITION_STATUS[pos.status]?.label || pos.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.collateral)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(pos.break_even)}</td>
                    <td className="px-4 py-3 text-right font-mono">{pos.current_price != null ? formatCurrency(pos.current_price) : '--'}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${pos.unrealized_pnl != null ? (pos.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600') : ''}`}>
                      {pos.unrealized_pnl != null ? formatCurrency(pos.unrealized_pnl) : '--'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(pos);
                }} className="text-gray-400 hover:text-red-600 transition-colors p-1" title="Delete position">
                        <Trash2 className="w-4 h-4"/>
                      </button>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        </Card>)}

      {/* Pagination */}
      {pagination && pagination.pages > 1 && (<div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-600">
            Showing {((pagination.page - 1) * pagination.limit) + 1}
            {' '}-{' '}
            {Math.min(pagination.page * pagination.limit, pagination.total)}
            {' '}of {pagination.total} positions
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-none" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="w-4 h-4"/>
            </Button>
            <span className="text-sm text-gray-700 px-2">
              Page {pagination.page} of {pagination.pages}
            </span>
            <Button variant="outline" size="sm" className="rounded-none" disabled={pagination.page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="w-4 h-4"/>
            </Button>
          </div>
        </div>)}

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Position" size="sm">
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to delete the{' '}
            <span className="font-semibold text-[#0D2654]">{deleteTarget?.ticker}</span>{' '}
            ${deleteTarget?.strike_price} put position? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" className="rounded-none" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" className="rounded-none" loading={deleteMutation.isPending} onClick={() => {
            if (deleteTarget) {
                deleteMutation.mutate(deleteTarget.id);
            }
        }}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>);
}
