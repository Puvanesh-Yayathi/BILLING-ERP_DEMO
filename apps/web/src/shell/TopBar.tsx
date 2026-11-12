import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Popover from '@radix-ui/react-popover';
import { Bell, ChevronDown, Search } from 'lucide-react';
import { formatINR, formatTime, ROLE_LABEL, type Notification } from '@app/contract';
import { api } from '../api/client';
import { useRealtime } from '../lib/realtime';
import { useMe, useSession } from '../lib/session';
import { Button } from '../ui/Button';
import { DropMenu } from '../ui/overlay';
import { BrandMark } from './AppShell';

function minutesText(m: number) {
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}

/** Workers only: "Clocked in 9:02 AM, 3 h 14 m today". Clock out simply signs out. */
function ClockWidget() {
  const me = useMe();
  const { logout } = useSession();
  const [, tick] = useState(0);
  const loadedAt = useRef(Date.now());
  useEffect(() => {
    loadedAt.current = Date.now();
  }, [me.clock?.minutesToday]);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const c = me.clock;
  if (!c?.clockedInAt) return null;
  const minutes = c.minutesToday + Math.floor((Date.now() - loadedAt.current) / 60000);
  return (
    <div className="hidden items-center gap-3 border-l border-hairline pl-4 md:flex">
      <span className="flex items-center gap-2 text-sm text-deep">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
        Clocked in {formatTime(c.clockedInAt)}, {minutesText(minutes)} today
      </span>
      <Button size="sm" variant="quiet" onClick={() => void logout('LOGOUT')}>
        Clock out
      </Button>
    </div>
  );
}

function LiveIndicator() {
  const { status, lastSync } = useRealtime();
  const label = status === 'live' ? 'Live' : status === 'reconnecting' ? 'Reconnecting' : 'Paused';
  return (
    <span className="hidden items-center gap-1.5 text-meta text-slate sm:inline-flex" title={lastSync ? `Last synced ${new Date(lastSync).toLocaleTimeString('en-IN')}` : undefined} aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-success' : status === 'reconnecting' ? 'bg-caution' : 'bg-slate'}`} aria-hidden />
      {label}
    </span>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'), refetchInterval: 30_000 });
  const unread = q.data?.unread ?? 0;
  const read = async (id: string) => {
    await api.post(`/notifications/${id}/read`);
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <Popover.Root>
      <Popover.Trigger className="relative inline-flex h-9 w-9 items-center justify-center rounded-ctl text-slate hover:bg-mist hover:text-deep" aria-label={`Notifications, ${unread} unread`}>
        <Bell className="h-4 w-4" strokeWidth={1.5} />
        {unread ? <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-brown px-1 text-[10px] font-semibold leading-4 text-white">{unread > 9 ? '9+' : unread}</span> : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(380px,calc(100vw-24px))] rounded-panel border border-hairline bg-white shadow-float">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <p className="text-base font-semibold">Notifications</p>
            {unread ? (
              <button type="button" className="link text-sm" onClick={() => void read('all')}>
                Mark all read
              </button>
            ) : null}
          </div>
          <ul className="max-h-[420px] overflow-y-auto">
            {q.data?.items.length ? (
              q.data.items.map((n) => (
                <li key={n.id} className="border-b border-hairline last:border-0">
                  <button
                    type="button"
                    onClick={() => {
                      void read(n.id);
                      navigate(n.link);
                    }}
                    className="relative flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-mist"
                  >
                    {!n.read ? <span className="absolute inset-y-3 left-0 w-0.5 bg-tide" aria-label="Unread" /> : null}
                    <span className={`text-sm ${n.read ? 'text-deep' : 'font-semibold text-deep'}`}>{n.title}</span>
                    <span className="text-sm text-slate">{n.body}</span>
                    <span className="text-meta text-slate">{new Date(n.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-sm text-slate">Approvals, payslips and stock alerts for you will appear here.</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface SearchHit {
  kind: string;
  label: string;
  sub: string;
  to: string;
}

function GlobalSearch() {
  const me = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const role = me.user.role;
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      const out: SearchHit[] = [];
      const jobs: Promise<void>[] = [];
      jobs.push(
        api.get<{ items: { id: string; number: string | null; customer: string; total: number }[] }>('/invoices', { q, limit: 5 }).then((r) => {
          for (const i of r.items) out.push({ kind: 'Bill', label: i.number ?? 'Draft bill', sub: `${i.customer}, ${formatINR(i.total)}`, to: `/bills/${i.id}` });
        }),
      );
      if (role !== 'DISTRIBUTOR')
        jobs.push(
          api.get<{ items: { id: string; name: string; code: string; type: string }[] }>('/customers', { q }).then((r) => {
            for (const c of r.items.slice(0, 5)) out.push({ kind: c.type === 'DISTRIBUTOR' ? 'Distributor' : 'Customer', label: c.name, sub: c.code, to: `/customers/${c.id}` });
          }),
        );
      if (role === 'ADMIN' || role === 'OPERATING' || role === 'MONITOR' || role === 'COLLECTOR')
        jobs.push(
          api.get<{ items: { id: string; name: string; code: string; stock: number }[] }>('/products', { q }).then((r) => {
            for (const p of r.items.slice(0, 5)) out.push({ kind: 'Product', label: `${p.code} ${p.name}`, sub: `Stock ${p.stock}`, to: `/inventory/sales/${p.id}` });
          }),
        );
      await Promise.allSettled(jobs);
      setHits(out);
      setActive(0);
    }, 200);
    return () => window.clearTimeout(t);
  }, [q, role]);
  const go = (h: SearchHit) => {
    setOpen(false);
    setQ('');
    navigate(h.to);
  };
  return (
    <Popover.Root open={open && q.trim().length >= 2} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate" strokeWidth={1.5} />
          <input
            type="search"
            aria-label="Search bills, customers and products"
            placeholder="Search bills, customers, products"
            value={q}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
              else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              else if (e.key === 'Enter' && hits[active]) go(hits[active]);
              else if (e.key === 'Escape') setOpen(false);
            }}
            className="h-9 w-full rounded-ctl border border-hairline bg-mist pl-9 pr-3 text-base text-deep placeholder:text-slate focus:border-tide focus:bg-white focus:outline-none"
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[320px] rounded-panel border border-hairline bg-white py-1 shadow-float">
          {hits.length ? (
            <ul role="listbox" aria-label="Search results">
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.to}`} role="option" aria-selected={i === active}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left ${i === active ? 'bg-mist' : ''}`}>
                    <span className="min-w-0">
                      <span className="block truncate text-base text-deep">{h.label}</span>
                      <span className="block truncate text-meta text-slate">{h.sub}</span>
                    </span>
                    <span className="text-meta text-slate">{h.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate">No matches for “{q}”.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TopBar({ leading }: { leading?: ReactNode }) {
  const me = useMe();
  const { logout } = useSession();
  const navigate = useNavigate();
  const worker = me.user.role === 'STAFF' || me.user.role === 'OPERATING';
  return (
    <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-hairline bg-white px-3 sm:px-4">
      {leading}
      <div className="flex items-center gap-2 lg:hidden">
        <BrandMark logo={me.branding.logoDataUrl} size={24} />
        <span className="hidden truncate text-base font-semibold sm:inline">{me.branding.brandName}</span>
      </div>
      <div className="hidden flex-1 md:block">
        <GlobalSearch />
      </div>
      <div className="ml-auto flex items-center gap-3">
        {worker ? <ClockWidget /> : null}
        <LiveIndicator />
        <Notifications />
        <DropMenu
          trigger={
            <button type="button" className="inline-flex h-9 items-center gap-2 rounded-ctl px-2 text-base text-deep hover:bg-mist">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-mist text-sm font-semibold text-deep">{me.user.name.slice(0, 1)}</span>
              <span className="hidden text-left sm:block">
                <span className="block text-sm font-medium leading-4">{me.user.name}</span>
                <span className="block text-meta text-slate">{ROLE_LABEL[me.user.role]}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate" strokeWidth={1.5} />
            </button>
          }
          items={[
            ...(worker ? [{ label: 'My pay', onSelect: () => navigate('/my/pay') }] : []),
            ...(me.user.role === 'ADMIN' ? [{ label: 'Settings', onSelect: () => navigate('/settings') }] : []),
            { label: worker ? 'Clock out and sign out' : 'Sign out', onSelect: () => void logout('LOGOUT') },
          ]}
        />
      </div>
    </header>
  );
}
