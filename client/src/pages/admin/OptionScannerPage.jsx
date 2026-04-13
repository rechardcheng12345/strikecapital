import React, { useState } from 'react';
import { Search, Plus, X, ScanLine, AlertTriangle, ChevronDown, ChevronUp, PlusCircle, CheckCircle, Sparkles, BarChart3, Calculator } from 'lucide-react';
import { scannerApi, positionApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button, Input, Skeleton, ErrorAlert } from '../../components/ui';

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
    if (abs <= 0.25) return 'text-green-600';
    if (abs <= 0.35) return 'text-yellow-600';
    return 'text-red-600';
}

// ─── Black-Scholes Put Pricing ──────────────────────────────────────────────
function normalCDF(x) {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
    const p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
}

function bsPutPrice(S, K, T, sigma, r = 0.045) {
    if (T <= 0 || sigma <= 0 || S <= 0) return 0;
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

function PremiumEstimator({ row }) {
    const [targetPrice, setTargetPrice] = useState('');
    // row.iv from moomoo is raw (e.g. 45.723 meaning 4572.3%). BS needs decimal like 0.4572.
    const iv = (row.iv ?? 0) / 100;
    const T = (row.days_to_expiry ?? 0) / 365;

    const estimate = targetPrice && Number(targetPrice) > 0
        ? bsPutPrice(Number(targetPrice), row.strike, T, iv)
        : null;

    const currentBSPrice = bsPutPrice(row.stock_price, row.strike, T, iv);

    return (
        <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="text-gray-500 font-medium">If {row.ticker} drops to</span>
            <input
                type="number"
                step="0.5"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder={`e.g. ${Math.floor(row.stock_price * 0.95)}`}
                className="w-24 px-2 py-1 border border-gray-300 text-xs focus:outline-none focus:border-[#F06010]"
            />
            {estimate !== null && (
                <>
                    <span className="text-gray-500">→ est. premium:</span>
                    <span className="font-bold text-[#0D2654]">${(estimate * 100).toFixed(2)}/contract</span>
                    <span className="text-gray-400">(${estimate.toFixed(4)}/sh)</span>
                    {row.premium > 0 && (
                        <span className={`font-medium ${estimate > row.premium ? 'text-green-600' : 'text-red-600'}`}>
                            {estimate > row.premium ? '+' : ''}{((estimate - row.premium) / row.premium * 100).toFixed(1)}% vs current
                        </span>
                    )}
                </>
            )}
            {currentBSPrice > 0 && (
                <span className="text-gray-400 ml-auto">
                    BS model @ current: ${(currentBSPrice * 100).toFixed(2)} vs market: ${(row.premium * 100).toFixed(2)}
                </span>
            )}
        </div>
    );
}

function LevelsPanel({ levels, strikes }) {
    const l = levels;
    const strikeMin = Math.min(...strikes);
    const strikeMax = Math.max(...strikes);

    function strikeContext() {
        const allSupport = [...(l.swingSupport || [])];
        if (l.ma50) allSupport.push(l.ma50);
        if (l.ma200) allSupport.push(l.ma200);
        const supportBelow = allSupport.filter(s => s < strikeMin).sort((a, b) => b - a);
        const supportAbove = allSupport.filter(s => s >= strikeMin && s <= strikeMax);
        if (supportAbove.length > 0) {
            return { color: 'text-yellow-700 bg-yellow-50', text: `Strike range overlaps support at $${supportAbove[0].toFixed(2)} — watch closely` };
        }
        if (supportBelow.length > 0) {
            return { color: 'text-green-700 bg-green-50', text: `Strikes below nearest support at $${supportBelow[0].toFixed(2)} — good cushion` };
        }
        return null;
    }

    const ctx = strikeContext();

    return (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-1.5 text-xs text-gray-600">
            <span><strong className="text-[#0D2654]">52W High:</strong> {l.fiftyTwoWeekHigh ? formatCurrency(l.fiftyTwoWeekHigh) : '—'}</span>
            <span><strong className="text-[#0D2654]">52W Low:</strong> {l.fiftyTwoWeekLow ? formatCurrency(l.fiftyTwoWeekLow) : '—'}</span>
            <span><strong className="text-[#0D2654]">MA50:</strong> {l.ma50 ? formatCurrency(l.ma50) : '—'}</span>
            <span><strong className="text-[#0D2654]">MA200:</strong> {l.ma200 ? formatCurrency(l.ma200) : '—'}</span>
            {l.swingSupport?.length > 0 && (
                <span><strong className="text-green-700">Support:</strong> {l.swingSupport.map(p => '$' + p.toFixed(2)).join(', ')}</span>
            )}
            {ctx && (
                <span className={`inline-block px-2 py-0.5 rounded font-medium ${ctx.color}`}>
                    {ctx.text}
                </span>
            )}
        </div>
    );
}

export function OptionScannerPage() {
    const queryClient = useQueryClient();
    const [newTicker, setNewTicker] = useState('');
    const [addingTicker, setAddingTicker] = useState(false);

    const [params, setParams] = useState({
        minDays: 14, maxDays: 28,
        minDiscount: 10, maxDiscount: 20,
        minDelta: 0, maxDelta: 1,
        minReturn: 0, minOI: 0,
    });
    const [scanning, setScanning] = useState(false);
    const [scanResults, setScanResults] = useState(null);
    const [scanError, setScanError] = useState(null);
    const [addingPosition, setAddingPosition] = useState(null);
    const [addedPositions, setAddedPositions] = useState(new Set());
    const [sortKey, setSortKey] = useState('score');
    const [sortDir, setSortDir] = useState('desc');
    const [analyzing, setAnalyzing] = useState(false);
    const [aiAnalysis, setAiAnalysis] = useState(null);  // structured object or string
    const [aiFormat, setAiFormat] = useState(null);       // 'structured' or 'text'
    const [aiError, setAiError] = useState(null);
    const [expandedEstimator, setExpandedEstimator] = useState(null); // option_code of expanded row
    const [expandedLevels, setExpandedLevels] = useState({});  // { ticker: { loading, data, error } }

    async function handleToggleLevels(ticker) {
        setExpandedLevels(prev => {
            if (prev[ticker] && !prev[ticker].loading) {
                const next = { ...prev };
                delete next[ticker];
                return next;
            }
            return prev;
        });
        if (expandedLevels[ticker]) return;
        setExpandedLevels(prev => ({ ...prev, [ticker]: { loading: true, data: null, error: null } }));
        try {
            const response = await scannerApi.getLevels(ticker);
            const data = response.data || response;
            if (data.error) {
                setExpandedLevels(prev => ({ ...prev, [ticker]: { loading: false, data: null, error: data.error } }));
            } else {
                setExpandedLevels(prev => ({ ...prev, [ticker]: { loading: false, data, error: null } }));
            }
        } catch (err) {
            setExpandedLevels(prev => ({ ...prev, [ticker]: { loading: false, data: null, error: err.message || 'Failed' } }));
        }
    }

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
        if (!scanResults?.results?.length) return;
        setAnalyzing(true);
        setAiAnalysis(null);
        setAiFormat(null);
        setAiError(null);
        try {
            const response = await scannerApi.analyze(scanResults.results, scanResults.stock_prices || {}, params);
            const data = response.data || {};
            if (data.error) setAiError(data.error);
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

    async function handleScan() {
        setScanning(true);
        setScanResults(null);
        setScanError(null);
        setAiAnalysis(null);
        setAiError(null);
        try {
            const response = await scannerApi.scan(params);
            const data = response.data || {};
            setScanResults(data);
            if (data.error) setScanError(data.error);
        } catch (err) {
            setScanError(err.message || 'Scan failed');
        } finally {
            setScanning(false);
        }
    }

    async function handleAddToMonitoring(row) {
        setAddingPosition(row.option_code);
        try {
            await positionApi.create({
                ticker: `${row.ticker} PUT`,
                position_type: 'option',
                status: 'MONITORING',
                strike_price: row.strike,
                expiration_date: row.expiry,
                premium_received: Math.round(row.premium * 100 * 100) / 100,
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

    const columns = [
        { key: 'score', label: 'Score' },
        { key: 'ticker', label: 'Ticker' },
        { key: 'stock_price', label: 'Stock $' },
        { key: 'strike', label: 'Strike' },
        { key: 'discount_pct', label: 'Disc%' },
        { key: 'return_pct', label: 'Return%' },
        { key: 'annual_return_pct', label: 'Ann%' },
        { key: 'expiry', label: 'Expiry' },
        { key: 'days_to_expiry', label: 'DTE' },
        { key: 'premium', label: 'Premium' },
        { key: 'iv', label: 'IV' },
        { key: 'delta', label: 'Delta' },
        { key: 'volume', label: 'Vol' },
    ];

    return (
        <div>
            <h1 className="text-2xl font-bold text-[#0D2654] mb-6 flex items-center gap-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                <ScanLine className="w-6 h-6 text-[#F06010]" />
                Option Scanner
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Watchlist */}
                <div className="border-2 border-[#0D2654]/20 bg-white p-5">
                    <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider mb-4">Watchlist</h2>
                    <form onSubmit={handleAddTicker} className="flex gap-2 mb-4">
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
                        <div className="space-y-2">
                            {[1, 2, 3].map(i => <Skeleton key={i} variant="text" height={32} />)}
                        </div>
                    ) : watchlistError ? (
                        <ErrorAlert message={wlError?.message || 'Failed to load watchlist'} onRetry={refetchWatchlist} />
                    ) : tickers.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">No tickers yet. Add some above.</p>
                    ) : (
                        <div className="space-y-1">
                            {tickers.map(t => (
                                <div key={t.ticker} className="flex items-center justify-between px-3 py-2 bg-[#F5F3EF] border border-[#0D2654]/10">
                                    <span className="text-sm font-medium text-[#0D2654]">{t.ticker}</span>
                                    <button
                                        onClick={() => handleRemoveTicker(t.ticker)}
                                        className="text-gray-400 hover:text-red-500 transition-colors"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Scan Parameters */}
                <div className="border-2 border-[#0D2654]/20 bg-white p-5 lg:col-span-2">
                    <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider mb-4">Scan Parameters</h2>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min Days to Expiry</label>
                            <Input
                                type="number"
                                value={params.minDays}
                                onChange={e => setParams(p => ({ ...p, minDays: parseInt(e.target.value) || 0 }))}
                                min={1}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Max Days to Expiry</label>
                            <Input
                                type="number"
                                value={params.maxDays}
                                onChange={e => setParams(p => ({ ...p, maxDays: parseInt(e.target.value) || 0 }))}
                                min={1}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min Discount from Stock %</label>
                            <Input
                                type="number"
                                value={params.minDiscount}
                                onChange={e => setParams(p => ({ ...p, minDiscount: parseFloat(e.target.value) || 0 }))}
                                min={0}
                                step={0.5}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Max Discount from Stock %</label>
                            <Input
                                type="number"
                                value={params.maxDiscount}
                                onChange={e => setParams(p => ({ ...p, maxDiscount: parseFloat(e.target.value) || 0 }))}
                                min={0}
                                step={0.5}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min Delta (abs)</label>
                            <Input
                                type="number"
                                value={params.minDelta}
                                onChange={e => setParams(p => ({ ...p, minDelta: parseFloat(e.target.value) || 0 }))}
                                min={0} max={1} step={0.05}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Max Delta (abs)</label>
                            <Input
                                type="number"
                                value={params.maxDelta}
                                onChange={e => setParams(p => ({ ...p, maxDelta: parseFloat(e.target.value) || 1 }))}
                                min={0} max={1} step={0.05}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min Return %</label>
                            <Input
                                type="number"
                                value={params.minReturn}
                                onChange={e => setParams(p => ({ ...p, minReturn: parseFloat(e.target.value) || 0 }))}
                                min={0} step={0.1}
                                className="w-full"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-gray-500 block mb-1">Min Open Interest</label>
                            <Input
                                type="number"
                                value={params.minOI}
                                onChange={e => setParams(p => ({ ...p, minOI: parseInt(e.target.value) || 0 }))}
                                min={0}
                                className="w-full"
                            />
                        </div>
                    </div>
                    <button
                        onClick={handleScan}
                        disabled={scanning || tickers.length === 0}
                        className="flex items-center gap-2 px-6 py-2.5 bg-[#F06010] text-white font-medium text-sm hover:bg-[#F06010]/90 disabled:opacity-50 transition-colors"
                    >
                        <Search className="w-4 h-4" />
                        {scanning ? 'Scanning...' : 'Run Scan'}
                    </button>
                    {tickers.length === 0 && (
                        <p className="text-xs text-gray-400 mt-2">Add tickers to the watchlist before scanning.</p>
                    )}
                </div>
            </div>

            {/* Results */}
            {scanError && (
                <div className="mb-4 p-4 border-2 border-yellow-400 bg-yellow-50 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-yellow-800">Scanner Warning</p>
                        <p className="text-sm text-yellow-700">{scanError}</p>
                    </div>
                </div>
            )}

            {scanResults && (
                <div className="border-2 border-[#0D2654]/20 bg-white">
                    <div className="px-5 py-3 border-b border-[#0D2654]/10 flex items-center justify-between gap-4">
                        <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider whitespace-nowrap">
                            Results ({results.length} options found)
                        </h2>
                        <div className="flex items-center gap-4 flex-wrap">
                            {Object.entries(scanResults.stock_prices || {}).length > 0 && (
                                <div className="flex gap-3 flex-wrap items-center">
                                    {Object.entries(scanResults.stock_prices).map(([t, p]) => (
                                        <span key={t} className="text-xs text-gray-500 inline-flex items-center gap-1">
                                            {t}: <span className="font-medium text-[#0D2654]">{formatCurrency(p)}</span>
                                            <button
                                                onClick={() => handleToggleLevels(t)}
                                                title={expandedLevels[t] ? 'Hide S/R levels' : 'Show S/R levels'}
                                                className={`ml-0.5 transition-colors ${expandedLevels[t] ? 'text-[#F06010]' : 'text-gray-400 hover:text-[#F06010]'}`}
                                            >
                                                <BarChart3 className="w-4.5 h-4.5" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                            {results.length > 0 && (
                                <button
                                    onClick={handleAnalyze}
                                    disabled={analyzing}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0D2654] text-white text-xs font-medium hover:bg-[#0D2654]/80 disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    {analyzing ? 'Analyzing...' : 'Analyze with AI'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* S/R Levels Panels */}
                    {Object.entries(expandedLevels).length > 0 && (
                        <div className="border-b border-[#0D2654]/10 px-5 py-3 space-y-2">
                            {Object.entries(expandedLevels).map(([ticker, state]) => (
                                <div key={ticker}>
                                    {state.loading ? (
                                        <span className="text-xs text-gray-500 flex items-center gap-2">
                                            <span className="inline-block w-3 h-3 border-2 border-[#F06010] border-t-transparent rounded-full animate-spin"></span>
                                            Loading levels for {ticker}...
                                        </span>
                                    ) : state.error ? (
                                        <span className="text-xs text-red-500">{ticker}: {state.error}</span>
                                    ) : state.data ? (
                                        <LevelsPanel levels={state.data} strikes={results.filter(r => r.ticker === ticker).map(r => r.strike)} />
                                    ) : null}
                                </div>
                            ))}
                        </div>
                    )}

                    {results.length === 0 ? (
                        <div className="py-8 px-5">
                            <p className="text-sm text-gray-500 text-center mb-4">No options matched your criteria.</p>
                            <div className="text-xs border border-gray-200 bg-gray-50 p-3 max-w-3xl mx-auto">
                                <p className="font-semibold text-gray-600 mb-2">Debug Info</p>
                                <pre className="overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap text-gray-700">
                                    {JSON.stringify(scanResults.debug ?? {}, null, 2)}
                                </pre>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-[#0D2654]/5 text-left">
                                        <th className="px-3 py-3 w-10"></th>
                                        {columns.map(col => (
                                            <th
                                                key={col.key}
                                                onClick={() => handleSort(col.key)}
                                                className="px-4 py-3 text-xs font-semibold text-[#0D2654] uppercase tracking-wider cursor-pointer select-none hover:bg-[#0D2654]/10 transition-colors text-left"
                                            >
                                                <span className="inline-flex items-center gap-1">
                                                    {col.label}
                                                    {sortKey === col.key && (
                                                        sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-[#F06010]" /> : <ChevronDown className="w-3 h-3 text-[#F06010]" />
                                                    )}
                                                </span>
                                            </th>
                                        ))}
                                        <th className="px-3 py-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#0D2654]/10">
                                    {results.map((row) => {
                                        const added = addedPositions.has(row.option_code);
                                        const adding = addingPosition === row.option_code;
                                        const isEstimatorOpen = expandedEstimator === row.option_code;
                                        return (
                                        <React.Fragment key={row.option_code}>
                                        <tr className={`transition-colors ${added ? 'bg-green-50' : 'hover:bg-[#F5F3EF]'}`}>
                                            <td className="px-3 py-3">
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => !added && handleAddToMonitoring(row)}
                                                        disabled={adding || added}
                                                        title={added ? 'Added to Monitoring' : 'Add to Monitoring'}
                                                        className="text-gray-400 hover:text-[#F06010] disabled:cursor-default transition-colors"
                                                    >
                                                        {added
                                                            ? <CheckCircle className="w-5 h-5 text-green-500" />
                                                            : adding
                                                                ? <PlusCircle className="w-5 h-5 animate-pulse text-[#F06010]" />
                                                                : <PlusCircle className="w-5 h-5" />
                                                        }
                                                    </button>
                                                    <button
                                                        onClick={() => setExpandedEstimator(isEstimatorOpen ? null : row.option_code)}
                                                        title="Premium estimator"
                                                        className={`transition-colors ${isEstimatorOpen ? 'text-[#F06010]' : 'text-gray-400 hover:text-[#F06010]'}`}
                                                    >
                                                        <Calculator className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={scoreColor(row.score)}>{row.score ?? '—'}</span>
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-[#0D2654]">{row.ticker}</td>
                                            <td className="px-4 py-3 text-gray-600">{formatCurrency(row.stock_price)}</td>
                                            <td className="px-4 py-3 font-medium text-[#0D2654]">{formatCurrency(row.strike)}</td>
                                            <td className="px-4 py-3">
                                                <span className="text-orange-600 font-medium">{formatPct(row.discount_pct)}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-blue-600 font-medium">{row.return_pct != null ? row.return_pct.toFixed(2) + '%' : '—'}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="text-purple-600 font-medium">{row.annual_return_pct != null ? row.annual_return_pct.toFixed(1) + '%' : '—'}</span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{row.expiry}</td>
                                            <td className="px-4 py-3 text-gray-600">{row.days_to_expiry}d</td>
                                            <td className="px-4 py-3 font-medium text-green-700">
                                                {formatCurrency(row.premium * 100)}
                                                <span className="text-gray-400 text-[10px] ml-1">(${row.premium}/sh)</span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{row.iv != null ? formatPct(row.iv * 100) : '—'}</td>
                                            <td className="px-4 py-3">
                                                <span className={deltaColor(row.delta)}>{row.delta != null ? formatNum(row.delta, 3) : '—'}</span>
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">{row.volume > 0 ? row.volume.toLocaleString() : '—'}</td>
                                        </tr>
                                        {isEstimatorOpen && (
                                            <tr className="bg-blue-50/50">
                                                <td colSpan={columns.length + 2} className="px-5 py-2.5">
                                                    <PremiumEstimator row={row} />
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* AI Analysis Panel */}
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
                                    {/* Market Outlook */}
                                    {aiAnalysis.market_outlook && (
                                        <div className="bg-[#0D2654]/5 border border-[#0D2654]/15 px-4 py-3 text-sm text-[#0D2654]">
                                            <span className="font-semibold text-xs uppercase tracking-wider text-[#0D2654]/60 block mb-1">Market Outlook</span>
                                            {aiAnalysis.market_outlook}
                                        </div>
                                    )}

                                    {/* Pick Cards */}
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

                                    {/* Footer: General Risks + Strategy Tip */}
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
