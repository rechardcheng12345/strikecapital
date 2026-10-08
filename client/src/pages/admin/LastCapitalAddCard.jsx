import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { History, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../../api/client';
import { useApiQuery } from '../../hooks/useApiQuery';
import { Button, Modal } from '../../components/ui';

function formatCurrency(v) {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shows the most recent capital add with a safe "Undo" that reverses everything it changed
// (ownership split, invested amount, fund capital). Editing the amounts by hand does not.
export function LastCapitalAddCard() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const { data } = useApiQuery({
    queryKey: ['admin', 'capital', 'last'],
    queryFn: () => adminApi.getLastCapital(),
  });
  const m = data?.movement;
  if (!m) return null;
  const isWithdrawal = Number(m.amount) < 0;
  const amt = Math.abs(Number(m.amount));
  const what = isWithdrawal ? 'withdrawal' : 'capital add';

  async function handleUndo() {
    setUndoing(true);
    const res = await adminApi.undoLastCapital();
    setUndoing(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`Undid the ${formatCurrency(Math.abs(res.data.undone.amount))} ${Number(res.data.undone.amount) < 0 ? 'withdrawal' : 'add'} of ${res.data.undone.moved_on}.`);
    setConfirmOpen(false);
    ['capital', 'investors', 'fund-summary', 'dashboard', 'investor-value', 'investor-statement'].forEach((k) => queryClient.invalidateQueries({ queryKey: ['admin', k] }));
  }

  return (
    <div className="mb-4 border border-ink/15 bg-white px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
      <History className="w-4 h-4 text-accent" />
      <span className="text-gray-500">Last capital movement:</span>
      <span className={`font-medium ${isWithdrawal ? 'text-red-700' : 'text-ink'}`}>
        {isWithdrawal ? `−${formatCurrency(amt)} withdrawal` : `+${formatCurrency(amt)} add`} · {m.full_name || `User #${m.user_id}`} · {m.moved_on}
      </span>
      {m.note && <span className="text-gray-400">“{m.note}”</span>}
      <div className="ml-auto">
        {m.undoable ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)} className="rounded-none gap-1.5">
            <Undo2 className="w-4 h-4" /> Undo
          </Button>
        ) : (
          <span className="text-xs text-gray-400">{m.reason}</span>
        )}
      </div>

      <Modal isOpen={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Undo last ${what}`} size="md">
        <div className="space-y-4 text-sm">
          <p>
            This removes the <strong>{formatCurrency(amt)}</strong> {what} for <strong>{m.full_name}</strong> on {m.moved_on}, and puts back everything it changed:
          </p>
          <ul className="list-disc pl-5 text-gray-600 space-y-1">
            <li>Everyone&apos;s ownership % returns to what it was before</li>
            <li>{m.full_name}&apos;s net invested amount and the fund capital go {isWithdrawal ? 'back up' : 'down'} by {formatCurrency(amt)}</li>
            <li>The capital record and its profit snapshot are deleted (the undo is written to the audit log)</li>
          </ul>
          <p className="text-gray-500">Use this for mistakes and tests. Don&apos;t edit the amounts by hand instead — that leaves the ownership split wrong.</p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="rounded-none">Cancel</Button>
            <Button variant="danger" onClick={handleUndo} loading={undoing} className="rounded-none">Undo {what}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
