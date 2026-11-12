# 07. API contract (`/api/v1`)

Conventions are in doc 06 (Request path). All endpoints require a session cookie except `POST /auth/login` and `GET /healthz`. Roles: **A** Admin, **S** Staff, **O** Operating, **M** Monitor, **C** Collector, **D** Distributor. "Own" means data created by or belonging to the caller, enforced in the service layer. All list endpoints support `limit`, `cursor`, sorting, and filters named in the table. All mutations accept `Idempotency-Key`; edits require `If-Match`. Money fields are integer paise. Errors: `{ code, message, details, requestId }`.

Generate the OpenAPI document from the zod schemas in `/packages/contract`, and keep this table in sync.

## Auth and session
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | Rate limited. Starts attendance for Staff and Operating. |
| POST | `/auth/logout` | all | Closes the open attendance session. |
| GET | `/auth/me` | all | User, role, company branding. |
| POST | `/presence/heartbeat` | S, O | Every 60 s while the app is open. Not conflict-prone (own key). |

## Workers, users, settings, company
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET, POST | `/workers` | A | POST creates worker plus optional login (login ID, password). Enforces `maxWorkerLogins`. |
| GET, PATCH | `/workers/:id` | A | Pay type, rates, share percent, reduce-by-absence switch. |
| POST | `/workers/:id/reset-password` | A | Signs the worker out everywhere. |
| POST | `/workers/:id/deactivate` | A | |
| GET, POST, PATCH | `/users` | A | Monitor, Collector, Distributor, Admin accounts. No self password change for non-admins. |
| GET, PUT | `/settings` | A | Rounding rule, working-day rules, rate limits, `maxWorkerLogins`, reduce-by-absence default, due days. |
| GET, PUT | `/calendar` | A | Weekly off days. `POST /calendar/holidays`, `DELETE /calendar/holidays/:id`. |
| GET | `/company-profile` | all | Current version (branding for every page). |
| PUT | `/company-profile` | A | Creates a **new version**. `GET /company-profile/versions`. |
| POST | `/assets/logo` | A | Type, size check, re-encode. |

## Masters
CRUD under each path, Admin writes, others read as permitted by doc 02. Filters: `q`, `active`, `category`.
`/customers` · `/suppliers` · `/products` (Sales Inventory items and prices) · `/purchase-items` (Purchase List) · `/units` · `/product-categories` · `/expense-heads` · `/bank-accounts` · `/opening-balances`
Imports: `GET /templates/:master` (Excel template), `POST /imports/:master/preview`, `POST /imports/:master/commit` (A).

## Sales and payments
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/invoices` | A, S, O (own), M, C (read), D (own) | Filters: `status`, `type`, `customerId`, `createdById`, `from`, `to`, `q`. |
| POST | `/invoices` | A, S, O | Creates draft. Server recalculates with `calcInvoice`. |
| GET, PATCH | `/invoices/:id` | as above | PATCH only while DRAFT. |
| POST | `/invoices/:id/finalize` | A, S, O | Locks, reduces stock (atomic), cash bill auto-payment, number assigned. Stores `companyProfileVersionId`. |
| POST | `/invoices/:id/cancel` | A | Reason required. Returns stock. |
| GET | `/invoices/:id/print-data` | as above | Data for the A4 template. |
| POST, GET | `/payments` | A, S, O | FIFO allocation or bill-wise. `GET /payments/:id/print-data`. |
| GET | `/dues` | A, S, O | Customer balances, ageing buckets, overdue. |
| GET | `/products/available` | A, S, O | Sales Inventory picker: code, name, price for customer type, live stock. |
| POST, GET | `/order-requests` | D (create, own), A (all) | `POST /order-requests/:id/convert` and `/reject` (A). |

## Funds and purchasing
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET, POST | `/fund-tranches` | A (write), M, C (read) | `isLoan`, lender. `GET /funds/summary` (received, committed, utilised, balance). |
| GET | `/loans` | A | Loans with outstanding. |
| GET, POST | `/indents` | A (create), M, C, O (read) | Items from the Purchase List, editable rates. |
| GET, PATCH | `/indents/:id` | A | PATCH while DRAFT or REJECTED. |
| POST | `/indents/:id/submit` | A | Fund warning in response. |
| POST | `/indents/:id/approve` | A (stage 1), M (stage 2), C (stage 3) | Stage derived from state. Wrong role returns 403. |
| POST | `/indents/:id/reject` | A, M, C (at their stage) | `remarks` required. |
| GET | `/approvals/inbox` | A, M, C | Only indents waiting at the caller's stage. |
| GET | `/indents/:id/po-print-data` | A, M, C, O | After final approval. |
| POST, GET | `/purchase-bills` | A, O (create), A, M, C, O (read) | Goods receipt plus supplier bill number, date, amount, actual rates, variance vs indent. |
| POST, GET | `/supplier-payments` | A | Counts toward fund utilisation. |

## Inventory and production
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/inventory/purchase` | A, O, M, C | Tracker: opening, received, used, adjusted, closing, status, average cost, value. |
| GET | `/inventory/sales` | A, O, M, C | Tracker with selling price and value. |
| GET | `/inventory/items/:kind/:id/movements` | A, O, M, C | Timeline and running balance. |
| POST | `/stock-adjustments` | A, O | Reason required. |
| POST | `/stock-counts`, `/stock-counts/:id/confirm` | A, O | Variances post as adjustments. |
| GET, POST | `/production-batches` | A, O (write), M, C (read) | Atomic raw down, finished up. |

## Ledgers, expenses
`GET /ledgers/:type/:id` (customer, distributor, supplier, cash, bank, expense-head, staff) · `GET /daybook` · `GET /cashflow` (A; M, C read) · `GET, POST /expenses` (A, O write; M, C read; "Other Expenses" with required description).

## Attendance and payroll
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/attendance` | A, O | Grid by date range and worker. |
| PUT | `/attendance/:id` | A | Edit with reason (flags `EDITED`). Locked days are refused. |
| POST | `/attendance/manual` | A | For workers without a login. |
| GET | `/my/attendance` | S, O | Own calendar, today's running hours. |
| GET, POST | `/advances` | A | |
| POST | `/payslips/preview` | A | FIXED or HOURLY, period inside one month. No overlap with PAID. |
| POST, GET | `/payslips` | A | Create draft, list. `POST /payslips/bulk-drafts`. |
| POST | `/payslips/:id/pay` | A | Date, mode, reference. Locks attendance, posts ledgers, notifies worker. |
| POST | `/payslips/:id/cancel` | A | Reason required. |
| GET | `/payslips/:id/print-data` | A, own worker | Other workers get 404. |
| GET | `/my/payslips` | S, O | Own only. |

## Profit settlement (Admin only)
`POST /settlements/preview` · `POST /settlements` (draft) · `GET /settlements`, `/settlements/:id` · `POST /settlements/:id/finalize` · `POST /settlements/:id/cancel` · `GET /settlements/:id/consolidated-print-data`. Monitor and Collector get 403 on all of these.

## Analytics, explorer, reports
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/analytics/overview` | A (full), M, C (no profit) | `period=day|week|month|year`, `date`, `compare=true`. |
| GET | `/analytics/workers`, `/analytics/hourly`, `/analytics/products`, `/analytics/dues-ageing` | A | |
| GET | `/my/analytics` | S, O | Own work only, same periods. |
| GET | `/explorer/sales`, `/explorer/purchases` | A (all), S, O (own), M, C (read) | `groupBy=worker|none`. |
| GET | `/reports/:key` | per matrix in doc 09 | 12 report keys. Excel and print are done in the browser. |

## Notifications, events, logs, system
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/notifications`, POST `/notifications/:id/read` | all | |
| GET | `/outbox` | A | Simulated emails. |
| GET | `/events?after=<cursor>` | all | Role and ownership filtered. Polled every 2 s. |
| GET | `/audit-log`, `/login-history`, `/presence` | A | Append-only. Filters and export. |
| GET | `/system/status`, `/system/requests` | A | Request log ring buffer: method, path, status, latency, request id, **function instance id**. |
| GET | `/openapi.json` | A | |
| POST | `/admin/reset`, GET `/admin/export`, POST `/admin/import` | A | Reset restores the seed. |
| GET | `/healthz` | public | |
