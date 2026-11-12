# 02. Roles and permissions

## 3. Roles and Permissions

Six roles. Enforce on **both** the UI (hide nav) and the server (reject actions). Use a single `can(role, action)` helper.

| Capability | Admin | Staff | Operating | Monitor | Collector | Distributor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Users, masters, prices, settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Customer entry | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create sales bills, print | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Receipts / payments received | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Fund tracker (add tranche) | ✅ | ❌ | ❌ | 👁 | 👁 | ❌ |
| Raise purchase indent | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve indent: Stage 1 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Approve indent: Stage 2 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Approve indent: Stage 3 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Goods receipt / purchase bill entry | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Supplier payment | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Raw stock, production, finished stock, adjustments | ✅ | ❌ | ✅ | 👁 | 👁 | ❌ |
| Attendance, daily expenses | ✅ | ❌ | ✅ | 👁 | 👁 (expenses) | ❌ |
| Payroll: rates, payslips, pay workers, advances | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Loans, profit settlement, consolidated payslip, owner amount | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Own attendance, hours today, own payslips (clock is automatic) | ✅ (any) | Own | Own | ❌ | ❌ | ❌ |
| Ledgers, day book | ✅ | ❌ | ❌ | 👁 | 👁 | Own ledger only |
| Dashboard and analytics | ✅ full | Own work only | Own work only | 👁 sales, purchases, stock (no profit) | 👁 sales, purchases, stock (no profit) | ❌ |
| Bills explorer (all sales and purchase bills, by worker or overall) | ✅ | Own bills | Own bills (sales and purchase) | 👁 | 👁 | Own |
| Company profile and branding | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Audit log, login history, System Status | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reports | Per matrix in Section 9 | | | | | |
| Own bills, ledger, dues, payments | ❌ | ❌ | ❌ | ❌ | ❌ | 👁 own only |
| Order request | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

👁 = read-only. Distributor queries must always be scoped by the logged-in distributor's `customerId`.

**Demo logins** (seeded; password for all: `Demo@123`; only Admin can change passwords):
`admin`, `monitor`, `collector`, `distributor` (linked to Distributor A), `staff1`, `staff2`, `staff3`, `operating1`, `operating2`. The five worker logins use 5 of the 10 allowed, so Admin can add 5 more live.
