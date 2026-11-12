import type { ReactNode } from 'react';
import { formatINR, formatINRCompact } from '@app/contract';

export function PageHeader({ title, description, actions, meta }: { title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 border-b border-hairline px-6 py-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-title font-semibold text-deep">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-base text-slate">{description}</p> : null}
        {meta ? <div className="mt-2">{meta}</div> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({ title, actions, children, className = '', flush }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`border-b border-hairline ${className}`}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 px-6 pb-3 pt-5">
          {title ? <h2 className="text-section font-semibold text-deep">{title}</h2> : <span />}
          {actions ? <div className="no-print flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? '' : 'px-6 pb-6'}>{children}</div>
    </section>
  );
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-panel border border-hairline bg-white ${className}`}>{children}</div>;
}

/** One band of figures separated by thin dividers (no card walls). */
export function FigureBand({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode; onClick?: () => void; title?: string }[] }) {
  return (
    <div className="grid grid-cols-2 divide-hairline border-b border-hairline sm:grid-cols-3 lg:flex lg:divide-x">
      {items.map((it) => {
        const body = (
          <>
            <span className="text-meta text-slate">{it.label}</span>
            <span className="text-kpi font-semibold text-deep" title={it.title}>
              {it.value}
            </span>
            {it.sub ? <span className="text-sm font-medium">{it.sub}</span> : null}
          </>
        );
        return it.onClick ? (
          <button key={it.label} type="button" onClick={it.onClick} className="flex min-w-0 flex-1 flex-col items-start gap-1 border-b border-hairline px-6 py-4 text-left transition-colors duration-120 hover:bg-mist lg:border-b-0">
            {body}
          </button>
        ) : (
          <div key={it.label} className="flex min-w-0 flex-1 flex-col gap-1 border-b border-hairline px-6 py-4 lg:border-b-0">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Indian format. Negative amounts use the danger colour with a minus sign, never colour alone. */
export function Money({ value, compact, strong, className = '' }: { value: number | null | undefined; compact?: boolean; strong?: boolean; className?: string }) {
  if (value === null || value === undefined) return <span className="text-slate">—</span>;
  const text = compact ? formatINRCompact(value) : formatINR(value);
  return (
    <span className={`tabular-nums ${value < 0 ? 'text-danger' : ''} ${strong ? 'font-semibold' : ''} ${className}`} title={compact ? formatINR(value) : undefined}>
      {text}
    </span>
  );
}

export function KeyValue({ items, cols = 2 }: { items: { label: string; value: ReactNode }[]; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols];
  return (
    <dl className={`grid grid-cols-1 gap-x-8 gap-y-4 ${c}`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-meta text-slate">{it.label}</dt>
          <dd className="mt-0.5 break-words text-base text-deep">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-end gap-3 border-b border-hairline px-6 py-3">{children}</div>;
}
