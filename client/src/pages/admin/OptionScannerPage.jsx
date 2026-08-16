import React, { useState, useRef, useCallback } from 'react';
import { Search, Plus, X, ScanLine, AlertTriangle, ChevronDown, ChevronUp, Sparkles, Square } from 'lucide-react';
import { scannerApi, positionApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input, Skeleton, ErrorAlert } from '../../components/ui';
import { OptionScannerDetailPanel } from './OptionScannerDetailPanel';

function formatCurrency(v) {
    if (v == null) return '—';
    return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPct(v) {
    if (v == null) return '—';
    return Number(v).toFixed(2) + '%';
}
function formatNum(v, dec = 4) {
    if (v == null) return '—';
    return Number(v).toFixed(dec);
}
function scoreColor(score) {
    if (score >= 70) return 'text-green-600 font-semibold';
    if (score >= 50) return 'text-yellow-600 font-semibold';
    return 'text-gray-400';
}
function deltaColor(delta) {
    if (delta == null) return 'text-gray-500';
    const abs = Math.abs(delta);
    if (abs <= 0.20) return 'text-green-600';
    if (abs <= 0.30) return 'text-yellow-600';
    return 'text-red-600';
}

const HUNT_COLUMNS = [
    { key: 'score', label: 'Score' },
    { key: 'ticker', label: 'Symbol', sub: 'Stock $' },
    { key: 'strike', label: 'Strike', sub: 'Disc%' },
    { key: 'days_to_expiry', label: 'DTE' },
    { key: 'mid', label: 'Premium' },
    { key: 'return_pct', label: 'Return' },
    { key: 'delta', label: 'Delta' },
];

export function OptionScannerPage() {
    const queryClient = useQueryClient();
    const [newTicker, setNewTicker] = useState('');
    const [addingTicker, setAddingTicker] = useState(false);

    const [params, setParams] = useState({
        minDays: 14, maxDays: 28,
        minDiscount: 10, maxDiscount: 20,
        minDelta: 0, maxDelta: 1,
        minReturn: 0, minOI: 0,
        maxSpread: 0,
        targetDelta: 0.16,
    });
    const [scanning, setScanning] = useState(false);
    const [scanComplete, setScanComplete] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, ticker: null });
    const [scanResults, setScanResults] = useState(null);
    const [scanWarnings, setScanWarnings] = useState([]);
    const [addingPosition, setAddingPosition] = useState(null);
    const [addedPositions, setAddedPositions] = useState(new Set());
    const [sortKey, setSortKey] = useState('score');
    const [sortDir, setSortDir] = useState('desc');
    const [analyzing, setAnalyzing] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState(null);
    const [aiFormat, setAiFormat] = useState(null);
    const [aiError, setAiError] = useState(null);
    const [selectedCode, setSelectedCode] = useState(null);
    const [tickerLevels, setTickerLevels] = useState({});
    const scanGenRef = useRef(0);
    const levelsRef = useRef({});

    const ensureLevels = useCallback(async (ticker) => {
        const existing = levelsRef.current[ticker];
        if (existing?.data || existing?.loading) return;
        levelsRef.current[ticker] = { loading: true, data: null, error: null };
        setTickerLevels({ ...levelsRef.current });
        try {
            const response = await scannerApi.getLevels(ticker);
            const data = response.data || response;
            if (data.error || response.error) {
                levelsRef.current[ticker] = { loading: false, data: null, error: data.error || response.error };
            } else {
                levelsRef.current[ticker] = { loading: false, data, error: null };
            }
        } catch (err) {
            levelsRef.current[ticker] = { loading: false, data: null, error: err.message || 'Failed' };
        }
        setTickerLevels({ ...levelsRef.current });
    }, []);

    function handleSort(key) {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    }

    const { data: watchlistData, isLoading: watchlistLoading, isError: watchlistError, error: wlError, refetch: refetchWatchlist } = useApiQuery({
        queryKey: ['admin', 'scanner', 'watchlist'],
        queryFn: () => scannerApi.getWatchlist(),
    });

    const tickers = watchlistData?.tickers || [];

    async function handleAddTicker(e) {
        e.preventDefault();
        const ticker = newTicker.trim().toUpperCase();
        if (!ticker) return;
        setAddingTicker(true);
        try {
            await scannerApi.addTicker(ticker);
            setNewTicker('');
            queryClient.invalidateQueries({ queryKey: ['admin', 'scanner', 'watchlist'] });
            toast.success(`${ticker} added to watchlist`);
        } catch (err) {
            toast.error(err.message || 'Failed to add ticker');
        } finally {
            setAddingTicker(false);
        }
    }

    async function handleRemoveTicker(ticker) {
        try {
            await scannerApi.removeTicker(ticker);
            queryClient.invalidateQueries({ queryKey: ['admin', 'scanner', 'watchlist'] });
            toast.success(`${ticker} removed`);
        } catch (err) {
            toast.error(err.message || 'Failed to remove ticker');
        }
    }

    async function handleAnalyze() {
        if (!scanResults?.results?.length || scanning) return;
        setAnalyzing(true);
        setAiAnalysis(null);
        setAiFormat(null);
        setAiError(null);
        try {
            const response = await scannerApi.analyze(scanResults.results, scanResults.stock_prices || {}, params);
            const data = response.data || {};
            if (data.error || response.error) setAiError(data.error || response.error);
            else {
                setAiAnalysis(data.analysis);
                setAiFormat(data.format || 'text');
            }
        } catch (err) {
            setAiError(err.message || 'Analysis failed');
        } finally {
            setAnalyzing(false);
        }
    }

    function handleStopScan() {
        scanGenRef.current += 1;
        setScanning(false);
        setScanComplete(true);
        setScanProgress(p => ({ ...p, ticker: null }));
    }

    async function handleScan() {
        if (scanning || tickers.length === 0) return;
        const gen = ++scanGenRef.current;
        setScanning(true);
        setScanComplete(false);
        setScanResults({ results: [], stock_prices: {}, debug: {} });
        setScanWarnings([]);
        setAiAnalysis(null);
        setAiError(null);
        setSelectedCode(null);
        setScanProgress({ current: 0, total: tickers.length, ticker: null });

        const merged = { results: [], stock_prices: {}, debug: {} };

        for (let i = 0; i < tickers.length; i++) {
            if (scanGenRef.current !== gen) break;
            const ticker = tickers[i].ticker;
            setScanProgress({ current: i + 1, total: tickers.length, ticker });
            try {
                const response = await scannerApi.scan({ ...params, tickers: [ticker] });
                if (scanGenRef.current !== gen) break;
                const data = response.data || {};
                if (response.error && !data.results) {
                    setScanWarnings(w => [...w, `${ticker}: ${response.error}`]);
                    continue;
                }
                if (data.error) {
                    setScanWarnings(w => [...w, `${ticker}: ${data.error}`]);
                }
                merged.results = [...merged.results, ...(data.results || [])];
                merged.stock_prices = { ...merged.stock_prices, ...(data.stock_prices || {}) };
                merged.debug = { ...merged.debug, ...(data.debug || {}) };
                setScanResults({
                    results: [...merged.results],
                    stock_prices: { ...merged.stock_prices },
                    debug: { ...merged.debug },
                });
            } catch (err) {
                if (scanGenRef.current !== gen) break;
                setScanWarnings(w => [...w, `${ticker}: ${err.message || 'Failed'}`]);
            }
        }

        if (scanGenRef.current === gen) {
            setScanning(false);
            setScanComplete(true);
            setScanProgress(p => ({ ...p, ticker: null }));
        }
    }

    async function handleAddToMonitoring(row) {
        setAddingPosition(row.option_code);
        try {
            const pricePerShare = row.mid ?? row.premium;
            await positionApi.create({
                ticker: `${row.ticker} PUT`,
                position_type: 'option',
                status: 'MONITORING',
                strike_price: row.strike,
                expiration_date: row.expiry,
                premium_received: Math.round(pricePerShare * 100 * 100) / 100,
                contracts: 1,
                commission: 0,
                platform_fee: 0,
            });
            setAddedPositions(prev => new Set(prev).add(row.option_code));
            toast.success(`${row.ticker} $${row.strike} PUT added to Monitoring`);
        } catch (err) {
            toast.error(err.message || 'Failed to add position');
        } finally {
            setAddingPosition(null);
        }
    }

    const rawResults = scanResults?.results || [];
    const results = [...rawResults].sort((a, b) => {
        const av = a[sortKey] ?? -Infinity;
        const bv = b[sortKey] ?? -Infinity;
        if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        return sortDir === 'asc' ? av - bv : bv - av;
    });

    const selectedRow = results.find(r => r.option_code === selectedCode) || null;

    function handleRowClick(row) {
        setSelectedCode(prev => prev === row.option_code ? null : row.option_code);
    }

    return (
        <div>
            <h1 className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                <ScanLine className="w-6 h-6 text-[#F06010]" />
                Option Scanner
            </h1>

            <div className="space-y-4 mb-6">
                <div className="border-2 border-[#0D2654]/20 bg-white p-5">
                    <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider mb-3">Watchlist</h2>
                    <form onSubmit={handleAddTicker} className="flex gap-2 mb-3 max-w-sm">
                        <Input
                            value={newTicker}
                            onChange={e => setNewTicker(e.target.value.toUpperCase())}
                            placeholder="Add ticker..."
                            className="flex-1 text-sm"
                        />
                        <button
                            type="submit"
                            disabled={addingTicker || !newTicker.trim()}
                            className="px-3 py-2 bg-[#0D2654] text-white text-sm font-medium hover:bg-[#0D2654]/90 disabled:opacity-50 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </form>

                    {watchlistLoading ? (
                        <div className="flex gap-2">
                            {[1, 2, 3].map(i => <Skeleton key={i} variant="text" height={32} />)}
                        </div>
                    ) : watchlistError ? (
                        <ErrorAlert message={wlError?.message || 'Failed to load watchlist'} onRetry={refetchWatchlist} />
                    ) : tickers.length === 0 ? (
                        <p className="text-sm text-gray-400">No tickers yet. Add some above.</p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {tickers.map(t => (
                                <div key={t.ticker} className="flex items-center gap-2 px-3 py-1.5 bg-[#F5F3EF] border border-[#0D2654]/10">
                                    <span className="text-sm font-medium text-[#0D2654]">{t.ticker}</span>
                                    <button
                                        onClick={() => handleRemoveTicker(t.ticker)}
                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="border-2 border-[#0D2654]/20 bg-white p-5">
                    <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider mb-4">Scan Parameters</h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-5 gap-y-4 mb-5">
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Days to expiry</label>
                            <div className="flex items-center gap-2">
                                <Input type="number" value={params.minDays} onChange={e => setParams(p => ({ ...p, minDays: parseInt(e.target.value) || 0 }))} min={1} className="w-full" />
                                <span className="text-gray-400 text-xs shrink-0">to</span>
                                <Input type="number" value={params.maxDays} onChange={e => setParams(p => ({ ...p, maxDays: parseInt(e.target.value) || 0 }))} min={1} className="w-full" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Discount %</label>
                            <div className="flex items-center gap-2">
                                <Input type="number" value={params.minDiscount} onChange={e => setParams(p => ({ ...p, minDiscount: parseFloat(e.target.value) || 0 }))} min={0} step={0.5} className="w-full" />
                                <span className="text-gray-400 text-xs shrink-0">to</span>
                                <Input type="number" value={params.maxDiscount} onChange={e => setParams(p => ({ ...p, maxDiscount: parseFloat(e.target.value) || 0 }))} min={0} step={0.5} className="w-full" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">|Delta|</label>
                            <div className="flex items-center gap-2">
                                <Input type="number" value={params.minDelta} onChange={e => setParams(p => ({ ...p, minDelta: parseFloat(e.target.value) || 0 }))} min={0} max={1} step={0.05} className="w-full" />
                                <span className="text-gray-400 text-xs shrink-0">to</span>
                                <Input type="number" value={params.maxDelta} onChange={e => setParams(p => ({ ...p, maxDelta: parseFloat(e.target.value) || 1 }))} min={0} max={1} step={0.05} className="w-full" />
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min return %</label>
                            <Input type="number" value={params.minReturn} onChange={e => setParams(p => ({ ...p, minReturn: parseFloat(e.target.value) || 0 }))} min={0} step={0.1} className="w-full" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min open interest</label>
                            <Input type="number" value={params.minOI} onChange={e => setParams(p => ({ ...p, minOI: parseInt(e.target.value) || 0 }))} min={0} className="w-full" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">
                                Max spread % <span className="text-gray-400">(0 = off)</span>
                            </label>
                            <Input type="number" value={params.maxSpread} onChange={e => setParams(p => ({ ...p, maxSpread: parseFloat(e.target.value) || 0 }))} min={0} step={1} className="w-full" />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">
                                Target |Δ| <span className="text-gray-400">(0.16 ≈ 14% assign)</span>
                            </label>
                            <Input type="number" value={params.targetDelta} onChange={e => setParams(p => ({ ...p, targetDelta: parseFloat(e.target.value) || 0 }))} min={0.05} max={0.50} step={0.01} className="w-full" />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                        {scanning ? (
                            <button
                                onClick={handleStopScan}
                                className="flex items-center gap-2 px-6 py-2.5 bg-[#0D2654] text-white font-medium text-sm hover:bg-[#0D2654]/90 transition-colors"
                            >
                                <Square className="w-4 h-4" />
                                Stop Scan
                            </button>
                        ) : (
                            <button
                                onClick={handleScan}
                                disabled={tickers.length === 0}
                                className="flex items-center gap-2 px-6 py-2.5 bg-[#F06010] text-white font-medium text-sm hover:bg-[#F06010]/90 disabled:opacity-50 transition-colors"
                            >
                                <Search className="w-4 h-4" />
                                Run Scan
                            </button>
                        )}
                        {scanning && scanProgress.total > 0 && (
                            <p className="text-sm text-gray-600">
                                {scanProgress.current} / {scanProgress.total}
                                {scanProgress.ticker ? ` — scanning ${scanProgress.ticker}` : ''}
                            </p>
                        )}
                    </div>
                    {tickers.length === 0 && (
                        <p className="text-xs text-gray-400 mt-2">Add tickers to the watchlist before scanning.</p>
                    )}
                </div>
            </div>

            {scanWarnings.length > 0 && (
                <div className="mb-4 p-4 border-2 border-yellow-400 bg-yellow-50 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-yellow-800">Scanner Warning</p>
                        <ul className="text-sm text-yellow-700 list-disc pl-4">
                            {scanWarnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                    </div>
                </div>
            )}

            {scanResults && (
                <div className="border-2 border-[#0D2654]/20 bg-white">
                    <div className="px-5 py-3 border-b border-[#0D2654]/10 flex items-center justify-between gap-4">
                        <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider whitespace-nowrap">
                            Results ({results.length} options found)
                            {scanning ? ' · scanning…' : ''}
                        </h2>
                        <button
                            onClick={handleAnalyze}
                            disabled={analyzing || scanning || !scanComplete || results.length === 0}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0D2654] text-white text-xs font-medium hover:bg-[#0D2654]/80 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                            <Sparkles className="w-3.5 h-3.5" />
                            {analyzing ? 'Analyzing...' : 'Analyze with AI'}
                        </button>
                    </div>

                    <div className="flex flex-col md:flex-row">
                        <div className="flex-1 min-w-0">
                            {results.length === 0 ? (
                                <div className="py-8 px-5">
                                    <p className="text-sm text-gray-500 text-center mb-4">
                                        {scanning ? 'Waiting for the first ticker…' : 'No options matched your criteria.'}
                                    </p>
                                    {!scanning && Object.keys(scanResults.debug || {}).length > 0 && (
                                        <div className="text-xs border border-gray-200 bg-gray-50 p-3 max-w-3xl mx-auto">
                                            <p className="font-semibold text-gray-600 mb-2">Debug Info</p>
                                            <pre className="overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap text-gray-700">
                                                {JSON.stringify(scanResults.debug ?? {}, null, 2)}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-[#0D2654]/5 text-left">
                                                {HUNT_COLUMNS.map(col => (
                                                    <th
                                                        key={col.key}
                                                        onClick={() => handleSort(col.key)}
                                                        className="px-3 py-3 text-xs font-semibold text-[#0D2654] uppercase tracking-wider cursor-pointer select-none hover:bg-[#0D2654]/10 transition-colors text-left align-top"
                                                    >
                                                        <div className="flex flex-col leading-tight">
                                                            <span className="inline-flex items-center gap-1">
                                                                {col.label}
                                                                {sortKey === col.key && (
                                                                    sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-[#F06010]" /> : <ChevronDown className="w-3 h-3 text-[#F06010]" />
                                                                )}
                                                            </span>
                                                            {col.sub && (
                                                                <span className="text-[9px] font-normal text-gray-400 tracking-normal normal-case mt-0.5">{col.sub}</span>
                                                            )}
                                                        </div>
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[#0D2654]/10">
                                            {results.map((row) => {
                                                const selected = selectedCode === row.option_code;
                                                const added = addedPositions.has(row.option_code);
                                                const premium = row.mid != null ? row.mid * 100 : (row.premium != null ? row.premium * 100 : null);
                                                return (
                                                    <tr
                                                        key={row.option_code}
                                                        onClick={() => handleRowClick(row)}
                                                        className={`cursor-pointer transition-colors ${selected ? 'bg-[#F06010]/10' : added ? 'bg-green-50' : 'hover:bg-[#F5F3EF]'}`}
                                                    >
                                                        <td className="px-3 py-3 align-top">
                                                            <span className={`${scoreColor(row.score)} text-base`}>{row.score ?? '—'}</span>
                                                        </td>
                                                        <td className="px-3 py-3 align-top whitespace-nowrap">
                                                            <div className="font-semibold text-[#0D2654]">{row.ticker}</div>
                                                            <div className="text-[10px] text-gray-500">{formatCurrency(row.stock_price)}</div>
                                                        </td>
                                                        <td className="px-3 py-3 align-top whitespace-nowrap">
                                                            <div className="font-medium text-[#0D2654]">{formatCurrency(row.strike)}</div>
                                                            <div className="text-[10px] text-orange-600 font-medium">{formatPct(row.discount_pct)}</div>
                                                        </td>
                                                        <td className="px-3 py-3 align-top whitespace-nowrap">
                                                            <div className="font-medium text-[#0D2654]">{row.days_to_expiry}d</div>
                                                        </td>
                                                        <td className="px-3 py-3 align-top whitespace-nowrap">
                                                            <div className="font-semibold text-green-700">{premium != null ? formatCurrency(premium) : '—'}</div>
                                                        </td>
                                                        <td className="px-3 py-3 align-top whitespace-nowrap">
                                                            <div className="font-medium text-blue-600">{row.return_pct != null ? row.return_pct.toFixed(2) + '%' : '—'}</div>
                                                        </td>
                                                        <td className="px-3 py-3 align-top whitespace-nowrap">
                                                            <div className={`font-semibold ${deltaColor(row.delta)}`}>
                                                                {row.delta != null ? formatNum(Math.abs(row.delta), 3) : '—'}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {selectedRow && (
                            <OptionScannerDetailPanel
                                row={selectedRow}
                                onClose={() => setSelectedCode(null)}
                                levelsState={tickerLevels[selectedRow.ticker]}
                                onNeedLevels={ensureLevels}
                                added={addedPositions.has(selectedRow.option_code)}
                                adding={addingPosition === selectedRow.option_code}
                                onAddToMonitoring={handleAddToMonitoring}
                            />
                        )}
                    </div>

                    {(aiAnalysis || aiError || analyzing) && (
                        <div className="border-t-2 border-[#0D2654]/10 px-5 py-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Sparkles className="w-4 h-4 text-[#F06010]" />
                                <h3 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider">AI Analysis</h3>
                            </div>
                            {analyzing && (
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                    <span className="inline-block w-4 h-4 border-2 border-[#F06010] border-t-transparent rounded-full animate-spin"></span>
                                    Analyzing {results.length} options with AI...
                                </div>
                            )}
                            {aiError && (
                                <div className="p-3 bg-red-50 border border-red-200 text-sm text-red-700">
                                    {aiError}
                                </div>
                            )}
                            {aiAnalysis && aiFormat === 'structured' && typeof aiAnalysis === 'object' ? (
                                <div className="space-y-4">
                                    {aiAnalysis.market_outlook && (
                                        <div className="bg-[#0D2654]/5 border border-[#0D2654]/15 px-4 py-3 text-sm text-[#0D2654]">
                                            <span className="font-semibold text-xs uppercase tracking-wider text-[#0D2654]/60 block mb-1">Market Outlook</span>
                                            {aiAnalysis.market_outlook}
                                        </div>
                                    )}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {(aiAnalysis.picks || []).map((pick, i) => {
                                            const verdictStyles = {
                                                BUY: 'bg-green-600 text-white',
                                                WATCH: 'bg-yellow-500 text-white',
                                                SKIP: 'bg-gray-400 text-white',
                                            };
                                            return (
                                                <div key={i} className="border border-[#0D2654]/15 bg-white">
                                                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#0D2654]/10 bg-[#F5F3EF]">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-[#0D2654] text-sm">{pick.ticker}</span>
                                                            <span className="text-xs text-gray-500">${pick.strike} · {pick.expiry}</span>
                                                        </div>
                                                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${verdictStyles[pick.verdict] || verdictStyles.WATCH}`}>
                                                            {pick.verdict}
                                                        </span>
                                                    </div>
                                                    <div className="px-4 py-3 space-y-2 text-xs">
                                                        <div className="flex items-center gap-3">
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 font-medium rounded">
                                                                {pick.order_type}
                                                            </span>
                                                            {pick.limit_price_per_contract != null && (
                                                                <span className="text-gray-600">
                                                                    Limit: <span className="font-semibold text-[#0D2654]">{formatCurrency(pick.limit_price_per_contract)}</span>/contract
                                                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-gray-700 leading-relaxed">{pick.reason}</p>
                                                        {pick.support_note && (
                                                            <p className="text-green-700 bg-green-50 px-2 py-1 rounded">
                                                                <strong>Support:</strong> {pick.support_note}
                                                            </p>
                                                        )}
                                                        {pick.risk && pick.risk !== 'None' && (
                                                            <p className="text-amber-700 bg-amber-50 px-2 py-1 rounded">
                                                                <strong>Risk:</strong> {pick.risk}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex flex-wrap gap-3 text-xs">
                                        {aiAnalysis.general_risks && (
                                            <div className="flex-1 min-w-[200px] bg-amber-50 border border-amber-200 px-3 py-2 text-amber-800 rounded">
                                                <strong>Risks:</strong> {aiAnalysis.general_risks}
                                            </div>
                                        )}
                                        {aiAnalysis.strategy_tip && (
                                            <div className="flex-1 min-w-[200px] bg-blue-50 border border-blue-200 px-3 py-2 text-blue-800 rounded">
                                                <strong>Tip:</strong> {aiAnalysis.strategy_tip}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : aiAnalysis ? (
                                <div className="bg-[#F5F3EF] p-4 text-sm leading-relaxed whitespace-pre-wrap text-gray-700">
                                    {typeof aiAnalysis === 'string' ? aiAnalysis : JSON.stringify(aiAnalysis, null, 2)}
                                </div>
                            ) : null}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
