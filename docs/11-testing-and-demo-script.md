# 11. Testing and demo script

## 11. Testing Requirements

In the Demo Edition, tests that assume your own servers (nginx load balancing, Postgres row locks, Redis, SSE) are replaced by their Section 2B equivalents: rate-limit tests (platform rule present in the deploy config, app limiter returns 429 with Retry-After), compare-and-set conflict and retry tests with parallel requests, idempotency replay, `409` on stale `If-Match`, event-poll cursor tests, and a load test against a deploy preview showing several function instance ids. API tests call the Hono app directly with the MemoryStore. Playwright runs against `netlify dev` or a deploy preview.

Write automated tests (Vitest) for:
- `calcInvoice()`: tax-exclusive, tax-inclusive, CGST/SGST vs IGST, item discount, round-off.
- Indent state machine: the correct role per stage, reject returns to Admin, a wrong role is refused.
- Stock: billing reduces finished stock and is blocked when stock is insufficient; production consumes raw and creates finished; adjustments.
- Payments: partial, FIFO allocation, overpayment rejected, status transitions to Paid and Overdue.
- Fund: balance math and the committed warning.
- `calcPayslip()`: FIXED per-day rate with 26 and 27 working days, FIXED month-to-date, half-day, HOURLY with rounding modes (1 h 35 min becomes 2 h, 1 h 20 min becomes 1 h), no overtime anywhere, advance recovery cap, net never negative, rate snapshot, worked example from 9e.
- Working-day calendar: weekly offs and extra holidays change the day rate.
- Attendance automation: login creates PRESENT, logout closes the session, two sessions in a day add up, idle timeout closes at `lastSeenAt`, midnight auto-close, no login means ABSENT, edited rows are flagged.
- `calcSettlement()`: the worked example in Module 11, both share bases, loan capped at profit, negative gross profit, small-profit scaling, adjustments, `alreadyPaid` handling, owner amount reconciles to the rupee, share percentages over 100% rejected.
- Settlement workflow: finalize creates repayment and payslips, cancel rules, a worker can never read settlement totals, and only Admin can open Module 11.
- Inventory: sales picker lists only products and shows live stock, out-of-stock cannot be billed, purchase picker lists only Purchase List items, stock take variance posts adjustments, low-stock alert fires once at the reorder level, cancelling a bill returns stock, tracker closing balance equals sum of movements.
- UI quality: Playwright screenshots of key screens at desktop and tablet widths, a CSS check that only palette tokens are used, reduced-motion test, keyboard-only login and billing test, Lighthouse accessibility 95 or higher.
- Worker creation: a newly created worker can sign in immediately and sees only their own portal, a duplicate login ID is refused, the 11th worker login is refused on the server even if the UI is bypassed, raising `maxWorkerLogins` allows more.
- Login page: lockout countdown shows after repeated failures, brand name updates after a profile change, works on a 375 px phone width.
- SHARE with Reduce by absences on and off (5% over 26 days, 3 absent gives 4.42%), unpaid portion goes to the owner.
- Branding: editing the company profile creates a new version, old invoices reprint with the old name, GSTIN and logo, new invoices use the new ones, login page and header update live.
- Print pagination and A4 alignment checks from Section 9A (including raster comparison against approved reference images).
- Realtime: a bill finalized by a worker appears on the Admin screen and feed within 2 s, and a worker never receives another worker's events.
- Rate limiting: the 6th login attempt in a minute returns 429 with Retry-After. Idempotency: the same create-bill request sent twice creates one bill.
- Concurrency: two simultaneous bills for the last units of a product, only one succeeds.
- Load balancing: requests are spread over all instances, and one instance can be stopped without user-visible errors.
- Payroll: overlapping period refused, period must be in one month, PAID locks attendance, cancel reverses ledger and unlocks, a worker can only read their own payslips.
- RBAC: Distributor can never read another customer's data.
Also run a manual pass of the demo script (Section 14).

## 14. Demo Script (acceptance walk-through)

1. **Admin** logs in. Dashboard shows seeded funds, sales, profit, pending approvals.
2. Admin adds a **fund tranche** of ₹2,00,000. Fund balance rises.
3. Admin raises an **indent** for Raw Material A from Supplier A. The warning shows if it exceeds the available fund. Submit.
4. Switch to **Monitor**: nothing in the inbox yet. Back to **Admin** → inbox → approve Stage 1. Notification and outbox email appear.
5. **Monitor** approves Stage 2 (try rejecting a second indent with remarks to show the return to Admin).
6. **Collector** approves Stage 3. Admin gets a notification. Download the **PO PDF**.
7. **Admin** records the **goods receipt**. Raw stock increases. Records a **supplier payment**. Fund utilised rises, balance falls.
8. **Operating** logs in and records a **production batch** (raw used, packets made, wastage). Raw stock falls, finished stock rises.
9. **Staff** logs in and creates a **cash bill** for a walk-in. Print the A4 invoice with the tax summary and QR. Finished stock falls.
10. Staff creates a **credit bill** for a retail customer in another state (IGST appears) and a **distributor bill**.
11. Staff receives a **partial payment**, prints the receipt. Dues and the customer ledger update. Show an **overdue** customer in red.
12. **Distributor** logs in: sees only their own bills, ledger, outstanding. Submits an **order request**.
13. **Admin** converts the order request to a draft bill and finalizes it.
14. **Staff** and **Operating** log in and the header shows "Clocked in" with a running timer. They do some billing, then log out (clock out is automatic). **Admin** opens the attendance view, sees today's hours, fixes one forgotten-logout day with a reason, and adds a **daily expense**.
14a. **Admin → Workers**: show one worker on **Fixed** pay (base ₹17,000) and one on **Hourly**. Show the **company calendar** (Sundays off) and the working-day count.
14b. **Admin → Payroll**: open the overview for the Fixed worker (per-day rate, days present, day-by-day table), add a bonus and an advance recovery, **Pay Now** (UPI), download the **payslip PDF**. Open the Hourly worker's overview (rounded hours, no overtime) and pay. Try an overlapping range and see it refused. Run the month-end **bulk drafts**.
14c. The worker logs in, opens **My Pay**, sees only their own attendance and payslip.
14d. **Admin → Other Expenses**: add one expense with a description. **Funds**: show the loan and its outstanding amount.
14e. **Admin → Profit Settlement**: new settlement for the month. Show sales, purchases, gross profit. Enter the loan repayment, preview the waterfall and the worker table (Fixed, Hourly and Share workers), add one adjustment, **Finalize**, **Pay All**. Download one **worker payslip** and the **consolidated payslip PDF**. Then change the loan repayment on a new draft to a huge amount to show the small-profit scaling.
14f. Log in as a worker: confirm no profit, loan or owner figures are visible anywhere.
15. **Admin** opens the **day book**, **cash flow book** and a few **reports**, exporting one to Excel and one to PDF.
16. **Monitor** and **Collector** open the dashboard and reports in read-only mode. Show that create buttons are absent and that direct URL access to forbidden pages is refused.
17. **Excel import** of a small products file with one bad row showing the validation error.
18. **Branding:** Admin opens Company Profile and changes `[Your Brand Name]` to a sample name, adds a GSTIN and a logo. The login page, header and tab title change at once. A new invoice shows the new details, an older invoice still shows the old ones.
19. **Live visibility:** two windows side by side, or a phone and a laptop. A worker finalizes a bill in one and the Admin dashboard, bills explorer and Live Activity feed update without a refresh (instantly within one browser, about 2 seconds across devices).
20. **Pagination:** create a 12-item bill, print it, and show the repeating header and table heading on page 2 with the totals on the last page.
21. **Bills explorer and analytics:** Admin switches the bills view between Overall and Worker-wise, then walks the dashboard through Daily, Weekly, Monthly and Yearly. A worker's dashboard shows only their own numbers.
22. **Engineering (Demo Edition):** open Admin → System. Show the **request log** (every API call with status, latency, request id, function instance id) and the **API Explorer** (OpenAPI). Run the load script and show requests served by several **function instances** and the p95. Hammer the login to trigger the **429** and the lockout countdown. Send the same create-bill request twice to show the idempotent replay. Edit the same record in two tabs to show the **409** conflict message. Bill the last unit of a product from two sessions at once and show that only one succeeds. Show the **production architecture diagram**, labelled as the target design.
22a. **Inventory:** open the tracker. Show Purchase stock and Sales stock. Create a purchase indent and a purchase bill picking from the Purchase List, then a sales bill picking from the Sales Inventory with live available quantity (try an out-of-stock item). Run a stock take with one variance and see the adjustment. Show the low-stock alert.
22b. **New worker:** Admin opens Workers and Logins, sees "5 of 10 used", adds a worker with a login ID and password, then signs in as that worker in a private window and sees their own portal. Keep adding until the cap and show the limit message.
23. **Audit:** open the Audit Log, filter by the worker, show the before/after of an edited record, and Login History.
