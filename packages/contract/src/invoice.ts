import { divRound, pctBp, qtyMilli, roundToRupee, type Paise } from './money.js';

export interface InvoiceLineInput {
  qty: number;
  rate: Paise;
  discountPct: number;
  gstRate: number;
  taxInclusive: boolean;
}

export interface InvoiceLineResult {
  gross: Paise;
  discount: Paise;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  tax: Paise;
  lineTotal: Paise;
}

export interface TaxSummaryRow {
  gstRate: number;
  taxableValue: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalTax: Paise;
}

export interface InvoiceTotals {
  lines: InvoiceLineResult[];
  subtotal: Paise;
  discountTotal: Paise;
  taxableTotal: Paise;
  cgst: Paise;
  sgst: Paise;
  igst: Paise;
  totalBeforeRoundOff: Paise;
  roundOff: Paise;
  grandTotal: Paise;
  taxSummary: TaxSummaryRow[];
}

export function calcLine(line: InvoiceLineInput, intraState: boolean): InvoiceLineResult {
  const gross = divRound(qtyMilli(line.qty) * line.rate, 1000);
  const discount = divRound(gross * pctBp(line.discountPct), 10000);
  const net = gross - discount;
  const gBp = pctBp(line.gstRate);
  let taxableValue: Paise;
  let tax: Paise;
  if (line.taxInclusive) {
    taxableValue = divRound(net * 10000, 10000 + gBp);
    tax = net - taxableValue;
  } else {
    taxableValue = net;
    tax = divRound(taxableValue * gBp, 10000);
  }
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (intraState) {
    cgst = divRound(tax, 2);
    sgst = tax - cgst;
  } else {
    igst = tax;
  }
  return { gross, discount, taxableValue, cgst, sgst, igst, tax, lineTotal: taxableValue + tax };
}

/** One shared calculator for GST invoices (doc 04, Section 5.2). */
export function calcInvoice(lines: InvoiceLineInput[], intraState: boolean): InvoiceTotals {
  const results = lines.map((l) => calcLine(l, intraState));
  const sum = (k: keyof InvoiceLineResult) => results.reduce((a, r) => a + r[k], 0);
  const totalBeforeRoundOff = sum('lineTotal');
  const grandTotal = roundToRupee(totalBeforeRoundOff);
  const byRate = new Map<number, TaxSummaryRow>();
  results.forEach((r, i) => {
    const rate = lines[i]?.gstRate ?? 0;
    const row = byRate.get(rate) ?? { gstRate: rate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
    row.taxableValue += r.taxableValue;
    row.cgst += r.cgst;
    row.sgst += r.sgst;
    row.igst += r.igst;
    row.totalTax += r.tax;
    byRate.set(rate, row);
  });
  return {
    lines: results,
    subtotal: sum('gross'),
    discountTotal: sum('discount'),
    taxableTotal: sum('taxableValue'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    totalBeforeRoundOff,
    roundOff: grandTotal - totalBeforeRoundOff,
    grandTotal,
    taxSummary: [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate),
  };
}
