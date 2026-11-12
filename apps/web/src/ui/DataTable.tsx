import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Columns3, Rows3 } from 'lucide-react';
import { Checkbox } from './form';
import { EmptyState, ErrorState, SkeletonRows } from './feedback';

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: number;
  sortValue?: (row: T) => string | number;
  hideable?: boolean;
  defaultHidden?: boolean;
  total?: ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowId: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty: { title: string; body: string; action?: ReactNode };
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  caption: string;
  maxHeight?: number;
  rowTone?: (row: T) => 'danger' | undefined;
  toolbar?: boolean;
  defaultSort?: { id: string; dir: 'asc' | 'desc' };
}

const VIRTUAL_AFTER = 150;

export function DataTable<T>({ columns, rows, rowId, loading, error, onRetry, empty, onRowClick, selectedId, caption, maxHeight, rowTone, toolbar = true, defaultSort }: Props<T>) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)));
  const [compact, setCompact] = useState(false);
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const seen = useRef<Set<string> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const visible = columns.filter((c) => !hidden.has(c.id));

  const sorted = useMemo(() => {
    if (!rows) return [];
    if (!sort) return rows;
    const col = columns.find((c) => c.id === sort.id);
    if (!col?.sortValue) return rows;
    const f = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  // Rows that arrive while the table is open get a brief highlight.
  const fresh = useMemo(() => {
    const ids = new Set(sorted.map(rowId));
    const prev = seen.current;
    const out = new Set<string>();
    if (prev) for (const id of ids) if (!prev.has(id)) out.add(id);
    return out;
  }, [sorted, rowId]);
  useEffect(() => {
    if (rows) seen.current = new Set(sorted.map(rowId));
  }, [sorted, rowId, rows]);

  const virtual = sorted.length > VIRTUAL_AFTER;
  const rowH = compact ? 32 : 40;
  const v = useVirtualizer({ count: virtual ? sorted.length : 0, getScrollElement: () => scrollRef.current, estimateSize: () => rowH, overscan: 12 });

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    const tr = e.currentTarget;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      (tr.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      (tr.previousElementSibling as HTMLElement | null)?.focus();
    } else if ((e.key === 'Enter' || e.key === ' ') && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  const startResize = (id: string, startX: number, startW: number) => {
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [id]: Math.max(64, startW + ev.clientX - startX) }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const align = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  const hasTotals = columns.some((c) => c.total !== undefined);

  const renderRow = (row: T, style?: React.CSSProperties) => {
    const id = rowId(row);
    const selected = selectedId === id;
    const tone = rowTone?.(row);
    return (
      <tr
        key={id}
        style={style}
        tabIndex={onRowClick ? 0 : -1}
        aria-selected={selected || undefined}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        onKeyDown={(e) => onKey(e, row)}
        className={`border-b border-hairline transition-colors duration-120 ${onRowClick ? 'cursor-pointer hover:bg-mist focus:bg-mist focus:outline-none' : ''} ${fresh.has(id) ? 'row-arrive' : ''}`}
      >
        {visible.map((c, i) => (
          <td
            key={c.id}
            className={`${compact ? 'h-8' : 'h-10'} px-4 text-sm ${align(c.align)} ${c.align === 'right' ? 'tabular-nums' : ''} ${i === 0 && (selected || tone) ? 'relative' : ''}`}
          >
            {i === 0 && selected ? <span className="absolute inset-y-0 left-0 w-0.5 bg-tide" aria-hidden /> : null}
            {i === 0 && !selected && tone ? <span className="absolute inset-y-0 left-0 w-0.5 bg-danger" aria-hidden /> : null}
            {c.cell(row)}
          </td>
        ))}
      </tr>
    );
  };

  return (
    <div className="flex flex-col">
      {toolbar ? (
        <div className="no-print flex items-center justify-end gap-1 px-4 py-1.5">
          <button type="button" onClick={() => setCompact((x) => !x)} className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2 text-meta text-slate hover:bg-mist hover:text-deep" aria-pressed={compact}>
            <Rows3 className="h-3.5 w-3.5" strokeWidth={1.5} />
            {compact ? 'Comfortable' : 'Compact'}
          </button>
          {columns.some((c) => c.hideable !== false) ? (
            <Popover.Root>
              <Popover.Trigger className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2 text-meta text-slate hover:bg-mist hover:text-deep">
                <Columns3 className="h-3.5 w-3.5" strokeWidth={1.5} />
                Columns
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={6} className="z-50 flex w-56 flex-col gap-2 rounded-panel border border-hairline bg-white p-3 shadow-float">
                  {columns
                    .filter((c) => c.hideable !== false)
                    .map((c) => (
                      <Checkbox
                        key={c.id}
                        label={c.header || c.id}
                        checked={!hidden.has(c.id)}
                        onChange={(on) =>
                          setHidden((h) => {
                            const n = new Set(h);
                            if (on) n.delete(c.id);
                            else n.add(c.id);
                            return n;
                          })
                        }
                      />
                    ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          ) : null}
        </div>
      ) : null}
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight: maxHeight ?? (virtual ? 640 : undefined) }}>
        <table className="w-full border-collapse" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-mist">
            <tr className="border-y border-hairline">
              {visible.map((c) => {
                const w = widths[c.id] ?? c.width;
                const sorted = sort?.id === c.id ? sort.dir : null;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    style={w ? { width: w, minWidth: w } : undefined}
                    aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                    className={`group relative h-9 whitespace-nowrap px-4 text-th font-semibold text-slate ${align(c.align)}`}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        className={`inline-flex items-center gap-1 hover:text-deep ${c.align === 'right' ? 'flex-row-reverse' : ''}`}
                        onClick={() => setSort((s) => (s?.id === c.id ? { id: c.id, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { id: c.id, dir: 'asc' }))}
                      >
                        {c.header}
                        {sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> : sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> : null}
                      </button>
                    ) : (
                      c.header
                    )}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${c.header}`}
                      onPointerDown={(e) => startResize(c.id, e.clientX, (e.currentTarget.parentElement as HTMLElement).offsetWidth)}
                      className="no-print absolute right-0 top-2 h-5 w-1 cursor-col-resize rounded-full opacity-0 group-hover:bg-hairline group-hover:opacity-100"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          {loading && !rows ? null : error ? null : virtual ? (
            <tbody>
              {v.getVirtualItems()[0] ? <tr style={{ height: v.getVirtualItems()[0]!.start }} aria-hidden /> : null}
              {v.getVirtualItems().map((vi) => renderRow(sorted[vi.index] as T))}
              <tr style={{ height: Math.max(0, v.getTotalSize() - (v.getVirtualItems().at(-1)?.end ?? 0)) }} aria-hidden />
            </tbody>
          ) : (
            <tbody>{sorted.map((r) => renderRow(r))}</tbody>
          )}
          {hasTotals && rows && rows.length > 0 ? (
            <tfoot className="sticky bottom-0 bg-white">
              <tr className="border-y border-hairline">
                {visible.map((c) => (
                  <td key={c.id} className={`h-10 px-4 text-sm font-semibold ${align(c.align)}`}>
                    {c.total}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {loading && !rows ? <SkeletonRows cols={Math.min(visible.length, 6)} /> : null}
        {error && !loading ? <ErrorState error={error} onRetry={onRetry} /> : null}
        {!loading && !error && rows && rows.length === 0 ? <EmptyState {...empty} /> : null}
      </div>
    </div>
  );
}
