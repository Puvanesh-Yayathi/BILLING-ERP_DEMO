import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { readExcel, templateExcel } from '../../lib/excel';
import { useAction } from '../../lib/useAction';
import { Button } from '../../ui/Button';
import { InlineError } from '../../ui/feedback';
import { Field, Select } from '../../ui/form';
import { PageHeader, Section } from '../../ui/layout';
import { StatusText } from '../../ui/status';

interface Col {
  key: string;
  label: string;
  example: string;
  required: boolean;
}
interface PreviewRow {
  row: number;
  values: Record<string, unknown>;
  ok: boolean;
  errors: Record<string, string>;
}

const MASTERS = [
  ['products', 'Products (Sales Inventory)'],
  ['customers', 'Customers and distributors'],
  ['suppliers', 'Suppliers'],
  ['staff', 'Staff (workers without a login)'],
] as const;

/** Upload .xlsx, preview rows with validation errors, then import the valid rows. */
export function ExcelImport() {
  const [master, setMaster] = useState<string>('products');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; valid: number; invalid: number } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const tpl = useQuery({ queryKey: ['template', master], queryFn: () => api.get<{ columns: Col[] }>(`/templates/${master}`) });
  const check = useAction(async (data: Record<string, unknown>[]) => api.post<{ rows: PreviewRow[]; valid: number; invalid: number }>(`/imports/${master}/preview`, { rows: data }), { onDone: setPreview });
  const commit = useAction(() => api.post<{ imported: number; skipped: number }>(`/imports/${master}/commit`, { rows }), {
    success: (r) => `Imported ${r.imported} rows${r.skipped ? `, skipped ${r.skipped} with errors` : ''}`,
    onDone: () => {
      setRows(null);
      setPreview(null);
      setFile(null);
    },
  });
  const cols = tpl.data?.columns ?? [];
  const load = async (f: File) => {
    setFile(f);
    setReadError(null);
    setPreview(null);
    try {
      const data = await readExcel(f, cols);
      if (!data.length) {
        setReadError('No rows found. Use the template and keep the heading row.');
        return;
      }
      setRows(data);
      await check.run(data);
    } catch {
      setReadError('This file could not be read. Save it as an Excel workbook (.xlsx) and try again.');
    }
  };
  return (
    <div>
      <PageHeader title="Import from Excel" description="Download the template, fill it in, upload it, check the preview, then import. Rows with errors are skipped." />
      <Section>
        <div className="flex max-w-3xl flex-wrap items-end gap-4 pt-5">
          <Field label="What to import" htmlFor="imp-m">
            <Select
              id="imp-m"
              value={master}
              className="w-[280px]"
              onChange={(e) => {
                setMaster(e.target.value);
                setRows(null);
                setPreview(null);
                setFile(null);
              }}
            >
              {MASTERS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={!cols.length} onClick={() => void templateExcel(`${master}-template`, cols)}>
            Download template
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-ctl bg-tide px-4 text-base font-medium text-white hover:bg-deep focus-within:outline focus-within:outline-2 focus-within:outline-tide">
            Upload .xlsx
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
          </label>
          {file ? <span className="text-sm text-slate">{file.name}</span> : null}
        </div>
        <p className="mt-3 text-sm text-slate">Columns: {cols.map((c) => `${c.label}${c.required ? '' : ' (optional)'}`).join(', ')}</p>
        {readError ? <p className="mt-3 text-sm text-danger">{readError}</p> : null}
        <div className="mt-3">
          <InlineError error={check.error} />
        </div>
      </Section>
      {preview ? (
        <Section title={`Preview: ${preview.valid} ready, ${preview.invalid} with errors`} flush>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-mist">
                <tr className="border-y border-hairline text-th text-slate">
                  <th className="h-9 px-4 text-left font-semibold">Row</th>
                  {cols.map((c) => (
                    <th key={c.key} className="h-9 px-4 text-left font-semibold">
                      {c.label}
                    </th>
                  ))}
                  <th className="h-9 px-4 text-left font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className="border-b border-hairline align-top">
                    <td className="relative px-4 py-2 tabular-nums">
                      {!r.ok ? <span className="absolute inset-y-0 left-0 w-0.5 bg-danger" /> : null}
                      {r.row}
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-4 py-2">
                        {String(r.values[c.key] ?? '')}
                      </td>
                    ))}
                    <td className="px-4 py-2">{r.ok ? <StatusText status="OK" label="Ready" tone="success" /> : <span className="text-danger">{Object.values(r.errors).join('. ')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 px-6 py-4">
            <Button variant="primary" disabled={!preview.valid} loading={commit.busy} onClick={() => void commit.run()}>
              Import {preview.valid} rows
            </Button>
            {preview.invalid ? <span className="text-sm text-slate">Fix the rows marked in red in the file and upload it again, or import only the ready rows.</span> : null}
          </div>
        </Section>
      ) : null}
    </div>
  );
}
