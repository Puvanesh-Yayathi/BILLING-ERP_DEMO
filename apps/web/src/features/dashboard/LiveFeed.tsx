import { AnimatePresence, m } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useRealtime } from '../../lib/realtime';

const LINK: Record<string, (id: string) => string> = {
  invoice: (id) => `/bills/${id}`,
  payment: (id) => `/payments/${id}/print`,
  indent: (id) => `/indents/${id}`,
  'production-batch': (id) => `/production/${id}/print`,
  'purchase-bill': (id) => `/purchase-bills/${id}/print`,
  'order-request': () => '/order-requests',
  expense: () => '/expenses',
};

function ago(at: string) {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Live activity: what workers are doing, updating within about two seconds. */
export function LiveFeed() {
  const { events, status } = useRealtime();
  const navigate = useNavigate();
  return (
    <section className="flex min-h-0 flex-col border-b border-hairline" aria-live="polite">
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="text-section font-semibold text-deep">Live activity</h2>
        <span className="flex items-center gap-1.5 text-meta text-slate">
          <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-success' : 'bg-caution'}`} />
          {status === 'live' ? 'Updating' : 'Reconnecting'}
        </span>
      </div>
      <ul className="max-h-[340px] flex-1 overflow-y-auto px-3 pb-4">
        <AnimatePresence initial={false}>
          {events.length ? (
            events.map((e) => {
              const link = LINK[e.entity]?.(e.entityId);
              return (
                <m.li key={e.seq} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.24 }} className={e.fresh ? 'row-arrive rounded-ctl' : 'rounded-ctl'}>
                  <button type="button" disabled={!link} onClick={() => link && navigate(link)} className="flex w-full items-start gap-3 rounded-ctl px-3 py-2 text-left hover:bg-mist disabled:cursor-default disabled:hover:bg-transparent">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brown" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-deep">{e.summary}</span>
                      <span className="block text-meta text-slate">{ago(e.at)}</span>
                    </span>
                  </button>
                </m.li>
              );
            })
          ) : (
            <li className="px-3 py-4 text-sm text-slate">Bills, payments, approvals and production recorded by anyone will appear here as they happen.</li>
          )}
        </AnimatePresence>
      </ul>
    </section>
  );
}
