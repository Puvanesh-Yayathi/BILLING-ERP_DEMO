# Appendix: production target (NOT built in the demo)

Reference only. Do not build anything in this file. It describes where the product goes after the demo. Keep the demo's API contract and services compatible with it.

## 2. Production Target Stack (reference; NOT built in the demo)

| Concern | Choice |
|---|---|
| Framework | **Next.js 14+ (App Router) + TypeScript** |
| UI | **Tailwind CSS with Radix UI primitives (accessibility only), fully custom-styled to Section 8A**. Do **not** ship the default shadcn/ui theme or its stock look. lucide icons, **IBM Plex Sans** self-hosted, **Framer Motion** (or CSS transitions) for the motion system, responsive (desktop, tablet, mobile) |
| DB / ORM | **PostgreSQL 16 via Prisma** (needed because several app instances share one database) |
| Cache, limits, pub/sub, queue | **Redis 7** (rate limiting, dashboard cache, live-event pub/sub, **BullMQ** job queue) |
| Edge | **nginx** reverse proxy and load balancer in front of 2 to 3 identical app containers |
| Realtime | **Server-Sent Events** (SSE) fed by Redis pub/sub |
| Auth | Credentials login, **bcrypt** password hashing, JWT/session cookie, session timeout 30 min idle |
| Validation | **zod** on every server action and API route |
| Forms/tables | react-hook-form, TanStack Table |
| PDF | **HTML templates rendered to PDF by headless Chromium (Playwright `page.pdf`)**, run in a queue worker. Chosen because repeating headers and table headings across pages work natively. Paper is **A4 portrait only** for now (kept as one constant so another size can be added later). See Section 9A. |
| Excel | `exceljs` for exports and master imports |
| QR | `qrcode` library. Bank/UPI QR printed on the invoice |
| Charts | Recharts |
| Email | **Mocked**: write to `EmailOutbox` table and show in an in-app "Outbox" screen. Interface must allow swapping in SMTP later. |
| Logging / health | **pino** structured logs with a request id, `/healthz`, `/readyz`, optional `/metrics` |
| Tests | Vitest (unit), Playwright (end-to-end and print checks), k6 or autocannon (load test) |
| Packaging | **Docker Compose**: `nginx`, `app` (x3), `worker` (queue and scheduled jobs), `postgres`, `redis` |
| Language | English only |

Run with `docker compose up --build`. It must apply migrations, load the seed data and serve the app on one port with no other setup. A plain `npm run dev` mode (single instance, local Postgres and Redis) is kept for development.

## 2A. Production Architecture and Engineering (reference; the Demo Edition applies these concepts as described in 2B)

This is the target the product moves to after the demo. In the Demo Edition each item below is either implemented for real in the browser or clearly labelled as a simulation or a design, see the mapping table in 2B.

**Topology**
```
Browser --> nginx (TLS, gzip, rate limit, least_conn) --> app-1 | app-2 | app-3  (stateless Next.js)
                                                         |--> PostgreSQL (single source of truth)
                                                         |--> Redis (limits, cache, pub/sub, queue)
worker (BullMQ consumer): PDF rendering, email outbox, nightly and midnight jobs
```

1. **Load balancing:** nginx balances across app instances with `least_conn`, active health checks and automatic removal of an unhealthy instance. App containers are **stateless** (sessions in signed cookies, state in Postgres and Redis), so any request can hit any instance. Admin → **System Status** screen shows which instance served the current request, each instance's health, and uptime. Demo: stop one container and the app keeps working.
2. **Rate limiting (two layers):**
   - nginx `limit_req` per IP as a coarse guard.
   - App-level **Redis sliding-window limiter** per user and per route class: login 5 attempts per minute per IP and username with a 15-minute lockout after 10 failures, general API 120 requests per minute per user, PDF generation 20 per minute per user, exports 10 per minute.
   - Responses use **HTTP 429** with `Retry-After`. The UI shows a friendly message. Hits are listed on System Status.
3. **Realtime transparency:** every business event publishes to Redis (`invoice.finalized`, `payment.received`, `stock.changed`, `indent.stage_changed`, `goods.received`, `production.recorded`, `expense.added`, `attendance.changed`, `settlement.finalized`). Each browser holds one SSE connection to its own instance, which relays the events that user is allowed to see. Admin dashboards, lists and the **Live Activity feed** update **within about one second without refresh**. Reconnect with `Last-Event-ID` so no event is lost. Workers receive only events about their own work.
4. **Concurrency and correctness:**
   - Stock checks and updates inside the same DB transaction using row locks (`SELECT ... FOR UPDATE` on the item's stock row), so two workers can never oversell.
   - **Idempotency keys** on create-bill, record-payment, pay-payslip and similar POSTs, so a double click or retry never creates a duplicate.
   - Document numbers come from an atomic counter. No gaps in a financial year except by cancellation.
5. **Performance:** target p95 under 300 ms for API calls and dashboard load under 1 s on the seeded data. Means: indexes on all foreign keys and date columns, pagination everywhere (cursor or limit/offset), server-side aggregation for analytics, Redis cache of dashboard aggregates (15 s TTL, invalidated by events), no N+1 queries, gzip, static asset caching, `next/image` for the logo.
6. **Background jobs (worker container):** PDF generation (so heavy printing never blocks web requests), email outbox delivery, midnight auto-close of attendance sessions, idle-session sweeper, nightly Postgres `pg_dump` backup, cache warm-up.
7. **Security:** bcrypt passwords, secure httpOnly SameSite cookies, CSRF protection on mutations, strict security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy), zod validation on every input, output escaping, server-side RBAC on every route and every query (the Distributor and worker data scoping is enforced in the query layer, not only in the UI), upload checks (type, size, image re-encode) for the logo, secrets only in environment variables, dependency audit in CI.
8. **Observability:** structured JSON logs with request id and user id, `/healthz` (process alive), `/readyz` (Postgres and Redis reachable), a **System Status** page for Admin showing instance, DB and Redis health, queue depth, slow queries and rate-limit hits. Errors never expose stack traces to users.
9. **Resilience:** graceful shutdown (finish in-flight requests, close SSE), Postgres connection pooling, retry with backoff on queue jobs, clear UI states if SSE drops (a small "reconnecting" indicator, the page still works via normal requests).
10. **Load test script** (`npm run loadtest`): simulates 30 concurrent workers billing plus an Admin watching. Reports throughput and p95, shows a rate-limit 429 on a hammered login, and shows requests spread across instances. Include the output summary in the README.
11. **CI:** lint, type check, unit tests, build, Playwright smoke run of the demo script on every push.

## 10. Suggested Project Structure (production reference)

The **Demo Edition structure is in Section 2B**. The layout below is the production reference and is not built for the demo.

```
/prisma        schema.prisma, seed.ts
/src/app       (auth)/login, (app)/dashboard, billing, customers, payments, funds,
               indents, approvals, stock, production, ledgers, staff, attendance, payroll (payslips), settlement (loans, profit split), my-pay, expenses, bills explorer, analytics, settings (company profile),
               reports, masters, admin (users, activity, outbox), distributor
/src/lib       auth.ts, rbac.ts (can()), calc/invoice.ts, numbering.ts, money.ts,
               stock.ts (derived balances), ledger.ts, notify.ts, audit.ts
/src/components ui/*, InvoiceTemplate, ReceiptTemplate, POTemplate, DataTable, ...
/tests         calcInvoice.test.ts, stock.test.ts, approval.test.ts, payments.test.ts
/templates    print templates (invoice, receipt, po, grn, payslip, settlement, ledger, report)
/infra        docker-compose.yml, nginx.conf, Dockerfile, k6/loadtest scripts
/src/server   queue worker, jobs, sse hub, rate limiter
DECISIONS.md   assumptions and deviations
```

Every business operation (finalize invoice, record payment, approve indent, goods receipt, production batch, payslip) lives in a **server service function that runs in a single Prisma transaction** and writes the audit log. UI calls these functions only.
