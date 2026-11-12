import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DomainEvent } from '@app/contract';
import { api, onCrossTabMutation } from '../api/client';

interface RealtimeValue {
  events: (DomainEvent & { fresh: boolean })[];
  status: 'live' | 'reconnecting' | 'paused';
  lastSync: number | null;
}

const Ctx = createContext<RealtimeValue>({ events: [], status: 'paused', lastSync: null });
export const useRealtime = () => useContext(Ctx);

/**
 * Polls GET /events every 2 s (10 s when the tab is hidden, backoff on errors).
 * New events refresh the screens; BroadcastChannel makes same-browser tabs update instantly.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<RealtimeValue['events']>([]);
  const [status, setStatus] = useState<RealtimeValue['status']>('paused');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const cursor = useRef(0);
  const failures = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setStatus('paused');
      return;
    }
    let stop = false;
    let timer: number | undefined;
    const refresh = () => void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    const offTab = onCrossTabMutation(refresh);
    const tick = async () => {
      try {
        const after = cursor.current;
        const r = await api.get<{ cursor: number; items: DomainEvent[] }>('/events', { after });
        if (stop) return;
        const first = after === 0;
        cursor.current = r.cursor;
        failures.current = 0;
        setStatus('live');
        setLastSync(Date.now());
        if (r.items.length) {
          setEvents((prev) => {
            const seen = new Set(prev.map((e) => e.seq));
            const added = r.items.filter((e) => !seen.has(e.seq)).map((e) => ({ ...e, fresh: !first }));
            return [...added.reverse(), ...prev.map((e) => ({ ...e, fresh: false }))].slice(0, 40);
          });
          if (!first) {
            if (r.items.some((e) => e.type === 'branding.update')) void qc.invalidateQueries({ queryKey: ['me'] });
            refresh();
          }
        }
      } catch {
        failures.current++;
        setStatus('reconnecting');
      }
      if (stop) return;
      const base = document.hidden ? 10_000 : 2_000;
      const delay = failures.current ? Math.min(30_000, base * 2 ** failures.current) : base;
      timer = window.setTimeout(tick, delay);
    };
    void tick();
    const onVis = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      offTab();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, qc]);

  return <Ctx.Provider value={{ events, status, lastSync }}>{children}</Ctx.Provider>;
}
