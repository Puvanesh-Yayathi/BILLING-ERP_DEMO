import type { ReactNode } from 'react';
import { formatINR, formatINRCompact } from '@app/contract';

/** Chart styling from doc 08: Tide primary, Cured Brown second, grey (Slate at 40%) for the previous period. */
export const C = {
  tide: '#1F5F99',
  brown: '#8A5A2B',
  prev: 'rgba(91, 104, 120, 0.4)',
  grid: '#DCE2EA',
  axis: '#5B6878',
  deep: '#0F2A47',
};

export const axisProps = {
  stroke: C.grid,
  tick: { fill: C.axis, fontSize: 11, fontFamily: 'IBM Plex Sans' },
  tickLine: false,
  axisLine: { stroke: C.grid },
} as const;

export const moneyTick = (v: number) => formatINRCompact(v).replace('₹', '');

export function ChartTooltip({ active, payload, label, labelFormat, valueFormat = (v: number) => formatINR(v) }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string; labelFormat?: (l: string) => string; valueFormat?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-ctl border border-hairline bg-white px-3 py-2 text-sm shadow-float">
      <p className="mb-1 text-meta text-slate">{labelFormat ? labelFormat(String(label)) : label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-slate">{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-deep">{valueFormat(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

export function ChartPanel({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 border-b border-hairline ${className}`}>
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="text-section font-semibold text-deep">{title}</h2>
        {actions}
      </div>
      <div className="px-4 pb-5">{children}</div>
    </section>
  );
}

/** Ranked horizontal bars without a chart library (accessible, clickable). */
export function RankedBars({ items, onClick, format = (v: number) => formatINR(v), tone = 'tide' }: { items: { key: string; label: string; value: number; sub?: string }[]; onClick?: (key: string) => void; format?: (v: number) => string; tone?: 'tide' | 'brown' }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="px-2 py-6 text-sm text-slate">No data in this period.</p>;
  return (
    <ol className="flex flex-col gap-2.5 px-2">
      {items.map((it) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-deep">{it.label}</span>
              <span className="whitespace-nowrap font-medium tabular-nums text-deep">{format(it.value)}</span>
            </span>
            <span className="mt-1 block h-1.5 w-full rounded-full bg-mist">
              <span className={`block h-1.5 origin-left rounded-full ${tone === 'tide' ? 'bg-tide' : 'bg-brown'} transition-transform duration-240 ease-std`} style={{ transform: `scaleX(${it.value / max})` }} />
            </span>
            {it.sub ? <span className="mt-0.5 block text-meta text-slate">{it.sub}</span> : null}
          </>
        );
        return (
          <li key={it.key}>
            {onClick ? (
              <button type="button" className="block w-full rounded-ctl px-1 py-0.5 text-left hover:bg-mist" onClick={() => onClick(it.key)}>
                {body}
              </button>
            ) : (
              <div className="px-1 py-0.5">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
