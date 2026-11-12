import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * A4 portrait print engine (doc 09, Section 9A).
 * Page 210 × 297 mm, margins 10 mm (left, right, top) and 12 mm (bottom), usable width 190 mm.
 * Rows are measured in the browser, then packed into pages:
 * - the header repeats on every page (full on page 1, compact after),
 * - the table heading repeats on every page,
 * - the totals block is on the last page only and is never split,
 * - the last page always carries at least two item rows with the totals.
 */

export const MM = 96 / 25.4;
const PAGE_H = 297;
const PAD_TOP = 10;
const PAD_BOTTOM = 12;
const CONTENT_H = PAGE_H - PAD_TOP - PAD_BOTTOM;

export interface DocColumn {
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface PagedDocumentProps {
  header: (page: number, pages: number) => ReactNode;
  compactHeader: (page: number, pages: number) => ReactNode;
  columns: DocColumn[];
  rows: ReactNode[][];
  tail: ReactNode;
  footerNote?: string;
  /** Extra testing hook: rows per page after packing. */
  onLayout?: (rowsPerPage: number[]) => void;
}

function Table({ columns, rows, head = true }: { columns: DocColumn[]; rows: ReactNode[][]; head?: boolean }) {
  return (
    <table className="doc-table" style={{ width: '190mm', tableLayout: 'fixed', borderCollapse: 'collapse' }}>
      <colgroup>
        {columns.map((c, i) => (
          <col key={i} style={{ width: `${c.width}mm` }} />
        ))}
      </colgroup>
      {head ? (
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ textAlign: c.align ?? 'left' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri} data-row>
            {r.map((cell, ci) => (
              <td key={ci} style={{ textAlign: columns[ci]?.align ?? 'left' }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function packRows(heights: number[], firstCap: number, contCap: number, tail: number): number[][] {
  const pages: number[][] = [];
  let i = 0;
  while (i < heights.length) {
    const cap = pages.length === 0 ? firstCap : contCap;
    const page: number[] = [];
    let used = 0;
    while (i < heights.length && (page.length === 0 || used + (heights[i] ?? 0) <= cap)) {
      used += heights[i] ?? 0;
      page.push(i);
      i++;
    }
    pages.push(page);
  }
  if (!pages.length) pages.push([]);
  const sum = (p: number[]) => p.reduce((a, k) => a + (heights[k] ?? 0), 0);
  const capOf = (idx: number) => (idx === 0 ? firstCap : contCap);
  const minLast = Math.min(2, heights.length);
  for (let guard = 0; guard < 50; guard++) {
    const li = pages.length - 1;
    const last = pages[li] as number[];
    if (sum(last) + tail > capOf(li)) {
      // Totals do not fit: start a new last page with the final two rows.
      if (last.length <= minLast) break;
      pages.push(last.splice(last.length - minLast, minLast));
      continue;
    }
    if (last.length < minLast && li > 0) {
      const prev = pages[li - 1] as number[];
      const k = prev.pop();
      if (k === undefined) break;
      last.unshift(k);
      if (prev.length === 0) pages.splice(li - 1, 1);
      continue;
    }
    break;
  }
  return pages;
}

export function PagedDocument({ header, compactHeader, columns, rows, tail, footerNote, onLayout }: PagedDocumentProps) {
  const measure = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<number[][] | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const total = useMemo(() => columns.reduce((a, c) => a + c.width, 0), [columns]);
  if (Math.abs(total - 190) > 0.01) console.warn(`Document columns total ${total} mm, expected 190 mm`);

  useLayoutEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const el = measure.current;
    if (!el || !fontsReady) return;
    const h = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
    const rowHeights = [...el.querySelectorAll('[data-measure-rows] tr[data-row]')].map((r) => r.getBoundingClientRect().height);
    const thead = h('[data-measure-rows] thead');
    const full = h('[data-measure-full]');
    const compact = h('[data-measure-compact]');
    const tailH = h('[data-measure-tail]');
    const footer = h('[data-measure-footer]');
    const cont = h('[data-measure-cont]');
    const body = CONTENT_H * MM - footer - 2;
    const firstCap = body - full - thead - cont;
    const contCap = body - compact - thead - cont;
    const packed = packRows(rowHeights, firstCap, contCap, tailH - cont);
    setPages(packed);
    onLayout?.(packed.map((p) => p.length));
  }, [rows, columns, tail, fontsReady, onLayout]);

  const n = pages?.length ?? 1;
  return (
    <>
      <div ref={measure} aria-hidden="true" className="doc" style={{ position: 'absolute', left: -10000, top: 0, width: '190mm', visibility: 'hidden' }}>
        <div data-measure-full>{header(1, 1)}</div>
        <div data-measure-compact>{compactHeader(2, 2)}</div>
        <div data-measure-rows>
          <Table columns={columns} rows={rows} />
        </div>
        <div data-measure-tail>{tail}</div>
        <div data-measure-cont className="doc-continued">Continued on next page</div>
        <div data-measure-footer>
          <Footer page={1} pages={1} note={footerNote} />
        </div>
      </div>
      {pages ? (
        pages.map((idx, p) => (
          <article key={p} className="a4-page doc" data-page={p + 1} aria-label={`Page ${p + 1} of ${n}`}>
            <div className="a4-body">
              {p === 0 ? header(p + 1, n) : compactHeader(p + 1, n)}
              <Table columns={columns} rows={idx.map((k) => rows[k] as ReactNode[])} />
              {p < n - 1 ? <div className="doc-continued">Continued on next page</div> : <div data-tail>{tail}</div>}
            </div>
            <Footer page={p + 1} pages={n} note={footerNote} />
          </article>
        ))
      ) : (
        <article className="a4-page doc" aria-busy="true" />
      )}
    </>
  );
}

/** A document without an item table (receipt, voucher): one page, same frame. */
export function SinglePage({ children, footerNote }: { children: ReactNode; footerNote?: string }) {
  return (
    <article className="a4-page doc" data-page={1}>
      <div className="a4-body">{children}</div>
      <Footer page={1} pages={1} note={footerNote} />
    </article>
  );
}

function Footer({ page, pages, note }: { page: number; pages: number; note?: string }) {
  return (
    <footer className="doc-footer">
      <span>This is a computer-generated document.{note ? ` ${note}` : ''}</span>
      <span>
        Page {page} of {pages}
      </span>
    </footer>
  );
}

export const DOC_CSS = `
.print-root { display: flex; flex-direction: column; align-items: center; gap: 8mm; padding: 8mm 0 16mm; background: #F3F5F8; }
.doc { font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; color: #000000; font-variant-numeric: tabular-nums; }
.a4-page { position: relative; width: 210mm; height: 297mm; padding: 10mm 10mm 12mm; background: #FFFFFF; border: 1px solid #DCE2EA; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; }
.a4-body { flex: 1; min-height: 0; overflow: hidden; }
.doc-table th { font-size: 8.5pt; font-weight: 600; padding: 1.6mm 0.9mm; border-bottom: 0.4mm solid #0F2A47; color: #000000; vertical-align: bottom; }
.doc-table td { font-size: 9pt; font-weight: 400; padding: 1.4mm 0.9mm; border-bottom: 0.2mm solid #DCE2EA; height: 7mm; box-sizing: border-box; vertical-align: top; overflow-wrap: break-word; word-break: normal; }
.doc-continued { font-size: 8pt; color: #5B6878; text-align: right; padding-top: 2mm; }
.doc-footer { display: flex; justify-content: space-between; gap: 6mm; font-size: 7.5pt; color: #5B6878; border-top: 0.2mm solid #DCE2EA; padding-top: 1.6mm; margin-top: 2mm; }
.doc-label { font-size: 8pt; font-weight: 500; color: #5B6878; }
.doc-value { font-size: 9pt; font-weight: 400; }
.doc-company { font-size: 16pt; font-weight: 700; line-height: 1.15; }
.doc-title { font-size: 14pt; font-weight: 700; letter-spacing: 0.02em; }
.doc-rule { border-bottom: 0.5mm solid #0F2A47; }
.doc-grand { font-size: 12pt; font-weight: 700; }
.doc-words { font-size: 9pt; font-weight: 500; }
.doc .num { text-align: right; }
@media print { .print-root { background: #FFFFFF; padding: 0; gap: 0; } .a4-page { border: 0; } }
`;
