import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Menu as MenuIcon, X } from 'lucide-react';
import { ROLE_LABEL } from '@app/contract';
import { useMe } from '../lib/session';
import { navFor } from './nav';
import { TopBar } from './TopBar';

export function BrandMark({ logo, size = 28 }: { logo?: string; size?: number }) {
  return logo ? (
    <img src={logo} alt="" width={size} height={size} className="shrink-0 rounded-[6px] bg-white object-contain" style={{ width: size, height: size }} />
  ) : (
    <img src="/mark.svg" alt="" width={size} height={size} className="shrink-0" style={{ width: size, height: size }} />
  );
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const me = useMe();
  const groups = navFor(me.user.role);
  return (
    <nav aria-label="Main" className="flex h-full flex-col bg-deep text-white">
      <div className={`flex h-14 items-center gap-3 border-b border-white/10 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
        <BrandMark logo={me.branding.logoDataUrl} />
        {!collapsed ? <span className="truncate text-base font-semibold">{me.branding.brandName}</span> : null}
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        {groups.map((g) => (
          <div key={g.label} className="mb-3">
            {!collapsed ? <p className="px-5 pb-1 text-meta text-white/70">{g.label}</p> : <div className="mx-3 mb-1 h-px bg-white/10" />}
            <ul>
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.to === '/' || it.to === '/bills' || it.to === '/payments'}
                    onClick={onNavigate}
                    title={collapsed ? it.label : undefined}
                    className={({ isActive }) =>
                      `relative flex h-9 items-center gap-3 text-base transition-colors duration-120 ${collapsed ? 'justify-center px-2' : 'px-5'} ${isActive ? 'bg-white/10 font-medium text-white' : 'text-white/75 hover:bg-white/5 hover:text-white'}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brown" aria-hidden /> : null}
                        <it.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                        {!collapsed ? <span className="truncate">{it.label}</span> : <span className="sr-only">{it.label}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {!collapsed ? (
        <div className="border-t border-white/10 px-5 py-3 text-meta text-white/80">
          {me.user.name}
          <span className="block text-white/70">{ROLE_LABEL[me.user.role]}</span>
        </div>
      ) : null}
    </nav>
  );
}

function RouteProgress() {
  const nav = useNavigation();
  const loc = useLocation();
  const [key, setKey] = useState(0);
  useEffect(() => setKey((k) => k + 1), [loc.pathname]);
  if (nav.state === 'idle') return <div key={key} className="no-print pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left animate-[route-progress_240ms_cubic-bezier(0.2,0,0,1)_forwards] bg-tide opacity-0 transition-opacity delay-200 duration-180" />;
  return <div className="no-print pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 origin-left animate-[route-progress_1.2s_cubic-bezier(0.2,0,0,1)_forwards] bg-tide" />;
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open'), [collapsed]);
  return (
    <div className="flex min-h-screen">
      <RouteProgress />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-ctl focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className={`no-print sticky top-0 hidden h-screen shrink-0 transition-[width] duration-240 ease-std lg:block ${collapsed ? 'w-16' : 'w-sidebar'}`}>
        <Sidebar collapsed={collapsed} />
      </aside>
      {mobileOpen ? (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-deep/30" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-sidebar shadow-float">
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </div>
          <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="absolute left-[244px] top-3 rounded-ctl bg-white p-2 text-deep">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          leading={
            <>
              <button type="button" className="rounded-ctl p-2 text-slate hover:bg-mist lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
                <MenuIcon className="h-5 w-5" strokeWidth={1.5} />
              </button>
              <button type="button" className="hidden rounded-ctl p-2 text-slate hover:bg-mist hover:text-deep lg:inline-flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed((c) => !c)}>
                {collapsed ? <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} /> : <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />}
              </button>
            </>
          }
        />
        <main id="main" className="min-w-0 flex-1">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
