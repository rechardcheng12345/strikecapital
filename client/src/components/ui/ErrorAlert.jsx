import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function ErrorAlert({ message = 'Something went wrong. Please try again.', onRetry, }) {
    return (<div className="flex items-start gap-3 border border-red-100 border-l-2 border-l-red-600 bg-red-50/60 px-4 py-3.5 animate-rise" role="alert">
      <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0"/>
      <div className="flex-1 text-sm text-ink/80 leading-relaxed">{message}</div>
      {onRetry && (<Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>)}
    </div>);
}
