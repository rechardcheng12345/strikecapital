import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, RefreshCw, Settings, Plus } from 'lucide-react';
import { simApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input, Modal, Badge, ErrorAlert, Skeleton } from '../../components/ui';
import { EquityChart, Stat, money, pct, signColor, shortDate, OpenTradeModal, LiveBadge, LiveQuote, useLiveQuote } from './simShared';
import { PROFIT_TAKE_TARGET_PCT, takeProfitPrice } from '../../lib/constants';
import { SimStrategyPanel } from './SimStrategyPanel';

const REASON_LABEL = { bought_to_close: 'Bought to close', expired: 'Expired', assigned: 'Assigned', rolled: 'Rolled', sold: 'Sold', stopped: 'Stopped out', settled: 'Settled' };
const TX_LABEL = { sell_to_open: 'Sell to open', buy_to_close: 'Buy to close', expired: 'Expired', assigned: 'Assigned', sell_stock: 'Sell stock', settled: 'Settled' };
const EXIT_RULE_LABEL = { touch: 'close on touch of the short strike', loss2x: 'close at 2× credit loss', hold: 'hold to expiry' };

function contractLabel(p) {
    if (p.position_type === 'stock') return `${p.ticker} · ${p.shares} sh`;
    if (p.position_type === 'spread') return `${p.ticker} ${p.strike}/${p.long_strike}${p.option_type === 'call' ? 'C' : 'P'} ${shortDate(p.expiration_date)}`;
    return `${p.ticker} $${p.strike}P ${shortDate(p.expiration_date)}`;
}

/** How far the underlying is from a spread's short strike, as % of the price (negative = through it). */
function cushion(x) {
    if (x.position_type !== 'spread' || !(x.underlying_price > 0)) return null;
    const d = x.option_type === 'call' ? x.strike - x.underlying_price : x.underlying_price - x.strike;
    return (d / x.underlying_price) * 100;
}

function CloseModal({ position, onClose }) {
    const queryClient = useQueryClient();
    const [price, setPrice] = useState('');
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    useEffect(() => {
        setPrice('');
        setError(null);
    }, [position]);
    const liveQ = useLiveQuote({ ticker: position?.ticker, strike: position?.strike, expiration_date: position?.expiration_date }, !!position && position.position_type === 'option');
    if (!position) return null;
    const isStock = position.position_type === 'stock';
    const isSpread = position.position_type === 'spread';
    const submit = async () => {
        setSubmitting(true);
        const res = await simApi.closePosition(position.id, price !== '' ? { price: Number(price) } : {});
        setSubmitting(false);
        if (res.error) return setError(res.error);
        toast.success(`${isStock ? 'Sold' : 'Bought back'} ${contractLabel(position)} @ ${money(res.data.close_price)} · P&L ${money(res.data.realized_pnl)}`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        onClose();
    };
    return (
        <Modal isOpen={!!position} onClose={onClose} title={isStock ? 'Sell shares' : 'Buy to close'}>
            <div className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                <p className="text-sm text-gray-700">
                    {contractLabel(position)} · entry {money(position.entry_price)} · last mark {money(position.current_price)}
                    {!isStock && position.current_bid != null && <> (bid {money(position.current_bid)} / ask {money(position.current_ask)})</>}
                </p>
                {!isStock && !isSpread && <LiveQuote state={liveQ} label="Moomoo live" />}
                {isSpread && <p className="text-xs text-gray-500">Buys back the short leg and sells the long leg. Credit {money(position.entry_price)} · max loss {money(position.max_loss)}.</p>}
                <Input
                    label={isStock ? 'Sale price per share (blank = latest Yahoo price)' : isSpread ? 'Closing debit per share (blank = live Moomoo mids at the moment you submit)' : 'Buy-back price per share (blank = live Moomoo mid at the moment you submit)'}
                    type="number" step="0.01" min={0} value={price} onChange={(e) => setPrice(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" loading={submitting} onClick={submit}>{isStock ? 'Sell' : 'Buy to close'}</Button>
                </div>
            </div>
        </Modal>
    );
}

function RollModal({ position, onClose }) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState({});
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    useEffect(() => {
        if (position) setForm({ strike: position.strike, expiration_date: '', contracts: position.contracts, close_price: '', price: '' });
        setError(null);
    }, [position]);
    const closeQ = useLiveQuote({ ticker: position?.ticker, strike: position?.strike, expiration_date: position?.expiration_date }, !!position);
    const newQ = useLiveQuote({ ticker: position?.ticker, strike: form.strike, expiration_date: form.expiration_date }, !!position);
    if (!position) return null;
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const submit = async () => {
        setSubmitting(true);
        const res = await simApi.rollPosition(position.id, {
            strike: Number(form.strike),
            expiration_date: form.expiration_date,
            contracts: Number(form.contracts) || position.contracts,
            ...(form.close_price !== '' ? { close_price: Number(form.close_price) } : {}),
            ...(form.price !== '' ? { price: Number(form.price) } : {}),
        });
        setSubmitting(false);
        if (res.error) return setError(res.error);
        toast.success(`Rolled into ${contractLabel(res.data)} @ ${money(res.data.entry_price)}`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        onClose();
    };
    return (
        <Modal isOpen={!!position} onClose={onClose} title={`Roll ${contractLabel(position)}`} size="lg">
            <div className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                <p className="text-sm text-gray-600">Buys the current put back and sells the new one, both at the live mid unless you type a price.</p>
                <LiveQuote state={closeQ} label="Current put" />
                <Input label="Buy-back price per share (blank = live mid)" type="number" step="0.01" min={0} value={form.close_price ?? ''} onChange={set('close_price')} placeholder={position.current_price != null ? `Last mark ${position.current_price}` : ''} />
                <div className="grid grid-cols-3 gap-3">
                    <Input label="New strike ($)" type="number" step="0.5" value={form.strike ?? ''} onChange={set('strike')} />
                    <Input label="New expiry" type="date" value={form.expiration_date ?? ''} onChange={set('expiration_date')} />
                    <Input label="Contracts" type="number" min={1} value={form.contracts ?? ''} onChange={set('contracts')} />
                </div>
                <LiveQuote state={newQ} label="New put" />
                {closeQ.quote && newQ.quote && (() => {
                    const net = newQ.quote.price * 100 * (Number(form.contracts) || position.contracts) - closeQ.quote.price * 100 * position.contracts;
                    return <p className="text-sm">Net {net >= 0 ? 'credit' : 'debit'} at live mids (before fees): <strong className={signColor(net)}>{money(net)}</strong></p>;
                })()}
                <Input label="New put fill price per share (blank = live mid)" type="number" step="0.01" min={0} value={form.price ?? ''} onChange={set('price')} />
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" loading={submitting} onClick={submit} disabled={!form.expiration_date}>Roll</Button>
                </div>
            </div>
        </Modal>
    );
}

function SettingsModal({ isOpen, onClose, portfolio, hasTrades }) {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [form, setForm] = useState({});
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    useEffect(() => {
        if (isOpen && portfolio) {
            setForm({
                spread_exit_rule: portfolio.spread_exit_rule || 'touch',
                name: portfolio.name, description: portfolio.description || '', starting_cash: portfolio.starting_cash,
                fee_per_contract: portfolio.fee_per_contract, fee_per_stock_trade: portfolio.fee_per_stock_trade, is_active: portfolio.is_active,
            });
            setError(null);
            setConfirmDelete(false);
        }
    }, [isOpen, portfolio]);
    if (!portfolio) return null;
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const save = async () => {
        setBusy(true);
        const res = await simApi.updatePortfolio(portfolio.id, {
            name: form.name, description: form.description, starting_cash: Number(form.starting_cash),
            fee_per_contract: Number(form.fee_per_contract) || 0, fee_per_stock_trade: Number(form.fee_per_stock_trade) || 0, is_active: form.is_active,
            spread_exit_rule: form.spread_exit_rule,
        });
        setBusy(false);
        if (res.error) return setError(res.error);
        toast.success('Portfolio updated');
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        onClose();
    };
    const remove = async () => {
        setBusy(true);
        const res = await simApi.deletePortfolio(portfolio.id);
        setBusy(false);
        if (res.error) return setError(res.error);
        toast.success(`Deleted "${portfolio.name}"`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        navigate('/admin/simulation');
    };
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Portfolio settings">
            <div className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                <Input label="Name" value={form.name ?? ''} onChange={set('name')} />
                <Input label="Strategy notes" value={form.description ?? ''} onChange={set('description')} />
                <Input label={hasTrades ? 'Starting cash (locked after the first trade)' : 'Starting cash ($)'} type="number" step="0.01" value={form.starting_cash ?? ''} onChange={set('starting_cash')} disabled={hasTrades} />
                <div className="grid grid-cols-2 gap-3">
                    <Input label="Fee per contract ($)" type="number" step="0.01" min={0} value={form.fee_per_contract ?? ''} onChange={set('fee_per_contract')} />
                    <Input label="Fee per stock trade ($)" type="number" step="0.01" min={0} value={form.fee_per_stock_trade ?? ''} onChange={set('fee_per_stock_trade')} />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Spread exit rule</label>
                    <select value={form.spread_exit_rule ?? 'touch'} onChange={set('spread_exit_rule')} className="block w-full px-3 py-2 border border-gray-300 rounded-lg sm:text-sm">
                        <option value="touch">Close when the price touches the short strike</option>
                        <option value="loss2x">Close when the loss reaches 2× the credit</option>
                        <option value="hold">Hold to expiry</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">Checked every minute during US market hours.</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                    Active (paused portfolios take no new trades and stop being marked)
                </label>
                <div className="flex items-center justify-between pt-2">
                    {confirmDelete ? (
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-red-600">Delete all its trades and history?</span>
                            <Button variant="danger" size="sm" loading={busy} onClick={remove}>Delete</Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
                        </div>
                    ) : (
                        <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmDelete(true)}>Delete portfolio</Button>
                    )}
                    <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                        <Button size="sm" loading={busy} onClick={save}>Save</Button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}

function Table({ head, children, empty }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-[#0D2654]/10">
                        {head.map((h, i) => <th key={h} className={`px-2 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
            {empty && <p className="text-sm text-gray-400 text-center py-6">{empty}</p>}
        </div>
    );
}
const td = 'px-2 py-2 text-right font-mono whitespace-nowrap';

function Section({ title, children, action }) {
    return (
        <section className="bg-white border-2 border-[#0D2654]/10 p-4">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

export function SimPortfolioPage() {
    const { id } = useParams();
    const queryClient = useQueryClient();
    // Marks open positions at the live Moomoo mid on load and every 30s while the page is open
    const { data, isLoading, isError, error, refetch, isFetching } = useApiQuery({ queryKey: ['sim', 'portfolio', id], queryFn: () => simApi.getPortfolio(id, true), refetchInterval: 30000 });
    const [tradeOpen, setTradeOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [closing, setClosing] = useState(null);
    const [rolling, setRolling] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const refresh = async () => {
        setRefreshing(true);
        const res = await simApi.refresh();
        setRefreshing(false);
        if (res.error) return toast.error(res.error);
        toast.success(`Marked ${res.data.marked} position(s)${res.data.unquoted ? `, ${res.data.unquoted} without a quote` : ''}`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
    };

    if (isLoading) return <div className="space-y-4"><Skeleton height={40} /><Skeleton height={300} /></div>;
    if (isError) return <ErrorAlert message={error?.message} onRetry={refetch} />;

    const { portfolio: p, totals: t, stats: s, open_positions: open, closed_positions: closed, transactions, snapshots, live } = data;
    const series = [{ key: 'value', name: p.name, points: snapshots.map((x) => ({ date: x.snap_date, value: x.total_value })) }];
    const spy = snapshots.map((x) => ({ date: x.snap_date, value: x.spy_price }));

    return (
        <div className="space-y-6">
            <Link to="/admin/simulation" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0D2654]/60 hover:text-[#0D2654]">
                <ArrowLeft className="w-4 h-4" /> All portfolios
            </Link>

            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{p.name}</h1>
                        {p.strategy_type === 'rules' && <Badge variant="blue">Automatic</Badge>}
                        {!p.is_active && <Badge variant="gray">Paused</Badge>}
                    </div>
                    {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">Started with {money(p.starting_cash)} · {t.days_running} day(s) · fees {money(p.fee_per_contract)}/contract · spreads: {EXIT_RULE_LABEL[p.spread_exit_rule] || 'close on touch'}</p>
                    <LiveBadge live={live} fetching={isFetching} />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={refresh} loading={refreshing}><RefreshCw className="w-4 h-4 mr-1.5" />Refresh prices</Button>
                    <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}><Settings className="w-4 h-4 mr-1.5" />Settings</Button>
                    <Button size="sm" onClick={() => setTradeOpen(true)} disabled={!p.is_active}><Plus className="w-4 h-4 mr-1.5" />Sell put</Button>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat label="Total value" value={money(t.total_value)} sub={<span className={signColor(t.total_return_pct)}>{t.total_return_pct > 0 ? '+' : ''}{pct(t.total_return_pct)} total</span>} />
                <Stat label="Annualized" value={pct(t.annualized_pct)} sub={t.annualized_pct == null ? 'shown after 30 days' : null} />
                <Stat label="Max drawdown" value={t.max_drawdown_pct ? `-${pct(t.max_drawdown_pct)}` : '0%'} className={t.max_drawdown_pct ? 'text-red-600' : ''} />
                <Stat label="Free cash" value={money(t.free_cash)} sub={`cash ${money(t.cash)} · collateral ${money(t.collateral)}`} />
                <Stat label="Realized P&L" value={money(t.realized)} className={signColor(t.realized)} />
                <Stat label="Unrealized P&L" value={money(t.unrealized)} className={signColor(t.unrealized)} />
                <Stat label="Win rate" value={s.win_rate_pct != null ? pct(s.win_rate_pct, 0) : '—'} sub={`${s.wins} won · ${s.losses} lost`} />
                <Stat label="Premium captured" value={pct(s.premium_captured_pct, 1)} sub={s.avg_days_held != null ? `avg ${s.avg_days_held} days held` : null} />
                {s.wins_per_loss != null && <Stat label="Wins lost per loss" value={s.wins_per_loss.toFixed(1)} sub="one average loss wipes out this many average wins" className={s.wins_per_loss > 10 ? 'text-red-600' : ''} />}
            </div>

            {p.strategy_type === 'rules' && p.rules?.params && <SimStrategyPanel portfolio={p} snapshots={snapshots} />}

            <Section title="Value vs SPY (indexed to 100)">
                <EquityChart series={series} spy={spy} height={260} />
            </Section>

            <Section title={`Open positions (${open.length})`}>
                <Table head={['Position', 'DTE', 'Qty', 'Entry', 'Bid / Ask', 'Mark', 'Underlying', 'Unrealized', 'Captured', '']} empty={open.length ? null : 'No open positions.'}>
                    {open.map((x) => (
                        <tr key={x.id} className="border-b border-gray-100">
                            <td className="px-2 py-2 whitespace-nowrap font-medium text-[#0D2654]">
                                {contractLabel(x)}
                                {x.entry_source && x.entry_source !== 'mid' && <span className="ml-1 text-xs text-gray-400">({x.entry_source})</span>}
                            </td>
                            <td className={td}>{x.days_to_expiry ?? '—'}</td>
                            <td className={td}>{x.position_type === 'stock' ? x.shares : x.contracts}</td>
                            <td className={td}>{money(x.entry_price)}</td>
                            <td className={td}>{x.current_bid != null ? `${money(x.current_bid)} / ${money(x.current_ask)}` : '—'}</td>
                            <td className={td} title={x.price_updated_at ? `Updated ${new Date(x.price_updated_at).toLocaleString()}` : ''}>{money(x.current_price)}</td>
                            <td className={td}>{money(x.underlying_price)}</td>
                            <td className={`${td} ${signColor(x.unrealized_pnl)}`}>{money(x.unrealized_pnl)}</td>
                            <td className={td} title={x.position_type === 'option' && takeProfitPrice({ perShare: x.entry_price }) != null ? `${PROFIT_TAKE_TARGET_PCT}% target — buy back at $${takeProfitPrice({ perShare: x.entry_price }).toFixed(2)} / share` : undefined}>
                                {x.profit_captured_pct != null ? pct(x.profit_captured_pct, 0) : '—'}
                                {cushion(x) != null && <div className={`text-[10px] ${cushion(x) <= 0.15 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>{cushion(x).toFixed(2)}% to short</div>}
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap space-x-1">
                                <Button variant="outline" size="sm" onClick={() => setClosing(x)}>{x.position_type === 'stock' ? 'Sell' : 'Close'}</Button>
                                {x.position_type === 'option' && <Button variant="outline" size="sm" onClick={() => setRolling(x)}>Roll</Button>}
                            </td>
                        </tr>
                    ))}
                </Table>
            </Section>

            <div className="grid lg:grid-cols-3 gap-6">
                <Section title="Trade stats">
                    <dl className="grid grid-cols-2 gap-y-2 text-sm">
                        <dt className="text-gray-500">Closed trades</dt><dd className="text-right font-semibold">{s.closed_trades}</dd>
                        <dt className="text-gray-500">Average win</dt><dd className="text-right font-semibold text-green-600">{money(s.avg_win)}</dd>
                        <dt className="text-gray-500">Average loss</dt><dd className="text-right font-semibold text-red-600">{money(s.avg_loss)}</dd>
                        <dt className="text-gray-500">Avg days held</dt><dd className="text-right font-semibold">{s.avg_days_held ?? '—'}</dd>
                        <dt className="text-gray-500">Assignments</dt><dd className="text-right font-semibold">{s.assignments} {s.assignment_rate_pct != null ? `(${pct(s.assignment_rate_pct, 0)})` : ''}</dd>
                        <dt className="text-gray-500">Premium captured</dt><dd className="text-right font-semibold">{pct(s.premium_captured_pct, 1)}</dd>
                    </dl>
                </Section>
                <div className="lg:col-span-2">
                    <Section title={`Closed trades (${closed.length})`}>
                        <Table head={['Position', 'Opened', 'Closed', 'Entry', 'Exit', 'Result', 'P&L']} empty={closed.length ? null : 'No closed trades yet.'}>
                            {closed.map((x) => (
                                <tr key={x.id} className="border-b border-gray-100">
                                    <td className="px-2 py-2 whitespace-nowrap font-medium text-[#0D2654]">{contractLabel(x)}</td>
                                    <td className={td}>{shortDate(x.open_date)}</td>
                                    <td className={td}>{shortDate(x.close_date)}</td>
                                    <td className={td}>{money(x.entry_price)}</td>
                                    <td className={td}>{money(x.close_price)}</td>
                                    <td className="px-2 py-2 text-right whitespace-nowrap" title={x.close_note || ''}>{REASON_LABEL[x.close_reason] || x.close_reason}</td>
                                    <td className={`${td} font-semibold ${signColor(x.realized_pnl)}`}>{money(x.realized_pnl)}</td>
                                </tr>
                            ))}
                        </Table>
                    </Section>
                </div>
            </div>

            <Section title="Cash ledger">
                <Table head={['When', 'Type', 'Detail', 'Fees', 'Cash change']} empty={transactions.length ? null : 'No transactions yet.'}>
                    {transactions.map((x) => (
                        <tr key={x.id} className="border-b border-gray-100">
                            <td className="px-2 py-2 whitespace-nowrap text-gray-500">{new Date(x.created_at).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">{TX_LABEL[x.type] || x.type}</td>
                            <td className="px-2 py-2 text-right text-gray-600">{x.description}</td>
                            <td className={td}>{x.fees ? money(x.fees) : '—'}</td>
                            <td className={`${td} ${signColor(x.amount)}`}>{money(x.amount)}</td>
                        </tr>
                    ))}
                </Table>
            </Section>

            <OpenTradeModal isOpen={tradeOpen} onClose={() => setTradeOpen(false)} portfolioId={p.id} />
            <CloseModal position={closing} onClose={() => setClosing(null)} />
            <RollModal position={rolling} onClose={() => setRolling(null)} />
            <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} portfolio={p} hasTrades={transactions.length > 0} />
        </div>
    );
}
