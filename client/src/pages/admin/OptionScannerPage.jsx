import { useState } from 'react';
import { Search, Plus, X, ScanLine, AlertTriangle, ChevronDown, ChevronUp, PlusCircle, CheckCircle } from 'lucide-react';
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

    async function handleScan() {
        setScanning(true);
        setScanResults(null);
        setScanError(null);
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
                    <div className="px-5 py-3 border-b border-[#0D2654]/10 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider">
                            Results ({results.length} options found)
                        </h2>
                        {Object.entries(scanResults.stock_prices || {}).length > 0 && (
                            <div className="flex gap-3 flex-wrap">
                                {Object.entries(scanResults.stock_prices).map(([t, p]) => (
                                    <span key={t} className="text-xs text-gray-500">
                                        {t}: <span className="font-medium text-[#0D2654]">{formatCurrency(p)}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

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
                                        return (
                                        <tr key={row.option_code} className={`transition-colors ${added ? 'bg-green-50' : 'hover:bg-[#F5F3EF]'}`}>
                                            <td className="px-3 py-3">
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
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
