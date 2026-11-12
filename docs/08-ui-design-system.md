# 08. UI direction and design system

This is the most important part of the demo. Follow it exactly.

## 8A. UI Direction and Design System (the most important part of the demo)

**Goal:** the app must look like carefully designed professional business software made by a design team. It must not look like a generated template. A client should feel calm, order and speed. Every screen, state and transition is designed, not defaulted.

### Character
Calm, precise, trustworthy business software. The identity comes from **deep navy and clean white**, with a small amount of **warm brown** as the only warm note. Quiet and disciplined, one memorable moment (the login page), everything else restrained. The demo is product-neutral: no industry imagery, no fish or food graphics.

### Palette (white is the major colour)
| Name | Hex | Use |
|---|---|---|
| White | `#FFFFFF` | Page and panels (about 80% of every screen) |
| Mist | `#F3F5F8` | Table header band, sidebar hover, subtle surfaces. Cool grey, **not cream**. |
| Hairline | `#DCE2EA` | Borders and dividers |
| Deep Sea | `#0F2A47` | Sidebar, login panel, headings, primary text on white |
| Tide | `#1F5F99` | Primary buttons, links, active states, main chart series |
| Cured Brown | `#8A5A2B` | The one warm accent: second chart series, small markers, active-item indicator, key numbers sparingly |
| Slate | `#5B6878` | Secondary text |
Status colours appear **only as small text, dots or thin left markers**, never large fills: success `#1E7B4F`, caution `#A66A12`, danger `#B3261E`. Text contrast meets WCAG AA. Previous-period comparison uses Slate at 40%. Do not add any other colours. **No gradients, no coloured glows, no blurred blobs, no gradient washes.**

### Typography (professional, with clear roles)
**One family, used with discipline: IBM Plex Sans**, self-hosted (WOFF2, subset to Latin plus the rupee sign ₹). It is a precise, neutral business typeface with true bold and medium weights and tabular figures. Fallback stack: `"IBM Plex Sans", "Segoe UI", system-ui, sans-serif`. Weights loaded: 400, 500, 600, 700. Enable `font-variant-numeric: tabular-nums` for every figure. Sentence case throughout the app. No ALL-CAPS labels, no tracked-out eyebrows.

| Role | Size / weight | Notes |
|---|---|---|
| Login headline | 40 / 600 | Deep Sea, tight line height 1.15 |
| Page title | 20 / 600 | Deep Sea |
| Section title | 16 / 600 | Deep Sea |
| Large figure (KPI) | 28 / 600 | tabular, Deep Sea; change vs previous period 13 / 500 in status colour |
| Table column heading | 12.5 / 600 | Slate, sentence case |
| Table body | 13 / 400 | numbers 13 / 500, right-aligned, tabular |
| Emphasis in a row (totals, balance) | 13 / 600 | |
| Body and form text | 14 / 400 | labels 13 / 500, helper text 12 / 400 Slate |
| Buttons | 14 / 500 | |
| Links | 14 / 500 | Tide, underline on hover |
| Meta and timestamps | 12 / 400 | Slate |

**Bold and highlight rules:** bold (600) only for headings, totals, balances, status that needs attention, and the single most important number on a screen. Highlight with weight and the Tide or Cured Brown colour, never with background marker colours, never with italics for emphasis. Negative amounts and overdue figures use the danger colour with a minus sign or the word "overdue", never colour alone.

**Documents (print and PDF) use the same family, embedded in the PDF:** company name 16 / 700, document title 14 / 700 (the legal titles "TAX INVOICE" and "BILL OF SUPPLY" may be capitals), field labels 8 / 500 Slate, field values 9 / 400, table heading 8.5 / 600, table body 9 / 400, grand total 12 / 700, amount in words 9 / 500. All printed figures are tabular and right-aligned. Verify that ₹ renders in both the app and the PDF.

### Layout and shape
- Left sidebar (Deep Sea, 232 px, collapses to icons), slim top bar (white) with company logo and name, global search, live-sync indicator, notifications, user menu, and for workers the clock widget.
- 8 px grid. Radius by hierarchy: inputs and buttons 6 px, panels 8 px, dialogs 12 px. Do not use one radius everywhere.
- **Structure over cards:** avoid walls of identical rounded cards with the same shadow. Use full-width bands, tables, split panes, ranked lists and dividers. Panels are separated by hairlines. **No drop shadows** except on floating layers (menus, dialogs, toasts), where one soft shadow is used.
- Tables are the main element of the product: sticky header, row height 40 px, right-aligned numbers, zebra off, hover Mist, selected row with a 2 px Tide left marker, column resize and show/hide, compact/comfortable toggle, inline status text, keyboard navigation.
- Forms: labels above fields, helper text below, inline validation in plain language ("Enter a quantity of at least 1"), never a generic "Invalid input". Sticky action bar on long forms.
- Copy is specific and plain: "Save changes" not "Submit", "Finalize bill", "Record payment". The same action keeps the same name in the button, the toast and the audit log. Errors say what happened and what to do. Empty states say what the screen is for and give one clear action. No exclamation marks, no emojis, no "Oops", no arrows appended to button text, no middle-dot strings in headings.
- Icons: lucide, 1.5 px stroke, used only where they help scanning. No decorative icon grids.

### Login page (make it perfect)
```
+-----------------------------------+--------------------------------------+
|  Deep Sea panel (56%)             |  White panel (44%)                   |
|  [logo] Brand name (from profile) |                                      |
|                                   |         Sign in                      |
|    subtle sea-chart contour       |         Username  [..............]   |
|    lines (SVG), very low contrast |         Password  [..........] show  |
|                                   |         [ Sign in ]                  |
|  Billing, stock and accounts      |         Need access? Ask your administrator   |
|  in one place.                    |                                      |
|                                   |   Powered by Novoz Infinity (small)  |
+-----------------------------------+--------------------------------------+
```
- **Graphic:** fine contour lines like a topographic chart, drawn as SVG in slightly lighter navy at 8% to 14% opacity (no clipart, no stock illustration, no emoji). It must feel like a map, not a decoration.
- **Motion (one orchestrated moment):** on first load the contour lines draw in over about 1.2 s, then the form panel fades in over 240 ms. After that the lines drift very slowly (60 s loop, a few pixels), barely noticeable. No bouncing, no parallax on mouse.
- The brand name and logo come from the company profile, so a change shows on the login page at once. Default `[Your Brand Name]`.
- Behaviour: autofocus username, Enter submits, show/hide password, Caps Lock warning, remembered username (optional), button shows an inline spinner, then a brief check and a smooth transition into the app. Wrong password message in plain language and never says which field was wrong. Lockout shows "Too many attempts. Try again in 14:32" with a live countdown (ties to rate limiting). Fully usable on a phone (panel stacks, graphic shrinks to a header band).

### Motion system (professional, restrained)
- Durations: 120 ms (hover, press), 180 ms (menus, tabs), 240 ms (dialogs, drawers, page content). Easing `cubic-bezier(0.2, 0, 0, 1)`. Nothing over 400 ms except the one-time chart draw (600 ms).
- **Use motion only when it explains a change:** page content cross-fade (no slide-up on every section), menus and drawers slide in, an approval stepper fills as a stage completes, a newly arrived row in a live list highlights and fades over 1.5 s, saved/failed states in buttons, number changes tick on the dashboard, collapsing sidebar, route-level progress bar.
- **One orchestrated entrance** on the Admin dashboard's first load: figures count up once and the main chart draws once. Not repeated on every visit or on every filter change (filter changes morph values smoothly instead).
- Skeleton loaders (static or a very slow shimmer) instead of spinners for lists. Optimistic updates where safe.
- **No** hover-lift on every card, no scroll-triggered fade-ups, no parallax, no confetti, no looping decorative animation other than the login contour drift.
- `prefers-reduced-motion` disables all of it except opacity changes. Animate only `transform` and `opacity` for smoothness, 60 fps.

### Analytics dashboard (detailed)
```
+------------------------------------------------------------------------------+
| Dashboard     [Today | This week | This month | This year]  [Compare: on]  [Export] |
+------------------------------------------------------------------------------+
| Sales 4,82,300 | Purchases 1,90,000 | Gross profit 2,92,300 | Bills 64 | Due 1,12,000 |  <- one band, thin dividers, change vs previous period under each
+---------------------------------------------+--------------------------------+
| Sales vs purchases (main chart, wide)       | Live activity (feed, updates)  |
| line/area, previous period in grey          | Staff A  finalized INV/26-27/42 |
|                                             | Operating B recorded batch ... |
+---------------------------------+-----------+--------------------------------+
| Worker-wise sales (ranked bars) | Sales by hour of day (strip)  | Top products |
+---------------------------------+-------------------------------+--------------+
| Inventory health: low stock list | Outstanding by age | Pending approvals     |
+------------------------------------------------------------------------------+
```
- Uses real aggregated data. Every figure and bar is clickable and opens the underlying list pre-filtered (drill-down). Hover shows exact values with a small tooltip. Period switch changes everything consistently. Comparison toggle shows the previous period in grey.
- Charts: Tide as the primary series, Cured Brown as the second, grey for the previous period. Direct labels on the lines where possible, minimal gridlines, no 3D, no pie charts with more than 4 slices, no gradient fills.
- Worker dashboard uses the same layout but only their own data, fewer panels. Monitor and Collector get the sales, purchases, stock and approvals panels without profit.
- Numbers are formatted in Indian grouping with ₹ in tables and a compact form (₹4.82 L, ₹1.2 Cr) on the KPI band, with the exact value on hover.

### Documents
Black on white with a thin Deep Sea rule under the header and the logo. Same typeface. See Section 9A.

### Design acceptance checklist (check before calling the UI done)
1. Login page, dashboard, billing screen, an approval page, payslip overview and a printed invoice each reviewed in a browser at desktop and tablet widths, with screenshots saved to `/docs/screens`.
2. No screen contains a gradient, a coloured shadow, an emoji, an ALL-CAPS label, or an identical-card grid.
3. Only the palette above is used. A script greps the CSS for any colour outside the token list.
4. Every list has loading, empty and error states with real copy.
5. Keyboard focus is visible everywhere, and all actions work by keyboard.
6. Reduced-motion mode verified. Lighthouse accessibility score 95 or higher on the main screens.
7. Interactions feel instant: no layout shift, no flash of empty content.
