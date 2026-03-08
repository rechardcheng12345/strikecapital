import {
  ShieldAlert,
  Gauge,
  PieChart,
  Ruler,
  AlertTriangle,
} from 'lucide-react';
import { adminApi, type RiskDashboard } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Skeleton, ErrorAlert } from '../../components/ui';

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return value.toFixed(1) + '%';
}

/* ── Skeleton placeholders ──────────────────────────── */

function SectionSkeleton() {
  return (
    <div className="rounded-none border-2 border-gray-200 bg-white p-5 space-y-4">
      <Skeleton variant="text" width="40%" height={20} />
      <Skeleton variant="rectangular" height={24} className="rounded-none w-full" />
      <Skeleton variant="rectangular" height={24} className="rounded-none w-full" />
      <Skeleton variant="rectangular" height={24} className="rounded-none w-full" />
    </div>
  );
}

/* ── Main page ──────────────────────────────────────── */

export function RiskDashboardPage() {
  const {
    data: risk,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery<RiskDashboard>({
    queryKey: ['admin', 'risk', 'dashboard'],
    queryFn: () => adminApi.getRiskDashboard(),
  });

  // Compute alerts
  const highUtilization = risk ? risk.capital_utilization.utilization_pct > 80 : false;
  const concentratedTickers = risk
    ? risk.ticker_concentration.filter((t) => t.pct > 30)
    : [];
  const hasAlerts = highUtilization || concentratedTickers.length > 0;

  return (
    <div>
      {/* Header */}
      <h1
        className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2"
        style={{ fontFamily: 'Space Grotesk, sans-serif' }}
      >
        <ShieldAlert className="w-6 h-6 text-[#F06010]" />
        Risk Dashboard
      </h1>

      {/* Error */}
      {isError && (
        <div className="mb-6">
          <ErrorAlert
            message={error?.message || 'Failed to load risk data.'}
            onRetry={() => refetch()}
          />
        </div>
      )}

      {/* Risk Alerts */}
      {!isLoading && risk && hasAlerts && (
        <div className="mb-6 space-y-3">
          {highUtilization && (
            <div className="rounded-none border-2 border-red-400 bg-red-50 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-red-800 text-sm" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  High Capital Utilization
                </p>
                <p className="text-red-700 text-sm mt-0.5">
                  Capital utilization is at {formatPercent(risk.capital_utilization.utilization_pct)}, which exceeds the 80% threshold.
                  Consider reducing exposure.
                </p>
              </div>
            </div>
          )}
          {concentratedTickers.map((t) => (
            <div
              key={t.ticker}
              className="rounded-none border-2 border-orange-400 bg-orange-50 p-4 flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-orange-800 text-sm" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  Concentration Warning: {t.ticker}
                </p>
                <p className="text-orange-700 text-sm mt-0.5">
                  {t.ticker} represents {formatPercent(t.pct)} of deployed capital ({formatCurrency(t.collateral)}),
                  exceeding the 30% concentration limit.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionSkeleton />
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      ) : risk ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Capital Utilization */}
          <div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5 lg:col-span-2">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                <Gauge className="w-5 h-5" />
              </div>
              <h2
                className="text-lg font-bold text-[#0D2654]"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Capital Utilization
              </h2>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-6 mb-5">
              <div className="flex-1">
                <p
                  className={`text-4xl font-bold ${
                    risk.capital_utilization.utilization_pct > 80 ? 'text-red-500' : 'text-[#0D2654]'
                  }`}
                  style={{ fontFamily: 'Space Grotesk, sans-serif' }}
                >
                  {formatPercent(risk.capital_utilization.utilization_pct)}
                </p>
                <p className="text-sm text-gray-500 mt-1">of total capital deployed</p>
              </div>
              <div className="flex gap-8">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Total Capital</p>
                  <p className="text-lg font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    {formatCurrency(risk.capital_utilization.total_capital)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Deployed Capital</p>
                  <p className="text-lg font-bold text-[#F06010]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    {formatCurrency(risk.capital_utilization.deployed_capital)}
                  </p>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full h-4 bg-[#0D2654]/10 rounded-none overflow-hidden">
              <div
                className="h-full rounded-none transition-all duration-700"
                style={{
                  width: `${Math.min(risk.capital_utilization.utilization_pct, 100)}%`,
                  backgroundColor:
                    risk.capital_utilization.utilization_pct > 80
                      ? '#EF4444'
                      : risk.capital_utilization.utilization_pct > 60
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

          {/* Ticker Concentration */}
          <div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                <PieChart className="w-5 h-5" />
              </div>
              <h2
                className="text-lg font-bold text-[#0D2654]"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Ticker Concentration
              </h2>
            </div>

            {risk.ticker_concentration.length > 0 ? (
              <div className="space-y-3">
                {risk.ticker_concentration.map((item) => {
                  const isOver = item.pct > 30;
                  return (
                    <div key={item.ticker}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-[#0D2654]">{item.ticker}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">{formatCurrency(item.collateral)}</span>
                          <span
                            className={`text-xs font-bold ${isOver ? 'text-red-500' : 'text-[#0D2654]'}`}
                          >
                            {formatPercent(item.pct)}
                          </span>
                          {isOver && <AlertTriangle className="w-3.5 h-3.5 text-red-500" />}
                        </div>
                      </div>
                      <div className="w-full h-3 bg-[#0D2654]/10 rounded-none overflow-hidden">
                        <div
                          className="h-full rounded-none transition-all duration-500"
                          style={{
                            width: `${Math.min(item.pct, 100)}%`,
                            backgroundColor: isOver ? '#EF4444' : '#0D2654',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-400">
                <PieChart className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No position data available.</p>
              </div>
            )}
          </div>

          {/* Distance to Strike Distribution */}
          <div className="rounded-none border-2 border-[#0D2654]/20 bg-white p-5">
            <div className="flex items-center gap-2 mb-5">
              <div className="p-2 rounded-none bg-[#0D2654]/5 text-[#0D2654]">
                <Ruler className="w-5 h-5" />
              </div>
              <h2
                className="text-lg font-bold text-[#0D2654]"
                style={{ fontFamily: 'Space Grotesk, sans-serif' }}
              >
                Distance to Strike
              </h2>
            </div>

            {risk.distance_distribution.length > 0 ? (
              <div className="space-y-3">
                {(() => {
                  const maxCount = Math.max(...risk.distance_distribution.map((d) => d.count), 1);
                  const barColors = ['#EF4444', '#F06010', '#0D2654', '#0D2654'];
                  return risk.distance_distribution.map((item, idx) => {
                    const widthPct = (item.count / maxCount) * 100;
                    return (
                      <div key={item.range}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-semibold text-[#0D2654]">{item.range}</span>
                          <span className="text-xs font-bold text-[#0D2654]">
                            {item.count} {item.count === 1 ? 'position' : 'positions'}
                          </span>
                        </div>
                        <div className="w-full h-3 bg-[#0D2654]/10 rounded-none overflow-hidden">
                          <div
                            className="h-full rounded-none transition-all duration-500"
                            style={{
                              width: `${Math.max(widthPct, 2)}%`,
                              backgroundColor: barColors[idx] || '#0D2654',
                            }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-400">
                <Ruler className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">No distance data available.</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
