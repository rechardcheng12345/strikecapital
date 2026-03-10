import React from 'react';
import { Loader2 } from 'lucide-react';
export function Button({ variant = 'primary', size = 'md', loading = false, children, className = '', disabled, ...props }) {
    const baseClasses = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
    const variantClasses = {
        primary: 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500',
        secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500',
        danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
        success: 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500',
        outline: 'border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 focus:ring-primary-500',
        ghost: 'text-gray-700 hover:bg-gray-100 focus:ring-gray-500',
    };
    const sizeClasses = {
        sm: 'px-3 py-1.5 text-sm',
        md: 'px-4 py-2 text-sm',
        lg: 'px-6 py-3 text-base',
    };
    return (<button className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin"/>}
      {children}
    </button>);
}
