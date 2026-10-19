# CLAUDE.md --- ExportFlow Project Rules

## Project goal

Build ExportFlow as a mobile-first PWA and management-intelligence
assistant that coordinates each Job Order through final delivery,
produces daily manager action plans, detects risks early, explains
recommendations, and prepares management communications.

## Source documents

Before changing code, read (in `/docs`):

1. `ExportFlow_Complete_Requirements_Bilingual_v1_9.docx` — business
   reference (Malayalam-first). Section 78 holds the v1.9 decisions.
2. `ExportFlow_Requirements_English_v1_9.docx` — English implementation
   companion. Section 31 mirrors Section 78.
3. `ExportFlow_Technical_Architecture_Development_Plan_v1_3.docx` and
   `ExportFlow_Technical_Architecture_Development_Plan_English_v1_3.docx`
   — proposed architecture; Section 16 is the only phase plan.

Earlier versions (Requirements v1.6–v1.8, Technical Plan v1.0–v1.2) are
superseded. If these documents are not accessible in the repository, ask
the user to place them in `/docs` or provide them. Never claim to have
read inaccessible files. If the Malayalam and English documents conflict,
report the discrepancy and ask; do not silently choose.

## Confirmed decisions (v1.9)

-   Approvals happen manually outside the app (decidedAt may be
    back-dated, reason optional; recordedAt is automatic and recording
    lag never counts as a delay). The app only records
    them (who, when, how, required-by) and derives On Time / Late /
    Overdue. The app never sets an approval to Approved by itself.
-   ExportFlow is a personal tool for the user, not an official company
    system: keep data entry light.
-   Stock for each Job Order is confirmed manually per order line (and
    per raw material for in-house manufacturing). No automatic
    safety-stock calculation. Warn on over-allocation across orders.
-   Internal deadline: buffer days = ceiling(order period in calendar
    days × 10%). Store the computed deadline and rule version per order.
-   Skeleton-first: every module works with available data; missing
    data shows Pending Verification / Unavailable / Insufficient Data
    and creates verification tasks. DEMO and ACTUAL data stay separate.
-   Hosting: new GitHub repo + GitHub Pages; new, dedicated Firebase
    project on the free Spark plan (Auth + Firestore) for Phases 1–6.
    No Cloud Functions or Storage until a Blaze-plan decision is made.
-   The user works from a phone only; give setup steps that can be done
    on a phone.

## Phase plan changes (confirmed 19 Oct 2026, supersede Tech Plan §16)

-   Phase 2 = Customer, Product, Raw Material masters + BOM + unit
    conversion. Department and Supplier masters moved to the phases that
    need them (stage tracking / procurement).
-   One BOM per product, written per ONE product base unit; a different
    recipe means a different product.
-   Multi-level BOM: a BOM line's component is a raw material OR another
    product (one item = one record; never duplicate an item as both).
    Raw Material = bought and never sold; anything made or sold is a
    Product. `explodeBom()` walks sub-products (MANUFACTURED/BOTH are
    produced, TRADED are bought), sums repeated components, refuses loops
    (`createsCycle()`), and marks the result provisional if any level is
    missing or unconfirmed. BOTH is assumed "made" until a Job Order decides. BOM versions = record `rev`; Job
    Orders (Phase 3) must snapshot the BOM lines they used.
-   Unit conversion is deterministic (`src/lib/units.ts`): standard units
    within a dimension; count↔area↔mass via size (L×W), GSM and weight
    per piece; user-defined units (bale, roll) per item. Never guess a
    missing conversion — return "Conversion needed".
-   Base unit of products and raw materials is fixed after creation
    (enforced in UI and rules).
-   Supplier master (confirmed 19 Oct 2026, label "Suppliers"): name
    required; place, contact, phone, email, GSTIN, notes optional.
    Supplier ↔ item links (raw materials and products) are editable from
    both sides but stored only on the supplier (`items` = item keys).
    No prices, lead times or payment terms until real data exists.
-   Masters are never deleted; they are set Inactive. Product code is
    optional and not auto-generated until the company scheme is known.
-   Build only company-independent parts now (Phases 2–3). Packing,
    container estimates, workflow stages, departments, approvals and
    procurement wait until the user has joined and seen real processes.

## Phase 3 decisions (confirmed 19 Oct 2026)

-   Phase 3 is split: 3a Job Order core (header, lines, Make/Buy per
    line, 10% deadline, status, BOM snapshot at confirmation); 3b
    per-JO manual stock confirmation + explosion into To produce / To
    buy with over-allocation warnings; 3c print/share as PDF via the
    Android share sheet (JO summary, To buy, To produce).
-   JO status: Draft → Confirmed → Completed, or Cancelled. Completed
    can be reopened to Confirmed, Cancelled to Draft. Cancelling and
    reopening require a reason (rules check the paired audit event);
    editing a confirmed JO does not (history records old/new values).
    Whether stock-quantity changes need a reason (Req. §31.3 says yes)
    is decided in the 3b design. A later BOM change never alters a
    confirmed JO; it shows a notice and "Use latest BOMs" (with reason).
-   Order Period starts on the JO received date. Delivery Date Type:
    Not confirmed yet / Factory dispatch / Port / Arrival at customer.
-   JO import (Excel, text PDF, typed images via on-device OCR) is
    built after the user joins and has a sample format. No AI
    extraction for now. Imported data is always a draft the user
    confirms. Original files are kept on the phone only. Android share
    target ("Share → ExportFlow") comes with import.
-   Daily task/blocker list waits for department benchmarks; it must
    also be printable/shareable.
-   3c documents (`src/lib/docs/`): A4 PDF built on the phone, English,
    simple header (company name from Settings, title, JO no., date; logo
    and address later), PROVISIONAL band with reasons when data is
    incomplete, no signature block. Share sheet or download; the app
    never sends anything itself. Later templates on the same engine:
    per-department daily to-do/targets, all-department review summary
    (evening/next morning), supplier RFQ letters and purchase orders —
    always drafts the user sends; no invented prices or supplier data.
-   3b stock: per-JO earmarks for finished products, made sub-products
    (deducted before exploding their components) and raw materials;
    qty + unit required, location/remarks optional, who/when automatic;
    reason optional, but each entry shows when it last changed and the
    previous value (overrides Req. §31.3 "reason required"). A manual
    stock count per item (with date) feeds the over-allocation check:
    warning only for Confirmed JOs, Draft earmarks shown as info; no
    count = "manual only". Plus an all-orders To buy list.
-   Home becomes a dashboard after 3b, layout "Option B · Track"
    (mockup artifact "ExportFlow Home Dashboard"): status counts,
    3-week deadline strip, planned-vs-actual bar per JO, materials from
    stock %, To buy, needs attention. Colour follows schedule gap
    (actual − planned), a smooth gradient green → amber → red (full red
    at about 20% behind, configurable; or past the internal deadline),
    always with the number shown. Until stage tracking (Phase 4) the
    actual % is a manual per-JO slider (dated); planned % rises
    linearly from confirmation to the internal deadline; no update =
    "Not tracked".

## Project setup (confirmed)

-   Repo: `kareempalathingal/exportflow`. App URL:
    `https://kareempalathingal.github.io/exportflow/` (Vite `base` is
    `/exportflow/`; HashRouter). Deployed by
    `.github/workflows/ci-deploy.yml` on push to `main`.
-   Firebase project: `exportflow-89597` (Spark plan). Web config lives in
    `src/firebase.ts` (public by design). Never reuse the Al Ameen
    Instalment project, repo or credentials.
-   Login: username + password. Username `x` maps to Firebase Auth email
    `x@exportflow.app` (`src/lib/username.ts`). Only Email/Password sign-in
    is enabled. Users are created by the owner in the Firebase console.
-   UI language: English by default, Malayalam optional in Settings.
-   Firestore rules (`firestore.rules`) are NOT deployed by CI: after any
    rules change, the user pastes the file into Firebase console →
    Firestore → Rules → Publish. Say so explicitly when rules change.
-   Data layout: `workspaces/{uid}_actual` and `workspaces/{uid}_demo`;
    versioned records carry `rev`, `updatedAt`, `updatedBy`,
    `lastAuditId` and are written with `saveRecord()` (record + audit
    event in one batch). New record collections need a matching
    `match` block in `firestore.rules`.
-   Browser storage keys use the `exportflow:` prefix (shared origin with
    other apps on the same github.io domain).
-   Checks: `npm run check` (typecheck, lint, unit tests, build).
    Rules tests: `npm run test:rules` (needs the Firestore emulator; runs
    in CI because the emulator download may be blocked locally).

## Non-negotiable rules

-   Start with a read-only repository audit. Do not edit files or
    install dependencies in the first step.
-   Do not build the entire app in one pass. Work one approved
    phase/feature at a time.
-   Do not silently change requirements, architecture, data model,
    authentication, or deployment.
-   If requirements conflict or information is missing, report it and
    create a decision/question list.
-   Never invent company recipes, BOM quantities, treatment steps,
    productivity benchmarks, supplier lead times, or approved workflows.
    Mark them Pending Verification/Unavailable.
-   Keep verified facts, user-provided facts, estimates, and assumptions
    distinct.
-   Use deterministic code for arithmetic, stock, deadlines, scheduling
    and validation wherever possible. Do not rely on an LLM for exact
    calculations.
-   AI outputs are suggestions/drafts unless a human approves them.
    Never silently change verified master data or approved plans.
-   Do not autonomously send purchase orders, make customer delivery
    promises, approve overtime, waive quality checks, or perform
    consequential actions without explicit authorization.
-   Never claim a communication was sent unless an integration confirms
    success.
-   Never commit credentials, API keys, tokens, service-account files or
    passwords.
-   Do not reuse another app's Firebase project or secrets. ExportFlow
    must have its own approved configuration.
-   Avoid destructive changes and migrations without a plan and backup.
-   Preserve existing behavior; use Git checkpoints and relevant
    regression tests.
-   Never hide failing tests or known limitations.

## Workflow for each task

1.  State the task and affected modules.
2.  Inspect relevant code and tests.
3.  Propose a small plan and risks.
4.  Make the smallest coherent change after approval.
5.  Run relevant tests, type checks, lint and build commands that exist.
6.  Run regression tests.
7.  Report changed files, commands/tests and results, limitations, and
    next step.
8.  Stop at the phase approval gate.

## Quality requirements

-   Use TypeScript strict typing if the approved stack uses TypeScript.
-   Validate inputs and handle loading, empty, offline, error and
    permission-denied states.
-   Keep business logic separate from UI where practical and make it
    testable.
-   Use least-privilege security rules and test unauthorized access.
-   Distinguish proposed plans, simulations, approved plans and actual
    records.
-   For sync, show pending/synced/failed/conflict states; never silently
    overwrite conflicts.
-   Keep mobile-first usability in mind.
-   Add or update acceptance and regression tests for meaningful
    behavior changes.

## First action

Perform a read-only repository audit. Do not edit files, install
dependencies, create cloud resources, change Firebase settings or deploy
until the user approves the audit and phase plan.
