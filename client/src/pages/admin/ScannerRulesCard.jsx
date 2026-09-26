import { useState } from 'react';
import { Plus, Trash2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { scannerApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Input } from '../../components/ui';

// Plain-English trading rules that Jev checks against each scanned ticker.
// "Block" vetoes matching tickers; "Warn" only flags them. Numeric limits belong in fund settings, not here.
export function ScannerRulesCard() {
    const queryClient = useQueryClient();
    const [text, setText] = useState('');
    const [action, setAction] = useState('warn');
    const [saving, setSaving] = useState(false);
    const { data, isLoading } = useApiQuery({
        queryKey: ['admin', 'scanner', 'rules'],
        queryFn: () => scannerApi.getRules(),
    });
    const rules = data?.rules || [];
    const available = data?.available !== false;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'scanner', 'rules'] });

    async function run(promise, okMsg) {
        const res = await promise;
        if (res?.error) toast.error(res.error);
        else {
            if (okMsg) toast.success(okMsg);
            refresh();
        }
        return res;
    }

    async function handleAdd(e) {
        e.preventDefault();
        if (!text.trim()) return;
        setSaving(true);
        const res = await run(scannerApi.addRule(text.trim(), action), 'Rule added');
        if (!res?.error) setText('');
        setSaving(false);
    }

    return (
        <div className="border-2 border-[#0D2654]/20 bg-white p-5">
            <h2 className="text-sm font-semibold text-[#0D2654] uppercase tracking-wider mb-1 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[#F06010]" />
                My Rules <span className="text-[10px] font-normal normal-case tracking-normal text-gray-400">checked by Jev AI</span>
            </h2>
            <p className="text-xs text-gray-500 mb-3">
                Plain-English rules, e.g. “Avoid Chinese ADRs” or “No biotech waiting on FDA decisions”. Numeric limits are already enforced by fund settings.
            </p>
            {!available ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2">
                    Rules need the new database table. Run <code className="font-mono">npm run db:migrate</code> to enable them.
                </p>
            ) : (
                <>
                    <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-3">
                        <Input value={text} onChange={e => setText(e.target.value)} placeholder="Add a rule…" maxLength={300} className="flex-1 min-w-[200px] text-sm" />
                        <select value={action} onChange={e => setAction(e.target.value)} className="border border-gray-300 px-2 text-sm bg-white">
                            <option value="warn">Warn</option>
                            <option value="block">Block</option>
                        </select>
                        <button type="submit" disabled={saving || !text.trim()} className="px-3 py-2 bg-[#0D2654] text-white text-sm hover:bg-[#0D2654]/90 disabled:opacity-50">
                            <Plus className="w-4 h-4" />
                        </button>
                    </form>
                    {isLoading ? (
                        <p className="text-xs text-gray-400">Loading…</p>
                    ) : rules.length === 0 ? (
                        <p className="text-xs text-gray-400">No rules yet.</p>
                    ) : (
                        <ul className="divide-y divide-[#0D2654]/10">
                            {rules.map(r => (
                                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={!!r.is_active}
                                        onChange={() => run(scannerApi.updateRule(r.id, { is_active: !r.is_active }))}
                                        title="Active"
                                    />
                                    <span className={`flex-1 ${r.is_active ? 'text-[#0D2654]' : 'text-gray-400 line-through'}`}>{r.rule_text}</span>
                                    <button
                                        type="button"
                                        onClick={() => run(scannerApi.updateRule(r.id, { action: r.action === 'block' ? 'warn' : 'block' }))}
                                        className={`px-2 py-0.5 text-[10px] font-bold uppercase ${r.action === 'block' ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}
                                        title="Click to toggle Block / Warn"
                                    >
                                        {r.action}
                                    </button>
                                    <button type="button" onClick={() => run(scannerApi.deleteRule(r.id), 'Rule removed')} className="text-gray-400 hover:text-red-500">
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
}
