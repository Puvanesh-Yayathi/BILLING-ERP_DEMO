# 03. Modules, screens and workflows

Every module below is in scope for the demo. Module 11 (profit settlement) and Module 12 (company profile) are included.

## 6. Modules, Screens and Workflows

Navigation is role-based. All list screens have search, filters, pagination. Forms validate with zod. Use toasts for success and error.

### Module 1: Login, Roles and Security
- `/login`, logout, 30 min idle timeout with redirect to login. **Passwords are managed only by Admin.** Workers and all other users have no change-password or forgot-password screen and cannot change their own password. Only Admin can set or reset a password (Admin can change their own).
- **Auth hooks feed attendance** (see Module 9b): a successful login by a worker, logout, and idle timeout each create or close an `AttendanceSession`.
- **Admin: Workers and Logins screen.** **Add worker** form: name, phone, role (Staff or Operating), pay type and rate (Module 9a), **login ID** (unique, 4 to 20 characters, checked live), **password** (set by Admin, with a generate button and a strength check). On save the account exists immediately and the worker can sign in with those credentials at the login page and land on their own portal. Admin can also deactivate a worker, reset the password (the worker is signed out of any open session), change the role, and edit details. A worker's session and attendance start from their own first login.
- **Demo cap:** the number of active worker logins (Staff and Operating) is limited by a setting `maxWorkerLogins`, **default 10**, enforced on the server. The screen shows "7 of 10 worker logins used". At the limit the Add button is disabled with the message "Limit of 10 worker logins reached. Ask your administrator to raise the limit." The cap is a plain setting so it can be raised later without code changes. Workers without a login (attendance entered by Admin) do not count. Admin, Monitor, Collector and Distributor accounts are created from the same screen and are not counted.
- Users screen for the other roles (Monitor, Collector, Distributor with a linked Customer).
- **Audit Log screen (Admin):** every create, update, cancel, approval, payment, stock adjustment, payslip, settlement, setting change and branding change is listed with who, what, when, IP, request id, and a **before/after comparison**. Filters by user, entity, action and date. Search. Export to Excel. The log is append-only.
- **Login History (Admin):** every login, failed login, lockout, logout and timeout with IP and device. Shows who is online now and their current session length.
- Data tools (Admin → Settings): **Export data (JSON)**, **Import data (JSON)** and **Reset demo data** in the Demo Edition (Admin-only server endpoints). In production this becomes `pg_dump` backups, nightly, last 7 kept.

### Module 2: Customers, Distributors, Product Catalog
- Customer/Distributor list and profile: contact, address, state, GSTIN, billing history tab, outstanding.
- Masters (Admin): Products, Categories, Units, Raw Materials, Suppliers, Staff, Expense Heads, Bank Accounts.
- Product code is unique. On the billing screen, typing a code auto-fills name and the price for the customer type (retail vs distributor).
- **Excel import** for Products, Customers, Suppliers, Staff: upload `.xlsx`, preview rows with validation errors, confirm to import. Provide downloadable template per master.

### Module 3: Pricing, Invoicing, Billing
Billing screen flow (Staff, Operating or Admin):
1. Choose bill type (Cash / Credit / Distributor) and customer (cash bill allows "Walk-in").
2. Add lines by product code or search. **Products come only from the Sales Inventory**, with live available quantity. Rate defaults by customer type and is editable only by Admin. Discount % per line.
3. Live totals via `calcInvoice()` with the tax summary.
4. **Save as Draft** or **Finalize (Sent)**.
5. After finalizing: **Print** (A4 portrait), **Download PDF**, **Share** (copy link / WhatsApp deep link `wa.me` text, no API).
- **Invoice layout, pagination rules and the other printed documents are defined in Section 9A.** UPI QR URI: `upi://pay?pa=<upiId>&pn=<name>&am=<balance>&cu=INR`.
- The client's own format may arrive later. Keep every document in an isolated template component so a format can be swapped without touching logic.

### Module 4: Payments, Receipts, Dues
- Receive Payment screen: customer, mode, amount, optional invoice, reference. Shows outstanding invoices with allocation.
- Printable receipt (A4/half page) PDF.
- Dues screen: customer-wise balance, ageing buckets (0 to 15, 16 to 30, 30+ days), overdue rows highlighted red.

### Module 5: Fund Tracker
- Add tranche (Admin), with an **"This is a loan"** flag and lender name. Loan outstanding = loan tranches − repayments (repayments are made through Module 11). List of tranches. Cards: Received, Committed, Utilised, Balance. Utilisation list linking to the supplier payments and indents that used the fund.
- Bank Accounts master lives here (the invoice QR uses the default account).

### Module 6: Purchase Indent, 3-Stage Approval, PO
State machine (this order is fixed by contract):

```
DRAFT --submit(Admin)--> PENDING_S1
PENDING_S1 --Admin approves--> PENDING_S2
PENDING_S2 --Monitor approves--> PENDING_S3
PENDING_S3 --Collector approves--> APPROVED
any PENDING_Sx --reject (remarks required)--> REJECTED (returns to Admin; Admin can edit and resubmit, restarting at S1)
APPROVED --goods receipt--> RECEIVED
RECEIVED --supplier payment (full)--> PAID
```
- Indent: supplier, items (**picked from the Purchase List**: item, qty, rate), auto total.
- Each approver sees an **Approvals inbox** with only the indents waiting at their stage. Approve or reject with remarks.
- Full approval trail on the indent (who, when, stage, remarks).
- **Notifications:** at each transition create an in-app `Notification` for the next approver (or Admin on reject or final approval) and an `EmailOutbox` row. Bell icon with unread count in the header. Outbox screen (Admin) shows the "sent emails".
- On final approval: **Purchase Order PDF** available (A4).
- **Goods Receipt / purchase bill:** Admin or Operating records the supplier's bill number, bill date and bill amount, and received qty per item (can be partial: if partial, indent stays `APPROVED` until total received ≥ ordered, then `RECEIVED`). Each receipt creates `RawStockMovement(PURCHASE, +qty)`.
- **Supplier payment:** one or more payments, mode and reference. Counts toward fund utilisation. Indent becomes `PAID` when payments ≥ total.

### Module 7: Inventory (Purchase List, Sales Inventory, Production, Tracker)

Two clearly separate lists, with one tracker over both.

**7a. Purchase List (what the company buys)**
- A master of **purchase items**: raw materials, packaging, consumables. Fields: name, category (Raw material, Packaging, Consumable, Other), unit, preferred supplier, last purchase rate, reorder level, active.
- **Purchase indents and purchase bills pick items only from the Purchase List.** The picker shows the item, unit, last rate, current stock and supplier. **Admin creates and edits all master lists (Purchase List, Sales Inventory items, prices, suppliers, customers). Operating and other workers can only pick from them.**
- **Rates are not locked.** The master's last rate is only a default. The rate can be changed on the purchase indent and on the purchase bill by whoever enters it (Admin or Operating), because actual prices change from day to day. Where a purchase bill rate differs from the approved indent rate, the bill shows the variance (amount and percentage) and the change is logged. Average cost is the weighted average of the actual rates on purchase bills.
- Purchase stock rises on goods receipt and falls when used in production.

**7b. Sales Inventory (what the company sells)**
- The **finished products** with their current stock and their **selling prices** (retail, distributor), which only **Admin** sets. Workers pick products but cannot change the price on a bill. **Sales bills pick products only from the Sales Inventory.** The picker shows the product code, name, price for the customer type, and **available quantity** live. Out-of-stock items are visible but cannot be added. Low stock shows a small caution marker.
- Finished stock rises when a production batch is saved and falls when a bill is finalized (or a bill is cancelled, which returns the stock).

**7c. Production batch (Operating or Admin)**
- Date, inputs (purchase items and quantity used, from raw stock), outputs (products and packets or items made), wastage quantity and note. One transaction: purchase stock down, sales inventory up. Blocked if raw stock is insufficient. Batch number, printable batch sheet.

**7d. Inventory tracker (one screen, two tabs: Purchase stock and Sales stock)**
- Table per item: opening, received or produced, used or sold, adjusted, **closing**, reorder level, status (in stock, low, out), average cost (purchase items) or **selling price** (products), stock value (purchase stock at average cost, sales stock at selling price). Filters by category, supplier, status, date range. Totals row with total stock value.
- **Item detail view:** movement timeline (every purchase, use, production, sale and adjustment with the document link and who did it), a stock-over-time line, and a running-balance ledger.
- **Low-stock alerts:** bell notification and a dashboard panel when an item falls under its reorder level. A suggested reorder quantity based on the last 30 days of use or sales.
- **Stock take:** Admin or Operating enters physical counts for chosen items, sees the variance against the system, and confirms. Confirmed variances post as adjustments with a mandatory reason and are logged.
- **Manual adjustment** (item, plus or minus quantity, mandatory reason). Logged.
- Everything updates live for Admin when a worker records a movement.
- Stock is always derived from movement tables (see Section 4). Wastage report and slow-moving items (no sales in 30 days) appear in the tracker.

### Module 8: Ledgers and Day Book
- Ledgers: Customer, Distributor, Supplier, Cash, Bank, Expense head, **Staff** (advances and payslips). Each shows opening balance, dated debit/credit rows, running balance, date filters, export.
  - Customer: invoice = debit, payment = credit.
  - Supplier: indent received value = credit, supplier payment = debit.
  - Cash/Bank: receipts in, supplier payments and expenses out.
- **Opening balance entry** for customers, suppliers, cash, bank.
- **Day book:** all transactions for a date range chronologically. **Cash flow book:** cash and bank in/out with closing balances.

### Module 9: Staff, Attendance, Payroll and Other Expenses

**9a. Three pay types (Admin chooses one per worker, on the worker page)**

| | **FIXED (base pay)** | **HOURLY** | **SHARE (profit percentage)** |
|---|---|---|---|
| Admin enters | Base pay for the month (e.g. ₹17,000). Admin can change it any time. | Rate per hour | Percentage of the profit pool (e.g. 5%) and a **"Reduce by absences" on/off switch** |
| Pay is based on | Days present. Base pay ÷ working days of the month = day rate. Each absent day is deducted. | Rounded hours worked | The month's profit (Module 11). With the switch on, also the days present |
| Overtime | None | None | None |
| Paid through | Payslip any time, or the settlement | Payslip any time, or the settlement | **Profit Settlement only** |

- Fixed and Hourly workers are paid on the days and hours they actually work, as designed below.
- SHARE workers' amount depends on the month's profit, so it can only be calculated in the settlement. Money given to them earlier in the month is recorded as an **advance** and recovered at settlement.
- Attendance, hours, leave and absence are tracked for **all three types** (they show on every payslip), even though SHARE pay does not depend on them.
- The type can be changed later and applies only to periods not yet paid. Rates and percentages are snapshotted onto each payslip.
- Workers who do not use the billing system (inventory, other areas) have the same three types. Admin enters their attendance manually in the attendance grid.

**9b. Company working-day calendar (Admin, Settings)**
- Admin selects the **weekly off days** (default: Sunday) and can add **extra holidays** by date with a name.
- `workingDaysInMonth = days in month − weekly offs − extra holidays`. Example: 30-day month with 4 Sundays gives 26 working days; with 3 Sundays gives 27.
- Admin can change the calendar for a future or current month before paying that month. The preview always shows the working-day count used.

**9c. Automatic attendance and hours (no manual clock buttons)**
Applies to every worker linked to a login (Staff, Operating).
- **Login = clock in.** The first successful login of the day creates today's attendance as `PRESENT` with `firstIn`, and opens an `AttendanceSession`. If the worker logs in again later the same day, another session opens.
- **Logout = clock out.** Closes the open session with `logoutAt`.
- **Idle timeout or closed browser:** the app sends a lightweight heartbeat every 60 s that updates `lastSeenAt`. If there is no heartbeat for 30 min, the session auto-closes with `logoutAt = lastSeenAt` (so idle time is not paid). A background job also closes any session still open at midnight (`AUTO_CLOSE`).
- **No login that day = not present.** Days with no session are `ABSENT` (a nightly job or the payroll preview treats missing rows as absent for working days only).
- **Hours** for a day = sum of that day's session durations. **Rounding (setting, default "nearest hour"):** the daily total is rounded to a whole hour, 30 minutes or more rounds up, e.g. 1 h 35 min becomes 2 h and 1 h 20 min becomes 1 h. Alternatives in the setting: round up, or exact minutes. Rounding is applied per day.
- **Header clock widget:** shows "Clocked in 9:02 AM · 3 h 14 m today" for workers. A **Clock out** button is shown, and it simply logs the worker out (equivalent to logout). It is automatic otherwise.
- **Optional rule (setting, default off):** a day with fewer than N paid hours counts as a Half day for FIXED pay.
- **Admin corrections:** Admin can edit a day's status or hours (e.g. forgot to log out, system down) with a mandatory reason. The row becomes `source = EDITED` and is logged. Admin can also mark attendance manually for a worker without a login (`source = MANUAL`). A day locked into a PAID payslip cannot be edited unless the payslip is cancelled.
- A worker logging in on a weekly off day or holiday: HOURLY is paid for hours. FIXED gets no extra pay (shown as "worked on off day"). See Assumptions.

**9d. Advances**
Admin records an advance (date, amount, mode). Outstanding advance per worker is shown on the worker profile and on the payslip screen.

**9e. Payroll and Payslip (Admin)**
Admin can pay **at month end or at any time**: for the whole month, month to date, or any date range **inside one calendar month**. This screen is for **FIXED and HOURLY** workers. SHARE workers are paid through Module 11.

1. Open **Payroll → Generate Payslip**. Pick worker and period (defaults to current month; quick buttons: This month so far, Last month, Custom). The system refuses a range that overlaps days already on a PAID payslip for that worker.
2. **Overview (preview):**
   - Header: worker, pay type, rate, period.
   - **FIXED:** shows base pay, working days in the month, **per-day rate** (e.g. 17,000 ÷ 26 = ₹653.85), days present, half-days, absent days, and base pay earned.
   - **HOURLY:** shows hourly rate, days worked, **total paid hours**, and base pay earned.
   - **Day-by-day table:** date, status, first in, last out, raw time, paid hours, day amount (FIXED shows the day rate for present days, HOURLY shows hours × rate), flags (edited, off-day work).
   - Optional **allowance / bonus** lines and other deduction lines (Admin adds label and amount).
   - **Advance recovery** prefilled with the outstanding advance (editable, never makes net negative).
   - Live **Gross, Total deductions, Net payable**.
3. **Save as Draft** (editable, does not lock attendance) or **Pay Now**: choose date, mode (Cash, UPI, Bank), reference → status `PAID`, number `PAY/26-27/0001`.
4. On PAID, in one transaction: the period's attendance rows get `payslipId` (locked), advance `recoveredAmount` is updated, a cash or bank ledger payment is posted, the staff ledger gets an entry, the audit log is written, and the worker gets an in-app notification.
5. **Payslip PDF (A4):** company header, payslip number, period, worker details, pay type and rate, attendance or hours summary, earnings and deductions, net pay in figures and words, payment mode and date, and a "Received by" signature line (works as the pay receipt).
6. **Bulk:** "Generate drafts for all active workers" for a month, then review and pay each, or Pay All Selected.
7. **Cancel** a PAID payslip (Admin, reason required): reverses the ledger entry, unlocks attendance, restores the advance recovered. Logged.
8. **Payroll list** with filters (month, worker, status) and a totals row.

**Pay calculation: one pure function `calcPayslip()` with unit tests**
- `FIXED`: `perDayRate = basePay ÷ workingDaysInMonth`; `basePayEarned = perDayRate × (presentDays + 0.5 × halfDays)`, capped at `basePay`. Absent days earn nothing. Month-to-date uses the **full month's** working-day count for the day rate.
- `HOURLY`: `basePayEarned = sum of daily paid hours × hourlyRate`. No overtime, no minimum.
- `gross = basePayEarned + allowances`; `net = gross − advanceRecovery − otherDeductions`; net is never negative. Round money to 2 decimals, show the final net rounded to the nearest ₹1 with the round-off shown.
- Worked example for the demo: base ₹17,000, month with 26 working days → ₹653.85 per day; 24 days present → ₹15,692.31.

**9f. Worker view ("My Pay", Staff and Operating)**
Own attendance calendar, today's running hours, this month so far (days or hours and estimated earnings), and own PAID payslips with PDF download. Read-only. Never shows other workers.

**9g. Other Expenses**
For costs that have no purchase bill: date, head (electricity, tea, food, travel, diesel, other), amount and a **required description**. Summary by head and by month. Posts to the cash ledger and the expense ledger. These feed the profit settlement.

### Module 10: Dashboard and Reports
**10a. Analytics dashboard**
- **Period switch: Daily, Weekly, Monthly, Yearly**, with a date picker and a comparison to the previous period (change in value and percentage).
- **Admin (everything):** sales, purchases, gross profit, inventory health, number of bills, average bill value, collections received, outstanding dues, other expenses, fund received, used and balance, loan outstanding, finished and raw stock value, low-stock list, pending approvals, production and wastage. Charts: sales trend, sales vs purchases, gross profit trend, top customers, top products, category share, payment-mode split, sales by hour of day, **worker-wise sales leaderboard**, attendance summary. Click any figure to open the matching list.
- **Live Activity feed** on the Admin dashboard: a running list of what workers are doing ("Staff A finalized INV/26-27/0042, ₹12,450"), updating in about one second.
- **Monitor and Collector:** read-only; sales, purchases, stock, approvals and expenses analytics. **No profit, loan, worker pay or owner figures.**
- **Staff and Operating (worker dashboard):** only their **own** work, same Daily, Weekly, Monthly, Yearly switch: bills they created, sales value they billed, items sold, receipts they recorded, production they logged, hours and days worked, and their own pay. Nothing from other workers or the company totals.
- Gross profit, loan, worker pay and owner amount appear only for Admin (dashboard cards and Module 11).
- Layout, charts, colours, drill-downs and motion follow Section 8A (Analytics dashboard).

**10b. Bills Explorer (transparency)**
- Admin sees **all sales bills and all purchase bills** in one place, with a toggle: **Overall** or **Worker-wise** (grouped by the worker who created them, with subtotal per worker and drill-down). Filters: date range, worker, customer or supplier, type, status. Totals row. Export to Excel and PDF.
- Workers see only bills they created. Distributors see only their own.
- New bills created by workers show up for Admin immediately (see Section 2A, realtime).

- Distributor home: own outstanding, recent bills, payments, and a button to **Request Order**.
- **Distributor order request flow:** Distributor submits items and quantities and a note → status `NEW` → Admin sees it in an "Order Requests" inbox with a notification → Admin clicks **Convert to Draft Bill** (prefilled distributor invoice) or **Reject** with remark. Distributor sees status.

### Module 11: Loans and Profit Settlement (Admin only)

Workers' pay and the owner's amount depend on the profit. Once a month, or when Admin chooses, Admin runs a **settlement** that works through this priority order:

1. **Gross profit** = sales − purchases for the month (both already in the system).
2. **Loan repayment** (first priority): Admin enters the amount. Capped at the available profit. Any part that cannot be paid stays outstanding on the loan.
3. **Workers** (second priority): all workers, billing and non-billing.
4. **Other expenses** (third priority): from the Other Expenses section for that month.
5. **Owner amount**: whatever is left.

**Calculation (one pure function `calcSettlement()` with unit tests):**
- `grossProfit = sales − purchases`. If negative, the pool is zero.
- `poolAfterLoan = max(0, grossProfit − loanRepaymentApplied)`.
- FIXED and HOURLY workers: `earned` comes from `calcPayslip()` for the whole month (absent days already deducted).
- SHARE workers: Admin sets the percentage (e.g. 5%). `shareBase` is the **profit after the loan and before expenses** (`poolAfterLoan`), as the client confirmed. (A setting `NET` exists as an alternative but is off.)
  - **Reduce by absences = OFF:** `shareAmount = shareBase × sharePercent / 100`.
  - **Reduce by absences = ON:** the percentage is spread over the month's working days, and each absent day loses its part: `effectivePercent = sharePercent × (presentDays + 0.5 × halfDays) ÷ workingDaysInMonth`, capped at `sharePercent`. `shareAmount = shareBase × effectivePercent / 100`. Example: 5% over 26 working days, 3 days absent: 5% × 23/26 = 4.42%. The unpaid portion stays in the pool and goes to the owner.
  - The switch is per worker (default off) and is shown on the preview and on the payslip. Percentages across all SHARE workers must total 100% or less (validated on the full percentages).
- `workerTotal = sum of earned + sum of shareAmounts`.
- **Small profit rule:** if `workerTotal > poolAfterLoan`, every worker gets the same fraction `scale = poolAfterLoan ÷ workerTotal` of their computed amount, so everyone receives a reduced amount rather than nothing.
- Admin can add a per-worker **adjustment** (plus or minus, with a reason) after scaling.
- `payable = computed × scale + adjustment`, rounded to whole rupees. Less any **advance recovery** and any amount already paid by an earlier FIXED/HOURLY payslip that month (`alreadyPaid`). If that goes below zero, the excess carries as an advance.
- `ownerAmount = poolAfterLoan − sum of payable − otherExpenses`, shown in red as a deficit if negative. The owner amount is computed last so the figures always reconcile to the rupee.

**Worked example (also the seed scenario):** sales ₹80,00,000, purchases ₹30,00,000 → gross profit ₹50,00,000. Loan repayment ₹20,00,000 → pool ₹30,00,000. FIXED and HOURLY earned total ₹1,20,000. SHARE workers at 5% and 3% → ₹1,50,000 and ₹90,000. Worker total ₹3,60,000. Other expenses ₹1,50,000. **Owner amount ₹24,90,000.**

**Workflow**
1. **Settlement → New**: pick the month. The system fills sales, purchases and other expenses (with drill-down links to the source lists).
2. Admin enters the **loan repayment** (choose which loan, shows outstanding).
3. **Preview**: waterfall summary on top, then a table of every worker: name, pay type, rate or %, days present, half, absent, leave, hours, earned or share, scale, adjustment, advance recovery, already paid, **net payable**.
4. **Finalize** (locks the figures): creates the loan repayment (bank/cash ledger entry, reduces loan outstanding), and a payslip for every worker (status DRAFT, amount fixed). Admin then **pays each** (date, mode, reference) or **Pay All**, which posts to the ledgers, locks attendance, and notifies workers as in 9e.
5. **Cancel** a settlement before any payslip is paid (Admin, reason). After payments, Admin must cancel the payslips first.
6. One settlement per month. A month can be re-run as a draft until finalized.

**Payslips from the settlement**
- **Individual payslip PDF** per worker: period, pay type and rate or %, attendance summary (days present, half, absent, leave, hours), earned or share amount, adjustment, advance recovery, net payable in figures and words, payment details, "Received by" line. **Workers never see profit, loan, owner amount or other workers' figures.**
- **Consolidated payslip PDF (Admin only):** page 1 is the waterfall summary (sales, purchases, gross profit, loan, pool, worker total, scale, expenses, owner amount). Following pages list every worker in a table with all attendance details. A "Download all payslips" option bundles the consolidated page and every individual payslip into one PDF.

### Module 12: Company Profile and Branding (Admin)

Admin → **Settings → Company Profile**. One place that controls the identity shown across the whole app and on every printed document.

- **Fields:** brand name, legal name, address, city, state and state code, pincode, phone, email, website, **GSTIN** (PAN and other registration numbers are not included for now and can be added later as optional fields), **logo**, favicon/icon, invoice terms, footer note, authorised signatory label. Bank accounts stay in the Bank Accounts master (default account prints on invoices).
- **Default for the demo:** brand name `[Your Brand Name]`, logo is a neutral placeholder mark, GSTIN empty. No client brand name appears anywhere in the demo.
- **Validation:** GSTIN pattern (15 characters, state code in the first two digits must match the chosen state), valid pincode and phone, logo PNG/SVG/JPG up to 2 MB (re-encoded, a 512 px version and a favicon are generated).
- **Where it appears, instantly after saving (live UI):** login page, sidebar and header, browser tab title and favicon, emails (outbox), empty states and footers.
- **On printed documents:** the company details are those of the profile **version in force when the document was finalized**. Changing the name, GSTIN, address or logo affects **new documents only**. Old invoices, payslips and receipts reprint exactly as originally issued (this is why each edit creates a new `CompanyProfile` version and documents store the version id). Drafts show the live profile until finalized.
- **History:** Admin can view past versions and who changed what (also in the audit log).
- Example: the company is changed from "Cluster Technologies" to "Cluster Tech". The login page, header and tab title change at once, and the next invoice shows "Cluster Tech". Last week's invoices still show "Cluster Technologies".
