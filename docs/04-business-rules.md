# 04. Business rules and test vectors

## 5. Cross-cutting Business Rules

### 5.1 Numbering (via `Counter`, atomic, per financial year Apr to Mar)
- Invoice `INV/26-27/0001`, Receipt `RCT/26-27/0001`, Indent `PI/26-27/0001`, PO `PO/26-27/0001`, Batch `BATCH/26-27/0001`.

### 5.2 GST calculation (server-side, one shared pure function `calcInvoice()` with unit tests)
Per line:
1. `gross = qty × rate`; `disc = gross × discountPct/100`; `net = gross − disc`.
2. **Tax-exclusive:** `taxable = net`; `tax = taxable × gstRate/100`; line total = taxable + tax.
3. **Tax-inclusive:** `taxable = net / (1 + gstRate/100)`; `tax = net − taxable`; line total = net.
4. **Intra-state** (customer state == company state, Tamil Nadu): `cgst = sgst = tax/2`, `igst = 0`. **Inter-state:** `igst = tax`.
5. Round each line to 2 decimals. Invoice totals = sum of lines. `roundOff` = round grand total to nearest ₹1. Show round-off on the invoice.
6. Invoice shows a **tax summary table** grouped by GST rate (taxable value, CGST, SGST, IGST).
- Seed GST rates are **sample values and must be editable per product** in the master. The client confirms the correct rates and HSN.

### 5.3 Invoice status
- `DRAFT` (editable) → `SENT` (locked, stock reduced) → `PAID` (paid ≥ grand total).
- `OVERDUE` is computed: status SENT, unpaid balance > 0 and `dueDate < today` (credit and distributor bills; default due = +15 days, a setting).
- Cash bill: when saved as Sent, an auto-payment of the full amount (CASH) is created, so it becomes Paid.
- Sent invoices cannot be edited. Corrections go through a **Cancel** (admin only, with reason, reverses stock) and re-bill. Log it.

### 5.4 Stock effects on billing
- Moving an invoice to `SENT` creates `FinishedStockMovement(SALE, −qty)` per item.
- **Block** if finished stock is insufficient (clear error message naming the product and available quantity).

### 5.5 Payments
- Payment may be linked to a specific invoice (bill-wise) or posted on account. On-account amounts auto-allocate to the oldest unpaid invoice first (FIFO).
- Partial payments allowed. Overpayment beyond outstanding is rejected.
- Updates `paidAmount` and status, and posts to cash or bank ledger by mode (CASH → cash; UPI, BANK, CARD → bank).

### 5.6 Fund tracker
- `Fund received` = sum of tranches.
- `Fund committed` = sum of indents in `APPROVED` or `RECEIVED` and not yet fully paid (shown as information).
- `Fund utilised` = sum of **supplier payments**.
- `Balance available` = received − utilised.
- When Admin submits an indent, show a warning (not a hard block) if the indent total exceeds `received − utilised − committed`.

### 5.7 Audit
Write `ActivityLog` for every create, update, cancel, approval, stock adjustment and login. Admin can view it filtered by user, entity and date.

---

## Test vectors (these must pass as automated tests)

All amounts in rupees for readability; store as paise. Rounding: half-up to 2 decimals per line.

### Invoice (`calcInvoice`)
**I-1. Tax-exclusive, intra-state (CGST+SGST), item discount**
| Line | Qty | Rate | Disc % | GST % | Taxable | CGST | SGST | Line total |
|---|---|---|---|---|---|---|---|---|
| 1 | 10 | 250.00 | 0 | 5 | 2,500.00 | 62.50 | 62.50 | 2,625.00 |
| 2 | 4 | 400.00 | 10 | 5 | 1,440.00 | 36.00 | 36.00 | 1,512.00 |
Invoice: gross 4,100.00, discount 160.00, taxable 3,940.00, CGST 98.50, SGST 98.50, IGST 0, round-off 0.00, **grand total 4,137.00**.

**I-2. Tax-inclusive, inter-state (IGST):** qty 1, rate 1,050.00 inclusive, GST 5% → taxable 1,000.00, IGST 50.00, total 1,050.00.

**I-3. Round-off:** qty 7, rate 199.50, GST 12% exclusive, intra-state → taxable 1,396.50, tax 167.58 (CGST 83.79, SGST 83.79), total before round-off 1,564.08, round-off −0.08, **grand total 1,564.00**.

### Working days
**W-1.** 30-day month, 4 Sundays off, no holidays → 26. **W-2.** 31-day month, 5 Sundays off, 1 extra holiday → 25.

### Hours rounding (default: nearest hour, 30 minutes rounds up; rounding applied to the day's total)
1 h 35 → 2 · 1 h 20 → 1 · 7 h 29 → 7 · 7 h 30 → 8 · 8 h 10 → 8 · 0 h 29 → 0 · 0 h 30 → 1. Two sessions of 1 h 10 and 0 h 40 on one day total 1 h 50 → 2.

### Payslip (`calcPayslip`)
**P-1. FIXED, full attendance count:** base 17,000, 26 working days, per-day 653.846…, 24 days present → base earned **15,692.31**.
**P-2. FIXED with half-days and advance:** 22 present + 2 half-days = 23 payable days → 15,038.46. Advance recovery 2,000.00, no allowance → net 13,038.46, paid **13,038.00** (round-off −0.46).
**P-3. FIXED, month to date:** period 1st to 10th, 8 working days in the period, all present → 8 × 653.846… = **5,230.77** (the day rate always uses the **full month's** 26 working days).
**P-4. HOURLY:** rate 90; daily rounded hours 8, 8, 7, 8, 2 → 33 h → **2,970.00**. No overtime anywhere.
**P-5. Net never negative:** earned 1,000, advance recovery requested 1,500 → recovery capped at 1,000, net 0, the remaining 500 stays as outstanding advance.

### Share pay
**S-1.** Share base 30,00,000, 5%, 26 working days, 23 payable days. Reduce by absences **ON** → effective 4.4230769% → **1,32,692.31**. **OFF** → **1,50,000.00**.

### Profit settlement (`calcSettlement`)
**ST-1. Normal month:** sales 80,00,000, purchases 30,00,000 → gross profit 50,00,000. Loan repayment 20,00,000 → pool 30,00,000. FIXED and HOURLY earned total 1,20,000. Two SHARE workers at 5% and 3% (switch off) → 1,50,000 and 90,000. Worker total 3,60,000 (no scaling). Other expenses 1,50,000. **Owner amount 24,90,000.**
**ST-2. Small profit, scaling:** sales 4,00,000, purchases 3,00,000 → gross 1,00,000, loan 0, pool 1,00,000. FIXED and HOURLY earned total 1,20,000 plus one SHARE worker at 5% (off) → 5,000. Total 1,25,000 > pool → scale 0.8. A worker who earned 17,000 gets **13,600**, the share worker gets **4,000**, total payable 1,00,000. Other expenses 20,000 → **owner −20,000 (shown as a deficit)**.
**ST-3. Loan cap:** gross 50,000, loan requested 80,000 → applied 50,000, pool 0, 30,000 stays outstanding on the loan, all workers 0, owner = −expenses.
**ST-4. Already paid:** a FIXED worker computed 17,000 who already received a 10,000 payslip that month → balance payable 7,000. If already paid exceeds computed, the excess carries as an advance.

### Payments, stock, funds
**PAY-1. FIFO:** unpaid INV-1 1,000.00 (older) and INV-2 2,000.00. Payment on account 1,500.00 → INV-1 PAID, INV-2 paid 500.00, outstanding 1,500.00. Overpayment beyond total outstanding is rejected.
**STK-1. No oversell:** Product A stock 5. Two simultaneous bills of 3 each → exactly one is finalized, the other fails with `INSUFFICIENT_STOCK` naming Product A and available 2.
**FUND-1.** Received 10,00,000, utilised 4,00,000, committed 2,00,000 → available 4,00,000 (balance 6,00,000). An indent of 5,00,000 shows a **warning**, not a block.
**NUM-1.** An invoice dated 31 Mar 2027 gets `INV/26-27/NNNN`. One dated 1 Apr 2027 gets `INV/27-28/0001`.
**IND-1.** Approval order is fixed Admin → Monitor → Collector. A Monitor trying to approve at stage 1 gets 403. A rejection at stage 2 returns the indent to Admin, and resubmission restarts at stage 1.

### API behaviour
**RATE-1.** The 6th failed login within a minute for one username returns 429 with `Retry-After`. After 10 failures the account is locked for 15 minutes.
**IDEM-1.** Two identical `POST /invoices/:id/finalize` calls with the same `Idempotency-Key` produce one finalization and the same response.
**CONC-1.** Updating a record with a stale `If-Match` returns 409.
**AUTH-1.** A worker requesting another worker's payslip gets 404 (not 403) so existence is not revealed. A Distributor never sees another customer's invoice. Monitor and Collector requests for profit, loan or settlement endpoints get 403.
