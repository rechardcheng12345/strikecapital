import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellRing, Plus, Search, Pencil, Trash2, EyeOff, Eye, FlaskConical } from 'lucide-react';
import { optionAlertApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Input, Modal, EmptyState, ErrorAlert, Skeleton } from '../../components/ui';
import { money, pct, shortDate, OpenTradeModal } from './simShared';

const DEFAULTS = { name: '', tickers: '', min_dte: 450, max_dte: 500, listed_within_days: 7 };

function parseTickers(text) {
    return [...new Set(String(text).split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))];
}

function AlertFormModal({ isOpen, onClose, alert, onSaved }) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState(DEFAULTS);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (!isOpen) return;
        setForm(alert
            ? { name: alert.name, tickers: alert.tickers.join(', '), min_dte: alert.min_dte, max_dte: alert.max_dte, listed_within_days: alert.listed_within_days }
            : DEFAULTS);
        setError(null);
    }, [isOpen, alert]);
    const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const tickers = parseTickers(form.tickers);
    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        if (!form.name.trim()) return setError('Name is required');
        if (!tickers.length) return setError('Add at least one ticker');
        const body = {
            name: form.name.trim(), tickers,
            min_dte: Number(form.min_dte), max_dte: Number(form.max_dte), listed_within_days: Number(form.listed_within_days),
        };
        if (!(body.max_dte >= body.min_dte)) return setError('Max days must be ≥ min days');
        setSaving(true);
        const res = alert ? await optionAlertApi.update(alert.id, body) : await optionAlertApi.create(body);
        setSaving(false);
        if (res.error) return setError(res.error);
        toast.success(alert ? 'Alert updated' : `Alert "${res.data.name}" created — press Check to pull the options`);
        queryClient.invalidateQueries({ queryKey: ['option-alerts'] });
        onSaved?.(res.data);
        onClose();
    };
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={alert ? 'Edit alert' : 'New option alert'}>
            <form onSubmit={submit} className="space-y-4">
                {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3">{error}</div>}
                <Input label="Name" value={form.name} onChange={set('name')} placeholder="e.g. LEAPS new listings" />
                <div>
                    <Input label="Tickers (comma or space separated)" value={form.tickers} onChange={set('tickers')} placeholder="SOXL, TSLA, NVDA" />
                    {tickers.length > 0 && <p className="mt-1 text-xs text-gray-500">{tickers.length} ticker(s): {tickers.join(' · ')}</p>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Input label="Expiry from (days)" type="number" min={0} value={form.min_dte} onChange={set('min_dte')} />
                    <Input label="to (days)" type="number" min={0} value={form.max_dte} onChange={set('max_dte')} />
                    <Input label="Listed within (days)" type="number" min={1} value={form.listed_within_days} onChange={set('listed_within_days')} />
                </div>
                <p className="text-xs text-gray-500">Puts only. Shows new expiries and new strikes in the window. Changing tickers later forgets what the removed tickers had.</p>
                <div className="flex justify-end gap-2 pt-2">
                    <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                    <Button type="submit" size="sm" loading={saving}>{alert ? 'Save' : 'Create'}</Button>
                </div>
            </form>
        </Modal>
    );
}

function KindBadge({ kind }) {
    if (kind === 'expiry') return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-accent/15 text-accent">New expiry</span>;
    if (kind === 'strike') return <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-800">New strike</span>;
    return null;
}

function CheckInfo({ alert, lastCheck }) {
    const info = lastCheck || alert.last_check_info;
    if (!info) return <p className="text-sm text-gray-500">Not checked yet. Press <strong>Check</strong> to pull every put in the window from Moomoo.</p>;
    const expiries = Object.entries(info.expiries || {});
    const errors = Object.entries(info.errors || {});
    return (
        <div className="text-xs text-gray-600 space-y-1">
            <p>
                Last check {new Date(info.checked_at).toLocaleString()} · {info.contracts} puts in the window
                {' · '}{info.with_listing_date ? `${info.with_listing_date} with a Moomoo listing date` : 'Moomoo gave no listing dates'}
                {info.new_contracts ? ` · ${info.new_contracts} first seen this check` : ''}
            </p>
            {expiries.length > 0 && (
                <p>Expiries in window: {expiries.map(([t, list]) => `${t} ${list.length ? list.map(shortDate).join(', ') : '— none'}`).join(' · ')}</p>
            )}
            {info.baseline > 0 && !info.with_listing_date && (
                <p className="text-amber-700">
                    {info.baseline} put(s) recorded as the starting point. Without Moomoo listing dates, anything listed after this shows up on your next Check.
                </p>
            )}
            {errors.length > 0 && <p className="text-red-600">Errors: {errors.map(([t, m]) => `${t}: ${m}`).join(' · ')}</p>}
        </div>
    );
}

function ResultsTable({ rows, onTrade, onDismiss, dismissed = false }) {
    const td = 'px-2 py-2 text-right font-mono whitespace-nowrap';
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-400 border-b border-ink/10">
                        {['Contract', 'Listed', 'Stock', 'Below', 'Bid / Ask', 'Mid', 'Premium', 'Return', 'Annual', 'Δ', 'IV', 'OI', 'Spread', ''].map((h, i) => (
                            <th key={h || i} className={`px-2 py-2 font-medium ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((r) => (
                        <tr key={r.id} className={`border-b border-gray-100 ${dismissed ? 'opacity-60' : ''}`}>
                            <td className="px-2 py-2 whitespace-nowrap">
                                <div className="font-semibold text-ink">{r.ticker} ${r.strike}P</div>
                                <div className="text-xs text-gray-500">{shortDate(r.expiry)} · {r.dte}d</div>
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">
                                <KindBadge kind={r.new_kind} />
                                <div className="text-xs text-gray-500 mt-0.5" title={r.new_source === 'moomoo' ? 'Listing date from Moomoo' : 'First seen by a Check (no Moomoo listing date)'}>
                                    {shortDate(r.new_on)} · {r.new_source === 'moomoo' ? 'Moomoo' : 'first seen'}
                                </div>
                            </td>
                            <td className={td}>{money(r.stock_price)}</td>
                            <td className={td}>{r.below_pct != null ? pct(r.below_pct, 1) : '—'}</td>
                            <td className={td}>{r.bid != null ? `${money(r.bid)} / ${money(r.ask)}` : '—'}</td>
                            <td className={td}>{money(r.mid)}{r.mid_source === 'last' && <span className="text-[10px] text-gray-400"> last</span>}</td>
                            <td className={`${td} font-semibold text-green-700`}>{money(r.premium)}</td>
                            <td className={td}>{pct(r.return_pct)}</td>
                            <td className={`${td} text-blue-700`}>{pct(r.annual_pct, 1)}</td>
                            <td className={td}>{r.delta != null ? Math.abs(r.delta).toFixed(2) : '—'}</td>
                            <td className={td}>{r.implied_volatility != null ? `${Number(r.implied_volatility).toFixed(0)}%` : '—'}</td>
                            <td className={td}>{r.open_interest ?? '—'}</td>
                            <td className={`${td} ${r.spread_pct > 15 ? 'text-red-600' : ''}`}>{r.spread_pct != null ? pct(r.spread_pct, 0) : '—'}</td>
                            <td className="px-2 py-2 text-right whitespace-nowrap space-x-1">
                                {!dismissed && (
                                    <button type="button" onClick={() => onTrade(r)} title="Paper trade" className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-ink/40 text-ink hover:bg-ink hover:text-white">
                                        <FlaskConical className="w-3.5 h-3.5" /> Sim
                                    </button>
                                )}
                                <button type="button" onClick={() => onDismiss(r, !dismissed)} title={dismissed ? 'Show again' : 'Dismiss'} className="inline-flex items-center px-2 py-1 text-xs text-gray-500 hover:text-ink">
                                    {dismissed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function AlertDetail({ alertId, onEdit, onDeleted }) {
    const queryClient = useQueryClient();
    const { data, isLoading, isError, error, refetch } = useApiQuery({ queryKey: ['option-alerts', alertId], queryFn: () => optionAlertApi.get(alertId) });
    const [checking, setChecking] = useState(false);
    const [lastCheck, setLastCheck] = useState(null);
    const [showDismissed, setShowDismissed] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [tradeRow, setTradeRow] = useState(null);
    useEffect(() => {
        setLastCheck(null);
        setConfirmDelete(false);
        setShowDismissed(false);
    }, [alertId]);

    const prefill = useMemo(() => tradeRow && ({
        ticker: tradeRow.ticker,
        strike: tradeRow.strike,
        expiration_date: tradeRow.expiry,
        fallback_price: tradeRow.mid ?? null,
        entry_context: {
            source: 'option_alert', listing: tradeRow.new_kind, listed_on: tradeRow.new_on, listed_source: tradeRow.new_source,
            delta: tradeRow.delta, iv: tradeRow.implied_volatility, days_to_expiry: tradeRow.dte, annual_return_pct: tradeRow.annual_pct,
            open_interest: tradeRow.open_interest, spread_pct: tradeRow.spread_pct, stock_price: tradeRow.stock_price,
        },
    }), [tradeRow]);

    if (isLoading) return <Skeleton height={240} />;
    if (isError) return <ErrorAlert message={error?.message} onRetry={refetch} />;
    const { alert, results, dismissed } = data;

    const check = async () => {
        setChecking(true);
        const res = await optionAlertApi.check(alert.id);
        setChecking(false);
        if (res.error) return toast.error(res.error);
        setLastCheck(res.data.check);
        toast.success(`${res.data.results.length} new listing(s) within ${alert.listed_within_days} days`);
        queryClient.setQueryData(['option-alerts', alert.id], res.data);
        queryClient.invalidateQueries({ queryKey: ['option-alerts', 'list'] });
    };
    const dismiss = async (row, value) => {
        const res = await optionAlertApi.setDismissed(row.id, value);
        if (res.error) return toast.error(res.error);
        queryClient.invalidateQueries({ queryKey: ['option-alerts'] });
    };
    const remove = async () => {
        const res = await optionAlertApi.delete(alert.id);
        if (res.error) return toast.error(res.error);
        toast.success(`Deleted "${alert.name}"`);
        queryClient.invalidateQueries({ queryKey: ['option-alerts'] });
        onDeleted();
    };

    return (
        <div className="space-y-4">
            <section className="bg-white border border-ink/10 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-ink" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{alert.name}</h2>
                        <p className="text-sm text-gray-600">
                            Puts expiring in <strong>{alert.min_dte}–{alert.max_dte} days</strong>, listed within <strong>{alert.listed_within_days} days</strong>
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">{alert.tickers.join(' · ')}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={check} loading={checking}><Search className="w-4 h-4 mr-1.5" />{checking ? 'Checking Moomoo…' : 'Check'}</Button>
                        <Button variant="outline" size="sm" onClick={() => onEdit(alert)}><Pencil className="w-4 h-4 mr-1.5" />Edit</Button>
                        {confirmDelete ? (
                            <>
                                <Button variant="danger" size="sm" onClick={remove}>Delete</Button>
                                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Keep</Button>
                            </>
                        ) : (
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}><Trash2 className="w-4 h-4" /></Button>
                        )}
                    </div>
                </div>
                {checking && <p className="text-xs text-gray-500">Moomoo allows about 10 option-chain requests per 30 seconds, so many tickers can take a minute.</p>}
                <CheckInfo alert={alert} lastCheck={lastCheck} />
            </section>

            <section className="bg-white border border-ink/10 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-ink uppercase tracking-wider">New listings ({results.length})</h3>
                    {dismissed.length > 0 && (
                        <button type="button" className="text-xs text-gray-500 hover:text-ink" onClick={() => setShowDismissed((v) => !v)}>
                            {showDismissed ? 'Hide' : 'Show'} dismissed ({dismissed.length})
                        </button>
                    )}
                </div>
                {results.length === 0
                    ? <p className="text-sm text-gray-400 text-center py-8">Nothing newly listed within {alert.listed_within_days} days{alert.last_checked_at ? ' as of the last check' : ''}.</p>
                    : <ResultsTable rows={results} onTrade={setTradeRow} onDismiss={dismiss} />}
                {showDismissed && dismissed.length > 0 && (
                    <div className="mt-4">
                        <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">Dismissed</p>
                        <ResultsTable rows={dismissed} onTrade={setTradeRow} onDismiss={dismiss} dismissed />
                    </div>
                )}
            </section>
            <OpenTradeModal isOpen={!!tradeRow} onClose={() => setTradeRow(null)} prefill={prefill} />
        </div>
    );
}

export function OptionAlertsPage() {
    const { data, isLoading, isError, error, refetch } = useApiQuery({ queryKey: ['option-alerts', 'list'], queryFn: optionAlertApi.list });
    const alerts = data?.alerts || [];
    const [selectedId, setSelectedId] = useState(null);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    useEffect(() => {
        if (!selectedId && alerts.length) setSelectedId(alerts[0].id);
        if (selectedId && alerts.length && !alerts.some((a) => a.id === selectedId)) setSelectedId(alerts[0].id);
    }, [alerts, selectedId]);

    const openNew = () => {
        setEditing(null);
        setFormOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Option Alerts</h1>
                    <p className="text-sm text-gray-500">Newly listed puts — new expiries and new strikes — in the expiry window you choose. Press Check to pull from Moomoo.</p>
                </div>
                <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />New alert</Button>
            </div>

            {isError && <ErrorAlert message={error?.message} onRetry={refetch} />}
            {isLoading && <Skeleton height={200} />}
            {!isLoading && alerts.length === 0 && (
                <EmptyState
                    icon={BellRing}
                    title="No option alerts yet"
                    description="Create one with your tickers and an expiry window, e.g. 450–500 days, then press Check."
                    action={<Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1.5" />New alert</Button>}
                />
            )}

            {alerts.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="space-y-2">
                        {alerts.map((a) => (
                            <button
                                key={a.id}
                                type="button"
                                onClick={() => setSelectedId(a.id)}
                                className={`w-full text-left border p-3 transition-colors ${a.id === selectedId ? 'border-accent bg-accent/5' : 'border-ink/10 bg-white hover:border-ink/30'}`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-semibold text-ink truncate">{a.name}</span>
                                    {a.new_count > 0 && <span className="shrink-0 px-2 py-0.5 text-xs font-bold bg-accent text-white">{a.new_count}</span>}
                                </div>
                                <p className="text-xs text-gray-500 mt-0.5">{a.min_dte}–{a.max_dte}d · within {a.listed_within_days}d · {a.tickers.length} ticker(s)</p>
                                <p className="text-[11px] text-gray-400">{a.last_checked_at ? `Checked ${new Date(a.last_checked_at).toLocaleString()}` : 'Never checked'}</p>
                            </button>
                        ))}
                    </div>
                    <div className="min-w-0 lg:col-span-3">
                        {selectedId && (
                            <AlertDetail
                                alertId={selectedId}
                                onEdit={(a) => {
                                    setEditing(a);
                                    setFormOpen(true);
                                }}
                                onDeleted={() => setSelectedId(null)}
                            />
                        )}
                    </div>
                </div>
            )}

            <AlertFormModal isOpen={formOpen} onClose={() => setFormOpen(false)} alert={editing} onSaved={(a) => setSelectedId(a.id)} />
        </div>
    );
}
