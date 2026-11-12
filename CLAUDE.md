# CLAUDE.md: Billing & Management System (Demo Edition)

You are building a **working, deployable demo** of a billing and management system for a small manufacturing and trading business. It will be shown to a client, so it must be correct, fast, minimal and professional. It is **not** a prototype and **not** a mock-up.

## Read before writing any code (in this order)
1. `docs/01-overview-and-scope.md`: what and why, end-to-end flow, out of scope, assumptions
2. `docs/02-roles-and-permissions.md`
3. `docs/03-modules-and-workflows.md`: every screen and workflow (the main document)
4. `docs/04-business-rules.md`: calculations and rules, **with test vectors you must pass**
5. `docs/05-data-model.md`
6. `docs/06-architecture-demo-edition.md`: Netlify, backend, data store, engineering concepts
7. `docs/07-api-contract.md`: endpoints
8. `docs/08-ui-design-system.md`: **the UI is the most important part**
9. `docs/09-print-documents-and-reports.md`
10. `docs/10-seed-data.md`: the generic demo data
11. `docs/11-testing-and-demo-script.md`: acceptance
12. `docs/12-build-plan-and-prompts.md`: build in these phases

`docs/appendix-production-target.md` describes the future production system. **Do not build it.** Keep the API contract and services compatible with it.

The documents keep their original section numbers (Section 2B, Module 11, Section 8A and so on). When one document says "Section X", find that heading in the set. Map: 1, 1A, 12, 13, 16 are in 01; 3 in 02; 6 (Modules 1 to 12) in 03; 5 in 04; 4 in 05; 2B and 8 in 06; 8A in 08; 9 and 9A in 09; 7 in 10; 11 and 14 in 11; 15 in 12.

## Non-negotiable rules
1. **Demo only.** Deploy target is **Netlify**: a React frontend plus a real serverless backend (Netlify Functions). **No external database** (no Supabase, Postgres, Redis, Docker). Seed data is bundled; new records go through the `DataStore` adapter (Netlify Blobs, with an in-memory fallback). See doc 06.
2. **Generic data.** Use Product A, Product B, Raw Material A, Customer A, Worker A and so on, and the brand placeholder `[Your Brand Name]`. No real brand, product or place names anywhere.
3. **Do not invent features.** Build what the documents say. If something is ambiguous, follow the assumptions in doc 01, choose the simplest sensible option, and record it in `DECISIONS.md`.
4. **The UI is the main part.** Follow doc 08 exactly: white-dominant, navy plus one warm brown accent, IBM Plex Sans, no gradients, no emojis, no generic template look, restrained purposeful motion. Check the design acceptance checklist before finishing any UI phase.
5. **A4 portrait only** for every printed document. Repeating header and table heading on every page, totals on the last page only. Doc 09.
6. **Money** is stored as **integer paise** and displayed in Indian format (`₹1,23,456.00`). Never use floats for money. Rounding is half-up to 2 decimals per line. Quantities have 3 decimals.
7. **Business logic lives in `/packages/contract` (pure functions) and `/server/services`.** The web app only calls the API through the typed client. Routes stay thin. RBAC and data scoping are enforced on the server, never only in the UI.
8. **Every business operation is one atomic transaction** (compare-and-set on the DataStore) and writes the audit log. Use idempotency keys on creates and payments.
9. **Passwords are managed only by Admin.** No change-password and no forgot-password screens for anyone else.
10. **Worker login cap** is a setting (`maxWorkerLogins`, default 10) enforced on the server.
11. **Be honest about what is real and what is simulated.** Follow the table in doc 06. Never label something as a running load balancer, server cluster or production database if it is not.
12. **Quality floor:** TypeScript strict, no `any`, no TODO or placeholder screens, no dead buttons, every list has loading, empty and error states, keyboard accessible, responsive (billing on tablet, approvals and My Pay on phone).

## How to work
- Work **one phase at a time** from doc 12. Finish it completely, run the tests, run the app and click through it, then commit and move on.
- Write the **calculators and services test-first** using the vectors in doc 04. They must pass before building screens on top.
- Commit after every phase with a clear message. Keep files small and well named. Do not leave generated or unused code.
- Keep `DECISIONS.md` updated (date, decision, reason).
- Before saying a phase is done: tests green, `pnpm build` succeeds, no console errors, UI checked against doc 08, the relevant demo-script steps in doc 11 work end to end.
- Never log or commit secrets. `JWT_SECRET` comes from the environment.

## Commands (create these in Phase 0)
`pnpm dev` (Netlify dev: web and functions) · `pnpm build` · `pnpm test` (unit and API) · `pnpm e2e` (Playwright) · `pnpm verify:seed` · `pnpm loadtest` · `pnpm lint` · `pnpm typecheck`

## Definition of done (whole project)
All 23 steps of the demo script in doc 11 run without errors on a deployed Netlify preview, all test vectors pass, the seed verifies, Lighthouse budgets hold, the design checklist passes, and the README explains local run, deploy, environment variables, demo logins and what is real versus simulated.
