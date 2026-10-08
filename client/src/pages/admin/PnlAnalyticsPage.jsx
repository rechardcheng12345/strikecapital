import { useState, useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Skeleton, ErrorAlert, PageHeader, Segmented, HeroFigure, Money, Ledger, Eyebrow, TrendChart, toneClass } from '../../components/ui';
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
        <div className="bg-white border border-line px-3 py-2 shadow-lg">
            <p className="text-xs text-gray-500 mb-1">{formatDate(d.fullDate)}</p>
            <p className={`text-sm font-bold ${amountColor(d.cumulative)}`}>{formatCurrency(d.cumulative)}</p>
        </div>
    );
}

/* ── Skeleton placeholders ──────────────────────────── */
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
    return (<div>
      <PageHeader
        eyebrow="Fund"
        title="P&L analytics"
        description="Realized results of every closed trade, after fees."
        actions={<Segmented value={period} onChange={setPeriod} options={PERIOD_TABS.map((t) => [t.key, t.label])}/>}
      />

      {isError && <div className="mb-6"><ErrorAlert message={error?.message || 'Failed to load P&L data.'} onRetry={() => refetch()}/></div>}

      {isLoading ? (<div className="space-y-6 mb-10"><Skeleton height={320}/><Skeleton height={130}/></div>) : pnl ? (<div className="space-y-6 mb-10">
          <section className="bg-white border border-line grid lg:grid-cols-[1fr_1.5fr]">
            <div className="p-7 sm:p-10 lg:border-r border-line flex flex-col justify-between gap-8">
              <HeroFigure label="Realized P&L" caption={<>
                  From <span className="text-ink"><Money plain value={pnl.total_premium}/></span> of premium sold, kept{' '}
                  <span className="text-ink">{pnl.total_premium ? ((pnl.total_realized_pnl / pnl.total_premium) * 100).toFixed(0) : 0}%</span> after buybacks and fees.
                </>}>
                <span className={toneClass(pnl.total_realized_pnl)}><Money value={pnl.total_realized_pnl} signed/></span>
              </HeroFigure>
            </div>
            <div className="p-6 sm:p-8 border-t lg:border-t-0 border-line">
              <Eyebrow className="mb-4">Cumulative</Eyebrow>
              <TrendChart points={cumulativeData.map((d) => ({ date: d.date, value: d.cumulative }))} height={260}/>
            </div>
          </section>
          <Ledger columns={3} items={[
                { label: 'Premium sold', value: <Money value={pnl.total_premium}/>, caption: 'All options opened in the period' },
                { label: 'Win rate', value: formatPercent(winRate), caption: 'Closed trades with a profit' },
                { label: 'Closed trades', value: pnl.records.length.toLocaleString(), caption: 'Records in the period' },
            ]}/>
        </div>) : null}

      {/* P&L Records table */}
      <h2 className="font-display text-[22px] leading-none text-ink mb-4">Records</h2>
      <div className="border border-line bg-white">

        {isLoading ? (<div className="p-5">
            <TableSkeleton />
          </div>) : pnl && pnl.records.length > 0 ? (<div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-5 py-3.5">
                    Position
                  </th>
                  <th className="text-left px-5 py-3.5">
                    Type
                  </th>
                  <th className="text-right px-5 py-3.5">
                    Amount
                  </th>
                  <th className="text-left px-5 py-3.5">
                    Description
                  </th>
                  <th className="text-left px-5 py-3.5">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {pnl.records.map((record) => (<tr key={record.id} className="border-b border-line/70 last:border-b-0">
                    <td className="px-5 py-3 font-semibold text-ink">
                      {tickerMap[record.position_id] || `#${record.position_id}`}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] uppercase tracking-[0.1em] text-muted">
                        {recordTypeLabel(record.record_type)}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-mono font-medium ${amountColor(record.amount)}`}>
                      {formatCurrency(record.amount)}
                    </td>
                    <td className="px-5 py-3 text-gray-600 max-w-xs truncate">
                      {record.description ? record.description.replace(/_/g, ' ') : '—'}
                    </td>
                    <td className="px-5 py-3 text-muted whitespace-nowrap">{formatDate(record.record_date)}</td>
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
