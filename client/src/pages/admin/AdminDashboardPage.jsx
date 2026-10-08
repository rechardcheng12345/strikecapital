import { useState } from 'react';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAuthStore } from '../../stores/authStore';
import { formatDateTime } from '../../lib/constants';
import { Skeleton, ErrorAlert, PageHeader, Money, Pct, HeroFigure, Ledger, Eyebrow, Segmented, greeting, toneClass } from '../../components/ui';
import { InvestorOverview } from '../investor/InvestorDashboardPage';

const shortDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');

/** Capital deployed as collateral — a hairline gauge with the 80% guideline marked. */
function Utilization({ pct }) {
    const v = Math.max(0, Math.min(Number(pct) || 0, 100));
    const tone = v > 90 ? 'bg-red-600' : v > 80 ? 'bg-accent' : 'bg-ink';
    return (<div>
      <div className="flex items-end justify-between">
        <Eyebrow>Capital deployed</Eyebrow>
        <span className="font-display text-[36px] leading-none text-ink"><Pct value={pct} signed={false}/></span>
      </div>
      <div className="relative mt-5 h-[6px] bg-paper-deep">
        <div className={`absolute inset-y-0 left-0 ${tone} transition-[width] duration-1000 ease-out`} style={{ width: `${v}%` }}/>
        <div className="absolute -top-1.5 -bottom-1.5 w-px bg-ink/40" style={{ left: '80%' }} title="80% guideline"/>
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-muted">
        <span className="absolute left-0">0%</span>
        <span className="absolute -translate-x-1/2" style={{ left: '80%' }}>80%</span>
        <span className="absolute right-0">100%</span>
      </div>
      <p className="mt-4 text-[12.5px] text-muted leading-relaxed">Collateral held for open puts, against contributed capital plus realized P&L.</p>
    </div>);
}

function FundOverview() {
    const { data: s, isLoading, isError, error, refetch } = useApiQuery({
        queryKey: ['admin', 'dashboard', 'stats'],
        queryFn: () => adminApi.getDashboardStats(),
        refetchOnMount: 'always',
        staleTime: 0,
    });
    if (isLoading) return (<div className="space-y-6"><Skeleton height={260}/><Skeleton height={130}/><Skeleton height={130}/></div>);
    if (isError) return <ErrorAlert message={error?.message || 'Failed to load dashboard stats.'} onRetry={() => refetch()}/>;
    if (!s) return null;

    const nav = (s.total_capital || 0) + (s.total_realized_pnl || 0) + (s.total_unrealized_pnl || 0);
    const profit = (s.total_realized_pnl || 0) + (s.total_unrealized_pnl || 0);
    return (<div className="space-y-6">
      <section className="bg-white border border-line grid lg:grid-cols-[1.25fr_1fr]">
        <div className="p-7 sm:p-10 lg:border-r border-line">
          <HeroFigure label="Fund value" caption={<>
              <span className="text-ink"><Money plain value={s.total_capital}/></span> contributed ·{' '}
              <span className={`font-medium ${toneClass(profit)}`}><Money plain value={profit} signed/></span> P&L
              {s.total_return_pct != null && <> · <span className={`font-medium ${toneClass(s.total_return_pct)}`}><Pct value={s.total_return_pct}/></span> since the last capital add{s.last_contribution_on ? ` (${shortDate(s.last_contribution_on)})` : ''}</>}
            </>}>
            <Money value={nav}/>
          </HeroFigure>
          <p className="mt-8 text-[12px] text-muted/80">
            Contributed capital + realized + unrealized P&L{s.last_price_update ? ` · prices updated ${formatDateTime(s.last_price_update)}` : ''}.
          </p>
        </div>
        <div className="p-7 sm:p-10 border-t lg:border-t-0 border-line flex flex-col justify-center">
          <Utilization pct={s.capital_utilization}/>
        </div>
      </section>

      <Ledger items={[
            { label: 'Realized P&L', value: <Money value={s.total_realized_pnl} signed/>, tone: toneClass(s.total_realized_pnl), caption: 'Closed trades, after fees' },
            { label: 'Unrealized P&L', value: <Money value={s.total_unrealized_pnl} signed/>, tone: toneClass(s.total_unrealized_pnl), caption: 'Open positions at the latest price' },
            { label: 'Premium received', value: <Money value={s.total_premium}/>, caption: 'All options sold' },
            s.additional_earnings != null && { label: 'Interest & other', value: <Money value={s.additional_earnings} signed/>, tone: toneClass(s.additional_earnings), caption: 'Outside of trading' },
        ]}/>

      <Ledger columns={3} items={[
            { label: 'Open positions', value: s.total_positions.toLocaleString(), caption: 'Active, excluding monitoring', to: '/admin/positions' },
            { label: 'Expiring in 7 days', value: s.positions_expiring_soon.toLocaleString(), tone: s.positions_expiring_soon > 0 ? 'text-accent' : 'text-ink', caption: s.positions_expiring_soon > 0 ? 'Decide: let expire, roll or close' : 'Nothing due this week', to: '/admin/positions' },
            { label: 'Investors', value: s.total_investors.toLocaleString(), caption: 'Accounts with a share of the fund', to: '/admin/investors' },
        ]}/>
    </div>);
}

export function AdminDashboardPage() {
    const [view, setView] = useState('admin');
    const user = useAuthStore((st) => st.user);
    return (<div>
      <PageHeader
        eyebrow={view === 'admin' ? 'Fund overview' : 'Your investor account'}
        title={greeting(user?.full_name)}
        description={view === 'admin' ? 'Where the fund stands today.' : 'Exactly what your investors see on their own dashboard.'}
        actions={<Segmented value={view} onChange={setView} options={[['admin', 'Fund'], ['investor', 'Investor view']]}/>}
      />
      {view === 'admin' ? <FundOverview/> : <InvestorOverview/>}
    </div>);
}
