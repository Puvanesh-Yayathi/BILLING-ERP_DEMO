# 01. Overview and scope

Part of the Demo Edition document set. Read `CLAUDE.md` first.

## 1. Context

- **Real client:** a dry fish producer enterprise in Tirunelveli. **The demo is product-neutral:** it uses generic names (Product A, Raw Material A, Customer A, Worker A) and the brand placeholder `[Your Brand Name]`. No client name, product or place name appears anywhere in the demo.
- **Vendor:** Novoz Infinity (Nagercoil | Chennai).
- **Business model:** buys raw materials, processes them into finished products (with wastage), sells to customers and distributors. Currently on paper and spreadsheets.
- **Product:** One web app covering fund tracking, purchase approval, purchase, raw stock, production, finished stock, billing, payments, ledgers, staff, expenses and reports.
- **Contract scope:** 10 modules, 6 role logins, a fixed report list. The original proposal was ₹75,520 for 3 weeks. The client has since asked for the additions in Section 13, which are all in scope for this build.

### Purpose of this demo
A **working, clickable, data-backed demo** that the client can use end to end in a meeting: log in as each role and walk the full business cycle. It is not a mock-up. Every feature in Section 6 must really work against a database. It is built like a small production system (Section 2A), but real email sending, a payment gateway and client-specific hosting are out of scope.

### Demo success definition
In one sitting, a presenter can run the script in Section 14 without errors, switching between role logins, and every number (stock, fund, dues, ledgers, dashboard) stays consistent.

## 1A. How the System Works (end to end)

1. **Setup (Admin, once):** enter the company profile (name, address, GSTIN, logo, bank, terms), calendar (weekly off days, holidays), masters (products, raw materials, customers, suppliers, workers with pay type), opening balances, and users.
2. **Funds and purchasing:** loan or fund tranches are recorded. Admin raises a purchase indent, which passes Admin, Monitor and Collector approval. After approval a purchase order prints. Goods arrive and the supplier's bill is recorded (goods receipt). Raw stock goes up and the supplier is paid.
3. **Production:** Operating converts raw material into finished products and records wastage. Raw stock goes down, finished stock goes up.
4. **Selling:** a billing worker (Staff or Operating) logs in, which automatically marks them present and starts their clock. They create cash, credit or distributor bills. GST is computed, finished stock reduces, and an A4 tax invoice prints. Payments are received and receipts printed. Dues and ledgers update.
5. **Live visibility:** everything a worker does appears on the Admin's screens immediately (live activity feed, dashboards, bills explorer). Admin can see all bills overall or worker by worker. Each worker sees only their own work and pay.
6. **Month end (Admin):** other expenses are recorded. Admin runs the **Profit Settlement**: gross profit (sales minus purchases) → loan repayment → worker pay (fixed, hourly, profit share) → other expenses → owner amount. Payslips are generated for each worker, plus one consolidated payslip.
7. **Always on:** role-based access, full audit log, login history, ledgers, day book, reports, analytics (daily, weekly, monthly, yearly), and a request log with rate limiting.

## 12. Out of Scope (do NOT build)

GST return filing or reconciliation, e-way bill, e-invoice, online payment gateway, real SMS/WhatsApp/SMTP sending, Android app, multi-branch, Tamil UI, barcode or label printing, weighing scale and biometric integration, legacy data migration, multiple invoice formats (other paper sizes are not built), an external database, Redis, nginx, Docker or custom load balancing in the demo (production target only), WebSocket or SSE push in the demo, any extra report, field or approval stage.

## 13. Client-Requested Additions (all in scope)

**Request 1: Payroll and payslip (captured).** Admin picks one of two pay types per worker: **Fixed** (monthly base pay divided by the working days of the month, which Admin sets by choosing off days and holidays) or **Hourly** (rate per hour, no overtime). Attendance and hours are recorded **automatically from login and logout**, with 1 h 35 min style times rounded to whole hours. Admin can pay at month end or any time and gets a payslip with a full overview. No PF or ESI for now (may be added later, keep the deductions lines extensible).
- These go beyond the original Module 9 (attendance, monthly salary, advances, staff ledger). The client asked for them, so build them.
- Still to confirm with the client: (a) rounding rule for hours (nearest hour is the default), (b) lunch and break time: automatic hours count all logged-in time, so should workers log out for breaks or should Admin deduct a fixed break, (c) paid leave, (d) workers without a computer login.

**Request 2: Profit-based pay and settlement (captured).** Worker pay can be a Fixed base pay (with absent days deducted), an hourly rate, or a percentage share of the profit. Monthly profit is split in order: loan, workers (billing and non-billing), expenses, owner. Overall figures are visible to Admin only. Individual and consolidated payslips are produced. Admin can add other expenses that have no bill.
- **Resolved by the client:** share percentage applies to profit after the loan and before expenses; SHARE pay has an on/off switch to reduce by absences; Monitor and Collector see sales and purchases but **no profit or overall amounts**; workers see only their own pay; overall amounts are Admin-only.
- Still to confirm: whether a direct purchase bill without approval is really needed (not built).

**Request 3: Company profile and branding, print formats, analytics, live visibility (captured).** Company profile (name, GST, registration numbers, logo) controlling the whole app and all new documents without altering old ones. Professional Indian-format documents with repeating headers and footers, A4 portrait. Daily, weekly, monthly and yearly analytics for Admin and per-worker dashboards. Bills explorer overall and worker-wise. Real-time Admin visibility. Audit and login logs. Production-style demo architecture (load balancing, rate limiting).
- Only GSTIN is captured for the company. PAN and other registration numbers can be added later if the client asks.

**Further client requests:** none pending.

If a clarification changes behavior, update the relevant section above and record it in `DECISIONS.md`.

## 16. Assumptions (flag in DECISIONS.md if the client disagrees)

1. Financial year is April to March. Company is in Tamil Nadu, so same-state means CGST+SGST.
2. Default credit period is 15 days (setting).
3. Fund "utilised" is counted at **supplier payment**, with "committed" shown for approved but unpaid indents.
4. Distributor order request converts to a **draft** distributor bill that Admin finalizes.
5. Partial goods receipt is allowed. The indent stays Approved until fully received.
6. Sent invoices are immutable. Admin can cancel with a reason.
7. Sample GST rates and HSN codes in the seed are placeholders to be confirmed by the client.
8. Salary is pro-rated by attendance over the working days of the month (setting, default 26).
9. Rejected indents, after edit, restart approval at Stage 1.
10. Email is simulated by an in-app outbox for the demo.
11. Payroll: exactly two pay types, Fixed and Hourly. No overtime. One payslip per worker per period, no overlap, and each payslip stays inside one calendar month.
12. Working days = days in month minus weekly offs minus extra holidays. Absent days are unpaid for Fixed. Paid leave is not modelled.
13. Attendance is automatic from login, logout, heartbeat and idle timeout. Idle time is not counted. Hours are rounded per day, default to the nearest hour. Biometric stays out of scope.
14. Working on an off day: Hourly is paid for hours, Fixed gets nothing extra.
15. Salary payments reduce cash or bank by the net amount on the pay date. No PF, ESI or TDS.
16. Profit for settlement is gross: sales (taxable value) minus purchases (goods receipt bill value). Other expenses are deducted after workers, as the client listed the priority order.
17. SHARE workers' percentage applies to profit after the loan and before expenses. Admin can switch "Reduce by absences" on per worker (default off). A SHARE worker sees their share only after the settlement is finalized, never an estimate during the month, because an estimate would reveal the profit.
18. If the profit after the loan is too small, all workers get the same reduced fraction of their amount, never nothing unless the pool is zero.
19. Purchases are recorded only through the approved indent and goods receipt flow, with the supplier's bill number. A direct purchase bill that skips approval is **not** built (it would bypass the 3-stage approval rule). Costs without a bill go into Other Expenses.
20. Individual FIXED and HOURLY payslips paid earlier in a month are counted as already paid when that month is settled.
21. Approved leave is tracked and shown on payslips but is unpaid for FIXED, like an absence.
22. All documents are A4 portrait only. The client will say if another size is needed.
23. Operating workers (inventory) work on both purchase and sales bills: they can create sales bills and receipts, and enter purchase bills and goods receipts. Purchase indents, approvals and supplier payments stay with the approval chain and Admin (confirmed by the client).
24. Profit Summary (report 12) is Admin only (confirmed by the client). Monitor and Collector do not see profit.
25. The demo is a Netlify deployment with a React frontend and a real serverless backend (Section 2B). There is no external database. Seed data is bundled, and new records use the Blobs adapter. Production (Sections 2 and 2A) comes later and keeps the same API contract and services.
26. Workers see their own billed sales value and their own pay. They never see other workers or company totals.
