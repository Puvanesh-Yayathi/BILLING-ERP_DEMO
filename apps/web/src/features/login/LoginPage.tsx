import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { m } from 'framer-motion';
import { Check, Eye, EyeOff } from 'lucide-react';
import type { MeResponse } from '@app/contract';
import { api, ApiError } from '../../api/client';
import { applyBranding, useSession } from '../../lib/session';
import { Spinner } from '../../ui/Button';
import { errorText } from '../../ui/feedback';
import { Contours } from './Contours';

const DEMO_ACCOUNTS: { username: string; name: string; work: string }[] = [
  { username: 'admin', name: 'Admin', work: 'Everything: approvals, purchases, stock, payroll, settlement, reports' },
  { username: 'staff1', name: 'Worker A, Staff', work: 'Billing and payments. Fixed pay.' },
  { username: 'staff2', name: 'Worker B, Staff', work: 'Billing and payments. Hourly pay.' },
  { username: 'staff3', name: 'Worker C, Staff', work: 'Billing and payments. Profit share.' },
  { username: 'monitor', name: 'Monitor', work: 'Read only: sales, purchases, stock, funds and reports. No profit figures.' },
  { username: 'collector', name: 'Collector', work: 'Read only: sales, purchases, stock, funds and reports. No profit figures.' },
  { username: 'distributor', name: 'Distributor A', work: 'Own bills, ledger and order requests' },
];
const DEMO_PASSWORD = 'Demo@123';

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function LoginPage() {
  const { me, setMe } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const branding = useQuery({ queryKey: ['branding'], queryFn: () => api.get<{ brandName: string; logoDataUrl?: string; faviconDataUrl?: string }>('/branding'), refetchInterval: 15_000 });
  const remembered = localStorage.getItem('remembered-username') ?? '';
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(!!remembered);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const userRef = useRef<HTMLInputElement>(null);
  // The entrance plays once per browser session.
  const [intro] = useState(() => !sessionStorage.getItem('login-intro'));
  useEffect(() => sessionStorage.setItem('login-intro', '1'), []);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => applyBranding(branding.data, 'Sign in'), [branding.data]);
  useEffect(() => {
    (remembered ? passRef : userRef).current?.focus();
  }, [remembered]);
  useEffect(() => {
    if (!until) return;
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) {
        setUntil(null);
        setError(null);
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [until]);

  if (me && !done) return <Navigate to={me.user.role === 'DISTRIBUTOR' ? '/portal' : '/'} replace />;

  const notice = params.get('timeout') ? 'You were signed out after 30 minutes without activity.' : params.get('expired') ? 'Your session has ended. Sign in again.' : null;
  const locked = until !== null && until > now;
  const lockText = locked ? `Too many attempts. Try again in ${mmss(Math.ceil((until - now) / 1000))}` : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || locked) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<MeResponse>('/auth/login', { username: username.trim(), password });
      if (remember) localStorage.setItem('remembered-username', username.trim());
      else localStorage.removeItem('remembered-username');
      setDone(true);
      window.setTimeout(() => {
        setMe(r);
        navigate(r.user.role === 'DISTRIBUTOR' ? '/portal' : '/', { replace: true });
      }, 420);
    } catch (err) {
      setPassword('');
      if (err instanceof ApiError && (err.code === 'LOCKED' || err.code === 'RATE_LIMITED') && err.retryAfter) {
        setUntil(Date.now() + err.retryAfter * 1000);
        setNow(Date.now());
        setError(null);
      } else if (err instanceof ApiError && err.status === 401) setError('The username or password is not correct.');
      else setError(err instanceof ApiError ? errorText(err) : 'Cannot sign in right now. Try again.');
      passRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const brand = branding.data?.brandName ?? '';
  return (
    <m.div className="flex min-h-screen flex-col lg:flex-row" animate={{ opacity: done ? 0 : 1 }} transition={{ duration: 0.24, delay: done ? 0.18 : 0 }}>
      <section className="relative flex h-44 shrink-0 flex-col justify-between overflow-hidden bg-deep px-6 py-6 text-white sm:h-56 lg:h-auto lg:w-[56%] lg:px-14 lg:py-12">
        <Contours className="absolute inset-0 h-full w-full" animate={intro} />
        <div className="relative flex items-center gap-3">
          {branding.data?.logoDataUrl ? <img src={branding.data.logoDataUrl} alt="" className="h-9 w-9 rounded-[6px] bg-white object-contain" /> : <img src="/mark.svg" alt="" className="h-9 w-9" />}
          <span className="text-section font-semibold">{brand || ' '}</span>
        </div>
        <h1 className="relative max-w-md text-[26px] font-semibold leading-[1.15] sm:text-[32px] lg:text-login">
          Billing, stock and accounts
          <br />
          in one place.
        </h1>
      </section>
      <m.section
        className="flex flex-1 flex-col bg-white px-6 py-10 sm:px-10 lg:w-[44%] lg:justify-center lg:px-16"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.24, delay: intro ? 1.2 : 0, ease: [0.2, 0, 0, 1] }}
      >
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-title font-semibold text-deep">Sign in</h2>
          {notice ? <p className="mt-3 border-l-2 border-caution pl-3 text-sm text-deep">{notice}</p> : null}
          <form className="mt-8 flex flex-col gap-5" onSubmit={submit} noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="username" className="label">
                Username
              </label>
              <input
                ref={userRef}
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-10 rounded-ctl border border-hairline px-3 text-base text-deep focus:border-tide focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="label">
                Password
              </label>
              <div className="relative">
                <input
                  ref={passRef}
                  id="password"
                  name="password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                  onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))}
                  aria-describedby={caps ? 'caps' : undefined}
                  className="h-10 w-full rounded-ctl border border-hairline px-3 pr-20 text-base text-deep focus:border-tide focus:outline-none"
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1 inline-flex h-8 items-center gap-1.5 rounded-ctl px-2 text-sm font-medium text-tide hover:bg-mist" aria-pressed={show}>
                  {show ? <EyeOff className="h-4 w-4" strokeWidth={1.5} /> : <Eye className="h-4 w-4" strokeWidth={1.5} />}
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
              {caps ? (
                <p id="caps" className="text-meta text-brown">
                  Caps Lock is on
                </p>
              ) : null}
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-tide" />
              Remember my username on this device
            </label>
            <div aria-live="polite" className="min-h-[20px]">
              {lockText ? <p className="text-sm font-medium text-danger">{lockText}</p> : error ? <p className="text-sm text-danger">{error}</p> : null}
            </div>
            <button
              type="submit"
              disabled={busy || locked}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-ctl bg-tide text-base font-medium text-white transition-colors duration-120 hover:bg-deep disabled:cursor-not-allowed disabled:bg-hairline disabled:text-slate"
            >
              {done ? <Check className="h-4 w-4" strokeWidth={2} /> : busy ? <Spinner /> : null}
              {done ? 'Signed in' : 'Sign in'}
            </button>
            <p className="text-sm text-slate">Need access? Ask your administrator.</p>
          </form>
          <section className="mt-10 border-t border-hairline pt-6" aria-labelledby="demo-accounts">
            <h3 id="demo-accounts" className="text-base font-semibold text-deep">
              Demo accounts
            </h3>
            <p className="mt-1 text-sm text-slate">
              Every account uses the password <span className="font-medium text-deep">{DEMO_PASSWORD}</span>. Choose one to fill the form.
            </p>
            <ul className="mt-3 divide-y divide-hairline rounded-panel border border-hairline">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.username}>
                  <button
                    type="button"
                    onClick={() => {
                      setUsername(a.username);
                      setPassword(DEMO_PASSWORD);
                      setError(null);
                      passRef.current?.focus();
                    }}
                    className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-mist"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-deep">{a.name}</span>
                      <span className="block text-meta text-slate">{a.work}</span>
                    </span>
                    <span className="shrink-0 font-medium text-sm text-tide">{a.username}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </m.section>
    </m.div>
  );
}
