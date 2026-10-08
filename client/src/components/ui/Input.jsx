import React from 'react';

// Hairline field, ink focus, labels set as small eyebrows.
export const Input = React.forwardRef(({ label, error, className = '', ...props }, ref) => {
    return (<div className="w-full">
        {label && (<label className="block text-[11px] font-medium uppercase tracking-eyebrow text-muted mb-1.5">
            {label}
          </label>)}
        <input ref={ref} className={`block w-full h-10 px-3 bg-white border rounded-none text-sm text-ink placeholder:text-muted/60 transition-[border-color,box-shadow] duration-150 focus:outline-none focus:border-ink focus:ring-1 focus:ring-ink disabled:bg-paper disabled:text-muted ${error
            ? 'border-red-500 focus:border-red-600 focus:ring-red-600'
            : 'border-line-strong hover:border-ink/40'} ${className}`} {...props}/>
        {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>);
});
Input.displayName = 'Input';
