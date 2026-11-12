import { useEffect, useState, type ReactNode } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { addDays, formatDate, toISTDate, type Role } from '@app/contract';
import { useSession } from '../lib/session';
import { Button } from '../ui/Button';
import { Input } from '../ui/form';

export const today = () => toISTDate(new Date());
export const daysAgo = (n: number) => addDays(today(), -n);
export const monthStartOf = (d = today()) => `${d.slice(0, 7)}-01`;
export { formatDate };

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DateRange({ from, to, onChange, presets = true }: { from: string; to: string; onChange: (from: string, to: string) => void; presets?: boolean }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-meta text-slate">From</span>
        <Input type="date" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} className="w-[150px]" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-meta text-slate">To</span>
        <Input type="date" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} className="w-[150px]" />
      </label>
      {presets ? (
        <div className="flex gap-1">
          <Button size="sm" variant="quiet" onClick={() => onChange(today(), today())}>
            Today
          </Button>
          <Button size="sm" variant="quiet" onClick={() => onChange(monthStartOf(), today())}>
            This month
          </Button>
          <Button size="sm" variant="quiet" onClick={() => onChange(daysAgo(29), today())}>
            Last 30 days
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-slate">Search</span>
      <Input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-[240px]" />
    </label>
  );
}

export function NotAllowed() {
  return (
    <div className="px-6 py-16">
      <h1 className="text-title font-semibold text-deep">You do not have access to this page</h1>
      <p className="mt-2 max-w-md text-base text-slate">This page is not part of your role. Ask your administrator if you need access.</p>
      <Link to="/" className="link mt-4 inline-block">
        Go to your home page
      </Link>
    </div>
  );
}

/** Direct URL access to a page outside the role is refused (the server refuses the data too). */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useSession();
  if (!role || !roles.includes(role)) return <NotAllowed />;
  return <>{children}</>;
}

export function NotFound() {
  return (
    <div className="px-6 py-16">
      <h1 className="text-title font-semibold text-deep">This page does not exist</h1>
      <p className="mt-2 max-w-md text-base text-slate">Check the address, or go back to your home page.</p>
      <Link to="/" className="link mt-4 inline-block">
        Go to your home page
      </Link>
    </div>
  );
}

export function RouteError() {
  const err = useRouteError();
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  return (
    <div className="px-6 py-16">
      <h1 className="text-title font-semibold text-deep">{notFound ? 'This page does not exist' : 'This page could not be shown'}</h1>
      <p className="mt-2 max-w-md text-base text-slate">{notFound ? 'Check the address, or go back to your home page.' : 'Reload the page. If it happens again, note the time and tell your administrator.'}</p>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => window.location.reload()}>Reload</Button>
        <Link to="/" className="link inline-flex h-9 items-center px-2">
          Go to your home page
        </Link>
      </div>
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <span className="text-slate">{children}</span>;
}

export const MODE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', BANK: 'Bank transfer', CARD: 'Card' };
export const TYPE_LABEL: Record<string, string> = { CASH: 'Cash', CREDIT: 'Credit', DISTRIBUTOR: 'Distributor' };
export const PAYTYPE_LABEL: Record<string, string> = { FIXED: 'Fixed', HOURLY: 'Hourly', SHARE: 'Profit share' };
