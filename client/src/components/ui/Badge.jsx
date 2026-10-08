import React from 'react';

// A small typeset label with a status dot — reads like a ledger annotation, not a pill.
export function Badge({ children, variant = 'gray', className = '' }) {
    const variantClasses = {
        gray: 'text-muted border-line-strong bg-white [--dot:#8C867B]',
        green: 'text-green-700 border-green-100 bg-green-50 [--dot:#0E7A53]',
        yellow: 'text-amber-800 border-amber-200/70 bg-amber-50 [--dot:#D99A06]',
        red: 'text-red-700 border-red-100 bg-red-50 [--dot:#B4432B]',
        blue: 'text-ink border-ink-100 bg-ink-50 [--dot:#1F3A6E]',
    };
    return (<span className={`inline-flex items-center gap-1.5 px-2 py-[3px] border text-[11px] font-medium tracking-[0.01em] leading-none whitespace-nowrap ${variantClasses[variant] || variantClasses.gray} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--dot)]"/>
      {children}
    </span>);
}
