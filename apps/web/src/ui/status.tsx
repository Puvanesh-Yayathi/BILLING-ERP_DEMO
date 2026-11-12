/** Status colours appear only as small text, dots or thin markers. */
type Tone = 'success' | 'caution' | 'danger' | 'neutral' | 'info';

const TONE: Record<Tone, { dot: string; text: string }> = {
  success: { dot: 'bg-success', text: 'text-success' },
  // #A66A12 is under 4.5:1 for small text, so caution text uses the warm accent and keeps the caution dot.
  caution: { dot: 'bg-caution', text: 'text-brown' },
  danger: { dot: 'bg-danger', text: 'text-danger' },
  info: { dot: 'bg-tide', text: 'text-tide' },
  neutral: { dot: 'bg-slate', text: 'text-slate' },
};

const MAP: Record<string, [string, Tone]> = {
  DRAFT: ['Draft', 'neutral'],
  SENT: ['Sent', 'info'],
  PAID: ['Paid', 'success'],
  OVERDUE: ['Overdue', 'danger'],
  CANCELLED: ['Cancelled', 'neutral'],
  PENDING_S1: ['Waiting for approval', 'caution'],
  PENDING_S2: ['Waiting for approval', 'caution'],
  PENDING_S3: ['Waiting for approval', 'caution'],
  APPROVED: ['Approved', 'info'],
  REJECTED: ['Rejected', 'danger'],
  RECEIVED: ['Received', 'info'],
  NEW: ['New', 'caution'],
  CONVERTED: ['Converted', 'success'],
  PRESENT: ['Present', 'success'],
  ABSENT: ['Absent', 'danger'],
  HALF: ['Half day', 'caution'],
  LEAVE: ['Leave', 'neutral'],
  OFF: ['Off', 'neutral'],
  UPCOMING: ['Upcoming', 'neutral'],
  IN_STOCK: ['In stock', 'success'],
  LOW: ['Low', 'caution'],
  OUT: ['Out of stock', 'danger'],
  FINALIZED: ['Finalized', 'success'],
  CONFIRMED: ['Confirmed', 'success'],
  SUCCESS: ['Signed in', 'success'],
  FAILED: ['Failed', 'danger'],
  LOCKED: ['Locked', 'danger'],
  LOGOUT: ['Signed out', 'neutral'],
  TIMEOUT: ['Timed out', 'caution'],
};

export function statusLabel(s: string): string {
  return MAP[s]?.[0] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function StatusText({ status, label, tone }: { status: string; label?: string; tone?: Tone }) {
  const [text, t] = MAP[status] ?? [statusLabel(status), 'neutral'];
  const c = TONE[tone ?? t];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
      {label ?? text}
    </span>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${TONE[tone].dot}`} aria-hidden="true" />;
}

export function Change({ cur, prev, invert }: { cur: number; prev: number | undefined | null; invert?: boolean }) {
  if (prev === undefined || prev === null) return null;
  if (prev === 0 && cur === 0) return <span className="text-sm font-medium text-slate">No change</span>;
  if (prev === 0) return <span className="text-sm font-medium text-slate">New this period</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`text-sm font-medium ${good ? 'text-success' : 'text-danger'}`}>
      {up ? '+' : '−'}
      {Math.abs(pct).toFixed(1)}% vs previous
    </span>
  );
}
