import type { ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation, type RouteObject } from 'react-router-dom';
import type { Role } from '@app/contract';
import { LoginPage } from './features/login/LoginPage';
import { NotFound, RequireRole, RouteError } from './features/common';
import { RealtimeProvider } from './lib/realtime';
import { SessionProvider, useSession } from './lib/session';
import { AppShell } from './shell/AppShell';
import { Skeleton, ToastProvider } from './ui/feedback';

const ALL: Role[] = ['ADMIN', 'STAFF', 'OPERATING', 'MONITOR', 'COLLECTOR', 'DISTRIBUTOR'];
const A: Role[] = ['ADMIN'];
const SELL: Role[] = ['ADMIN', 'STAFF', 'OPERATING'];
const COMPANY: Role[] = ['ADMIN', 'MONITOR', 'COLLECTOR'];
const W: Role[] = ['STAFF', 'OPERATING'];

/** Lazy route with a role guard: direct URL access outside the role shows "no access". */
function page(path: string, roles: Role[], load: () => Promise<ComponentType>): RouteObject {
  return {
    path,
    lazy: async () => {
      const C = await load();
      return {
        Component: () => (
          <RequireRole roles={roles}>
            <C />
          </RequireRole>
        ),
      };
    },
  };
}

function Splash() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-sidebar bg-deep lg:block" />
      <div className="flex-1 p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-6 h-24 w-full" />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    </div>
  );
}

function Gate() {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <RealtimeProvider enabled>
      <AppShell>
        <Outlet />
      </AppShell>
    </RealtimeProvider>
  );
}

function Root() {
  return (
    <SessionProvider>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </SessionProvider>
  );
}

function HomeRedirect() {
  const { role } = useSession();
  return role === 'DISTRIBUTOR' ? <Navigate to="/portal" replace /> : null;
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <Gate />,
        errorElement: <RouteError />,
        children: [
          {
            path: '/',
            lazy: async () => {
              const { HomeDashboard } = await import('./features/dashboard/HomeDashboard');
              return {
                Component: () => (
                  <>
                    <HomeRedirect />
                    <HomeDashboard />
                  </>
                ),
              };
            },
          },
          page('/portal', ['DISTRIBUTOR'], () => import('./features/distributor/Portal').then((m) => m.Portal)),
          page('/ledger', ['DISTRIBUTOR'], () => import('./features/distributor/Portal').then((m) => m.MyLedger)),
          page('/order-requests', ['ADMIN', 'DISTRIBUTOR'], () => import('./features/distributor/OrderRequests').then((m) => m.OrderRequests)),
          page('/explorer', [...COMPANY, ...W], () => import('./features/explorer/Explorer').then((m) => m.Explorer)),

          page('/bills/new', SELL, () => import('./features/billing/BillEditor').then((m) => m.BillEditor)),
          page('/bills/:id/edit', SELL, () => import('./features/billing/BillEditor').then((m) => m.BillEditor)),
          page('/bills', [...SELL, 'DISTRIBUTOR', 'MONITOR', 'COLLECTOR'], () => import('./features/billing/BillsList').then((m) => m.BillsList)),
          page('/bills/:id', [...SELL, 'DISTRIBUTOR', 'MONITOR', 'COLLECTOR'], () => import('./features/billing/BillDetail').then((m) => m.BillDetail)),
          page('/bills/:id/print', [...SELL, 'DISTRIBUTOR', 'MONITOR', 'COLLECTOR'], () => import('./print/pages').then((m) => m.InvoicePrintPage)),
          page('/payments/new', SELL, () => import('./features/payments/ReceivePayment').then((m) => m.ReceivePayment)),
          page('/payments', [...SELL, 'DISTRIBUTOR'], () => import('./features/payments/Receipts').then((m) => m.Receipts)),
          page('/payments/:id/print', [...SELL, 'DISTRIBUTOR'], () => import('./print/pages').then((m) => m.ReceiptPrintPage)),
          page('/dues', SELL, () => import('./features/payments/Dues').then((m) => m.Dues)),
          page('/customers', [...SELL, 'MONITOR', 'COLLECTOR'], () => import('./features/customers/Customers').then((m) => m.Customers)),
          page('/customers/:id', [...SELL, 'MONITOR', 'COLLECTOR'], () => import('./features/customers/CustomerProfile').then((m) => m.CustomerProfile)),

          page('/funds', COMPANY, () => import('./features/funds/Funds').then((m) => m.Funds)),
          page('/approvals', A, () => import('./features/purchasing/Approvals').then((m) => m.Approvals)),
          page('/indents', [...COMPANY, 'OPERATING'], () => import('./features/purchasing/Indents').then((m) => m.Indents)),
          page('/indents/new', A, () => import('./features/purchasing/IndentEditor').then((m) => m.IndentEditor)),
          page('/indents/:id/edit', A, () => import('./features/purchasing/IndentEditor').then((m) => m.IndentEditor)),
          page('/indents/:id', [...COMPANY, 'OPERATING'], () => import('./features/purchasing/IndentDetail').then((m) => m.IndentDetail)),
          page('/indents/:id/po', [...COMPANY, 'OPERATING'], () => import('./print/pages').then((m) => m.PurchaseOrderPrintPage)),
          page('/purchase-bills', [...COMPANY, 'OPERATING'], () => import('./features/purchasing/PurchaseBills').then((m) => m.PurchaseBills)),
          page('/purchase-bills/new', ['ADMIN', 'OPERATING'], () => import('./features/purchasing/PurchaseBillEditor').then((m) => m.PurchaseBillEditor)),
          page('/purchase-bills/:id/print', [...COMPANY, 'OPERATING'], () => import('./print/pages').then((m) => m.GoodsReceiptPrintPage)),
          page('/supplier-payments/:id/print', A, () => import('./print/pages').then((m) => m.SupplierVoucherPrintPage)),

          page('/inventory', [...COMPANY, 'OPERATING'], () => import('./features/inventory/Tracker').then((m) => m.Tracker)),
          page('/inventory/:kind/:id', [...COMPANY, 'OPERATING'], () => import('./features/inventory/ItemDetail').then((m) => m.ItemDetail)),
          page('/production', [...COMPANY, 'OPERATING'], () => import('./features/inventory/Production').then((m) => m.Production)),
          page('/production/new', ['ADMIN', 'OPERATING'], () => import('./features/inventory/ProductionEditor').then((m) => m.ProductionEditor)),
          page('/production/:id/print', [...COMPANY, 'OPERATING'], () => import('./print/pages').then((m) => m.BatchPrintPage)),
          page('/stock-take', ['ADMIN', 'OPERATING'], () => import('./features/inventory/StockTake').then((m) => m.StockTake)),

          page('/ledgers', COMPANY, () => import('./features/accounts/Ledgers').then((m) => m.Ledgers)),
          page('/daybook', COMPANY, () => import('./features/accounts/DayBook').then((m) => m.DayBook)),
          page('/expenses', [...COMPANY, 'OPERATING'], () => import('./features/accounts/Expenses').then((m) => m.Expenses)),
          page('/reports', ALL.filter((r) => r !== 'DISTRIBUTOR'), () => import('./features/reports/Reports').then((m) => m.Reports)),
          page('/reports/:key', ALL, () => import('./features/reports/ReportView').then((m) => m.ReportView)),

          page('/my/pay', W, () => import('./features/people/MyPay').then((m) => m.MyPay)),
          page('/attendance', A, () => import('./features/people/Attendance').then((m) => m.Attendance)),
          page('/payroll', A, () => import('./features/people/Payroll').then((m) => m.Payroll)),
          page('/payroll/new', A, () => import('./features/people/PayslipEditor').then((m) => m.PayslipEditor)),
          page('/payroll/:id', A, () => import('./features/people/PayslipEditor').then((m) => m.PayslipEditor)),
          page('/payslips/:id/print', [...A, ...W], () => import('./print/pages').then((m) => m.PayslipPrintPage)),
          page('/settlements', A, () => import('./features/people/Settlements').then((m) => m.Settlements)),
          page('/settlements/new', A, () => import('./features/people/SettlementEditor').then((m) => m.SettlementEditor)),
          page('/settlements/:id', A, () => import('./features/people/SettlementDetail').then((m) => m.SettlementDetail)),
          page('/settlements/:id/print', A, () => import('./print/pages').then((m) => m.ConsolidatedPrintPage)),
          page('/workers', A, () => import('./features/people/Workers').then((m) => m.Workers)),

          page('/masters', A, () => import('./features/setup/Masters').then((m) => m.Masters)),
          page('/masters/import', A, () => import('./features/setup/ExcelImport').then((m) => m.ExcelImport)),
          page('/settings', A, () => import('./features/setup/Settings').then((m) => m.SettingsPage)),
          page('/audit', A, () => import('./features/setup/Audit').then((m) => m.Audit)),
          page('/system', A, () => import('./features/setup/System').then((m) => m.SystemPage)),
          page('/print/table', ALL, () => import('./print/table').then((m) => m.TablePrintPage)),
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
