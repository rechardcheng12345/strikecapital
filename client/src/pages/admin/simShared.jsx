import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FlaskConical } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from 'recharts';
import { simApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input, Modal } from '../../components/ui';

export function money(v) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function pct(v, dp = 2) {
    return v == null ? '—' : `${Number(v).toFixed(dp)}%`;
}
export function signColor(v) {
    if (v == null || Number(v) === 0) return 'text-gray-700';
    return Number(v) > 0 ? 'text-green-600' : 'text-red-600';
}
export function shortDate(d) {
    if (!d) return '—';
    return new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' });
}

export const LINE_COLORS = ['#F06010', '#0D2654', '#0E7A53', '#9333EA', '#0891B2', '#DB2777', '#CA8A04'];

/**
 * Equity curves indexed to 100 at each series' first point, so portfolios with different starting cash
 * compare fairly. series: [{ key, name, points: [{ date, value }] }]; spy: [{ date, value }] (optional).
 */
export function EquityChart({ series, spy, height = 300 }) {
    const data = useMemo(() => {
        const byDate = new Map();
        const put = (date, key, v) => {
            if (!byDate.has(date)) byDate.set(date, { date });
            byDate.get(date)[key] = v;
        };
        for (const s of series) {
            const base = s.points.find((p) => p.value > 0)?.value;
            if (!base) continue;
            for (const p of s.points) put(p.date, s.key, Math.round((p.value / base) * 10000) / 100);
        }
        const spyBase = spy?.find((p) => p.value > 0)?.value;
        if (spyBase) for (const p of spy) if (p.value > 0) put(p.date, 'spy', Math.round((p.value / spyBase) * 10000) / 100);
        return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    }, [series, spy]);

    if (data.length < 2) {
        return <p className="text-sm text-gray-400 py-10 text-center">The chart starts after the second daily snapshot.</p>;
    }
    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EEEAE1" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} width={44} />
                <Tooltip labelFormatter={shortDate} formatter={(v, name) => [Number(v).toFixed(2), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={100} stroke="#B5AFA3" strokeDasharray="4 4" />
                {series.map((s, i) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                ))}
                {spy?.length ? <Line type="monotone" dataKey="spy" name="SPY" stroke="#B5AFA3" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls /> : null}
            </LineChart>
        </ResponsiveContainer>
    );
}

/** "Live" badge: when open positions were last marked at Moomoo prices by this page's polling. */
export function LiveBadge({ live, fetching }) {
    if (!live) return null;
    if (live.error) return <span className="text-xs text-red-600">Live prices unavailable: {live.error}</span>;
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500" title={`${live.marked} marked${live.unquoted ? `, ${live.unquoted} without a quote` : ''}`}>
            <span className={`w-2 h-2 rounded-full ${live.unquoted ? 'bg-yellow-500' : 'bg-green-500'} ${fetching ? 'animate-pulse' : ''}`} />
            Live · {new Date(live.marked_at).toLocaleTimeString()}
            {live.unquoted ? ` · ${live.unquoted} without quote` : ''}
        </span>
    );
}

export function Stat({ label, value, sub, className = '' }) {
    return (
        <div className="border border-ink/10 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
            <p className={`text-xl font-bold ${className || 'text-ink'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
    );
}

function useDebounced(value, ms = 400) {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
}

/** Live Moomoo quote for a put, refreshed every 15s while `enabled`. */
export function useLiveQuote({ ticker, strike, expiration_date }, enabled = true) {
    const key = useDebounced(`${String(ticker || '').toUpperCase()}|${Number(strike) || ''}|${expiration_date || ''}`);
    const [t, k, e] = key.split('|');
    const valid = !!t && Number(k) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e);
    const q = useApiQuery({
        queryKey: ['sim', 'quote', key],
        queryFn: () => simApi.quote({ ticker: t, strike: Number(k), expiration_date: e }),
        enabled: enabled && valid,
        refetchInterval: 15000,
        retry: false,
        staleTime: 0,
    });
    return { quote: q.data || null, loading: q.isFetching && !q.data, error: q.error?.message || null, updatedAt: q.dataUpdatedAt, valid };
}

export function LiveQuote({ state, label = 'Live quote' }) {
    if (!state.valid) return <p className="text-xs text-gray-400">{label}: enter ticker, strike and expiry.</p>;
    if (state.loading) return <p className="text-xs text-gray-400 animate-pulse">{label}: fetching from Moomoo…</p>;
    if (state.error) return <p className="text-xs text-red-600">{label}: {state.error}</p>;
    if (!state.quote) return null;
    const q = state.quote;
    return (
        <div className="text-sm bg-green-50 border border-green-200 px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> {label}
            </span>
            <span>Bid <strong>{money(q.bid)}</strong></span>
            <span>Ask <strong>{money(q.ask)}</strong></span>
            <span>{q.source === 'mid' ? 'Mid' : 'Last'} <strong className="text-ink">{money(q.price)}</strong></span>
            {q.delta != null && <span className="text-gray-500">Δ {Math.abs(q.delta).toFixed(2)}</span>}
            <span className="text-xs text-gray-400">{state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : ''}</span>
        </div>
    );
}

/**
 * Sell to open a cash-secured put in a paper portfolio. Fills at the live mid unless a price is typed.
 * prefill: { ticker, strike, expiration_date, fallback_price, entry_context } (e.g. from a scanner row).
 */
export function OpenTradeModal({ isOpen, onClose, portfolioId = null, prefill = null, onDone }) {
    const queryClient = useQueryClient();
    const { data: list } = useApiQuery({ queryKey: ['sim', 'portfolios'], queryFn: simApi.listPortfolios, enabled: isOpen && !portfolioId });
    const active = (list?.portfolios || []).filter((p) => p.is_active);
    const [form, setForm] = useState({});
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setForm({
            portfolio_id: portfolioId || '',
            ticker: prefill?.ticker || '',
            strike: prefill?.strike ?? '',
            expiration_date: prefill?.expiration_date || '',
            contracts: 1,
            price: '',
            notes: '',
        });
        setError(null);
        // Reset only when the form opens — prefill can change underneath (e.g. Jev scores arriving) while typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);
    const live = useLiveQuote({ ticker: form.ticker, strike: form.strike, expiration_date: form.expiration_date }, isOpen);
    const quote = live.quote;
    useEffect(() => {
        if (isOpen && !portfolioId && !form.portfolio_id && active.length === 1) setForm((f) => ({ ...f, portfolio_id: active[0].id }));
    }, [isOpen, portfolioId, active, form.portfolio_id]);

    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const fillPx = form.price !== '' ? Number(form.price) : (quote?.price ?? prefill?.fallback_price ?? null);
    const contracts = Number(form.contracts) || 1;
    const chosen = portfolioId ? null : active.find((p) => String(p.id) === String(form.portfolio_id));

    const submit = async () => {
        setError(null);
        const pid = portfolioId || form.portfolio_id;
        if (!pid) return setError('Choose a portfolio');
        setSubmitting(true);
        const res = await simApi.openPut(pid, {
            ticker: form.ticker,
            strike: Number(form.strike),
            expiration_date: form.expiration_date,
            contracts,
            ...(form.price !== '' ? { price: Number(form.price) } : {}),
            ...(prefill?.fallback_price ? { fallback_price: Number(prefill.fallback_price) } : {}),
            ...(prefill?.entry_context ? { entry_context: prefill.entry_context } : {}),
            ...(form.notes ? { notes: form.notes } : {}),
        });
        setSubmitting(false);
        if (res.error) return setError(res.error);
        toast.success(`Paper trade: sold ${contracts} ${res.data.ticker} $${res.data.strike}P @ ${money(res.data.entry_price)} (${res.data.entry_source})`);
        queryClient.invalidateQueries({ queryKey: ['sim'] });
        onDone?.(res.data);
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Paper trade — sell put" size="lg">
            <div className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                {!portfolioId && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio</label>
                        {active.length === 0 ? (
                            <p className="text-sm text-gray-500">No active paper portfolios — create one on the Simulation page.</p>
                        ) : (
                            <select value={form.portfolio_id} onChange={set('portfolio_id')} className="block w-full px-3 py-2 border border-gray-300 rounded-lg sm:text-sm">
                                <option value="">Choose…</option>
                                {active.map((p) => <option key={p.id} value={p.id}>{p.name} — free cash {money(p.free_cash)}</option>)}
                            </select>
                        )}
                    </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Input label="Ticker" value={form.ticker || ''} onChange={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))} />
                    <Input label="Strike ($)" type="number" step="0.5" value={form.strike} onChange={set('strike')} />
                    <Input label="Expiry" type="date" value={form.expiration_date || ''} onChange={set('expiration_date')} />
                    <Input label="Contracts" type="number" min={1} value={form.contracts} onChange={set('contracts')} />
                </div>
                <LiveQuote state={live} label="Moomoo live" />
                <Input
                    label="Fill price per share (leave blank = live Moomoo mid at the moment you submit)"
                    type="number" step="0.01" min={0} value={form.price} onChange={set('price')}
                    placeholder={prefill?.fallback_price ? `Scanner mid ${Number(prefill.fallback_price).toFixed(2)} is used if no live quote` : 'Live mid'}
                />
                {fillPx > 0 && Number(form.strike) > 0 && (
                    <div className="text-sm bg-ink/5 px-3 py-2 space-y-0.5">
                        <p>
                            {form.price !== '' ? `Fill at your price ${money(fillPx)}` : quote ? `Fills at the live mid (now ${money(fillPx)})` : `No live quote — fills at the scanner mid ${money(fillPx)}`}
                            {' · '}Premium ≈ <strong>{money(fillPx * 100 * contracts)}</strong> · Collateral <strong>{money(Number(form.strike) * 100 * contracts)}</strong>
                        </p>
                        {chosen && <p className="text-gray-500">Free cash now {money(chosen.free_cash)} → after ≈ {money(chosen.free_cash + fillPx * 100 * contracts - Number(form.strike) * 100 * contracts)}</p>}
                    </div>
                )}
                <Input label="Notes" value={form.notes || ''} onChange={set('notes')} placeholder="Why this trade?" />
                <div className="flex justify-end gap-2 pt-2">
                    <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                    <Button size="sm" loading={submitting} onClick={submit}>Sell put</Button>
                </div>
            </div>
        </Modal>
    );
}

/** Paper-trade prefill from a scanner row, keeping the scores the trade was taken on. */
export function scannerPrefill(row, finalScore, jevScore) {
    return row && ({
        ticker: row.ticker,
        strike: row.strike,
        expiration_date: String(row.expiry || '').slice(0, 10),
        fallback_price: row.mid ?? row.premium ?? null,
        entry_context: {
            source: 'scanner',
            quant_score: row.score ?? null,
            final_score: finalScore ?? null,
            jev_score: jevScore?.jev_score ?? null,
            delta: row.delta ?? null,
            sigma_otm: row.sigma_otm ?? null,
            iv: row.iv ?? null,
            iv_hv_ratio: row.iv_hv_ratio ?? null,
            days_to_expiry: row.days_to_expiry ?? null,
            annual_return_pct: row.annual_return_pct ?? null,
            managed_ann_pct: row.managed_ann_pct ?? null,
            spread_pct: row.spread_pct ?? null,
            stock_price: row.stock_price ?? null,
            earnings_before_expiry: row.earnings_before_expiry ?? null,
        },
    });
}

/** "Paper trade" button for a scanner row. */
export function PaperTradeButton({ row, finalScore, jevScore }) {
    const [open, setOpen] = useState(false);
    const prefill = useMemo(() => scannerPrefill(row, finalScore, jevScore), [row, finalScore, jevScore]);
    if (!row) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-ink text-ink text-sm font-medium hover:bg-ink/5 transition-colors"
            >
                <FlaskConical className="w-4 h-4" /> Paper trade
            </button>
            <OpenTradeModal isOpen={open} onClose={() => setOpen(false)} prefill={prefill} />
        </>
    );
}
