import { PROFIT_TAKE_TARGET_PCT, takeProfitPrice } from '../../lib/constants';

// Shows % of max profit (premium) captured on a short option, with a small bar.
// Green once it reaches the take-profit target, red when the option is worth more than it was sold for.
// With the premium (total + contracts, or per share), hovering shows the buy-back price that reaches the target.
export function ProfitCaptured({ pct, compact = false, premium, contracts, premiumPerShare }) {
    const target = takeProfitPrice({ premiumTotal: premium, contracts, perShare: premiumPerShare });
    const targetTip = target != null ? ` — buy back at $${target.toFixed(2)} / share to lock in ${PROFIT_TAKE_TARGET_PCT}%` : '';
    if (pct == null) return <span className="text-gray-400" title={targetTip ? `${PROFIT_TAKE_TARGET_PCT}% target${targetTip}` : undefined}>--</span>;
    const reached = pct >= PROFIT_TAKE_TARGET_PCT;
    const color = pct < 0 ? '#dc2626' : reached ? '#16a34a' : pct >= 50 ? '#F06010' : '#0D2654';
    const width = Math.max(0, Math.min(pct, 100));
    return (<div className={`inline-flex flex-col items-end gap-0.5 ${compact ? 'min-w-[56px]' : 'min-w-[80px]'}`} title={(reached ? `Reached ${PROFIT_TAKE_TARGET_PCT}% target — consider closing` : `${PROFIT_TAKE_TARGET_PCT}% target`) + targetTip}>
      <span className="font-mono font-semibold" style={{ color }}>
        {pct.toFixed(1)}%{reached && <span className="ml-1 text-[10px] font-sans font-bold uppercase">Close?</span>}
      </span>
      <div className="relative w-full h-1.5 bg-gray-200 rounded-none">
        <div className="h-full rounded-none" style={{ width: `${width}%`, backgroundColor: color }}/>
        <div className="absolute top-[-2px] h-[10px] w-px bg-gray-500" style={{ left: `${PROFIT_TAKE_TARGET_PCT}%` }}/>
      </div>
    </div>);
}
