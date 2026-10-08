import { Inbox } from 'lucide-react';

export function EmptyState({ icon: Icon = Inbox, title, description, action, }) {
    return (<div className="flex flex-col items-center justify-center py-14 px-4 animate-rise">
      <div className="w-14 h-14 border border-line flex items-center justify-center mb-5 bg-paper">
        <Icon className="w-6 h-6 text-ink/40" strokeWidth={1.5}/>
      </div>
      <h3 className="font-display text-xl text-ink mb-1.5">{title}</h3>
      {description && (<p className="text-sm text-muted text-center max-w-sm mb-5 leading-relaxed">
          {description}
        </p>)}
      {action && <div>{action}</div>}
    </div>);
}
