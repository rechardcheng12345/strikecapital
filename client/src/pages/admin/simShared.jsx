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

export const LINE_COLORS = ['#F06010', '#0D2654', '#16A34A', '#9333EA', '#0891B2', '#DB2777', '#CA8A04'];

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
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} width={44} />
                <Tooltip labelFormatter={shortDate} formatter={(v, name) => [Number(v).toFixed(2), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={100} stroke="#9CA3AF" strokeDasharray="4 4" />
                {series.map((s, i) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                ))}
                {spy?.length ? <Line type="monotone" dataKey="spy" name="SPY" stroke="#9CA3AF" strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls /> : null}
            </LineChart>
        </ResponsiveContainer>
    );
}

export function Stat({ label, value, sub, className = '' }) {
    return (
        <div className="border border-[#0D2654]/10 bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wider text-gray-400">{label}</p>
            <p className={`text-xl font-bold ${className || 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
    );
}

/** Live bid / ask / mid preview; `onQuote` gets the quote so the parent can show it. */
function QuotePreview({ ticker, strike, expiration_date, onQuote }) {
    const [state, setState] = useState({ loading: false, quote: null, error: null });
    const ready = ticker && strike > 0 && /^\d{4}-\d{2}-\d{2}$/.test(expiration_date || '');
    const load = async () => {
        setState({ loading: true, quote: null, error: null });
        const res = await simApi.quote({ ticker, strike: Number(strike), expiration_date });
        setState({ loading: false, quote: res.data || null, error: res.error || null });
        onQuote?.(res.data || null);
    };
    return (
        <div className="flex items-center gap-3 text-sm">
            <Button type="button" variant="secondary" size="sm" onClick={load} disabled={!ready} loading={state.loading}>Get live quote</Button>
            {state.quote && (
                <span className="text-gray-700">
                    Bid {money(state.quote.bid)} · Ask {money(state.quote.ask)} · <strong>{state.quote.source === 'mid' ? 'Mid' : 'Last'} {money(state.quote.price)}</strong>
                </span>
            )}
            {state.error && <span className="text-red-600">{state.error}</span>}
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
    const [quote, setQuote] = useState(null);
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
        setQuote(null);
        setError(null);
    }, [isOpen, portfolioId, prefill]);
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
                <QuotePreview ticker={form.ticker} strike={Number(form.strike)} expiration_date={form.expiration_date} onQuote={setQuote} />
                <Input
                    label="Fill price per share (leave blank = live mid)"
                    type="number" step="0.01" min={0} value={form.price} onChange={set('price')}
                    placeholder={prefill?.fallback_price ? `Scanner mid ${Number(prefill.fallback_price).toFixed(2)} is used if no live quote` : 'Live mid'}
                />
                {fillPx > 0 && Number(form.strike) > 0 && (
                    <div className="text-sm bg-[#0D2654]/5 px-3 py-2 space-y-0.5">
                        <p>Premium ≈ <strong>{money(fillPx * 100 * contracts)}</strong> · Collateral <strong>{money(Number(form.strike) * 100 * contracts)}</strong></p>
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

/** "Paper trade" button for a scanner row. */
export function PaperTradeButton({ row, finalScore, jevScore }) {
    const [open, setOpen] = useState(false);
    const prefill = useMemo(() => row && ({
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
    }), [row, finalScore, jevScore]);
    if (!row) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-[#0D2654] text-[#0D2654] text-sm font-medium hover:bg-[#0D2654]/5 transition-colors"
            >
                <FlaskConical className="w-4 h-4" /> Paper trade
            </button>
            <OpenTradeModal isOpen={open} onClose={() => setOpen(false)} prefill={prefill} />
        </>
    );
}
