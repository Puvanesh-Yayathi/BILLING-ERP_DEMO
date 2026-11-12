/** Excel export and import in the browser. exceljs is loaded only when needed. */

export interface ExcelColumn {
  header: string;
  key: string;
  type?: 'text' | 'money' | 'qty' | 'date' | 'number' | 'pct';
  width?: number;
}

type Cell = string | number | null | undefined;

export async function exportExcel(filename: string, sheets: { name: string; columns: ExcelColumn[]; rows: readonly object[]; totals?: Record<string, Cell> }[], title?: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = title ?? 'Billing demo';
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
    ws.columns = sh.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? (c.type === 'text' || !c.type ? 24 : 16) }));
    const conv = (c: ExcelColumn, raw: unknown) => {
      const v: Cell = typeof raw === 'number' || typeof raw === 'string' ? raw : raw === null || raw === undefined ? null : String(raw);
      if (v === null || v === undefined || v === '') return null;
      if (c.type === 'money') return Number(v) / 100;
      if (c.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return new Date(`${v.slice(0, 10)}T00:00:00Z`);
      return v;
    };
    for (const r of sh.rows) ws.addRow(Object.fromEntries(sh.columns.map((c) => [c.key, conv(c, (r as Record<string, unknown>)[c.key])])));
    if (sh.totals) {
      const row = ws.addRow(Object.fromEntries(sh.columns.map((c) => [c.key, conv(c, sh.totals?.[c.key])])));
      row.font = { bold: true };
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    sh.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.type === 'money') col.numFmt = '[$₹-4009]#,##,##0.00;-[$₹-4009]#,##,##0.00';
      else if (c.type === 'qty') col.numFmt = '0.###';
      else if (c.type === 'date') col.numFmt = 'dd/mm/yyyy';
      if (c.type && c.type !== 'text') col.alignment = { horizontal: 'right' };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Reads the first sheet. Headers are matched to column keys by label. */
export async function readExcel(file: File, columns: { key: string; label: string }[]): Promise<Record<string, unknown>[]> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const header = ws.getRow(1);
  const map = new Map<number, string>();
  header.eachCell((cell, col) => {
    const label = String(cell.value ?? '').trim().toLowerCase();
    const c = columns.find((x) => x.label.toLowerCase() === label || x.key.toLowerCase() === label);
    if (c) map.set(col, c.key);
  });
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o: Record<string, unknown> = {};
    let any = false;
    row.eachCell((cell, col) => {
      const k = map.get(col);
      if (!k) return;
      let v: unknown = cell.value;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      else if (v && typeof v === 'object' && 'text' in v) v = (v as { text: string }).text;
      else if (v && typeof v === 'object' && 'result' in v) v = (v as { result: unknown }).result;
      o[k] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') any = true;
    });
    if (any) rows.push(o);
  });
  return rows;
}

export async function templateExcel(filename: string, columns: { key: string; label: string; example: string }[]): Promise<void> {
  await exportExcel(filename, [{ name: 'Template', columns: columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(16, c.label.length + 4) })), rows: [Object.fromEntries(columns.map((c) => [c.key, c.example]))] }]);
}
