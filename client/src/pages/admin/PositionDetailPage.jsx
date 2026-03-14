import { useState } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Calendar, DollarSign, TrendingDown, Shield, Target, Percent, Edit3, Trash2, CheckCircle2, RefreshCw, Info, ExternalLink, } from 'lucide-react';
import { positionApi, investorApi, } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { POSITION_STATUS, RESOLUTION_TYPE, POSITION_TYPE } from '../../lib/constants';
import { Button, Input, Card, CardHeader, CardBody, Badge, Modal, ErrorAlert, Skeleton, } from '../../components/ui';
// ─── Helpers ───────────────────────────────────────────
function formatCurrency(value) {
    if (value == null)
        return '--';
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPercent(value) {
    if (value == null)
        return '--';
    return value.toFixed(2) + '%';
}
function formatDate(dateStr) {
    if (!dateStr)
        return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}
function statusBadgeVariant(status) {
    const map = {
        OPEN: 'green',
        MONITORING: 'yellow',
        ROLLING: 'blue',
        EXPIRY: 'red',
        RESOLVED: 'gray',
    };
    return map[status] ?? 'gray';
}
function RiskMetric({ label, value, icon, highlight }) {
    return (<div className={`rounded-none border-2 p-4 transition-all duration-150 ${highlight
            ? 'border-[#F06010] bg-[#F06010]/5'
            : 'border-[#0D2654]/15 bg-white hover:border-[#0D2654]/30'}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1.5 rounded-none ${highlight ? 'bg-[#F06010]/10 text-[#F06010]' : 'bg-[#0D2654]/5 text-[#0D2654]'}`}>
          {icon}
        </div>
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
        {value}
      </p>
    </div>);
}
// ─── Detail Row ───────────────────────────────────────
function DetailRow({ label, value }) {
    return (<div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-medium text-[#0D2654]">{value ?? '--'}</span>
    </div>);
}
// ─── Loading Skeleton ─────────────────────────────────
function DetailSkeleton() {
    return (<div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton variant="rectangular" width={80} height={36} className="rounded-none"/>
        <Skeleton variant="text" width="40%" height={32}/>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (<div key={i} className="rounded-none border-2 border-gray-200 bg-white p-4 space-y-2">
            <Skeleton variant="text" width="60%" height={12}/>
            <Skeleton variant="text" width="80%" height={22}/>
          </div>))}
      </div>
      <div className="rounded-none border-2 border-gray-200 bg-white p-6 space-y-4">
        <Skeleton variant="text" width="30%" height={20}/>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (<div key={i} className="space-y-1">
              <Skeleton variant="text" width="50%" height={10}/>
              <Skeleton variant="text" width="70%" height={16}/>
            </div>))}
        </div>
      </div>
    </div>);
}
// ─── Main Component ───────────────────────────────────
export function PositionDetailPage() {
    const { id } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const isAdmin = location.pathname.startsWith('/admin');
    const positionId = Number(id);
    // ─── State ────────────────────────────────────────
    const [resolveOpen, setResolveOpen] = useState(false);
    const [rollOpen, setRollOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshLog, setRefreshLog] = useState(null);
    // Resolve form
    const [resolveForm, setResolveForm] = useState({
        resolution_type: 'expired_worthless',
        realized_pnl: undefined,
        notes: '',
    });
    // Roll form
    const [rollForm, setRollForm] = useState({
        ticker: '',
        strike_price: 0,
        premium_received: 0,
        contracts: 1,
        expiration_date: '',
        notes: '',
    });
    // ─── Fetch Position ───────────────────────────────
    const { data: position, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['position', positionId, isAdmin ? 'admin' : 'investor'],
        queryFn: () => isAdmin ? positionApi.get(positionId) : investorApi.getPosition(positionId),
        enabled: !isNaN(positionId) && positionId > 0,
    });
    // Pre-fill roll form when position loads
    const initRollForm = () => {
        if (position) {
            setRollForm({
                ticker: position.ticker,
                strike_price: position.strike_price,
                premium_received: 0,
                contracts: position.contracts,
                expiration_date: '',
                notes: '',
            });
        }
        setActionError(null);
        setRollOpen(true);
    };
    // ─── Actions ──────────────────────────────────────
    const handleResolve = async () => {
        setActionLoading(true);
        setActionError(null);
        const res = await positionApi.resolve(positionId, resolveForm);
        setActionLoading(false);
        if (res.error) {
            setActionError(res.error);
            return;
        }
        setResolveOpen(false);
        queryClient.invalidateQueries({ queryKey: ['position', positionId] });
        refetch();
    };
    const handleRoll = async () => {
        setActionLoading(true);
        setActionError(null);
        const res = await positionApi.roll(positionId, rollForm);
        setActionLoading(false);
        if (res.error) {
            setActionError(res.error);
            return;
        }
        setRollOpen(false);
        queryClient.invalidateQueries({ queryKey: ['position'] });
        if (res.data?.new_position) {
            navigate(`/admin/positions/${res.data.new_position.id}`);
        }
        else {
            refetch();
        }
    };
    const handleDelete = async () => {
        setActionLoading(true);
        setActionError(null);
        const res = await positionApi.delete(positionId);
        setActionLoading(false);
        if (res.error) {
            setActionError(res.error);
            return;
        }
        setDeleteOpen(false);
        queryClient.invalidateQueries({ queryKey: ['positions'] });
        navigate('/admin/positions');
    };
    const handleRefreshPrices = async () => {
        setRefreshing(true);
        setRefreshLog(null);
        try {
            const res = await positionApi.refreshPrices();
            if (res.error) {
                setRefreshLog({ error: res.error });
            } else {
                setRefreshLog(res.data);
                queryClient.invalidateQueries({ queryKey: ['position', positionId] });
                refetch();
            }
        } catch (err) {
            setRefreshLog({ error: err.message || 'Failed to refresh prices' });
        }
        setRefreshing(false);
    };
    // ─── Back path ────────────────────────────────────
    const backPath = isAdmin ? '/admin/positions' : '/positions';
    // ─── Render ───────────────────────────────────────
    return (<div>
      {/* Back button */}
      <button onClick={() => navigate(backPath)} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0D2654]/60 hover:text-[#0D2654] transition-colors mb-4">
        <ArrowLeft className="w-4 h-4"/>
        Back to Positions
      </button>

      {isError && (<div className="mb-6">
          <ErrorAlert message={error?.message || 'Failed to load position.'} onRetry={() => refetch()}/>
        </div>)}

      {isLoading && <DetailSkeleton />}

      {position && (<div className="space-y-6">
          {/* ─── Header ────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {position.position_type === 'stock'
                ? `${position.ticker} Stock`
                : `${position.ticker} $${parseFloat(position.strike_price).toFixed(2)}P`}
              </h1>
              <Badge variant={statusBadgeVariant(position.status)}>
                {POSITION_STATUS[position.status]?.label ?? position.status}
              </Badge>
              <Badge variant={position.position_type === 'stock' ? 'blue' : 'gray'}>
                {POSITION_TYPE[position.position_type]?.shortLabel || 'Option'}
              </Badge>
            </div>
            {position.position_type !== 'stock' && position.expiration_date && (<div className="flex items-center gap-2 text-sm text-gray-500">
                <Calendar className="w-4 h-4"/>
                Expires {formatDate(position.expiration_date)}
              </div>)}
            {position.position_type === 'stock' && position.shares && (<div className="flex items-center gap-2 text-sm text-gray-500">
                {position.shares.toLocaleString()} shares @ {formatCurrency(position.cost_basis)}
              </div>)}
          </div>

          {/* ─── Admin actions ─────────────────────────── */}
          {isAdmin && position.status !== 'RESOLVED' && (<div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => {
                    setActionError(null);
                    setResolveForm(f => ({
                        ...f,
                        resolution_type: position.position_type === 'stock' ? 'sold' : 'expired_worthless',
                    }));
                    setResolveOpen(true);
                }}>
                <CheckCircle2 className="w-4 h-4 mr-1.5"/>
                {position.position_type === 'stock' ? 'Sell / Close' : 'Resolve'}
              </Button>
              {position.position_type !== 'stock' && (<Button variant="outline" size="sm" onClick={initRollForm}>
                  <RefreshCw className="w-4 h-4 mr-1.5"/>
                  Roll
                </Button>)}
              <Button variant="outline" size="sm" onClick={() => navigate(`/admin/positions/${positionId}/edit`)}>
                <Edit3 className="w-4 h-4 mr-1.5"/>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => {
                    setActionError(null);
                    setDeleteOpen(true);
                }}>
                <Trash2 className="w-4 h-4 mr-1.5"/>
                Delete
              </Button>
              {position.position_type !== 'stock' && (
                <Button variant="outline" size="sm" loading={refreshing} onClick={handleRefreshPrices}>
                  <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshing ? 'animate-spin' : ''}`}/>
                  Refresh Prices
                </Button>
              )}
            </div>)}

          {/* ─── Refresh Prices Log ─────────────────────── */}
          {refreshLog && (
            <Card className="rounded-none">
              <CardHeader className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  Price Refresh Log
                </h3>
                <button onClick={() => setRefreshLog(null)} className="text-gray-400 hover:text-gray-600 text-xs">
                  Dismiss
                </button>
              </CardHeader>
              <CardBody>
                {refreshLog.error ? (
                  <p className="text-red-600 text-sm">{refreshLog.error}</p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700">
                      Updated <span className="font-semibold">{refreshLog.updated}</span> position(s) from{' '}
                      <span className="font-semibold">{refreshLog.prices?.length || 0}</span> option quote(s).
                      {refreshLog.source && (
                        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-none text-xs font-medium ${refreshLog.source === 'moomoo' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          Source: {refreshLog.source === 'moomoo' ? 'Live API' : 'Cached'}
                        </span>
                      )}
                    </p>
                    {refreshLog.prices?.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-left">
                              <th className="px-3 py-2 font-semibold">Ticker</th>
                              <th className="px-3 py-2 font-semibold">Strike</th>
                              <th className="px-3 py-2 font-semibold">Expiry</th>
                              <th className="px-3 py-2 font-semibold">Option Code</th>
                              <th className="px-3 py-2 font-semibold text-right">Price</th>
                              <th className="px-3 py-2 font-semibold text-right">IV</th>
                              <th className="px-3 py-2 font-semibold text-right">Delta</th>
                              <th className="px-3 py-2 font-semibold text-right">Stock</th>
                              <th className="px-3 py-2 font-semibold text-right">Dist. to Strike</th>
                              <th className="px-3 py-2 font-semibold text-right">Last Updated</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {refreshLog.prices.map((p, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-medium">{p.ticker}</td>
                                <td className="px-3 py-2 font-mono">${parseFloat(p.strike).toFixed(2)}</td>
                                <td className="px-3 py-2">{p.expiry}</td>
                                <td className="px-3 py-2 font-mono text-gray-500">{p.option_code}</td>
                                <td className="px-3 py-2 text-right font-mono font-semibold">${parseFloat(p.price).toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono">{p.iv != null ? p.iv.toFixed(1) + '%' : '--'}</td>
                                <td className="px-3 py-2 text-right font-mono">{p.delta != null ? p.delta.toFixed(3) : '--'}</td>
                                <td className="px-3 py-2 text-right font-mono">{p.stock_price != null ? '$' + p.stock_price.toFixed(2) : '--'}</td>
                                <td className="px-3 py-2 text-right font-mono">{p.distance_to_strike != null ? p.distance_to_strike.toFixed(2) + '%' : '--'}</td>
                                <td className="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{p.cached_at ? new Date(p.cached_at).toLocaleString() : new Date().toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          )}

          {/* ─── Risk Metrics Strip ────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {position.position_type === 'stock' ? (<>
                <RiskMetric label="Shares" value={position.shares?.toLocaleString() || '--'} icon={<DollarSign className="w-4 h-4"/>}/>
                <RiskMetric label="Cost Basis" value={formatCurrency(position.cost_basis)} icon={<Target className="w-4 h-4"/>}/>
                <RiskMetric label="Current Price" value={position.current_price != null ? formatCurrency(position.current_price) : '--'} icon={<DollarSign className="w-4 h-4"/>}/>
                <RiskMetric label="Collateral" value={formatCurrency(position.collateral)} icon={<Shield className="w-4 h-4"/>}/>
                <RiskMetric label="Break-Even" value={formatCurrency(position.break_even)} icon={<Target className="w-4 h-4"/>}/>
                <RiskMetric label="Unrealized P&L" value={position.current_price && position.shares
                    ? formatCurrency((position.current_price - (position.cost_basis || 0)) * position.shares)
                    : '--'} icon={<TrendingDown className="w-4 h-4"/>} highlight={position.current_price != null && position.cost_basis != null && position.current_price < position.cost_basis}/>
              </>) : (<>
                <RiskMetric label="Current Price" value={position.current_price != null ? formatCurrency(position.current_price) : '--'} icon={<DollarSign className="w-4 h-4"/>}/>
                <RiskMetric label="Unrealized P&L" value={position.unrealized_pnl != null ? formatCurrency(position.unrealized_pnl) : '--'} icon={<TrendingDown className="w-4 h-4"/>} highlight={position.unrealized_pnl != null && position.unrealized_pnl < 0}/>
                <RiskMetric label="Collateral" value={formatCurrency(position.collateral)} icon={<Shield className="w-4 h-4"/>}/>
                <RiskMetric label="Break-Even" value={formatCurrency(position.break_even)} icon={<Target className="w-4 h-4"/>}/>
                <RiskMetric label="Max Profit" value={formatCurrency(position.max_profit)} icon={<DollarSign className="w-4 h-4"/>}/>
                <RiskMetric label="Return on Coll." value={position.collateral > 0 ? formatPercent((position.max_profit / position.collateral) * 100) : '--'} icon={<Percent className="w-4 h-4"/>} highlight={position.collateral > 0 && (position.max_profit / position.collateral) * 100 > 3}/>
              </>)}
          </div>
          {position.last_price_update && (
            <p className="text-xs text-gray-400 -mt-1">
              Prices updated: {new Date(position.last_price_update).toLocaleString()}
            </p>
          )}

          {/* ─── Position Details Card ─────────────────── */}
          <Card className="rounded-none border-2 border-[#0D2654]/15">
            <CardHeader className="border-b-2 border-[#0D2654]/10">
              <h2 className="text-lg font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                <Info className="w-5 h-5 text-[#F06010]"/>
                Position Details
              </h2>
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
                <DetailRow label="Ticker" value={position.ticker}/>
                <DetailRow label="Type" value={POSITION_TYPE[position.position_type]?.label || 'Option'}/>
                {position.position_type === 'stock' ? (<>
                    <DetailRow label="Shares" value={position.shares?.toLocaleString()}/>
                    <DetailRow label="Cost Basis" value={formatCurrency(position.cost_basis)}/>
                    <DetailRow label="Collateral" value={formatCurrency(position.collateral)}/>
                    <DetailRow label="Break-Even" value={formatCurrency(position.break_even)}/>
                    <DetailRow label="Current Price" value={position.current_price != null ? formatCurrency(position.current_price) : '--'}/>
                    <DetailRow label="Status" value={POSITION_STATUS[position.status]?.label ?? position.status}/>
                    <DetailRow label="Open Date" value={formatDate(position.created_at)}/>
                  </>) : (<>
                    <DetailRow label="Strike Price" value={formatCurrency(position.strike_price)}/>
                    <DetailRow label="Premium Received" value={formatCurrency(position.premium_received)}/>
                    <DetailRow label="Contracts" value={position.contracts}/>
                    <DetailRow label="Expiration" value={formatDate(position.expiration_date)}/>
                    <DetailRow label="Status" value={POSITION_STATUS[position.status]?.label ?? position.status}/>
                    <DetailRow label="Collateral" value={formatCurrency(position.collateral)}/>
                    <DetailRow label="Break-Even" value={formatCurrency(position.break_even)}/>
                    <DetailRow label="Max Profit" value={formatCurrency(position.max_profit)}/>
                    <DetailRow label="Current Price" value={position.current_price != null ? formatCurrency(position.current_price) : '--'}/>
                    <DetailRow label="Unrealized P&L" value={position.unrealized_pnl != null ? formatCurrency(position.unrealized_pnl) : '--'}/>
                    <DetailRow label="Last Price Update" value={position.last_price_update ? new Date(position.last_price_update).toLocaleString() : '--'}/>
                    <DetailRow label="Created" value={formatDate(position.created_at)}/>
                  </>)}
              </div>
              {position.notes && (<div className="mt-4 pt-4 border-t border-[#0D2654]/10">
                  <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Notes</span>
                  <p className="text-sm text-[#0D2654] mt-1 whitespace-pre-wrap">{position.notes}</p>
                </div>)}
            </CardBody>
          </Card>

          {/* ─── Resolution Info (if resolved) ─────────── */}
          {position.status === 'RESOLVED' && (<Card className="rounded-none border-2 border-[#0D2654]/15">
              <CardHeader className="border-b-2 border-[#0D2654]/10">
                <h2 className="text-lg font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  <CheckCircle2 className="w-5 h-5 text-[#F06010]"/>
                  Resolution
                </h2>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
                  <DetailRow label="Resolution Type" value={position.resolution_type ? (<span className={RESOLUTION_TYPE[position.resolution_type]?.color ?? 'text-gray-600'}>
                          {RESOLUTION_TYPE[position.resolution_type]?.label ?? position.resolution_type}
                        </span>) : ('--')}/>
                  <DetailRow label="Resolution Date" value={formatDate(position.resolution_date)}/>
                  <DetailRow label="Realized P&L" value={position.realized_pnl != null ? (<span className={position.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {formatCurrency(position.realized_pnl)}
                        </span>) : ('--')}/>
                </div>
              </CardBody>
            </Card>)}

          {/* ─── Rolled from / to links ────────────────── */}
          {(position.rolled_from_id || position.rolled_to_id || position.assigned_from_id || position.assigned_to_id) && (<Card className="rounded-none border-2 border-blue-200 bg-blue-50/30">
              <CardBody>
                <div className="flex flex-col sm:flex-row gap-4">
                  {position.rolled_from_id && (<div className="flex items-center gap-2 text-sm">
                      <ExternalLink className="w-4 h-4 text-blue-600"/>
                      <span className="text-gray-500">Rolled from:</span>
                      <Link to={`${isAdmin ? '/admin' : ''}/positions/${position.rolled_from_id}`} className="font-medium text-blue-600 hover:text-blue-800 underline">
                        Position #{position.rolled_from_id}
                      </Link>
                    </div>)}
                  {position.rolled_to_id && (<div className="flex items-center gap-2 text-sm">
                      <ExternalLink className="w-4 h-4 text-blue-600"/>
                      <span className="text-gray-500">Rolled to:</span>
                      <Link to={`${isAdmin ? '/admin' : ''}/positions/${position.rolled_to_id}`} className="font-medium text-blue-600 hover:text-blue-800 underline">
                        Position #{position.rolled_to_id}
                      </Link>
                    </div>)}
                  {position.assigned_from_id && (<div className="flex items-center gap-2 text-sm">
                      <ExternalLink className="w-4 h-4 text-purple-600"/>
                      <span className="text-gray-500">Assigned from option:</span>
                      <Link to={`${isAdmin ? '/admin' : ''}/positions/${position.assigned_from_id}`} className="font-medium text-purple-600 hover:text-purple-800 underline">
                        Position #{position.assigned_from_id}
                      </Link>
                    </div>)}
                  {position.assigned_to_id && (<div className="flex items-center gap-2 text-sm">
                      <ExternalLink className="w-4 h-4 text-purple-600"/>
                      <span className="text-gray-500">Assigned to stock:</span>
                      <Link to={`${isAdmin ? '/admin' : ''}/positions/${position.assigned_to_id}`} className="font-medium text-purple-600 hover:text-purple-800 underline">
                        Position #{position.assigned_to_id}
                      </Link>
                    </div>)}
                </div>
              </CardBody>
            </Card>)}

          {/* ═══════════════════════════════════════════════
                 MODALS (Admin only)
               ═══════════════════════════════════════════════ */}

          {/* ─── Resolve Modal ─────────────────────────── */}
          <Modal isOpen={resolveOpen} onClose={() => setResolveOpen(false)} title="Resolve Position" size="md">
            <div className="space-y-4">
              {actionError && (<div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-none p-3">
                  {actionError}
                </div>)}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Resolution Type
                </label>
                <select value={resolveForm.resolution_type} onChange={(e) => setResolveForm((f) => ({
                ...f,
                resolution_type: e.target.value,
            }))} className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm">
                  {position.position_type === 'stock' ? (<option value="sold">Sold</option>) : (<>
                      <option value="expired_worthless">Expired Worthless</option>
                      <option value="assigned">Assigned (Creates Stock Position)</option>
                      <option value="bought_to_close">Bought to Close</option>
                    </>)}
                </select>
              </div>

              <Input label="Realized P&L ($)" type="number" step="0.01" value={resolveForm.realized_pnl ?? ''} onChange={(e) => setResolveForm((f) => ({
                ...f,
                realized_pnl: e.target.value ? parseFloat(e.target.value) : undefined,
            }))} placeholder="e.g. 450.00"/>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={resolveForm.notes ?? ''} onChange={(e) => setResolveForm((f) => ({ ...f, notes: e.target.value }))} rows={3} className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Optional notes..."/>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setResolveOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" loading={actionLoading} onClick={handleResolve}>
                  Resolve Position
                </Button>
              </div>
            </div>
          </Modal>

          {/* ─── Roll Modal ────────────────────────────── */}
          <Modal isOpen={rollOpen} onClose={() => setRollOpen(false)} title="Roll Position" size="lg">
            <div className="space-y-4">
              {actionError && (<div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-none p-3">
                  {actionError}
                </div>)}

              <Input label="Ticker" value={rollForm.ticker} onChange={(e) => setRollForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))}/>

              <div className="grid grid-cols-2 gap-4">
                <Input label="New Strike Price ($)" type="number" step="0.01" value={rollForm.strike_price || ''} onChange={(e) => setRollForm((f) => ({ ...f, strike_price: parseFloat(e.target.value) || 0 }))}/>
                <Input label="Premium Received ($)" type="number" step="0.01" value={rollForm.premium_received || ''} onChange={(e) => setRollForm((f) => ({
                ...f,
                premium_received: parseFloat(e.target.value) || 0,
            }))}/>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input label="Contracts" type="number" min={1} value={rollForm.contracts} onChange={(e) => setRollForm((f) => ({ ...f, contracts: parseInt(e.target.value) || 1 }))}/>
                <Input label="Expiration Date" type="date" value={rollForm.expiration_date} onChange={(e) => setRollForm((f) => ({ ...f, expiration_date: e.target.value }))}/>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={rollForm.notes ?? ''} onChange={(e) => setRollForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 sm:text-sm" placeholder="Optional notes..."/>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setRollOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" loading={actionLoading} onClick={handleRoll}>
                  Roll Position
                </Button>
              </div>
            </div>
          </Modal>

          {/* ─── Delete Confirmation Modal ─────────────── */}
          <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete Position" size="sm">
            <div className="space-y-4">
              {actionError && (<div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-none p-3">
                  {actionError}
                </div>)}
              <p className="text-sm text-gray-600">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-[#0D2654]">
                  {position.ticker} ${parseFloat(position.strike_price).toFixed(2)}P
                </span>
                ? This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button variant="danger" size="sm" loading={actionLoading} onClick={handleDelete}>
                  Delete
                </Button>
              </div>
            </div>
          </Modal>
        </div>)}
    </div>);
}
