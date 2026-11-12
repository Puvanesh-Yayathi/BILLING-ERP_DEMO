# 09. Print documents and reports

## 9A. Print Documents and Templates

**Documents to produce (all from isolated templates, all in Indian formats):** Tax Invoice (cash, credit, distributor), Payment Receipt, Purchase Order, Purchase Bill / Goods Receipt Note, Supplier Payment Voucher, Payslip (individual), Consolidated Payslip and Settlement Statement, Ledger Statement, Day Book, and all report prints.

**Paper:** **A4 portrait only** (210 x 297 mm). If the client later wants another size it will be added then. Orientation is portrait for every document, including report prints (wide reports reduce column count or font, they do not rotate).

**Common page frame (every document, every page):**
- **Header (repeats on every page):** logo, company name, address, phone, GSTIN (from the profile version of that document), document title (e.g. "TAX INVOICE"), **document number and date**, and the bill-to or party block. On continuation pages a compact version (logo, company name, GSTIN, document title, number, date, "Page x of y") is repeated.
- **Table heading row repeats on every page**, and the items continue under it.
- **Footer (every page):** "Page x of y", "This is a computer-generated document", and the footer note from the profile.
- **Last page only:** totals, tax summary, amount in words, bank details and QR, terms, authorised signatory "For [Brand Name]". This block is **never split across pages**. The last page must always contain at least two item rows along with the totals (never a page of only totals).
- A "Continued on next page" label appears under the table when it overflows.
- Example required by the client: a bill with 12 products where one page fits 10. Page 1 has the header, table heading, 10 items and "Continued". **Page 2 repeats the header and table heading, shows items 11 and 12, then the totals and footer.**

**A4 geometry (everything must fit exactly; no clipping, no drifting):**
- Page 210 x 297 mm. Margins: 10 mm left and right, 10 mm top, 12 mm bottom. Usable width **190 mm**.
- A 190 mm grid. Header block: logo (max 22 x 22 mm) and company details on the left, document title and number and date block on the right-aligned to the right margin. Party details below in two equal columns separated by a hairline.
- **Invoice item table column widths (mm):** S.No 8, Description 46, HSN 16, Qty 14, Unit 11, Rate 20, Discount 14, Taxable value 22, GST % 11, Amount 28 (total 190). Text columns left-aligned, number columns right-aligned with tabular figures, S.No centred. Long descriptions wrap inside the cell and never push the table past the margin. Row height 7 mm minimum, 0.2 mm hairline row separators, header row has a Deep Sea bottom rule.
- Totals block right-aligned in a 80 mm column ending at the right margin, with the tax summary table to its left. Amount in words spans the full width under them. Bank details and QR (28 x 28 mm) on the left of the lower band, terms in the centre, signatory on the right. Everything in the lower band shares one baseline grid.
- Footer at the bottom margin: page number "Page x of y" right-aligned, computer-generated note left-aligned, on every page.
- Same grid and margins for all documents so that stacks of printed paper look like one family.
- **Alignment verification:** Playwright renders each document to PDF, rasterizes it at 150 dpi, and compares it to approved reference images (pixel difference under 0.1%). A separate check asserts that no element extends beyond the 10 mm margins and that no text is clipped.

**Tax Invoice specifics (Indian format):** title "TAX INVOICE" (or "BILL OF SUPPLY" if no tax is charged), invoice number, date, due date for credit, place of supply and state code, supplier GSTIN, buyer name, address and GSTIN, and a copy label (Original for Recipient / Duplicate for Transporter / Triplicate for Supplier, selectable at print). Item table columns: S.No, Description, HSN, Qty, Unit, Rate, Discount, Taxable value, GST %, Amount. Tax summary by rate (taxable, CGST, SGST or IGST, total tax). Round-off. Grand total in figures and in words (Indian numbering). Bank details with UPI QR. Terms and conditions. Signatory block.

**Payslip specifics:** employee details, pay type, period, attendance summary (working days, present, half, absent, leave, hours), earnings, deductions, net pay in figures and words, payment mode and date, "Received by" signature. Consolidated payslip: Admin-only summary page plus the table of all workers (see Module 11).

**Implementation:** HTML and CSS print templates. In the **Demo Edition** they are printed from the browser with `window.print()` (the user chooses "Save as PDF" for a file) using `@page { size: A4 portrait }`, a repeating `<thead>` and a fixed footer. In production the same templates are rendered by headless Chromium on the server. The company header goes inside the `<thead>` of the main table so it repeats natively, plus a fixed footer for page numbers, `@page { size: A4 portrait; margin: 0 }` with margins applied in the template, and `break-inside: avoid` on the totals block. The PDF is generated by the queue worker and cached by document id and profile version. Print and PDF must look identical.

**Verification (Playwright tests):** render invoices of 1, 10, 12, 25 and 60 items in A4, and assert page count, header text on every page, table heading on every page, totals only on the last page, at least two item rows on the last page, and no clipped text.

## 9. Reports (12 groups, date filters, export to Excel and PDF)

| # | Report | Admin | Staff | Operating | Monitor | Collector | Distributor |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| 1 | Daily / monthly / yearly sales; customer-wise; product-wise; tax summary (CGST/SGST/IGST) | ✅ | ✅ | | ✅ | ✅ | |
| 2 | Top customers and top items | ✅ | | | ✅ | ✅ | |
| 3 | Outstanding and overdue summary; customer and distributor ledger | ✅ | ✅ | | | | Own |
| 4 | Fund received, utilised, balance | ✅ | | | ✅ | ✅ | |
| 5 | Purchase indent status (pending / approved / rejected) | ✅ | | | ✅ | ✅ | |
| 6 | Purchase register; supplier-wise purchases | ✅ | | | ✅ | ✅ | |
| 7 | Raw material stock; finished product stock | ✅ | | ✅ | ✅ | ✅ | |
| 8 | Production batch report with wastage | ✅ | | ✅ | ✅ | | |
| 9 | Day book; cash flow book | ✅ | | | ✅ | ✅ | |
| 10 | Attendance, hours and salary statement (payslip register); staff advance | ✅ | | ✅ | | | |
| 11 | Daily expense report; head-wise summary | ✅ | | | ✅ | ✅ | |
| 12 | Profit summary, month-wise (Admin only, because profit is Admin-only) | ✅ | | | | | |

Only these reports. Do not add others.
