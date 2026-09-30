import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical, Plus, RefreshCw } from 'lucide-react';
import { simApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input, Modal, Badge, EmptyState, ErrorAlert, SkeletonCard } from '../../components/ui';
import { EquityChart, money, pct, signColor, OpenTradeModal } from './simShared';

function PortfolioFormModal({ isOpen, onClose }) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState({ name: '', description: '', starting_cash: '', fee_per_contract: '', fee_per_stock_trade: '' });
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!form.name.trim()) return setError('Name is required');
        if (!(Number(form.starting_cash) > 0)) return setError('Starting cash must be greater than 0');
        setSubmitting(true);
        const res = await simApi.createPortfolio({
            name: form.name.trim(),
            ...(form.description ? { description: form.description } : {}),
            starting_cash: Number(form.starting_cash),
            fee_per_contract: Number(form.fee_per_contract) || 0,
            fee_per_stock_trade: Number(form.fee_per_stock_trade) || 0,
        });
        setSubmitting(false);
        if (res.error) return setError(res.error);
        toast.success(`Portfolio "${res.data.name}" created`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        setForm({ name: '', description: '', starting_cash: '', fee_per_contract: '', fee_per_stock_trade: '' });
        onClose();
    };
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="New paper portfolio">
            <form onSubmit={submit} className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                <Input label="Name" value={form.name} onChange={set('name')} placeholder="e.g. 30Δ quant score ≥ 70" />
                <Input label="Strategy notes" value={form.description} onChange={set('description')} placeholder="What rule does this portfolio follow?" />
                <Input label="Starting cash ($)" type="number" step="0.01" min={0} value={form.starting_cash} onChange={set('starting_cash')} />
                <div className="grid grid-cols-2 gap-3">
                    <Input label="Fee per contract ($)" type="number" step="0.01" min={0} value={form.fee_per_contract} onChange={set('fee_per_contract')} placeholder="commission + platform" />
                    <Input label="Fee per stock trade ($)" type="number" step="0.01" min={0} value={form.fee_per_stock_trade} onChange={set('fee_per_stock_trade')} />
                </div>
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
                {!p.is_active && <Badge variant="gray">Paused</Badge>}
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
    const { data, isLoading, isError, error, refetch } = useApiQuery({ queryKey: ['sim', 'portfolios'], queryFn: simApi.listPortfolios });
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
                    <p className="text-sm text-gray-500">Paper-trade strategies at the bid/ask mid. Nothing here touches the live fund.</p>
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
