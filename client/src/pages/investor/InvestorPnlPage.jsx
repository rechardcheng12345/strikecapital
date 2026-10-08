import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Skeleton, ErrorAlert, EmptyState, PageHeader, HeroFigure, Money, Segmented, TrendChart, Eyebrow, toneClass } from '../../components/ui';

const PERIODS = [['1m', '1M'], ['3m', '3M'], ['ytd', 'YTD'], ['all', 'All']];
const PERIOD_TEXT = { '1m': 'in the last month', '3m': 'in the last three months', ytd: 'this year', all: 'since you joined' };
const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function InvestorPnlPage() {
    const [period, setPeriod] = useState('all');
    const { data: pnl, isLoading, isError, error, refetch } = useApiQuery({
        queryKey: ['investor', 'pnl', period],
        queryFn: () => investorApi.getPnl(period),
    });

    // Oldest → newest running total for the chart
    const points = useMemo(() => {
        if (!pnl?.records?.length) return [];
        let run = 0;
        return [...pnl.records]
            .sort((a, b) => new Date(a.record_date) - new Date(b.record_date))
            .map((r) => ({ date: day(r.record_date), value: (run += Number(r.pnl_share) || 0) }));
    }, [pnl]);

    return (<div>
      <PageHeader
        eyebrow="My account"
        title="Profit & loss"
        description="Your share of every closed trade, in proportion to your stake in the fund."
        actions={<Segmented value={period} onChange={setPeriod} options={PERIODS}/>}
      />

      {isError && <div className="mb-6"><ErrorAlert message={error?.message || 'Failed to load P&L data.'} onRetry={() => refetch()}/></div>}

      {isLoading ? (<div className="space-y-6"><Skeleton height={300}/><Skeleton height={360}/></div>) : pnl ? (<>
        <section className="bg-white border border-line grid lg:grid-cols-[1fr_1.4fr]">
          <div className="p-7 sm:p-10 lg:border-r border-line flex flex-col justify-between gap-8">
            <HeroFigure label="Your realized P&L" caption={<>
                From <span className="text-ink">{pnl.records.length.toLocaleString()}</span> closed {pnl.records.length === 1 ? 'trade' : 'trades'} {PERIOD_TEXT[period]}.
              </>}>
              <span className={toneClass(pnl.total_pnl_share)}><Money value={pnl.total_pnl_share} signed/></span>
            </HeroFigure>
            <dl className="grid grid-cols-2 border-t border-line pt-5">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-eyebrow text-muted">Your stake</dt>
                <dd className="mt-2 text-[22px] font-medium tracking-[-0.02em] text-ink">{Number(pnl.allocation_pct || 0).toFixed(2)}%</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-eyebrow text-muted">Average per trade</dt>
                <dd className="mt-2 text-[22px] font-medium tracking-[-0.02em] text-ink">
                  <Money value={pnl.records.length ? pnl.total_pnl_share / pnl.records.length : 0}/>
                </dd>
              </div>
            </dl>
          </div>
          <div className="p-6 sm:p-8 border-t lg:border-t-0 border-line">
            <Eyebrow className="mb-4">Cumulative</Eyebrow>
            <TrendChart points={points} height={240}/>
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-[22px] leading-none text-ink">Statement</h2>
            <span className="text-[12.5px] text-muted">Newest first</span>
          </div>
          <div className="bg-white border border-line overflow-hidden">
            {pnl.records.length === 0 ? (<EmptyState icon={BarChart3} title="Nothing closed in this period" description="Your share appears here when a trade is closed or expires."/>) : (<div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left px-4 sm:px-6 py-3.5">Date</th>
                    <th className="text-left px-4 sm:px-6 py-3.5">Position</th>
                    <th className="text-right px-4 sm:px-6 py-3.5">Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {pnl.records.map((r) => (<tr key={`${r.position_id}-${r.record_date}`} className="border-b border-line/70 last:border-b-0">
                      <td className="px-4 sm:px-6 py-3.5 text-muted whitespace-nowrap">{day(r.record_date)}</td>
                      <td className="px-4 sm:px-6 py-3.5 font-medium text-ink whitespace-nowrap">{r.ticker}</td>
                      <td className={`px-4 sm:px-6 py-3.5 text-right font-mono whitespace-nowrap ${toneClass(r.pnl_share)}`}><Money plain value={r.pnl_share} signed/></td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
          </div>
        </section>
      </>) : null}
    </div>);
}
