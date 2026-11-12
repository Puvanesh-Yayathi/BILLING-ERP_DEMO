/** Money is always integer paise. Quantities are numbers with at most 3 decimals. */
export type Paise = number;

/** Integer division with half-up rounding (away from zero for negatives). */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('Division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Quantity to integer thousandths. */
export function qtyMilli(qty: number): number {
  return Math.round(qty * 1000);
}

export function roundQty(qty: number): number {
  return qtyMilli(qty) / 1000;
}

/** Percentage (up to 2 decimals) to basis points. 5 -> 500, 12.5 -> 1250. */
export function pctBp(pct: number): number {
  return Math.round(pct * 100);
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

/** Round paise to the nearest whole rupee (half-up). Returns paise. */
export function roundToRupee(p: Paise): Paise {
  return divRound(p, 100) * 100;
}

function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}

/** ₹1,23,456.00 */
export function formatINR(p: Paise, opts: { symbol?: boolean; decimals?: boolean } = {}): string {
  const { symbol = true, decimals = true } = opts;
  const neg = p < 0;
  const abs = Math.abs(Math.round(p));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  let s = groupIndian(String(rupees));
  if (decimals) s += '.' + String(paise).padStart(2, '0');
  return (neg ? '−' : '') + (symbol ? '₹' : '') + s;
}

/** Compact form for KPI bands: ₹4.82 L, ₹1.2 Cr. */
export function formatINRCompact(p: Paise): string {
  const neg = p < 0;
  const r = Math.abs(p) / 100;
  let s: string;
  if (r >= 1e7) s = `${trim(r / 1e7)} Cr`;
  else if (r >= 1e5) s = `${trim(r / 1e5)} L`;
  else if (r >= 1e3) s = groupIndian(String(Math.round(r)));
  else s = r.toFixed(r % 1 === 0 ? 0 : 2);
  return (neg ? '−' : '') + '₹' + s;
}

function trim(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function formatQty(q: number): string {
  const v = roundQty(q);
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '');
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n] ?? '';
  const t = TENS[Math.floor(n / 10)] ?? '';
  const o = ONES[n % 10] ?? '';
  return o ? `${t} ${o}` : t;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(twoDigits(r));
  return parts.join(' ');
}

/** Indian numbering in words: "Rupees One Lakh Twenty Three Thousand Only". */
export function amountInWords(p: Paise): string {
  const abs = Math.abs(Math.round(p));
  let rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 1e7);
  rupees %= 1e7;
  const lakh = Math.floor(rupees / 1e5);
  rupees %= 1e5;
  const thousand = Math.floor(rupees / 1e3);
  rupees %= 1e3;
  if (crore) parts.push(`${crore >= 100 ? threeDigits(crore) : twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rupees) parts.push(threeDigits(rupees));
  let out = parts.length ? `Rupees ${parts.join(' ')}` : 'Rupees Zero';
  if (paise) out += ` and ${twoDigits(paise)} Paise`;
  return `${p < 0 ? 'Minus ' : ''}${out} Only`;
}
