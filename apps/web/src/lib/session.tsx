import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { MeResponse, Role } from '@app/contract';
import { api, SESSION_EXPIRED } from '../api/client';

interface SessionValue {
  me: MeResponse | null;
  loading: boolean;
  role: Role | null;
  logout: (reason?: 'LOGOUT' | 'TIMEOUT') => Promise<void>;
  setMe: (me: MeResponse) => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}

export function useMe(): MeResponse {
  const { me } = useSession();
  if (!me) throw new Error('Not signed in');
  return me;
}

/** Applies the brand name and favicon from the company profile to the browser tab. */
export function applyBranding(b: { brandName: string; faviconDataUrl?: string } | undefined, page?: string) {
  if (!b) return;
  document.title = page ? `${page} | ${b.brandName}` : b.brandName;
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) {
    const href = b.faviconDataUrl ?? '/mark.svg';
    if (link.getAttribute('href') !== href) {
      link.setAttribute('href', href);
      link.setAttribute('type', href.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
    }
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ me: MeResponse | null }>('/auth/session')).me,
    staleTime: 30_000,
    retry: false,
  });
  const me = q.data ?? null;
  const lastActivity = useRef(Date.now());

  const logout = useCallback(
    async (reason: 'LOGOUT' | 'TIMEOUT' = 'LOGOUT') => {
      try {
        await api.post('/auth/logout', { reason });
      } catch {
        /* the session may already have ended */
      }
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (x) => x.queryKey[0] !== 'me' && x.queryKey[0] !== 'branding' });
      navigate(reason === 'TIMEOUT' ? '/login?timeout=1' : '/login', { replace: true });
    },
    [qc, navigate],
  );

  useEffect(() => {
    const expired = () => {
      qc.setQueryData(['me'], null);
      navigate('/login?expired=1', { replace: true });
    };
    window.addEventListener(SESSION_EXPIRED, expired);
    return () => window.removeEventListener(SESSION_EXPIRED, expired);
  }, [qc, navigate]);

  useEffect(() => {
    applyBranding(me?.branding);
  }, [me?.branding]);

  // Idle timeout and heartbeat: heartbeats are sent only while the user is active, so idle time is not paid.
  useEffect(() => {
    if (!me) return;
    const mark = () => {
      lastActivity.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'mousemove', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const idleMs = me.idleTimeoutMinutes * 60_000;
    const beat = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= idleMs) void logout('TIMEOUT');
      else if (idle < 60_000) void api.post('/presence/heartbeat').then((r) => qc.setQueryData(['heartbeat'], r)).catch(() => undefined);
    }, 60_000);
    void api.post('/presence/heartbeat').catch(() => undefined);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(beat);
    };
  }, [me, logout, qc]);

  const value = useMemo<SessionValue>(
    () => ({ me, loading: q.isLoading, role: me?.user.role ?? null, logout, setMe: (m) => qc.setQueryData(['me'], m) }),
    [me, q.isLoading, logout, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
