import { Link } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Editorial building blocks: eyebrow + serif page titles, statement-style money, hero figures, hairline ledgers.

/** Small uppercase label with an accent tick. */
export function Eyebrow({ children, className = '' }) {
    return (<p className={`flex items-center gap-2 text-[11px] font-medium uppercase tracking-eyebrow text-muted ${className}`}>
      <span className="w-3 h-px bg-accent" aria-hidden/>
      {children}
    </p>);
}

/** Page header: eyebrow, serif title, optional description and actions. */
export function PageHeader({ eyebrow, title, description, actions, className = '' }) {
    return (<header className={`flex flex-col gap-5 md:flex-row md:items-end md:justify-between mb-8 md:mb-10 ${className}`}>
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
        <h1 className="font-display text-[34px] md:text-[42px] leading-[1.05] text-ink">{title}</h1>
        {description && <p className="mt-3 text-[15px] leading-relaxed text-muted max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>);
}

const fmt = (n, digits = 2) => Math.abs(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Money set like a statement: the cents smaller and lighter. */
export function Money({ value, signed = false, digits = 2, plain = false, className = '' }) {
    if (value == null || Number.isNaN(Number(value))) return <span className={className}>—</span>;
    const n = Number(value);
    const [whole, cents] = fmt(n, digits).split('.');
    const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
    // plain: inline in a sentence — no raised cents
    if (plain) return <span className={`whitespace-nowrap ${className}`}>{sign}${whole}{cents != null ? `.${cents}` : ''}</span>;
    return (<span className={`whitespace-nowrap ${className}`}>
      {sign}${whole}{cents != null && <span className="opacity-45 text-[0.62em] align-[0.42em] ml-[0.04em]">.{cents}</span>}
    </span>);
}

export const toneClass = (n) => (n == null ? 'text-ink' : n > 0 ? 'text-green-600' : n < 0 ? 'text-red-600' : 'text-ink');

export function Pct({ value, signed = true, digits = 1, className = '' }) {
    if (value == null) return <span className={className}>—</span>;
    const n = Number(value);
    return <span className={className}>{n < 0 ? '−' : signed && n > 0 ? '+' : ''}{Math.abs(n).toFixed(digits)}%</span>;
}

/** A large serif figure with its label and the story underneath. */
export function HeroFigure({ label, children, caption, className = '' }) {
    return (<div className={className}>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-4 font-display text-[48px] sm:text-[60px] leading-none text-ink">{children}</div>
      {caption && <div className="mt-5 text-[14px] leading-relaxed text-muted">{caption}</div>}
    </div>);
}

/** Supporting figures as columns separated by hairlines (not boxes). */
export function Ledger({ items, columns = 4, className = '' }) {
    const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns] || 'sm:grid-cols-2 lg:grid-cols-4';
    return (<dl className={`grid grid-cols-2 ${cols} bg-white border border-line overflow-hidden ${className}`}>
      {items.filter(Boolean).map((it, i) => {
        const body = (<>
          <dt className="text-[11px] font-medium uppercase tracking-eyebrow text-muted">{it.label}</dt>
          <dd className={`mt-3 font-display text-[22px] sm:text-[28px] leading-none ${it.tone || 'text-ink'}`}>{it.value}</dd>
          {it.caption && <dd className="mt-2.5 text-[12.5px] leading-snug text-muted">{it.caption}</dd>}
        </>);
        const cls = `block p-5 sm:p-6 border-line -mt-px -ml-px border-t border-l ${it.to ? 'group hover:bg-paper/60 transition-colors' : ''}`;
        return it.to
            ? <Link key={it.label} to={it.to} className={cls}>{body}</Link>
            : <div key={it.label} className={cls}>{body}</div>;
      })}
    </dl>);
}

/** Quiet area chart for a cumulative series: [{ date, value }]. */
export function TrendChart({ points, height = 180, valueFormat = (v) => `$${fmt(v)}` }) {
    if (!points?.length || points.length < 2) {
        return <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>The chart fills in as trades close.</div>;
    }
    return (<ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0D2654" stopOpacity={0.16}/>
            <stop offset="100%" stopColor="#0D2654" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide/>
        <YAxis hide domain={['dataMin', 'dataMax']}/>
        <Tooltip
          cursor={{ stroke: '#F06010', strokeWidth: 1, strokeDasharray: '3 3' }}
          contentStyle={{ border: '1px solid #E4DFD4', borderRadius: 0, boxShadow: '0 12px 32px -18px rgba(13,38,84,0.35)', fontSize: 12, padding: '8px 10px' }}
          labelStyle={{ color: '#6F6A61', marginBottom: 2 }}
          formatter={(v) => [valueFormat(v), 'Cumulative']}
        />
        <Area type="monotone" dataKey="value" stroke="#0D2654" strokeWidth={1.75} fill="url(#trendFill)" dot={false} activeDot={{ r: 3.5, fill: '#F06010', stroke: '#fff', strokeWidth: 2 }} isAnimationActive animationDuration={1400} animationEasing="ease-out"/>
      </AreaChart>
    </ResponsiveContainer>);
}

/** Two-option switch, square. */
export function Segmented({ value, onChange, options }) {
    return (<div className="inline-flex border border-line-strong bg-white p-0.5">
      {options.map(([v, label]) => (<button key={v} type="button" onClick={() => onChange(v)} className={`px-3.5 h-8 text-[13px] font-medium transition-colors ${value === v ? 'bg-ink text-white' : 'text-ink/70 hover:text-ink'}`}>
          {label}
        </button>))}
    </div>);
}

/** Greeting by Singapore time of day. */
export function greeting(name) {
    const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Singapore' }).format(new Date()));
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    return name ? `${part}, ${String(name).split(' ')[0]}` : part;
}
