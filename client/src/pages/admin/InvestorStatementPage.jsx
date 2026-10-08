import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Card, CardHeader, CardBody, ErrorAlert, Skeleton } from '../../components/ui';

const money = (v) => (v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
const sign = (v) => (v == null ? '' : v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : '');
const monthLabel = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const th = 'px-3 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400';
const td = 'px-3 py-2 font-mono text-right whitespace-nowrap';

function Tile({ label, value, sub, className = '' }) {
    return (
        <div className="bg-white border-2 border-[#0D2654]/10 p-4">
            <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
            <p className={`text-2xl font-bold text-[#0D2654] mt-1 ${className}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
    );
}

function Section({ title, hint, children }) {
    return (
        <Card className="rounded-none">
            <CardHeader>
                <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider">{title}</h2>
                {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
            </CardHeader>
            <CardBody className="p-0 overflow-x-auto">{children}</CardBody>
        </Card>
    );
}

/** One investor's P&L statement — what they'd be owed if they cashed out today and how it was earned. */
export function InvestorStatementPage() {
    const { id } = useParams();
    const { data: s, isLoading, isError, error, refetch } = useApiQuery({ queryKey: ['admin', 'investor-statement', id], queryFn: () => adminApi.getInvestorStatement(id) });

    if (isLoading) return <div className="space-y-4"><Skeleton height={40} /><Skeleton height={120} /><Skeleton height={300} /></div>;
    if (isError) return <ErrorAlert message={error?.message} onRetry={refetch} />;

    const contributed = s.contributions.filter((c) => c.amount > 0).reduce((sum, c) => sum + c.amount, 0);
    const withdrawn = -s.contributions.filter((c) => c.amount < 0).reduce((sum, c) => sum + c.amount, 0);
    return (
        <div className="space-y-6">
            <Link to="/admin/investors" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0D2654]/60 hover:text-[#0D2654]">
                <ArrowLeft className="w-4 h-4" /> Investors
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-[#0D2654] flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    <FileText className="w-6 h-6 text-[#F06010]" />P&L statement — {s.investor.full_name}
                </h1>
                <p className="text-sm text-gray-500">{s.investor.email} · as of {s.as_of}{s.since ? ` · invested since ${s.since}` : ''}</p>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Account value (if cashed out today)" value={money(s.value)} sub={`${money(s.invested)} net invested + ${money(s.realized)} realized + ${money(s.unrealized)} open`} />
                <Tile label="Profit" value={money(s.profit)} className={sign(s.profit)} sub={`realized ${money(s.realized)} · open positions ${money(s.unrealized)}`} />
                <Tile
                    label="Return (time-weighted)"
                    value={pct(s.twr_pct)}
                    className={sign(s.twr_pct)}
                    sub={`${s.twr_annualized_pct != null ? `${pct(s.twr_annualized_pct, 1)} a year · ` : ''}top-ups don't dilute it · simple profit ÷ invested ${pct(s.simple_return_pct)}`}
                />
                <Tile label="Share of the fund" value={`${Number(s.ownership_pct).toFixed(2)}%`} sub="splits every trade's P&L from now on" />
            </div>
            <p className="text-xs text-gray-500 -mt-3">
                Open positions are valued at their latest price, so the account value moves until they close. Profit earned before each top-up stays with the ownership at that time.
            </p>

            <Section title={`Capital movements (${s.contributions.length})`} hint={`${money(contributed)} contributed${withdrawn ? ` · ${money(withdrawn)} withdrawn` : ''}`}>
                <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                        <th className={`${th} text-left`}>Date</th><th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Fund value before</th>
                        <th className={`${th} text-right`}>Their value before</th><th className={`${th} text-right`}>Share after</th><th className={`${th} text-left`}>Note</th>
                    </tr></thead>
                    <tbody>
                        {s.contributions.map((c) => (
                            <tr key={c.id} className="border-b border-gray-50">
                                <td className="px-3 py-2">{c.moved_on}</td>
                                <td className={`${td} ${c.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{c.amount < 0 ? `−${money(-c.amount)} withdrawal` : `+${money(c.amount)}`}</td>
                                <td className={td}>{c.fund_value_before ? money(c.fund_value_before) : 'opening'}</td>
                                <td className={td}>{c.fund_value_before ? money(c.their_value_before) : '—'}</td>
                                <td className={td}>{c.ownership_after_pct != null ? `${c.ownership_after_pct.toFixed(2)}%` : '—'}</td>
                                <td className="px-3 py-2 text-gray-500">{c.note || ''}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title="Growth between contributions" hint="Each period: their money at the start (including that day's top-up) → at the end. Chained together they give the time-weighted return.">
                <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                        <th className={`${th} text-left`}>Period</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Start</th>
                        <th className={`${th} text-right`}>End</th><th className={`${th} text-right`}>Return</th>
                    </tr></thead>
                    <tbody>
                        {s.periods.filter((p) => p.start > 0).map((p) => (
                            <tr key={p.start_on} className="border-b border-gray-50">
                                <td className="px-3 py-2 whitespace-nowrap">{p.start_on} → {p.end_on || 'today'}</td>
                                <td className={td}>{p.ownership_pct.toFixed(2)}%</td>
                                <td className={td}>{money(p.start)}</td>
                                <td className={td}>{money(p.end)}</td>
                                <td className={`${td} ${sign(p.return_pct)}`}>{pct(p.return_pct)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Section>

            <Section title={`Open positions (${s.open_positions.length})`} hint="Their share of each open position's P&L at the latest price.">
                {s.open_positions.length === 0 ? <p className="text-sm text-gray-400 p-4">No open positions.</p> : (
                    <table className="w-full text-sm">
                        <thead><tr className="border-b border-gray-100">
                            <th className={`${th} text-left`}>Position</th><th className={`${th} text-right`}>Price now</th>
                            <th className={`${th} text-right`}>Fund P&L</th><th className={`${th} text-right`}>Their share</th>
                        </tr></thead>
                        <tbody>
                            {s.open_positions.map((o) => (
                                <tr key={o.position_id} className="border-b border-gray-50">
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        <Link to={`/admin/positions/${o.position_id}`} className="text-[#0D2654] hover:underline">
                                            {o.ticker} {o.type === 'stock' ? `${o.shares} shares` : `$${o.strike} · ${o.expiry} · ×${o.contracts}`}
                                        </Link>
                                    </td>
                                    <td className={td}>{money(o.current_price)}</td>
                                    <td className={`${td} ${sign(o.fund_pnl)}`}>{money(o.fund_pnl)}</td>
                                    <td className={`${td} font-semibold ${sign(o.share)}`}>{money(o.share)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Section>

            <div className="grid lg:grid-cols-3 gap-6">
                <Section title="Realized by month">
                    <table className="w-full text-sm">
                        <tbody>
                            {[...s.realized_by_month].reverse().map((m) => (
                                <tr key={m.month} className="border-b border-gray-50">
                                    <td className="px-3 py-2">{monthLabel(m.month)}</td>
                                    <td className={`${td} ${sign(m.share)}`}>{money(m.share)}</td>
                                </tr>
                            ))}
                            <tr className="font-semibold"><td className="px-3 py-2">Total</td><td className={`${td} ${sign(s.realized)}`}>{money(s.realized)}</td></tr>
                        </tbody>
                    </table>
                </Section>
                <div className="lg:col-span-2">
                    <Section title={`Realized by position (${s.realized_by_position.length})`} hint="Fund P&L after fees, and their share by the ownership when it was earned.">
                        <table className="w-full text-sm">
                            <thead><tr className="border-b border-gray-100">
                                <th className={`${th} text-left`}>Closed</th><th className={`${th} text-left`}>Position</th>
                                <th className={`${th} text-right`}>Fund P&L</th><th className={`${th} text-right`}>Their share</th>
                            </tr></thead>
                            <tbody>
                                {s.realized_by_position.map((r) => (
                                    <tr key={r.position_id} className="border-b border-gray-50">
                                        <td className="px-3 py-2 whitespace-nowrap">{r.closed_on}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <Link to={`/admin/positions/${r.position_id}`} className="text-[#0D2654] hover:underline">
                                                {r.ticker} {r.type === 'stock' ? '' : `$${r.strike} · ${r.expiry}`}
                                            </Link>
                                        </td>
                                        <td className={`${td} ${sign(r.fund_pnl)}`}>{money(r.fund_pnl)}</td>
                                        <td className={`${td} font-semibold ${sign(r.share)}`}>{money(r.share)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Section>
                </div>
            </div>
        </div>
    );
}
