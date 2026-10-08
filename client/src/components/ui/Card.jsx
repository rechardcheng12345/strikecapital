import React from 'react';

// Paper-white panel on a hairline — no drop shadow; depth comes from spacing and type.
export function Card({ children, className = '' }) {
    return (<div className={`bg-white border border-line rounded-none ${className}`}>
      {children}
    </div>);
}
export function CardHeader({ children, className = '' }) {
    return (<div className={`px-6 py-4 border-b border-line ${className}`}>
      {children}
    </div>);
}
export function CardBody({ children, className = '' }) {
    return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}
export function CardFooter({ children, className = '' }) {
    return (<div className={`px-6 py-4 border-t border-line bg-paper/60 ${className}`}>
      {children}
    </div>);
}
