import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Plus, RefreshCw, Bot } from 'lucide-react';
import { simApi, backtestApi } from '../../api/client';
import { describeStrategy, sgtRange } from '../../lib/strategyText';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input, Modal, Badge, EmptyState, ErrorAlert, SkeletonCard } from '../../components/ui';
import { EquityChart, money, pct, signColor, OpenTradeModal, LiveBadge } from './simShared';

const EMPTY_FORM = { mode: 'manual', preset_id: '', run_at: '15:30', name: '', description: '', starting_cash: '', fee_per_contract: '', fee_per_stock_trade: '', spread_exit_rule: 'touch' };

function PortfolioFormModal({ isOpen, onClose }) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState(EMPTY_FORM);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const auto = form.mode === 'auto';
    const { data: presetData, isLoading: presetsLoading } = useApiQuery({ queryKey: ['backtest', 'presets'], queryFn: () => backtestApi.listPresets(), enabled: isOpen && auto });
    const presets = presetData?.presets || [];
    const preset = presets.find((x) => String(x.id) === String(form.preset_id));
    const pickPreset = (e) => {
        const chosen = presets.find((x) => String(x.id) === e.target.value);
        setForm((f) => ({
            ...f, preset_id: e.target.value,
            name: f.name || chosen?.name || '',
            starting_cash: f.starting_cash || (chosen?.params?.starting_cash ? String(chosen.params.starting_cash) : ''),
        }));
    };
    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!form.name.trim()) return setError('Name is required');
        if (!(Number(form.starting_cash) > 0)) return setError('Starting cash must be greater than 0');
        if (auto && !preset) return setError('Pick the saved backtest setting to follow');
        setSubmitting(true);
        const common = {
            name: form.name.trim(),
            ...(form.description ? { description: form.description } : {}),
            starting_cash: Number(form.starting_cash),
            fee_per_stock_trade: Number(form.fee_per_stock_trade) || 0,
        };
        const res = await simApi.createPortfolio(auto
            ? { ...common, preset_id: preset.id, run_at: form.run_at }
            : { ...common, fee_per_contract: Number(form.fee_per_contract) || 0, spread_exit_rule: form.spread_exit_rule });
        setSubmitting(false);
        if (res.error) return setError(res.error);
        toast.success(`Portfolio "${res.data.name}" created`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        setForm(EMPTY_FORM);
        onClose();
    };
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="New paper portfolio">
            <form onSubmit={submit} className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                <div className="grid grid-cols-2 gap-2 text-sm">
                    {[['manual', 'Manual', 'I place the trades myself'], ['auto', 'Automatic', 'Follow a saved backtest setting every trading day']].map(([v, label, hint]) => (
                        <label key={v} className={`border-2 p-2 cursor-pointer ${form.mode === v ? 'border-[#F06010] bg-orange-50' : 'border-gray-200'}`}>
                            <span className="flex items-center gap-2 font-semibold text-[#0D2654]"><input type="radio" checked={form.mode === v} onChange={() => setForm((f) => ({ ...f, mode: v }))} /> {label}</span>
                            <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>
                        </label>
                    ))}
                </div>
                {auto && (
                    <div className="space-y-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Saved backtest setting</label>
                            <select value={form.preset_id} onChange={pickPreset} className="block w-full px-3 py-2 border border-gray-300 rounded-lg sm:text-sm">
                                <option value="">{presetsLoading ? 'Loading…' : presets.length ? 'Choose…' : 'No saved settings — save one on the Backtest page'}</option>
                                {presets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                            </select>
                        </div>
                        {preset && (
                            <dl className="text-xs bg-gray-50 border border-gray-200 p-2 space-y-1">
                                {describeStrategy(preset.params).map((r) => (
                                    <div key={r.label} className="flex gap-2"><dt className="w-20 shrink-0 text-gray-400">{r.label}</dt><dd className="text-gray-700">{r.text}</dd></div>
                                ))}
                            </dl>
                        )}
                        <div>
                            <Input label="Runs every trading day at (New York time)" type="time" value={form.run_at} onChange={set('run_at')} />
                            <p className="mt-1 text-xs text-gray-500">{sgtRange(form.run_at)}. Uses live Moomoo prices, so the scanner proxy must be running. The fee per contract comes from the setting.</p>
                        </div>
                    </div>
                )}
                <Input label="Name" value={form.name} onChange={set('name')} placeholder={auto ? 'Defaults to the setting name' : 'e.g. 30Δ quant score ≥ 70'} />
                <Input label="Strategy notes" value={form.description} onChange={set('description')} placeholder={auto ? 'Optional' : 'What rule does this portfolio follow?'} />
                <Input label="Starting cash ($)" type="number" step="0.01" min={0} value={form.starting_cash} onChange={set('starting_cash')} />
                {!auto && (
                    <div className="grid grid-cols-2 gap-3">
                        <Input label="Fee per contract ($)" type="number" step="0.01" min={0} value={form.fee_per_contract} onChange={set('fee_per_contract')} placeholder="commission + platform" />
                        <Input label="Fee per stock trade ($)" type="number" step="0.01" min={0} value={form.fee_per_stock_trade} onChange={set('fee_per_stock_trade')} />
                    </div>
                )}
                {!auto && <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Spread exit rule</label>
                    <select value={form.spread_exit_rule} onChange={set('spread_exit_rule')} className="block w-full px-3 py-2 border border-gray-300 rounded-lg sm:text-sm">
                        <option value="touch">Close when the price touches the short strike</option>
                        <option value="loss2x">Close when the loss reaches 2× the credit</option>
                        <option value="hold">Hold to expiry</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">Checked every minute during US market hours.</p>
                </div>}
                <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                    <Button type="submit" size="sm" loading={submitting}>Create</Button>
                </div>
            </form>
        </Modal>
    );
}

function PortfolioCard({ p }) {
    return (
        <Link to={`/admin/simulation/${p.id}`} className="block bg-white border-2 border-[#0D2654]/10 hover:border-[#F06010] transition-colors p-4">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{p.name}</h3>
                    {p.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{p.description}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                    {p.strategy_type === 'rules' && <Badge variant="blue"><span className="inline-flex items-center gap-1"><Bot className="w-3 h-3" />Auto</span></Badge>}
                    {!p.is_active && <Badge variant="gray">Paused</Badge>}
                </div>
            </div>
            <div className="mt-3 flex items-baseline gap-3">
                <span className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{money(p.total_value)}</span>
                <span className={`text-sm font-semibold ${signColor(p.total_return_pct)}`}>{p.total_return_pct > 0 ? '+' : ''}{pct(p.total_return_pct)}</span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-gray-400">Annualized</dt><dd className="font-semibold">{pct(p.annualized_pct)}</dd></div>
                <div><dt className="text-gray-400">Max drawdown</dt><dd className="font-semibold text-red-600">{p.max_drawdown_pct ? `-${pct(p.max_drawdown_pct)}` : '0%'}</dd></div>
                <div><dt className="text-gray-400">Win rate</dt><dd className="font-semibold">{p.win_rate_pct != null ? `${pct(p.win_rate_pct, 0)} (${p.closed_trades})` : '—'}</dd></div>
                <div><dt className="text-gray-400">Free cash</dt><dd className="font-semibold">{money(p.free_cash)}</dd></div>
                <div><dt className="text-gray-400">Collateral</dt><dd className="font-semibold">{money(p.collateral)}</dd></div>
                <div><dt className="text-gray-400">Open</dt><dd className="font-semibold">{p.open_positions}</dd></div>
            </dl>
        </Link>
    );
}

export function SimulationPage() {
    const queryClient = useQueryClient();
    const [createOpen, setCreateOpen] = useState(false);
    const [tradeOpen, setTradeOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    // Marks every open position at the live Moomoo mid on load and every 30s while the page is open
    const { data, isLoading, isError, error, refetch, isFetching } = useApiQuery({ queryKey: ['sim', 'portfolios', 'live'], queryFn: () => simApi.listPortfolios(true), refetchInterval: 30000 });
    const portfolios = data?.portfolios || [];

    const { series, spy } = useMemo(() => {
        const s = portfolios.map((p) => ({ key: `p${p.id}`, name: p.name, points: p.snapshots.map((x) => ({ date: x.snap_date, value: x.total_value })) }));
        const longest = [...portfolios].sort((a, b) => b.snapshots.length - a.snapshots.length)[0];
        return { series: s, spy: longest ? longest.snapshots.map((x) => ({ date: x.snap_date, value: x.spy_price })) : [] };
    }, [portfolios]);

    const refresh = async () => {
        setRefreshing(true);
        const res = await simApi.refresh();
        setRefreshing(false);
        if (res.error) return toast.error(res.error);
        const r = res.data;
        toast.success(`Marked ${r.marked} position(s)${r.unquoted ? `, ${r.unquoted} without a quote` : ''}${r.expired || r.assigned ? ` · settled ${r.expired} expired, ${r.assigned} assigned` : ''}`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Simulation</h1>
                    <p className="text-sm text-gray-500">Paper-trade strategies at the live Moomoo bid/ask mid. Nothing here touches the live fund.</p>
                    <LiveBadge live={data?.live} fetching={isFetching} />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={refresh} loading={refreshing}><RefreshCw className="w-4 h-4 mr-1.5" />Refresh prices</Button>
                    <Button variant="outline" size="sm" onClick={() => setTradeOpen(true)} disabled={!portfolios.some((p) => p.is_active)}>Sell put</Button>
                    <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />New portfolio</Button>
                </div>
            </div>

            {isError && <ErrorAlert message={error?.message} onRetry={refetch} />}
            {isLoading && <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>}

            {!isLoading && portfolios.length === 0 && (
                <EmptyState
                    icon={FlaskConical}
                    title="No paper portfolios yet"
                    description="Create one per strategy you want to test, with its own starting cash and fees."
                    action={<Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1.5" />New portfolio</Button>}
                />
            )}

            {portfolios.length > 0 && (
                <>
                    <section className="bg-white border-2 border-[#0D2654]/10 p-4">
                        <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider mb-1">Performance (indexed to 100)</h2>
                        <p className="text-xs text-gray-500 mb-3">Each line starts at 100 so portfolios with different starting cash compare fairly. SPY dashed.</p>
                        <EquityChart series={series} spy={spy} />
                    </section>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {portfolios.map((p) => <PortfolioCard key={p.id} p={p} />)}
                    </div>
                </>
            )}

            <PortfolioFormModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
            <OpenTradeModal isOpen={tradeOpen} onClose={() => setTradeOpen(false)} />
        </div>
    );
}
