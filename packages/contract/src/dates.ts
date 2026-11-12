/** Dates are ISO strings. Business dates are 'YYYY-MM-DD' in India time (IST, UTC+05:30). */
export type ISODate = string;

const IST_OFFSET_MIN = 330;

export function toISTDate(at: Date | string | number): ISODate {
  const t = new Date(at).getTime() + IST_OFFSET_MIN * 60_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Minutes since IST midnight for a timestamp. */
export function istMinuteOfDay(at: Date | string | number): number {
  const t = new Date(at).getTime() + IST_OFFSET_MIN * 60_000;
  const d = new Date(t);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Build an ISO timestamp for an IST date and minute of day. */
export function istTimestamp(date: ISODate, minuteOfDay: number): string {
  const base = Date.parse(`${date}T00:00:00.000Z`) - IST_OFFSET_MIN * 60_000;
  return new Date(base + minuteOfDay * 60_000).toISOString();
}

export function parseDate(d: ISODate): { y: number; m: number; day: number } {
  const [y, m, day] = d.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, day: day ?? 1 };
}

export function addDays(d: ISODate, n: number): ISODate {
  const t = Date.parse(`${d}T00:00:00.000Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(d: ISODate): number {
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}

export function monthStart(month: string): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: string): ISODate {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(y ?? 0, m ?? 1)).padStart(2, '0')}`;
}

export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function formatDate(d: ISODate | undefined | null): string {
  if (!d) return '';
  const s = d.slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

export function formatTime(at: string | undefined | null): string {
  if (!at) return '';
  const m = istMinuteOfDay(at);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Financial year label (April to March): 2026-05-01 -> "26-27". */
export function fyLabel(d: ISODate): string {
  const { y, m } = parseDate(d);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function formatDocNumber(prefix: string, d: ISODate, seq: number): string {
  return `${prefix}/${fyLabel(d)}/${String(seq).padStart(4, '0')}`;
}

export interface CalendarConfig {
  weeklyOffs: number[];
  holidays: ISODate[];
}

export function isOffDay(d: ISODate, cal: CalendarConfig): boolean {
  return cal.weeklyOffs.includes(weekday(d)) || cal.holidays.includes(d);
}

/** Working days = days in month − weekly offs − extra holidays (holidays on an off day count once). */
export function workingDaysInMonth(month: string, cal: CalendarConfig): number {
  return eachDay(monthStart(month), monthEnd(month)).filter((d) => !isOffDay(d, cal)).length;
}

export type HoursRounding = 'NEAREST' | 'UP' | 'EXACT';

/** Paid hours for a day's total minutes. NEAREST: 30 minutes or more rounds up. */
export function roundHours(minutes: number, mode: HoursRounding = 'NEAREST'): number {
  const m = Math.max(0, Math.floor(minutes));
  if (mode === 'NEAREST') return Math.floor((m + 30) / 60);
  if (mode === 'UP') return Math.ceil(m / 60);
  return Math.round((m / 60) * 100) / 100;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}
