import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { investorApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAuthStore } from '../../stores/authStore';
import { formatDateTime } from '../../lib/constants';
import { Skeleton, ErrorAlert, PageHeader, Money, Pct, HeroFigure, Ledger, TrendChart, Eyebrow, greeting, toneClass } from '../../components/ui';

const shortDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

function OverviewSkeleton() {
    return (<div className="space-y-6">
      <div className="bg-white border border-line p-8 grid lg:grid-cols-[1.1fr_1fr] gap-10">
        <div className="space-y-4"><Skeleton width={140} height={12}/><Skeleton width="70%" height={72}/><Skeleton width="85%" height={14}/></div>
        <Skeleton height={190}/>
      </div>
      <Skeleton height={130}/>
    </div>);
}

/** The investor's account at a glance — also shown to the admin under Dashboard → Investor view. */
export function InvestorOverview() {
    const { data: d, isLoading, isError, error, refetch } = useApiQuery({ queryKey: ['investor', 'dashboard'], queryFn: () => investorApi.getDashboard() });
    const { data: pnl } = useApiQuery({ queryKey: ['investor', 'pnl', 'all'], queryFn: () => investorApi.getPnl('all') });

    // Cumulative realized share over time, oldest first
    const series = useMemo(() => {
        const rows = [...(pnl?.records || [])].sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
        let sum = 0;
        const byDay = new Map();
        for (const r of rows) {
            sum += Number(r.pnl_share) || 0;
            byDay.set(shortDate(r.record_date), Math.round(sum * 100) / 100);
        }
        return [...byDay.entries()].map(([date, value]) => ({ date, value }));
    }, [pnl]);

    if (isLoading) return <OverviewSkeleton/>;
    if (isError) return <ErrorAlert message={error?.message || 'Failed to load your account.'} onRetry={() => refetch()}/>;
    if (!d) return null;

    const invested = d.allocation.allocation_amount;
    const realized = d.total_pnl_share ?? 0;
    const open = d.unrealized_pnl_share ?? 0;
    const value = d.account_value ?? invested + realized + open;
    const profit = realized + open;
    const twr = d.total_return_pct;

    return (<div className="space-y-6">
      <section className="bg-white border border-line grid lg:grid-cols-[1.05fr_1fr]">
        <div className="p-7 sm:p-10 lg:border-r border-line">
          <HeroFigure label="Account value" caption={<>
              <span className={`font-medium ${toneClass(profit)}`}><Money plain value={profit} signed/></span> profit
              {twr != null && <> · <span className={`font-medium ${toneClass(twr)}`}><Pct value={twr}/></span> {d.return_basis === 'time_weighted' ? 'time-weighted' : 'return'}</>}
              {d.return_since && <> since {shortDate(d.return_since)}</>}
              {d.annualized_return_pct != null && <> · <Pct value={d.annualized_return_pct}/> a year</>}
            </>}>
            <Money value={value}/>
          </HeroFigure>
          <p className="mt-8 text-[12px] text-muted/80">
            Open positions valued at their latest price{d.last_price_update ? ` · updated ${formatDateTime(d.last_price_update)}` : ''}.
          </p>
        </div>
        <div className="p-7 sm:p-10 border-t lg:border-t-0 border-line flex flex-col">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Realized P&L, cumulative</Eyebrow>
            <span className={`text-[13px] font-medium ${toneClass(realized)}`}><Money plain value={realized} signed/></span>
          </div>
          <div className="mt-6 flex-1 min-h-[180px]">
            <TrendChart points={series} height={200}/>
          </div>
          {series.length > 1 && (<div className="mt-2 flex justify-between text-[11px] text-muted">
              <span>{series[0].date}</span><span>{series[series.length - 1].date}</span>
            </div>)}
        </div>
      </section>

      <Ledger items={[
            { label: 'Net invested', value: <Money value={invested}/>, caption: `${Number(d.allocation.allocation_pct || 0).toFixed(1)}% of contributed capital` },
            { label: 'Realized P&L', value: <Money value={realized} signed/>, tone: toneClass(realized), caption: 'Your share of closed trades' },
            { label: 'Open positions', value: <Money value={open} signed/>, tone: toneClass(open), caption: 'Your share at today’s prices' },
            { label: 'Win rate', value: <Pct value={d.win_rate} signed={false}/>, caption: `${d.active_positions} position${d.active_positions === 1 ? '' : 's'} open now` },
        ]}/>

      {d.unread_notifications > 0 && (<Link to="/notifications" className="group flex items-center justify-between border border-line bg-white px-6 py-4 hover:border-ink/30 transition-colors">
          <span className="flex items-center gap-3 text-sm text-ink">
            <span className="relative flex w-2 h-2"><span className="absolute inset-0 rounded-full bg-accent animate-pulse-ring"/><span className="relative w-2 h-2 rounded-full bg-accent"/></span>
            {d.unread_notifications} unread update{d.unread_notifications === 1 ? '' : 's'} from the fund
          </span>
          <span className="text-[13px] text-muted group-hover:text-ink transition-colors">Read →</span>
        </Link>)}
    </div>);
}

export function InvestorDashboardPage() {
    const user = useAuthStore((s) => s.user);
    return (<div>
      <PageHeader eyebrow="Your account" title={greeting(user?.full_name)} description="Your share of the StrikeCapital fund — what it’s worth today and how it got there."/>
      <InvestorOverview/>
    </div>);
}
