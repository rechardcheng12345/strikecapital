import { useState, useMemo } from 'react';
import { BarChart3, DollarSign, TrendingUp, Trophy, Calendar, } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Skeleton, ErrorAlert } from '../../components/ui';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
const PERIOD_TABS = [
    { key: '1m', label: '1M' },
    { key: '3m', label: '3M' },
    { key: 'ytd', label: 'YTD' },
    { key: 'all', label: 'All' },
];
function formatCurrency(value) {
    const prefix = value < 0 ? '-$' : '$';
    return prefix + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}
function formatPercent(value) {
    return value.toFixed(1) + '%';
}
function amountColor(value) {
    if (value > 0)
        return 'text-green-600';
    if (value < 0)
        return 'text-red-600';
    return 'text-gray-600';
}
function recordTypeLabel(type) {
    const map = {
        premium: 'Premium',
        assignment_loss: 'Assignment Loss',
        buyback_cost: 'Buyback Cost',
        dividend: 'Dividend',
        adjustment: 'Adjustment',
    };
    return map[type] || type;
}
function recordTypeBadgeColor(type) {
    const map = {
        premium: 'bg-green-100 text-green-800',
        assignment_loss: 'bg-red-100 text-red-800',
        buyback_cost: 'bg-orange-100 text-orange-800',
        dividend: 'bg-blue-100 text-blue-800',
        adjustment: 'bg-gray-100 text-gray-800',
    };
    return map[type] || 'bg-gray-100 text-gray-800';
}
function computeWinRate(positions) {
    const resolved = positions.filter((p) => p.realized_pnl !== undefined && p.realized_pnl !== null);
    if (resolved.length === 0)
        return 0;
    const wins = resolved.filter((p) => (p.realized_pnl ?? 0) > 0).length;
    return (wins / resolved.length) * 100;
}
// Build a lookup from position id → ticker
function buildTickerMap(positions) {
    const map = {};
    for (const p of positions) {
        map[p.id] = p.ticker;
    }
    return map;
}
function buildCumulativeData(records) {
    if (!records || records.length === 0) return [];
    const sorted = [...records].sort((a, b) => new Date(a.record_date) - new Date(b.record_date));
    const grouped = {};
    for (const r of sorted) {
        const d = r.record_date;
        grouped[d] = (grouped[d] || 0) + (r.amount ?? 0);
    }
    let cumulative = 0;
    return Object.entries(grouped).map(([date, amount]) => {
        cumulative += amount;
        return {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            fullDate: date,
            cumulative: Math.round(cumulative * 100) / 100,
        };
    });
}

function ChartTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
        <div className="bg-white border-2 border-[#0D2654]/20 px-3 py-2 shadow-lg">
            <p className="text-xs text-gray-500 mb-1">{formatDate(d.fullDate)}</p>
            <p className={`text-sm font-bold ${amountColor(d.cumulative)}`}>{formatCurrency(d.cumulative)}</p>
        </div>
    );
}

/* ── Skeleton placeholders ──────────────────────────── */
function SummaryCardSkeleton() {
    return (<div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-start justify-between">
        <Skeleton variant="rectangular" width={40} height={40} className="rounded-none"/>
        <Skeleton variant="text" width={48} height={12}/>
      </div>
      <Skeleton variant="text" width="60%" height={14}/>
      <Skeleton variant="text" width="80%" height={28}/>
    </div>);
}
function TableSkeleton() {
    return (<div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (<Skeleton key={i} variant="rectangular" height={40} className="rounded-none w-full"/>))}
    </div>);
}
/* ── Main page ──────────────────────────────────────── */
export function PnlAnalyticsPage() {
    const [period, setPeriod] = useState('all');
    const { data: pnl, isLoading, isError, error, refetch, } = useApiQuery({
        queryKey: ['admin', 'pnl', period],
        queryFn: () => adminApi.getPnl(period),
    });
    const winRate = pnl ? computeWinRate(pnl.positions) : 0;
    const tickerMap = pnl ? buildTickerMap(pnl.positions) : {};
    const cumulativeData = useMemo(() => pnl ? buildCumulativeData(pnl.records) : [], [pnl]);
    const hasNegative = cumulativeData.some(d => d.cumulative < 0);
    return (<div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <BarChart3 className="w-6 h-6 text-[#F06010]"/>
          P&amp;L Analytics
        </h1>

        {/* Period tabs */}
        <div className="flex border-2 border-[#0D2654]/20 rounded-none overflow-hidden">
          {PERIOD_TABS.map((tab) => (<button key={tab.key} onClick={() => setPeriod(tab.key)} className={`px-4 py-2 text-sm font-semibold transition-colors duration-150 ${period === tab.key
                ? 'bg-[#0D2654] text-white'
                : 'bg-white text-[#0D2654] hover:bg-[#0D2654]/5'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              {tab.label}
            </button>))}
        </div>
      </div>

      {/* Error */}
      {isError && (<div className="mb-6">
          <ErrorAlert message={error?.message || 'Failed to load P&L data.'} onRetry={() => refetch()}/>
        </div>)}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {isLoading ? (<>
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
          </>) : pnl ? (<>
            {/* Total Premium */}
            <div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5 hover:border-[#0D2654]/40 transition-all duration-150">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                  <DollarSign className="w-5 h-5"/>
                </div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Income</span>
              </div>
              <p className="text-sm font-medium text-gray-500 mb-1">Total Premium</p>
              <p className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {formatCurrency(pnl.total_premium)}
              </p>
            </div>

            {/* Total Realized P&L */}
            <div className="rounded-none border-2 border-[#F06010] bg-white p-5 transition-all duration-150">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-none bg-[#F06010]/10 text-[#F06010]">
                  <TrendingUp className="w-5 h-5"/>
                </div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Net</span>
              </div>
              <p className="text-sm font-medium text-gray-500 mb-1">Total Realized P&amp;L</p>
              <p className={`text-2xl font-bold ${amountColor(pnl.total_realized_pnl)}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {formatCurrency(pnl.total_realized_pnl)}
              </p>
            </div>

            {/* Win Rate */}
            <div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5 hover:border-[#0D2654]/40 transition-all duration-150">
              <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                  <Trophy className="w-5 h-5"/>
                </div>
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Rate</span>
              </div>
              <p className="text-sm font-medium text-gray-500 mb-1">Win Rate</p>
              <p className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {formatPercent(winRate)}
              </p>
              <div className="mt-3">
                <div className="w-full h-2 bg-[#0D2654]/10 rounded-none overflow-hidden">
                  <div className="h-full rounded-none transition-all duration-500 bg-[#0D2654]" style={{ width: `${Math.min(winRate, 100)}%` }}/>
                </div>
              </div>
            </div>
          </>) : null}
      </div>

      {/* Cumulative P&L Chart */}
      <div className="rounded-none border-2 border-[#0D2654]/20 bg-white mb-8">
        <div className="px-5 py-4 border-b-2 border-[#0D2654]/10">
          <h2 className="text-lg font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <TrendingUp className="w-5 h-5 text-[#F06010]"/>
            Cumulative P&amp;L
          </h2>
        </div>
        {isLoading ? (
          <div className="p-5">
            <Skeleton variant="rectangular" height={300} className="rounded-none w-full"/>
          </div>
        ) : cumulativeData.length > 0 ? (
          <div className="p-5">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={cumulativeData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#0D2654', fontFamily: 'Space Grotesk, sans-serif' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e5e7eb' }}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#0D2654', fontFamily: 'Space Grotesk, sans-serif' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`}
                />
                <Tooltip content={<ChartTooltip />}/>
                {hasNegative && <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3"/>}
                <defs>
                  <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#F06010" stopOpacity={0.2}/>
                    <stop offset="100%" stopColor="#F06010" stopOpacity={0.02}/>
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="#F06010"
                  strokeWidth={2}
                  fill="url(#pnlGradient)"
                  dot={false}
                  activeDot={{ r: 4, fill: '#F06010', stroke: '#fff', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="p-12 text-center text-gray-400">
            <TrendingUp className="w-10 h-10 mx-auto mb-3 text-gray-300"/>
            <p className="font-medium">No data to chart for this period.</p>
          </div>
        )}
      </div>

      {/* P&L Records table */}
      <div className="rounded-none border-2 border-[#0D2654]/20 bg-white">
        <div className="px-5 py-4 border-b-2 border-[#0D2654]/10">
          <h2 className="text-lg font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <Calendar className="w-5 h-5 text-[#F06010]"/>
            P&amp;L Records
          </h2>
        </div>

        {isLoading ? (<div className="p-5">
            <TableSkeleton />
          </div>) : pnl && pnl.records.length > 0 ? (<div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-[#0D2654]/10 bg-[#F5F3EF]">
                  <th className="text-left px-5 py-3 font-semibold text-[#0D2654] uppercase text-xs tracking-wider">
                    Position
                  </th>
                  <th className="text-left px-5 py-3 font-semibold text-[#0D2654] uppercase text-xs tracking-wider">
                    Type
                  </th>
                  <th className="text-right px-5 py-3 font-semibold text-[#0D2654] uppercase text-xs tracking-wider">
                    Amount
                  </th>
                  <th className="text-left px-5 py-3 font-semibold text-[#0D2654] uppercase text-xs tracking-wider">
                    Description
                  </th>
                  <th className="text-left px-5 py-3 font-semibold text-[#0D2654] uppercase text-xs tracking-wider">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {pnl.records.map((record) => (<tr key={record.id} className="border-b border-[#0D2654]/5 hover:bg-[#F5F3EF]/50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-[#0D2654]">
                      {tickerMap[record.position_id] || `#${record.position_id}`}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-none ${recordTypeBadgeColor(record.record_type)}`}>
                        {recordTypeLabel(record.record_type)}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-bold ${amountColor(record.amount)}`}>
                      {formatCurrency(record.amount)}
                    </td>
                    <td className="px-5 py-3 text-gray-600 max-w-xs truncate">
                      {record.description || '--'}
                    </td>
                    <td className="px-5 py-3 text-gray-500">{formatDate(record.record_date)}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>) : pnl ? (<div className="p-12 text-center text-gray-400">
            <BarChart3 className="w-10 h-10 mx-auto mb-3 text-gray-300"/>
            <p className="font-medium">No P&amp;L records found for this period.</p>
          </div>) : null}
      </div>
    </div>);
}
