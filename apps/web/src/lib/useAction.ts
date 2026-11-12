import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { useToast } from '../ui/feedback';

/**
 * Runs a mutation with busy state, field errors, a toast and a refresh of the open screens.
 * The success text uses the same wording as the button and the audit log.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: { success?: string | ((r: R) => string); onDone?: (r: R) => void; silentError?: boolean } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const running = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      setError(null);
      setDone(false);
      try {
        const r = await fn(...args);
        if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
        setDone(true);
        window.setTimeout(() => setDone(false), 1400);
        await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        opts.onDone?.(r);
        return r;
      } catch (e) {
        setError(e);
        if (!opts.silentError && !(e instanceof ApiError && e.code === 'VALIDATION' && Object.keys(e.fields).length > 1)) toast.error(e);
        return undefined;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn, qc],
  );
  const fields = error instanceof ApiError ? error.fields : {};
  return { run, busy, error, done, fields, reset: () => setError(null) };
}
