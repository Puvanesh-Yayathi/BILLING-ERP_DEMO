import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { ApiError } from '../api/client';
import { Button } from './Button';

/* Toasts: same wording as the button and the audit log. */
interface Toast {
  id: number;
  kind: 'success' | 'error';
  text: string;
}
const ToastCtx = createContext<{ push: (kind: Toast['kind'], text: string) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite" role="status">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <m.div
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
              className="pointer-events-auto flex items-start gap-3 rounded-panel border border-hairline bg-white px-4 py-3 shadow-float"
            >
              {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={1.5} /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} />}
              <p className="flex-1 text-sm text-deep">{t.text}</p>
              <button type="button" aria-label="Dismiss" className="text-slate hover:text-deep" onClick={() => setItems((x) => x.filter((y) => y.id !== t.id))}>
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const { push } = useContext(ToastCtx);
  return {
    success: (text: string) => push('success', text),
    error: (e: unknown) => push('error', errorText(e)),
  };
}

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429 && e.retryAfter) return `${e.message.replace(/ Try again.*$/, '')} Try again in ${e.retryAfter} seconds.`;
    if (e.status === 409 && e.code === 'STALE') return 'This record was changed by someone else. Reload to see the latest version.';
    const detail = e.code === 'INTERNAL' && e.details && typeof (e.details as Record<string, unknown>).error === 'string' ? ` (${String((e.details as Record<string, unknown>).error)})` : '';
    return `${e.message}${detail}`;
  }
  return 'Something went wrong. Try again.';
}

/* Loading, empty and error states. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-hairline" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-10 items-center gap-6 px-4">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={`h-3 ${c === 0 ? 'w-28' : c === cols - 1 ? 'ml-auto w-20' : 'w-24'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-6 py-10">
      <p className="text-section font-semibold text-deep">{title}</p>
      <p className="max-w-md text-base text-slate">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 border-l-2 border-danger px-6 py-8" role="alert">
      <p className="text-section font-semibold text-deep">This could not be loaded</p>
      <p className="max-w-md text-base text-slate">{errorText(error)}</p>
      {onRetry ? (
        <Button size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="border-l-2 border-danger pl-3 text-sm text-deep" role="alert">
      {errorText(error)}
    </p>
  );
}
