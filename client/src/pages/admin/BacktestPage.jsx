import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { History, Play, Download, Trash2, RotateCcw } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceArea } from 'recharts';
import { backtestApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input } from '../../components/ui';
import { money, pct, signColor, shortDate } from './simShared';

const TICKER = 'SOXL';
/** Option / strike prices: split-adjusted history goes below $1, so show 4 decimals there. */
const px = (v) => (v == null ? '—' : Math.abs(v) < 1 ? `$${Number(v).toFixed(4)}` : money(v));
const DEFAULT_FORM = {
    name: '',
    start: '2015-01-01',
    end: '',
    starting_cash: 100000,
    size_mode: 'equity_pct',
    size_pct: 10,
    contracts: 1,
    ladder: true, ladder_day: 1,
    listing: false,
    dip: false, dip_pct: 30, dip_cooldown: 30,
    continuous: false,
    max_open_puts: '', max_units: '',
    min_dte: 400, max_dte: 500, calendar: 'january',
    strike_mode: 'pct', delta: 0.25, otm_pct: 60, min_discount: 60, max_discount: 80, target_annual: 10,
    min_annual: 0,
    min_put_premium: 0.05,
    max_capital: 70,
    tp_on: true, tp: 30, after_tp: 'roll', roll_discount: 70, roll_strike: 'pct', after_expiry: false,
    early_on: false, early_remaining: 10, early_min_days: 180,
    roll_on: false, roll_buffer: 5,
    assigned_mode: 'calls', recover_pct: 0,
    cc_on: true, cc_dte: 30, cc_mode: 'delta', cc_delta: 0.25, cc_pct: 10, cc_floor: true, cc_tp_on: false, cc_tp: 50, cc_min_premium: 0.05,
    fee: 0.65,
    slippage: 2,
};
// The 35–40 day routine: 35% below, close at 80%, else hold; assigned → calls at cost + 5%; ≤ 1 put, ≤ 200 shares
const MY_ROUTINE = {
    name: '35–40d · 35% below · TP80 · calls cost+5% · max 100 sh + 1 put',
    size_mode: 'contracts', contracts: 1,
    ladder: false, listing: false, dip: false, continuous: true,
    max_open_puts: 1, max_units: 2,
    min_dte: 35, max_dte: 40, calendar: 'weekly',
    strike_mode: 'pct', otm_pct: 35, min_discount: 35,
    min_annual: 0, min_put_premium: 0.05, max_capital: 100,
    tp_on: true, tp: 80, after_tp: 'none', after_expiry: false,
    early_on: false, roll_on: false,
    assigned_mode: 'calls', cc_on: true, cc_dte: 35, cc_mode: 'cost_pct', cc_pct: 5, cc_floor: true, cc_tp_on: false, cc_min_premium: 0.01,
};

const REASON = { sold_at_recovery: 'Sold above cost', take_profit: 'Take profit', early_close: 'Closed early', rolled: 'Rolled', expired: 'Expired', assigned: 'Assigned', called_away: 'Called away', open: 'Open' };

function formToParams(f) {
    const n = (v) => Number(v);
    return {
        start: f.start || undefined,
        end: f.end || undefined,
        starting_cash: n(f.starting_cash),
        size_mode: f.size_mode,
        size_pct: n(f.size_pct),
        contracts: n(f.contracts),
        entry: {
            ladder: { enabled: f.ladder, day: n(f.ladder_day) },
            listing: { enabled: f.listing },
            dip: { enabled: f.dip, pct: n(f.dip_pct), cooldown_days: n(f.dip_cooldown) },
            continuous: { enabled: f.continuous },
        },
        limits: {
            max_open_puts: f.max_open_puts === '' ? null : n(f.max_open_puts),
            max_units: f.max_units === '' ? null : n(f.max_units),
        },
        expiry: { min_dte: n(f.min_dte), max_dte: n(f.max_dte), calendar: f.calendar },
        strike: { mode: f.strike_mode, delta: n(f.delta), pct: n(f.otm_pct), min_discount_pct: n(f.min_discount) || 0, max_discount_pct: n(f.max_discount) || 80, target_annual_pct: n(f.target_annual) || 10 },
        sell_at_recovery: { enabled: f.assigned_mode === 'recover', above_pct: n(f.recover_pct) },
        covered_calls: {
            enabled: f.assigned_mode === 'calls', dte: n(f.cc_dte), mode: f.cc_mode, delta: n(f.cc_delta), pct: n(f.cc_pct),
            floor_at_cost: f.cc_floor, take_profit_pct: f.cc_tp_on ? n(f.cc_tp) : null, min_premium: n(f.cc_min_premium),
        },
        min_annual_return_pct: n(f.min_annual),
        min_put_premium: n(f.min_put_premium),
        max_capital_pct: n(f.max_capital),
        exit: {
            take_profit_pct: f.tp_on ? n(f.tp) : null,
            after_tp: f.after_tp,
            roll_discount_pct: n(f.roll_discount),
            roll_strike: f.roll_strike,
            after_expiry: f.after_expiry ? 'reenter' : 'none',
            early_close: { enabled: f.early_on, remaining_pct: n(f.early_remaining), min_days_left: n(f.early_min_days) },
            roll_when_tested: { enabled: f.roll_on, buffer_pct: n(f.roll_buffer) },
        },
        fee_per_contract: n(f.fee),
        slippage_pct: n(f.slippage),
    };
}
function paramsToForm(p, name = '') {
    return {
        ...DEFAULT_FORM,
        name,
        start: p.start || '', end: p.end || '', starting_cash: p.starting_cash, size_mode: p.size_mode || 'contracts', size_pct: p.size_pct ?? 10, contracts: p.contracts ?? 1,
        ladder: !!p.entry?.ladder?.enabled, ladder_day: p.entry?.ladder?.day ?? 1,
        listing: !!p.entry?.listing?.enabled,
        dip: !!p.entry?.dip?.enabled, dip_pct: p.entry?.dip?.pct ?? 30, dip_cooldown: p.entry?.dip?.cooldown_days ?? 30,
        continuous: !!p.entry?.continuous?.enabled,
        max_open_puts: p.limits?.max_open_puts ?? '', max_units: p.limits?.max_units ?? '',
        min_dte: p.expiry?.min_dte ?? 400, max_dte: p.expiry?.max_dte ?? 500, calendar: p.expiry?.calendar || 'january',
        strike_mode: p.strike?.mode || 'delta', delta: p.strike?.delta ?? 0.25, otm_pct: p.strike?.pct ?? 30, min_discount: p.strike?.min_discount_pct ?? 0, max_discount: p.strike?.max_discount_pct ?? 80, target_annual: p.strike?.target_annual_pct ?? 10,
        assigned_mode: p.sell_at_recovery?.enabled ? 'recover' : p.covered_calls?.enabled ? 'calls' : 'hold',
        recover_pct: p.sell_at_recovery?.above_pct ?? 0,
        cc_on: !!p.covered_calls?.enabled, cc_dte: p.covered_calls?.dte ?? 30, cc_mode: p.covered_calls?.mode || 'delta', cc_delta: p.covered_calls?.delta ?? 0.25,
        cc_pct: p.covered_calls?.pct ?? 10, cc_floor: p.covered_calls?.floor_at_cost ?? true, cc_tp_on: p.covered_calls?.take_profit_pct != null,
        cc_tp: p.covered_calls?.take_profit_pct ?? 50, cc_min_premium: p.covered_calls?.min_premium ?? 0.05,
        min_annual: p.min_annual_return_pct ?? 0, min_put_premium: p.min_put_premium ?? 0, max_capital: p.max_capital_pct ?? 70,
        tp_on: p.exit?.take_profit_pct != null, tp: p.exit?.take_profit_pct ?? 50, after_tp: p.exit?.after_tp || (p.exit?.reenter_after_tp ? 'reenter' : 'none'), roll_discount: p.exit?.roll_discount_pct ?? 70, roll_strike: p.exit?.roll_strike || 'pct', after_expiry: p.exit?.after_expiry === 'reenter',
        early_on: !!p.exit?.early_close?.enabled, early_remaining: p.exit?.early_close?.remaining_pct ?? 10, early_min_days: p.exit?.early_close?.min_days_left ?? 180,
        roll_on: !!p.exit?.roll_when_tested?.enabled, roll_buffer: p.exit?.roll_when_tested?.buffer_pct ?? 5,
        fee: p.fee_per_contract ?? 0.65, slippage: p.slippage_pct ?? 2,
    };
}

function Box({ title, children, right, className = '' }) {
    return (
        <section className={`bg-white border-2 border-[#0D2654]/10 p-4 ${className}`}>
            <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider">{title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}
function Check({ label, checked, onChange }) {
    return (
        <label className="flex items-center gap-2 text-sm font-medium text-[#0D2654]">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
        </label>
    );
}
function Tile({ label, value, sub, cls = '' }) {
    return (
        <div className="border border-[#0D2654]/10 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
            <p className={`text-lg font-bold ${cls || 'text-[#0D2654]'}`} style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{value}</p>
            {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
        </div>
    );
}

function DataPanel() {
    const queryClient = useQueryClient();
    const { data, refetch } = useApiQuery({
        queryKey: ['backtest', 'data', TICKER],
        queryFn: () => backtestApi.dataStatus(TICKER),
        refetchInterval: (q) => (q.state.data?.job?.running ? 3000 : false),
    });
    const [busy, setBusy] = useState(false);
    const load = async () => {
        setBusy(true);
        const res = await backtestApi.loadHistory(TICKER);
        setBusy(false);
        if (res.error) return toast.error(res.error);
        toast.success('Loading real option prices in the background…');
        refetch();
    };
    const record = async () => {
        const res = await backtestApi.recordToday(TICKER);
        if (res.error) return toast.error(res.error);
        toast.success(`Recorded ${res.data.recorded} contracts for ${res.data.date}`);
        queryClient.invalidateQueries({ queryKey: ['backtest', 'data'] });
    };
    const job = data?.job;
    const cal = data?.calibration;
    const yahoo = data?.sources?.find((s) => s.source === 'yahoo');
    const mids = data?.sources?.find((s) => s.source === 'moomoo_mid');
    return (
        <Box title={`Price data — ${TICKER}`} right={(
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={load} loading={busy || job?.running}><Download className="w-4 h-4 mr-1.5" />{yahoo ? 'Refresh real prices' : 'Load real prices'}</Button>
                <Button variant="ghost" size="sm" onClick={record} title="Save today's Moomoo long-dated chain now (the server also does this after each close)">Record today</Button>
            </div>
        )}>
            {job?.running && (
                <div className="mb-3">
                    <p className="text-sm text-gray-600">{job.message} {job.total ? `${job.done}/${job.total}` : ''}</p>
                    <div className="h-1.5 bg-gray-100 mt-1"><div className="h-1.5 bg-[#F06010]" style={{ width: `${job.total ? (job.done / job.total) * 100 : 5}%` }} /></div>
                </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div>
                    <p className="text-xs uppercase tracking-wider text-gray-400">Stock history (Yahoo)</p>
                    <p>{data?.underlying ? `${data.underlying.first} → ${data.underlying.last} (${data.underlying.days} days)` : '—'}</p>
                </div>
                <div>
                    <p className="text-xs uppercase tracking-wider text-gray-400">Real option prices</p>
                    <p>{yahoo ? `${yahoo.bars.toLocaleString()} daily prices, ${yahoo.contracts} contracts, ${yahoo.first} → ${yahoo.last}` : 'Not loaded yet'}</p>
                    {mids && <p className="text-xs text-gray-500">+ {mids.bars.toLocaleString()} recorded Moomoo mids ({mids.first} → {mids.last})</p>}
                </div>
                <div>
                    <p className="text-xs uppercase tracking-wider text-gray-400">Model calibration</p>
                    {cal?.calibrated ? (
                        <p>
                            Off by <strong>{cal.holdout_core?.median_abs_pct ?? cal.holdout?.median_abs_pct}%</strong> on a typical day for strikes 50–90% of the price
                            <span className="text-xs text-gray-500"> (all strikes {cal.holdout?.median_abs_pct}%; tested on {cal.holdout?.from} →; {cal.lookback}-day volatility; {cal.points?.toLocaleString()} real prices)</span>
                        </p>
                    ) : <p className="text-amber-700">{cal?.reason || 'Load real prices to calibrate the model.'}</p>}
                </div>
            </div>
            {cal?.short && (
                <p className="text-xs text-gray-500 mt-2">
                    Short-dated puts (20–100 days): {cal.short.calibrated
                        ? <>own fit on {cal.short.points?.toLocaleString()} real prices since {cal.short.first_date} — off by {cal.short.holdout_core?.median_abs_pct ?? cal.short.holdout?.median_abs_pct}% on a typical day</>
                        : <>{cal.short.reason} Using the long-dated fit.</>}
                </p>
            )}
            {cal?.buckets?.length > 0 && (
                <p className="text-xs text-gray-500 mt-2">
                    Skew learned (implied ÷ historical volatility by strike ÷ price): {cal.buckets.map((b) => `${b.lo}–${b.hi}: ${b.mult}×`).join(' · ')}
                </p>
            )}
        </Box>
    );
}

function StrategyForm({ form, setForm, onRun, running }) {
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const tog = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
    const noEntry = !form.ladder && !form.listing && !form.dip && !form.continuous;
    return (
        <Box title="Strategy — cash-secured puts" right={<Button variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, ...MY_ROUTINE }))}>Load my 35-day routine</Button>}>
            <div className="space-y-4">
                <div className="grid sm:grid-cols-4 gap-3">
                    <Input label="Name (optional)" value={form.name} onChange={set('name')} placeholder="e.g. ladder Δ0.25 TP50" />
                    <Input label="From" type="date" value={form.start} onChange={set('start')} />
                    <Input label="To (blank = today)" type="date" value={form.end} onChange={set('end')} />
                    <Input label="Starting cash ($)" type="number" value={form.starting_cash} onChange={set('starting_cash')} />
                </div>

                <div className="grid lg:grid-cols-3 gap-4">
                    <div className="space-y-2 border border-gray-100 p-3">
                        <p className="text-xs uppercase tracking-wider text-gray-400">When to sell (any that fire)</p>
                        <div className="flex items-center gap-2">
                            <Check label="Monthly ladder on day" checked={form.ladder} onChange={tog('ladder')} />
                            <input type="number" min={1} max={28} value={form.ladder_day} onChange={set('ladder_day')} className="w-16 px-2 py-1 border border-gray-300 text-sm" />
                        </div>
                        <Check label="New expiry enters the window" checked={form.listing} onChange={tog('listing')} />
                        <div className="flex items-center gap-2 flex-wrap">
                            <Check label="Dip: price" checked={form.dip} onChange={tog('dip')} />
                            <input type="number" min={1} max={95} value={form.dip_pct} onChange={set('dip_pct')} className="w-16 px-2 py-1 border border-gray-300 text-sm" />
                            <span className="text-sm">% below 1-year high, every</span>
                            <input type="number" min={1} value={form.dip_cooldown} onChange={set('dip_cooldown')} className="w-16 px-2 py-1 border border-gray-300 text-sm" />
                            <span className="text-sm">days at most</span>
                        </div>
                        <Check label="Keep selling: a new put whenever the limits allow" checked={form.continuous} onChange={tog('continuous')} />
                        {noEntry && <p className="text-xs text-red-600">Pick at least one.</p>}
                    </div>
                    <div className="space-y-2 border border-gray-100 p-3">
                        <p className="text-xs uppercase tracking-wider text-gray-400">Which put</p>
                        <div className="grid grid-cols-2 gap-2">
                            <Input label="Expiry from (days)" type="number" value={form.min_dte} onChange={set('min_dte')} />
                            <Input label="to (days)" type="number" value={form.max_dte} onChange={set('max_dte')} />
                        </div>
                        <select value={form.calendar} onChange={set('calendar')} className="block w-full px-3 py-2 border border-gray-300 text-sm">
                            <option value="january">January expiries only (typical long-dated listings)</option>
                            <option value="monthly">Any month&apos;s expiry (third Friday)</option>
                            <option value="weekly">Weekly expiries (every Friday)</option>
                        </select>
                        <div className="flex items-center gap-3 text-sm">
                            <label className="flex items-center gap-1"><input type="radio" checked={form.strike_mode === 'delta'} onChange={() => setForm((f) => ({ ...f, strike_mode: 'delta' }))} /> Delta</label>
                            <input type="number" step="0.01" value={form.delta} onChange={set('delta')} disabled={form.strike_mode !== 'delta'} className="w-20 px-2 py-1 border border-gray-300" />
                            <label className="flex items-center gap-1"><input type="radio" checked={form.strike_mode === 'pct'} onChange={() => setForm((f) => ({ ...f, strike_mode: 'pct' }))} /> % below price</label>
                            <input type="number" value={form.otm_pct} onChange={set('otm_pct')} disabled={form.strike_mode !== 'pct'} className="w-16 px-2 py-1 border border-gray-300" />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-sm">
                            <label className="flex items-center gap-1"><input type="radio" checked={form.strike_mode === 'yield'} onChange={() => setForm((f) => ({ ...f, strike_mode: 'yield' }))} /> Furthest strike paying ≥</label>
                            <input type="number" value={form.target_annual} onChange={set('target_annual')} disabled={form.strike_mode !== 'yield'} className="w-16 px-2 py-1 border border-gray-300" />
                            <span>% a year, no further than</span>
                            <input type="number" value={form.max_discount} onChange={set('max_discount')} disabled={form.strike_mode !== 'yield'} className="w-14 px-2 py-1 border border-gray-300" />
                            <span>% below</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <Input label={form.strike_mode === 'yield' ? 'No closer than % below price' : 'Strike at least % below price'} type="number" value={form.min_discount} onChange={set('min_discount')} />
                            <Input label="Min annual return (%)" type="number" value={form.min_annual} onChange={set('min_annual')} />
                        </div>
                        <Input label="Min premium per share ($, real — skip puts not worth selling)" type="number" step="0.01" value={form.min_put_premium} onChange={set('min_put_premium')} />
                    </div>
                    <div className="space-y-2 border border-gray-100 p-3">
                        <p className="text-xs uppercase tracking-wider text-gray-400">Exit</p>
                        <div className="flex items-center gap-2">
                            <Check label="Take profit at" checked={form.tp_on} onChange={tog('tp_on')} />
                            <input type="number" value={form.tp} onChange={set('tp')} disabled={!form.tp_on} className="w-16 px-2 py-1 border border-gray-300 text-sm" /><span className="text-sm">% of premium earned</span>
                        </div>
                        {form.tp_on && (
                            <div className="pl-6 flex items-center gap-2 text-sm">
                                <span>then</span>
                                <select value={form.after_tp} onChange={set('after_tp')} className="px-2 py-1 border border-gray-300 text-sm">
                                    <option value="roll">roll to a later expiry</option>
                                    <option value="reenter">sell a new put at today&apos;s strike rule</option>
                                    <option value="none">wait for the next entry</option>
                                </select>
                                {form.after_tp === 'roll' && (
                                    <>
                                        <select value={form.roll_strike} onChange={set('roll_strike')} className="px-2 py-1 border border-gray-300 text-sm">
                                            <option value="entry">strike by the entry rule</option>
                                            <option value="pct">strike a fixed % below</option>
                                        </select>
                                        {form.roll_strike === 'pct' && (
                                            <>
                                                <input type="number" value={form.roll_discount} onChange={set('roll_discount')} className="w-14 px-2 py-1 border border-gray-300 text-sm" />
                                                <span>% below the price then</span>
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                            <Check label="Close early if ≤" checked={form.early_on} onChange={tog('early_on')} />
                            <input type="number" value={form.early_remaining} onChange={set('early_remaining')} disabled={!form.early_on} className="w-14 px-2 py-1 border border-gray-300 text-sm" /><span className="text-sm">% left with ≥</span>
                            <input type="number" value={form.early_min_days} onChange={set('early_min_days')} disabled={!form.early_on} className="w-16 px-2 py-1 border border-gray-300 text-sm" /><span className="text-sm">days to go</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Check label="Roll when price within" checked={form.roll_on} onChange={tog('roll_on')} />
                            <input type="number" value={form.roll_buffer} onChange={set('roll_buffer')} disabled={!form.roll_on} className="w-14 px-2 py-1 border border-gray-300 text-sm" /><span className="text-sm">% of strike</span>
                        </div>
                        <Check label="When a put expires worthless, sell the next one" checked={form.after_expiry} onChange={tog('after_expiry')} />
                        <p className="text-xs text-gray-500">Otherwise held to expiry.</p>
                    </div>
                </div>

                <div className="border border-gray-100 p-3 space-y-2">
                    <div className="flex items-center flex-wrap gap-x-4 gap-y-1 text-sm">
                        <span className="text-xs uppercase tracking-wider text-gray-400">If assigned</span>
                        <label className="flex items-center gap-1"><input type="radio" checked={form.assigned_mode === 'calls'} onChange={() => setForm((f) => ({ ...f, assigned_mode: 'calls', cc_on: true }))} /> Sell covered calls (the wheel)</label>
                        <label className="flex items-center gap-1"><input type="radio" checked={form.assigned_mode === 'recover'} onChange={() => setForm((f) => ({ ...f, assigned_mode: 'recover', cc_on: false }))} /> Hold, sell the shares when the price is back above my cost +</label>
                        <input type="number" value={form.recover_pct} onChange={set('recover_pct')} disabled={form.assigned_mode !== 'recover'} className="w-14 px-2 py-1 border border-gray-300" /><span>%</span>
                        <label className="flex items-center gap-1"><input type="radio" checked={form.assigned_mode === 'hold'} onChange={() => setForm((f) => ({ ...f, assigned_mode: 'hold', cc_on: false }))} /> Just hold</label>
                    </div>
                    {form.assigned_mode === 'calls' && <p className="text-xs text-gray-500">Calls are model-priced — real history is loaded for puts only.</p>}
                    {form.assigned_mode === 'calls' && (
                        <div className="flex items-center gap-3 flex-wrap text-sm">
                            <span>Expiry ≥</span>
                            <input type="number" value={form.cc_dte} onChange={set('cc_dte')} className="w-16 px-2 py-1 border border-gray-300" /><span>days ·</span>
                            <label className="flex items-center gap-1"><input type="radio" checked={form.cc_mode === 'delta'} onChange={() => setForm((f) => ({ ...f, cc_mode: 'delta' }))} /> Delta</label>
                            <input type="number" step="0.01" value={form.cc_delta} onChange={set('cc_delta')} disabled={form.cc_mode !== 'delta'} className="w-20 px-2 py-1 border border-gray-300" />
                            <label className="flex items-center gap-1"><input type="radio" checked={form.cc_mode === 'pct'} onChange={() => setForm((f) => ({ ...f, cc_mode: 'pct' }))} /> % above price</label>
                            <label className="flex items-center gap-1"><input type="radio" checked={form.cc_mode === 'cost_pct'} onChange={() => setForm((f) => ({ ...f, cc_mode: 'cost_pct' }))} /> % above my cost</label>
                            <input type="number" value={form.cc_pct} onChange={set('cc_pct')} disabled={form.cc_mode === 'delta'} className="w-16 px-2 py-1 border border-gray-300" /><span>%</span>
                            <Check label="Never below my cost" checked={form.cc_floor} onChange={tog('cc_floor')} />
                            <Check label="Take profit at" checked={form.cc_tp_on} onChange={tog('cc_tp_on')} />
                            <input type="number" value={form.cc_tp} onChange={set('cc_tp')} disabled={!form.cc_tp_on} className="w-14 px-2 py-1 border border-gray-300" /><span>%</span>
                            <span>· min premium $</span>
                            <input type="number" step="0.01" value={form.cc_min_premium} onChange={set('cc_min_premium')} className="w-16 px-2 py-1 border border-gray-300" /><span>/share</span>
                        </div>
                    )}
                </div>

                <div className="grid sm:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Size per trade</label>
                        <select value={form.size_mode} onChange={set('size_mode')} className="block w-full px-3 py-2 border border-gray-300 text-sm">
                            <option value="equity_pct">% of account</option>
                            <option value="contracts">Fixed contracts</option>
                        </select>
                    </div>
                    {form.size_mode === 'equity_pct'
                        ? <Input label="Collateral per trade (% of account)" type="number" value={form.size_pct} onChange={set('size_pct')} />
                        : <Input label="Contracts per trade" type="number" value={form.contracts} onChange={set('contracts')} />}
                    <Input label="Max cash tied up (%)" type="number" value={form.max_capital} onChange={set('max_capital')} />
                    <Input label="Max open puts (blank = any)" type="number" min={1} value={form.max_open_puts} onChange={set('max_open_puts')} />
                    <Input label="Max shares ÷ 100 + puts (blank = any)" type="number" min={1} value={form.max_units} onChange={set('max_units')} />
                    <Input label="Fee per contract ($)" type="number" step="0.01" value={form.fee} onChange={set('fee')} />
                    <Input label="Slippage vs price (%)" type="number" step="0.5" value={form.slippage} onChange={set('slippage')} />
                </div>
                <div className="flex justify-end">
                    <Button onClick={onRun} loading={running} disabled={noEntry}><Play className="w-4 h-4 mr-1.5" />Run backtest</Button>
                </div>
            </div>
        </Box>
    );
}

function EquityChart({ run }) {
    const [log, setLog] = useState(true);
    const key = `${run.meta?.ticker || TICKER}_hold`;
    const data = useMemo(() => {
        const eq = run.equity || [];
        const step = Math.max(1, Math.ceil(eq.length / 1200));
        return eq.filter((_, i) => i % step === 0 || i === eq.length - 1);
    }, [run]);
    const realFrom = run.meta?.real_data_from;
    return (
        <Box title="Account value" right={<button type="button" className="text-xs text-gray-500 hover:text-[#0D2654]" onClick={() => setLog((v) => !v)}>{log ? 'Log scale' : 'Linear scale'}</button>}>
            <ResponsiveContainer width="100%" height={320}>
                <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="date" tickFormatter={(d) => d.slice(0, 4)} tick={{ fontSize: 11 }} minTickGap={40} />
                    <YAxis scale={log ? 'log' : 'auto'} domain={['auto', 'auto']} tickFormatter={(v) => `$${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} width={56} allowDataOverflow />
                    <Tooltip labelFormatter={shortDate} formatter={(v, name) => [money(v), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {realFrom && data.length > 0 && realFrom <= data[data.length - 1].date && (
                        <ReferenceArea x1={data.find((d) => d.date >= realFrom)?.date} x2={data[data.length - 1].date} fill="#16A34A" fillOpacity={0.06} label={{ value: 'real prices', fontSize: 10, fill: '#16A34A', position: 'insideTop' }} />
                    )}
                    <Line type="monotone" dataKey="equity" name="Strategy" stroke="#F06010" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey={key} name={`Hold ${run.meta?.ticker || TICKER}`} stroke="#0D2654" strokeWidth={1.2} dot={false} strokeOpacity={0.6} />
                    <Line type="monotone" dataKey="SPY_hold" name="Hold SPY" stroke="#9CA3AF" strokeWidth={1.2} strokeDasharray="5 3" dot={false} />
                </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-500 mt-1">Before {realFrom || 'the shaded area'} option prices come from the calibrated model; inside it, from real daily prices where a contract traded.</p>
        </Box>
    );
}

function Results({ run }) {
    const s = run.summary;
    const b = run.benchmarks || {};
    const hold = b[`${run.meta?.ticker || TICKER}_hold`];
    const td = 'px-2 py-1.5 text-right font-mono whitespace-nowrap';
    const [showAll, setShowAll] = useState(false);
    const trades = showAll ? run.trades : run.trades.slice(-60);
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 bg-white border-2 border-[#0D2654]/10 p-3">
                <Tile label="Annual return" value={pct(s.cagr_pct, 1)} cls={signColor(s.cagr_pct)} sub={`${pct(s.total_return_pct, 0)} total, ${s.years}y`} />
                <Tile label="Max drawdown" value={`-${pct(s.max_drawdown_pct, 1)}`} cls="text-red-600" sub={`${s.max_drawdown_from} → ${s.max_drawdown_to}`} />
                <Tile label="Final value" value={money(s.final_equity)} />
                <Tile label="Trades" value={s.trades} sub={`${pct(s.win_rate_pct, 1)} won · ${s.open_puts} open`} />
                <Tile label="Assigned" value={s.assignments} sub={s.shares_held ? `${s.shares_held} sh held, ${money(s.shares_value)}` : null} />
                <Tile label="Cash used (avg)" value={pct(s.avg_capital_used_pct, 0)} />
                <Tile label={`Hold ${run.meta?.ticker || TICKER}`} value={hold ? pct(hold.cagr_pct, 1) : '—'} sub={hold ? `max DD -${pct(hold.max_drawdown_pct, 0)}` : null} />
                <Tile label="Hold SPY" value={b.SPY_hold ? pct(b.SPY_hold.cagr_pct, 1) : '—'} sub={b.SPY_hold ? `max DD -${pct(b.SPY_hold.max_drawdown_pct, 0)}` : null} />
            </div>
            {s.covered_calls && (s.covered_calls.sold > 0 || run.params?.covered_calls?.enabled) && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-white border-2 border-[#0D2654]/10 p-3">
                    <Tile label="Covered calls sold" value={s.covered_calls.sold} sub={`${s.covered_calls.expired} expired · ${s.covered_calls.open} open`} />
                    <Tile label="Call premium" value={money(s.covered_calls.premium)} cls="text-green-700" />
                    <Tile label="Called away" value={s.covered_calls.called_away} />
                    <Tile label="Shares sold vs cost" value={money(s.covered_calls.realized_vs_cost)} cls={signColor(s.covered_calls.realized_vs_cost)} sub="call strike − assignment strike" />
                    <Tile label="Shares held now" value={s.shares_held || 0} sub={s.cost_basis_avg ? `cost ${money(s.cost_basis_avg)}` : null} />
                </div>
            )}
            <p className="text-xs text-gray-500">
                Prices: {pct(s.real_price_pct, 1)} real, the rest modelled (model off by ~{run.meta?.calibration?.holdout?.median_abs_pct ?? '—'}% on a typical day across all strikes).
                {' '}Skipped entries — no expiry in window: {s.skipped?.no_expiry}, return too low: {s.skipped?.low_return}, premium too small: {s.skipped?.low_premium ?? 0}, cash limit: {s.skipped?.capital}{s.skipped?.limit ? `, position limit: ${s.skipped.limit} days` : ''}.
            </p>
            <EquityChart run={run} />
            <div className="grid lg:grid-cols-2 gap-4">
                <Box title="By year">
                    <table className="w-full text-sm">
                        <thead><tr className="text-xs uppercase tracking-wider text-gray-400 border-b"><th className="text-left py-1">Year</th><th className="text-right">Return</th><th className="text-right">Max drawdown</th><th className="text-right">End value</th></tr></thead>
                        <tbody>
                            {run.by_year.map((y) => (
                                <tr key={y.year} className="border-b border-gray-100">
                                    <td className="py-1">{y.year}</td>
                                    <td className={`${td} ${signColor(y.return_pct)}`}>{pct(y.return_pct, 1)}</td>
                                    <td className={`${td} text-red-600`}>-{pct(y.max_drawdown_pct, 1)}</td>
                                    <td className={td}>{money(y.end_equity)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Box>
                <Box title={`Assignments (${run.assignments.length})`}>
                    {run.assignments.length === 0 ? <p className="text-sm text-gray-400">None.</p> : (
                        <table className="w-full text-sm">
                            <thead><tr className="text-xs uppercase tracking-wider text-gray-400 border-b"><th className="text-left py-1">Date</th><th className="text-right">Strike</th><th className="text-right">Price then</th><th className="text-right">Below strike</th><th className="text-right">Shares</th><th className="text-right">Back to strike</th></tr></thead>
                            <tbody>
                                {run.assignments.map((a, i) => (
                                    <tr key={i} className="border-b border-gray-100">
                                        <td className="py-1">{a.date}</td>
                                        <td className={td}>{px(a.strike)}</td>
                                        <td className={td}>{px(a.S)}</td>
                                        <td className={`${td} text-red-600`}>{pct(a.depth_pct, 0)}</td>
                                        <td className={td}>{a.shares}</td>
                                        <td className={td}>{a.recovered_on ? `${a.recover_days}d` : 'not yet'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Box>
            </div>
            {s.sold_at_recovery?.times > 0 && (
                <p className="text-sm text-gray-700">Assigned shares sold once back above cost: <strong>{s.sold_at_recovery.times}×</strong>, {money(s.sold_at_recovery.vs_cost)} vs cost.</p>
            )}
            {run.stock_events?.length > 0 && (
                <Box title={`Assigned shares sold (${run.stock_events.length})`}>
                    <table className="w-full text-sm">
                        <thead><tr className="text-xs uppercase tracking-wider text-gray-400 border-b"><th className="text-left py-1">Date</th><th className="text-right">Shares</th><th className="text-right">Sold at</th><th className="text-right">Price then</th><th className="text-right">Cost basis</th><th className="text-right">vs cost</th></tr></thead>
                        <tbody>
                            {run.stock_events.map((e, i) => (
                                <tr key={i} className="border-b border-gray-100">
                                    <td className="py-1">{e.date}</td>
                                    <td className={td}>{e.shares}</td>
                                    <td className={td}>{px(e.price)}</td>
                                    <td className={td}>{px(e.S)}</td>
                                    <td className={td}>{px(e.cost_basis)}</td>
                                    <td className={`${td} ${signColor(e.vs_cost)}`}>{money(e.vs_cost)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Box>
            )}
            <Box title={`Trades (${run.trades.length})`} right={run.trades.length > 60 && <button type="button" className="text-xs text-gray-500 hover:text-[#0D2654]" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show last 60' : 'Show all'}</button>}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-xs uppercase tracking-wider text-gray-400 border-b">
                                {['Opened', 'Type', 'Trigger', 'Expiry', 'Strike', 'Price then', 'Qty', 'Premium', 'Annual', 'Closed', 'Result', 'P&L'].map((h, i) => <th key={h} className={`py-1 px-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map((t) => (
                                <tr key={t.id} className="border-b border-gray-100">
                                    <td className="py-1 px-2 whitespace-nowrap">{t.opened}</td>
                                    <td className={`px-2 text-right text-xs font-semibold ${t.type === 'call' ? 'text-blue-700' : t.type === 'stock' ? 'text-purple-700' : 'text-[#0D2654]'}`}>{t.type === 'call' ? 'Call' : t.type === 'stock' ? 'Shares' : 'Put'}</td>
                                    <td className="px-2 text-right text-xs text-gray-500">{t.trigger}</td>
                                    <td className={td}>{t.expiry}</td>
                                    <td className={td}>{px(t.strike)}</td>
                                    <td className={td}>{px(t.S_entry)}</td>
                                    <td className={td}>{t.contracts}</td>
                                    <td className={td}>{px(t.entry_price)}{t.entry_source === 'real' && <span className="text-[10px] text-green-700"> real</span>}</td>
                                    <td className={td}>{pct(t.annual_return_pct, 1)}</td>
                                    <td className={td}>{t.closed || '—'}</td>
                                    <td className="px-2 text-right whitespace-nowrap">{REASON[t.reason] || t.reason}</td>
                                    <td className={`${td} font-semibold ${signColor(t.pnl)}`}>{money(t.pnl)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Box>
        </div>
    );
}

export function BacktestPage() {
    const queryClient = useQueryClient();
    const [form, setForm] = useState(DEFAULT_FORM);
    const [run, setRun] = useState(null);
    const [running, setRunning] = useState(false);
    const { data: runsData } = useApiQuery({ queryKey: ['backtest', 'runs'], queryFn: backtestApi.listRuns });
    const runs = runsData?.runs || [];

    const execute = async () => {
        setRunning(true);
        const res = await backtestApi.run({ name: form.name || undefined, ticker: TICKER, params: formToParams(form) });
        setRunning(false);
        if (res.error) return toast.error(res.error);
        setRun(res.data);
        toast.success(`Backtest done: ${pct(res.data.summary.cagr_pct, 1)} a year, max drawdown -${pct(res.data.summary.max_drawdown_pct, 1)}`);
        queryClient.invalidateQueries({ queryKey: ['backtest', 'runs'] });
    };
    const open = async (id) => {
        const res = await backtestApi.getRun(id);
        if (res.error) return toast.error(res.error);
        setRun(res.data);
        window.scrollTo({ top: document.body.scrollHeight / 3, behavior: 'smooth' });
    };
    const reuse = (r) => {
        setForm(paramsToForm(r.params, ''));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast.success(`Loaded the settings of "${r.name}"`);
    };
    const remove = async (id) => {
        const res = await backtestApi.deleteRun(id);
        if (res.error) return toast.error(res.error);
        if (run?.id === id) setRun(null);
        queryClient.invalidateQueries({ queryKey: ['backtest', 'runs'] });
    };
    useEffect(() => {
        if (!run && runs.length) open(runs[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runs.length]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Backtest</h1>
                <p className="text-sm text-gray-500">Replay a long-dated cash-secured put routine on {TICKER} over past years — with covered calls if assigned. Real option prices where they exist, a calibrated model before that.</p>
            </div>
            <DataPanel />
            <StrategyForm form={form} setForm={setForm} onRun={execute} running={running} />
            {run && (
                <div className="space-y-2">
                    <h2 className="text-lg font-bold text-[#0D2654]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{run.name}</h2>
                    <Results run={run} />
                </div>
            )}
            <Box title={`Saved runs (${runs.length})`}>
                {runs.length === 0 ? <p className="text-sm text-gray-400">No runs yet.</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-xs uppercase tracking-wider text-gray-400 border-b">
                                    {['Run', 'Period', 'Annual', 'Max DD', 'Trades', 'Won', 'Assigned', ''].map((h, i) => <th key={h || i} className={`py-1 px-2 ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {runs.map((r) => (
                                    <tr key={r.id} className={`border-b border-gray-100 ${run?.id === r.id ? 'bg-[#F06010]/5' : ''}`}>
                                        <td className="py-1 px-2"><button type="button" className="text-[#0D2654] font-medium hover:underline text-left" onClick={() => open(r.id)}>{r.name}</button></td>
                                        <td className="px-2 text-right whitespace-nowrap text-gray-500">{r.summary.start?.slice(0, 7)} → {r.summary.end?.slice(0, 7)}</td>
                                        <td className={`px-2 text-right font-mono ${signColor(r.summary.cagr_pct)}`}>{pct(r.summary.cagr_pct, 1)}</td>
                                        <td className="px-2 text-right font-mono text-red-600">-{pct(r.summary.max_drawdown_pct, 1)}</td>
                                        <td className="px-2 text-right font-mono">{r.summary.trades}</td>
                                        <td className="px-2 text-right font-mono">{pct(r.summary.win_rate_pct, 0)}</td>
                                        <td className="px-2 text-right font-mono">{r.summary.assignments}</td>
                                        <td className="px-2 text-right whitespace-nowrap space-x-1">
                                            <button type="button" title="Reuse these settings" onClick={() => reuse(r)} className="p-1 text-gray-500 hover:text-[#0D2654]"><RotateCcw className="w-4 h-4" /></button>
                                            <button type="button" title="Delete" onClick={() => remove(r.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Box>
            <p className="text-xs text-gray-400 flex items-center gap-1"><History className="w-3.5 h-3.5" /> Backtests use daily closes, fills at the price minus slippage, and no early assignment. Past results — especially modelled ones — don&apos;t guarantee future returns.</p>
        </div>
    );
}
