import React from 'react';
import { Loader2 } from 'lucide-react';

// Square, hairline, quiet. Primary is ink; `accent` (orange) is for the one action that matters on a screen.
export function Button({ variant = 'primary', size = 'md', loading = false, children, className = '', disabled, ...props }) {
    const baseClasses = 'relative inline-flex items-center justify-center gap-1.5 font-medium tracking-[-0.005em] rounded-none whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-45 disabled:cursor-not-allowed disabled:active:translate-y-0';
    const variantClasses = {
        primary: 'bg-ink text-white hover:bg-ink-950 shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]',
        accent: 'bg-accent text-white hover:bg-accent-deep shadow-[inset_0_-1px_0_rgba(0,0,0,0.18)]',
        secondary: 'bg-paper-deep text-ink hover:bg-line',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        success: 'bg-green-600 text-white hover:bg-green-700',
        outline: 'border border-line-strong text-ink bg-white hover:border-ink',
        ghost: 'text-ink/80 hover:text-ink hover:bg-ink/5',
    };
    const sizeClasses = {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-[15px]',
    };
    return (<button className={`${baseClasses} ${variantClasses[variant] || variantClasses.primary} ${sizeClasses[size]} min-h-11 sm:min-h-0 ${className}`} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
      {children}
    </button>);
}
