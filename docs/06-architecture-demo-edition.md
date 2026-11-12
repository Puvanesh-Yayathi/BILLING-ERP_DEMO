# 06. Architecture (Demo Edition on Netlify)

## 2B. Demo Edition (Netlify: React frontend + serverless backend, demo data inside the app, no external database)

### Constraints and decisions
- **Hosting:** Netlify. The React app is served as static files from Netlify's CDN. The backend is **TypeScript code running as Netlify Functions** under `/api/v1/*`.
- **Data:** no external database (no Supabase, no Postgres, no Redis). **Seed data is bundled in the backend code** and loaded on first run. Records created during the demo are stored through a **`DataStore` adapter**. The default adapter uses **Netlify Blobs** (built into Netlify, no account, connection string or setup), so a bill made on one device shows up for Admin on another. A second adapter, **in-memory**, exists for tests and as a fallback (`DATA_STORE=blobs|memory`). With the memory adapter, new records can disappear when a function instance restarts, so Blobs is the demo default.
- **Honest note on Blobs:** it is object storage, not a database, and Netlify does not position it for queryable relational data. It is used here only as the demo's persistence adapter, behind an interface, and is replaced by Postgres in production (Section 2). Keep the dataset small (see limits below).
- **Reset:** Admin → Settings has **Reset demo data**, **Export data (JSON)** and **Import data (JSON)**, all server endpoints restricted to Admin.

### Stack
| Concern | Choice |
|---|---|
| Frontend | **Vite + React 18 + TypeScript (strict)**, React Router with lazy routes, **TanStack Query** (cache, stale-while-revalidate, retries with backoff, optimistic updates), TanStack Table with virtualization, Recharts |
| UI | Tailwind CSS with Radix primitives, custom-styled to Section 8A, IBM Plex Sans (self-hosted), Framer Motion, lucide |
| Backend | **Hono (TypeScript) as one Netlify Function** at `/api/v1/*`, with `@hono/zod-openapi` so routes, validation and the OpenAPI document come from the same zod schemas |
| Auth | `bcryptjs` password hashes, **JWT (`jose`) in an httpOnly, Secure, SameSite=Strict cookie**, secret in a Netlify environment variable, 30 minute sliding expiry, `tokenVersion` so a password reset signs the user out everywhere |
| Data | `DataStore` interface with `BlobStore` (strong consistency, compare-and-set writes) and `MemoryStore` |
| Scheduled work | **Netlify Scheduled Function** (cron) for the stale-session sweeper (every 5 minutes) and the midnight attendance auto-close |
| Shared code | pnpm workspace package `@app/contract`: zod schemas, types, and the pure calculators (`calcInvoice`, `calcPayslip`, `calcSettlement`), used by both web and server |
| Excel, QR | `exceljs`, `qrcode` (in the browser) |
| Documents | HTML and CSS print templates, browser print (`@page A4 portrait`), see Section 9A |
| Tests | Vitest (unit, and API integration via `app.request()` on the MemoryStore), Playwright (end-to-end, print and screenshot checks), axe, Lighthouse CI, a load test (k6 or autocannon) |
| Tooling | pnpm, ESLint (the web app may import only the API client, never server code), Prettier, GitHub Actions CI, Netlify continuous deploy with deploy previews |

### Request path
```
Browser (React SPA)
  --> Netlify CDN / edge  (static files, security headers, platform rate-limit rule)
  --> /api/v1/*  Netlify Function (Hono)
        middleware: request id --> auth --> app-level rate limit --> validation (zod) --> idempotency
        --> route handler --> service layer (business rules, RBAC, audit)
        --> DataStore (BlobStore | MemoryStore)
```
- Routes are thin. **All business rules live in the service layer** (pure, tested). RBAC and data scoping (worker sees own data, distributor sees own customer) are enforced there, on the server.
- REST conventions: versioned `/api/v1`, plural nouns, `{ code, message, details, requestId }` error body, `limit` and `cursor` pagination, filter and sort parameters, `ETag` with `If-Match` for edits, `Idempotency-Key` on creates and payments.

### Data store, transactions and limits
- **Transactional state document:** the business data that must change together (invoices, payments, stock movements, indents, funds, payslips, settlements, masters, attendance rows) lives in one versioned JSON document. A write is `read (strong) → apply service logic → write only if the version is unchanged (compare-and-set) → retry with jitter, up to 5 times`. This gives **serializable transactions across all function instances**, so two workers can never oversell the last unit and a payment can never be applied twice.
- **Separate keys for high-frequency, non-transactional data** so they never cause conflicts on the main document: presence heartbeats, rate-limit counters, idempotency keys (kept 24 hours), the event log (ring buffer), the request log (ring buffer), and the append-only audit log (chunked).
- **Limits:** the seed and demo usage keep the main document under about 2 MB. The service reports document size in System Status and refuses writes over a hard cap with a clear message. Store names are **namespaced by deploy context** (`production`, `deploy-preview`, `branch`) so a preview deploy never touches production demo data.
- Reads of lists are served from the loaded document with indexes built in memory per request, with `ETag` and `304 Not Modified` for unchanged lists.

### Engineering concepts applied (all real in the demo unless marked)
| Concept | Implementation |
|---|---|
| **API design and contract** | Versioned REST, zod schemas shared with the frontend, generated OpenAPI 3.1, **API Explorer** page (Admin → System) |
| **Rate limiting (two layers)** | (1) **Netlify platform rule** in the function's exported `config` (`rateLimit` with `windowLimit`, `windowSize`, `aggregateBy` IP and domain), enforced at Netlify's edge before the function runs. (2) **App-level limiter** per user and route class, counters in the store with strong consistency: login 5 attempts per minute per username and a 15-minute lockout after 10 failures, general API 120 per minute per user, exports 20 per minute. Both return **HTTP 429** with `Retry-After`, and the UI shows a plain message and a live countdown. |
| **Authentication and RBAC** | Server-side as described above. Only Admin can set or reset passwords. Every route declares the roles allowed, enforced by middleware and re-checked in services. |
| **Validation** | zod on every request. Field-level, plain-language errors. |
| **Idempotency** | `Idempotency-Key` on create-bill, record-payment, pay-payslip and similar. A repeated key returns the first stored response and changes nothing. |
| **Concurrency control** | Compare-and-set writes (above) plus `ETag` and `If-Match` on edits. Editing a record changed elsewhere returns **409** and the UI offers to reload. |
| **Realtime visibility** | Every domain event is appended to the event log. Browsers **poll `GET /api/v1/events?after=<cursor>` every 2 seconds** (every 10 seconds when the tab is hidden, with backoff on errors). **BroadcastChannel** makes updates instant across tabs of the same browser. This works **across devices** with about 2 seconds delay. Events are filtered by role and ownership, so a worker never receives another worker's events. |
| **Scaling and "load balancing"** | **Real, platform-provided:** Netlify serves the frontend from its CDN and runs the function on as many instances as concurrent requests need. There is **no nginx**. System Status shows, for recent requests, the **function instance id** (generated at cold start) and the Netlify request id, so concurrency across instances is visible. The load test script drives concurrent workers and shows the spread. The production load-balanced design (Section 2A) is shown as a labelled diagram. |
| **Caching and performance** | HTTP `ETag` and `Cache-Control`, TanStack Query cache and invalidation by events, prefetch on hover, virtualized tables, lazy routes, code splitting, WOFF2 subset fonts, hashed immutable assets. Budgets: initial JavaScript under 250 KB gzip, Largest Contentful Paint under 1.5 s, API p95 under 400 ms warm. Lighthouse CI enforces the frontend budgets. |
| **Resilience** | Retries with exponential backoff on idempotent reads, request timeouts, route-level error boundaries, graceful handling of 429, 409 and 5xx, a visible "reconnecting" indicator for the event poll. |
| **Observability** | Structured JSON logs (request id, user id, route, status, duration) in Netlify's function logs, a **request log panel** in System Status (from the ring buffer), Web Vitals, an error log. |
| **Security** | Strict CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'` via Netlify headers. Same-origin API with SameSite=Strict cookies plus an `Origin` check on mutations. Secrets only in Netlify environment variables. Output escaped. Logo upload checked and re-encoded. Demo data only, with a visible banner. |
| **Background work** | Netlify Scheduled Function: session sweeper and midnight auto-close (closing sessions at `lastSeenAt`). |
| **Audit** | Append-only audit log with before/after, plus login history, as in Module 1. |
| **Data lifecycle** | Versioned seed (`seedVersion`) with a migration step, dates in the seed relative to the day it is first loaded, fixed random seed so the data is identical every time, reset, export and import. |
| **Testing and CI** | Unit tests for calculators and services, API integration tests through `app.request()`, Playwright run of the whole demo script, print and pixel checks, accessibility and Lighthouse budgets, run in CI before a deploy. |
| **Configuration** | Typed config (worker login cap, rounding rule, rate limits, store type) from environment variables and Admin settings. |

### What is real and what is not
| Item | In the Demo Edition |
|---|---|
| Backend, auth, RBAC, validation, rate limiting, concurrency control | **Real**, running on Netlify Functions |
| Scaling across instances | **Real** (Netlify serverless and CDN), no custom load balancer. The nginx design is shown only as the production target. |
| Database | **None.** Bundled seed data plus the Blobs adapter for new records. Not a production data store. |
| Live updates to Admin | **Real across devices**, by 2-second polling, instant within one browser. Not push (no WebSocket or SSE). |
| PDF | Browser print or "Save as PDF" with the A4 templates, not server-rendered |
| Email | Outbox screen only |
| Security hardening | Good for a demo, but production needs its own review, a real database and secrets management |

Telling the client plainly which parts are demo-grade and what the production architecture adds (real database, server-rendered PDFs, load-balanced servers, push updates) is part of the pitch.

### Netlify configuration
- `netlify.toml`: build command, publish directory, functions directory, Node version, **SPA fallback** (`/*` to `/index.html` status 200, API paths excluded), security headers, immutable caching for hashed assets, no-cache for `index.html`.
- Environment variables (set in Netlify, never committed): `JWT_SECRET`, `DATA_STORE`, `DEMO_RESET_ENABLED`, `SEED_VERSION`.
- The API function exports `config = { path: "/api/v1/*", rateLimit: { windowLimit, windowSize, aggregateBy: ["ip", "domain"] } }`. Verify the rule appears in the deploy log.
- Deploy previews for every branch, instant rollback, `netlify dev` for local work (local Blobs sandbox).
- `README`: local run, deploy, environment variables, demo logins, the demo script, reset, and the real-versus-not table above.

### Project structure (Demo Edition)
```
/apps/web            React app: routes, features, ui (design system), api client, print templates
/netlify/functions   api.ts (Hono app + config), sweeper.ts (scheduled)
/server              routes, middleware (auth, rate limit, idempotency, request id), services,
                     store (DataStore, BlobStore, MemoryStore), seed (relative dates, fixed seed), events, audit
/packages/contract   zod schemas, types, calculators (shared)
/tests               unit, api, e2e, visual, a11y, load
netlify.toml, README.md, DECISIONS.md
```

## 8. Non-functional Requirements (demo level)

- Responsive: billing screen usable on a tablet; approvals inbox and distributor view usable on a phone.
- All money displayed in Indian format (`₹1,23,456.00`) via one `formatINR()` helper.
- Dates `DD/MM/YYYY` in UI; stored as ISO.
- Empty states, loading states and error states on every list and form.
- Follow Section 8A. No lorem ipsum. Page loads under 1 s on seeded data (see Section 2A for targets).
- Server-side authorization on every mutation. No client-only checks.
