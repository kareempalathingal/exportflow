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
    (Superseded 20 Oct 2026 by rule v2 in WORKING days — see "Working
    days and step times" below.)
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
-   "Wrong base unit? Copy in another unit" (product Details, confirmed 21
    Oct 2026, `src/lib/baseUnitCopy.ts`): makes a NEW product in another
    convertible standard unit (factor from size / GSM / weight); BOM
    quantities and own units rescaled (firm figures become "My estimate"
    when the conversion uses estimates); route, size and specs copied;
    other BOMs that used the old product and its suppliers move to the copy;
    the old product is set Inactive. Open orders, snapshots and stock counts
    stay with the old product (count stock again). Preview before writing;
    every write is a normal history entry. No in-place base-unit change.
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
-   Performance reports (confirmed 20 Oct 2026), PDF, any date range:
    JO-wise (on time vs internal deadline / delivery, buffer used,
    schedule gap over time, changes after confirmation) and, once stages
    and departments exist, department-wise (output vs target, on-time
    stage %, delays, QC rework if recorded). Plan against company or
    user benchmarks first; when enough real orders are completed,
    compare actual averages with benchmarks and SUGGEST a revision when
    the difference is significant — the user approves; benchmarks are
    versioned like the deadline rule and never changed silently or
    invented. Data captured now: `completedOn` and `progressLog` per JO
    (every update with its time; Phase 4 stage records replace the slider).
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

## Phase 4 skeleton: process steps (confirmed 20 Oct 2026)

-   Processes master (`processes`, label "Processes"): treatments and
    other steps shared by many products (weaving, bleaching, packing…);
    name + notes only. Departments and standard times come later.
-   Each product has an ordered process route on its form (`route`:
    process + output per working day (with unit) and/or fixed days, one
    data status; both empty = "time pending") and "Order of steps
    confirmed with the company" (`routeConfirmed`). Processes can be created from the route editor.
    Bought (TRADED) products have routes too (labelling, packing…).
-   At confirmation each JO line gets a copy of its steps
    (`lines[].steps`, `src/lib/route.ts` `buildLineSteps`): BUY lines
    start with built-in "Ordered → Received"; MAKE lines put made
    sub-product steps first (depth-first), then the product's own route.
    Steps can be changed per order (to-do steps only); product routes
    stay unchanged. Orders confirmed earlier get "Set up steps from
    product routes".
-   "X done → Y" marks the current step done (time automatic); "Undo
    last" reverses it. Each step shows actual vs planned working days
    and overruns. Line progress = done share, weighted by planned days when
    every step is timed; "should be" follows planned days, otherwise the
    linear deadline plan. Order progress = average of its lines and
    replaces the manual slider once steps exist (still logged in
    `progressLog`).
-   JO page opens on a "Products" tab (mockup "JO detail · progress per
    product"); Home shows "Now: product · step" and step overruns in
    Needs attention.

## Departments and contacts (skeleton, confirmed 21 Oct 2026)

-   Departments master (`departments`, label "Departments"): name, notes,
    people (`Person`: name, designation, phone, WhatsApp if different,
    company email, one main contact; at most 20) and the processes the
    department handles (`processIds`, stored on the department; a
    process in two departments is warned, not blocked). Work contacts
    only. Real names and numbers are added after joining.
-   Contact buttons only — no follow-up log (updates are entered in the
    app as usual): on a Job Order's Products tab for the step running now
    and the next one, and on Today items about steps. Call (`tel:`),
    WhatsApp (`wa.me` with a ready message) and Email (`mailto:` with
    subject and message); the message is a draft the user edits and
    sends — the app never sends anything. Main contact first, others
    under "more people". 10-digit Indian numbers get 91; incomplete
    numbers are refused (`src/lib/contacts.ts`).
-   Sample departments use example.com emails and no phone numbers, so no
    real person can be called from DEMO.

## Working days and step times (confirmed 20 Oct 2026)

-   Step time depends on quantity: planned days = quantity ÷ output per
    working day + fixed days (quantity-independent: drying, curing,
    batches), rounded UP to half a day. Hour-level planning later.
    Benchmarks are copied to JO steps at confirmation (confirmed, known or
    estimated values; estimates carry `estimated: true`, see below);
    planned days are worked out on display from the order as it is now
    (`planLines()` in `src/lib/route.ts`), so quantity, stock and holiday
    changes show at once.
-   Quantity per step: the line's product and made sub-products use the
    material plan (stock set aside deducted; a product needed by several
    lines is split by each line's share). Bought lines handle their full
    quantity. 0 days shows the reason (e.g. "All 120 kg from stock").
    The quantity is converted to the benchmark's unit; a missing
    conversion shows "Conversion needed", never a guess.
-   Shared department capacity across orders is NOT modelled yet (each
    order is planned as if alone); it comes with department capacities.
-   Working days: Sunday is the weekly off (editable); company holidays
    are added on the dashboard calendar (large type; tap a day to add or
    remove). Doc `settings/calendar` {weeklyOff, holidays} lives in the
    ACTUAL workspace; Demo uses the same calendar. No public holidays
    are added automatically.
-   Internal deadline rule v2 `buffer-10pct-ceil-min1-workdays/v2`:
    period = working days after the received date up to the delivery
    date; buffer = ceil(period × 10%), min 1; internal deadline = the
    buffer-th working day before delivery (always a working day). A
    delivery date on a day off is accepted with a warning. Drafts follow
    the current calendar; Confirmed orders (and older v1 orders) keep
    their stored deadline and show "Recalculate deadline" (saved with a
    history entry) and a Home attention item.
-   Planned % (linear plan, step plans, "fits the deadline" check,
    expected finish) counts working days. "Days left" pills stay
    calendar days.

## Reports tab and daily summary (confirmed 21 Oct 2026)

-   Bottom menu: Reports replaces History (History opens from Reports).
    Reports holds the daily summary (text share + PDF), the JO
    performance report, the all-orders To buy PDF and History; later the
    department to-do lists and review summaries. The To buy working list
    stays in Orders.
-   Home "Today" card (`src/lib/today.ts`): overdue / running late,
    today, and the next 2 working days — internal deadlines, deliveries,
    step overruns, steps due to finish, upcoming company holidays.
    "Share summary" passes plain text to the share sheet (or copies it);
    the app never sends anything. Backup reminders stay in Needs
    attention.
-   JO performance report (`src/lib/performance.ts`, Reports →
    Job Order performance): presets This month / Last month / Last 90
    days / Custom. Completed orders in the range: working days vs
    internal deadline and delivery, buffer used, allowed / planned /
    actual days, slowest step, furthest behind (from progressLog), plan
    changes after confirmation (from history; step progress excluded).
    Open orders listed separately; cancelled counted. Per process:
    planned vs actual for steps finished in the range; a benchmark
    suggestion only with >= 5 steps differing by >= 15% (median rate) —
    never applied automatically. Screen chart: allowed vs actual days per
    JO; the PDF engine draws simple grouped bar charts (`DocChart`).
-   Route steps have "Also for items taken from stock" (`alsoForStock`,
    default off): the step's time counts the stock set aside too (e.g.
    packing).
-   Desktop layout, Malayalam for the new screens and phone push
    notifications (GitHub Actions + FCM) are postponed.

## Manager reports (confirmed 21 Oct 2026)

-   Built only from data already in the app (`src/lib/managerReports.ts`,
    PDFs in `src/lib/docs/managerDocs.ts`); unknown values stay unknown.
    Each is a collapsed row in Reports with View / Share PDF / Download.
-   Orders at risk (text share too): Late (delivery or internal deadline
    passed), At risk (expected finish after the internal deadline, behind
    plan by the red threshold or more, draft past the planning benchmark),
    Watch (slightly behind, a step over plan, not tracked); every reason
    listed, worst first.
-   Delivery schedule: open orders (drafts marked) delivering in 30 / 60 /
    90 days or a custom range, plus open orders whose delivery date has
    passed; internal deadline, progress, expected finish (latest step
    finish of all lines) and "In time?" (Yes / No / Unknown / Draft).
-   Management summary (text share too): This / Last week (Monday-Sunday),
    This / Last month or custom; received (and since cancelled), confirmed,
    completed with on-time % (internal deadline and delivery), open orders
    by track today, deliveries in the next 7 days, top 5 risks.
-   Department work list (text share too): steps running now and starting
    within N working days (default 5, adjustable 1-30, kept on the phone),
    grouped by department; unlinked processes under "No department linked",
    Ordered/Received under "Bought items"; one department can be chosen and
    shared; contact buttons on running steps. Capacity not checked.
-   Stock allocation: per item counted stock (date), set aside on confirmed
    orders, free, drafts (info), orders; over-allocated first; a count older
    than 30 days is "old"; no count = "manual only".
-   To buy "Group by supplier" (Orders → To buy and Reports): an item with
    several suppliers is listed under each ("also from", buy it once);
    unlinked items last; no prices or lead times.
-   Not now: customer-wise, product-wise demand, pending company data.

## Data status labels and estimates (confirmed 21 Oct 2026)

-   The status says how sure a figure is and where it came from, not who
    entered it (everything is entered by the user). Labels
    (`DATA_STATUS_LABEL` in `src/lib/dataStatus.ts`, with a one-line hint
    under every status select): VERIFIED = "Confirmed" (company document
    or responsible person), USER_PROVIDED = "Known" (I know it / was told;
    good enough to use), ESTIMATED = "My estimate", PENDING_VERIFICATION =
    "To be confirmed", UNAVAILABLE = "Not available". Stored values are
    unchanged; all five levels stay distinct.
-   Estimated step times are now used in plans (previously "time
    pending"), always marked: "estimate" tag on the JO step, "· my
    estimate" in the basis, a PROVISIONAL reason in the working plan, an
    open point "time for X is approximate - to be confirmed with
    production" in the plan to submit, and "(estimate)" next to expected
    finish in the delivery schedule and risks. Orders confirmed earlier keep
    the step times copied then.

## Calculator and unit converter (confirmed 21 Oct 2026)

-   Home header button "Calculator" opens `/tools` (`src/features/tools/
    ToolsPage.tsx`, logic in `src/lib/calc.ts`), works offline. Calculator:
    hand-written parser (no eval), + − × ÷, brackets, % like a phone
    (200 + 10% = 220; 200 × 10% = 20); last 10 sums kept on the phone;
    "Convert this number". Converter: "Units" (within one kind) and "By
    product" (any product / raw material, every unit its size, GSM, weight
    and own units allow, with "via" and an "estimate" tag; same engine as
    orders; never guesses).
-   Later, when needed: size → area per piece, GSM + size → weight per
    piece, container fill (after packing data).

## KPIs (confirmed 26 Oct 2026)

-   Steps: optional "<step> started" and "<step> done" on the JO Products
    tab, both with "Date of this update" (default today; back-dating
    allowed, never future, never before the previous step / the start).
    `JoStep.startedAt` (ISO); `stepTime()` stores midday IST for past
    dates. With a start, step time splits into wait (previous done →
    started) and work (started → done); without it, everything counts as
    the step (marked "includes waiting"). "Undo start" for mistakes.
-   `src/lib/kpi.ts` (`buildKpis`), Reports → KPIs (`/reports/kpi`), any
    period vs the previous period of equal length: factory (orders
    completed, on-time delivery %, by internal deadline %, steps on time %,
    efficiency = planned ÷ actual days (same-day = half a day), average
    delay and wait per step, buffer used, planning days, plan changes per
    order, open orders late now) and per department (steps, on time,
    efficiency, delay, wait with start coverage, average days per step,
    main delay in late orders, running now / over plan; per process incl.
    quantity handled — never summed across processes). Purchase steps
    grouped as "Bought items"; unlinked processes as "No department
    linked". PDF with a chart, text share.
-   Targets: Settings → KPI targets (doc `settings/kpiTargets`, per
    workspace), user's own; empty = no colour. Met / within 10% (warn) /
    below. Home strip: last 30 days (on-time delivery, steps on time,
    efficiency, department needing most attention), hidden without data.
-   Benchmark suggestions (performance report) now use working time when
    the start was recorded. Daily department output vs target needs a
    production record — decide after joining.

## Capacity planning (decided 25 Oct 2026; build AFTER joining)

-   Wait until the company's real capacity practice is known (checklist
    item "capacity"): lines/machines vs total output, shifts, overtime,
    batch processes, setup times, subcontracting. Building now risks the
    wrong model and cannot be checked against real orders.
-   Agreed design for then: all open orders planned together against
    shared process / department capacity (finite capacity, working days).
    Capacity preferably as parallel lines × each product's own route rate
    (product difficulty stays in the calculation); "total output per day
    in a common unit" offered as an option if that is how the company
    measures. Queue order by internal deadline by default, with manual
    priority (move up / Rush), an impact preview before saving and a
    history entry with reason.
-   Draft JO "Capacity check": expected finish vs internal deadline, where
    it waits (process, department, behind which orders, days), impact on
    other orders, missing times / capacities listed. Then a Reports
    "Factory load" (weekly load % per process / department, bottlenecks
    first) and expected finish / risks using the shared queue.
-   No probability % until enough completed orders exist (about 10+):
    until then exact spare / late working days plus a Low / Medium / High
    risk level; later a % from actual-vs-planned history per process.

## Planning stage and plan document (confirmed 21 Oct 2026)

-   The order clock starts on the JO received date. "Planning"
    (received → confirmed) is the built-in first stage of every order
    (`planningStep()` / `withPlanning()` in `src/lib/route.ts`; worked
    out, not stored). Planned % (linear and step-based) counts from the
    received date. Planning benchmark: Settings → profile
    `planningDays`, default 1 working day (user benchmark; empty = not
    set). Drafts past it show in Today ("still in planning") and in the
    plan's open points; the performance report shows planning days per
    JO and the average.
-   Plan document (`productionPlanDoc()` in `src/lib/docs/model.ts`),
    for submission to superiors: "Proposed Plan" for drafts (steps from
    the product routes at that moment) or "Production Plan — status as
    of <date>" once confirmed. Contents: status band, plan version (JO
    revision + time), key dates, planning time, internal deadline and
    buffer, working days available, expected finish vs internal
    deadline, progress; a timeline (Gantt) with today / internal
    deadline / delivery markers; per-product schedule (quantity and
    basis, days, start, finish, status); materials to produce / to buy;
    open points and risks; notes (working days, capacity limitation);
    "Prepared by" (name + designation from Settings) and an empty
    "Reviewed / approved by" block for signing on paper — the app never
    marks anything approved. Available on the JO page and in Reports
    (choose a JO). PROVISIONAL band when times, routes or BOM data are
    missing.
-   Every PDF button row has View / Share PDF / Download (confirmed 21 Oct
    2026). View shows the PDF inside the app page by page (pdf.js
    `pdfjs-dist` 6.3.289, legacy build for older browsers, loaded on the
    first View and cached by the service worker — not precached), with
    zoom and Share / Download from the viewer.
-   Two versions (confirmed 21 Oct 2026): "to submit" (default, clean:
    no benchmarks, rates, calculation details, PROVISIONAL band or
    technical notes; missing data appears as plain-language open points
    such as "time for Latex backing to be confirmed with production";
    schedule columns Step / Quantity / Start / Finish / Status; "To be
    confirmed" for unknown dates) and "working" (all details, for the
    user only, banner "WORKING PLAN - internal details, not for
    submission"). `productionPlanDoc({ ..., variant })`.
-   Later (after real processes are known): an Analysis tab for the
    whole factory — department load from all orders, smooth capacity,
    bottlenecks, and scheduling orders against shared capacity.

## Data safety and onboarding aids (confirmed 20 Oct 2026)

-   Settings → Backup: one JSON file per mode (`src/lib/backup.ts`,
    format `exportflow-backup/v1`), share or download; last backup date
    kept on the phone. Home shows "Backup due" in ACTUAL when real data
    exists and the last backup is over 7 days old (or never).
-   Settings → Restore (`src/lib/restore.ts`, confirmed 20 Oct 2026):
    whole-file restore only. Preview per collection (new / changed /
    same / kept) before writing; needs internet. Each record is written
    as a NEW revision with the history reason "Restored from backup of
    …"; records not in the backup are kept; audit events are never
    restored. Job Orders go through allowed status paths (e.g. Completed
    → Confirmed → Completed). Products/raw materials whose base unit
    differs are skipped and listed. A DEMO backup can never go into
    ACTUAL; an ACTUAL backup may go into DEMO (practice). Restoring into
    ACTUAL requires a fresh backup of the current data first (30 min).
-   Crash handling: `ErrorBoundary` around every screen (and the app)
    shows Reload / Go to Home / Copy error details instead of a blank
    page. `src/lib/errorLog.ts` keeps the last 50 errors on the phone
    only (screen crashes, background errors, failed syncs, backup and
    restore errors); never sent anywhere.
-   Settings → System health: ACTUAL backup age, sync counts, errors
    (copy / clear), free-plan quota hits, "Check rules" (probes a newly
    added collection to detect unpublished rules) and "Check data"
    (`src/lib/integrity.ts`: missing links, BOM loops, broken orders —
    report only, never auto-fix).
-   Reports uses the same layout (confirmed 21 Oct 2026): Today ("2
    overdue · 1 today", red flag when overdue), Plan of a Job Order, To buy
    — all orders ("N items") as collapsed rows; Job Order performance and
    History as link rows of the same size.
-   Settings layout (confirmed 21 Oct 2026): Mode stays open; every other
    section is one collapsed row (`SettingSection`, native details) with
    a short status (e.g. "All saved", "Last: 3 days ago", "No errors")
    and a red/amber flag when something needs attention (failed or
    conflicting syncs, errors, backup due). Nothing opens by itself.
-   Not available on the free Spark plan: managed backups / point-in-time
    recovery (Blaze). Revisit when real data is in use.
-   Settings → Sample data: DEMO only, records named "(sample)", fixed
    ids `sample_*`; never written to ACTUAL (checked in code).
-   "Waiting for company data" checklist (`src/lib/readiness.ts`, doc
    `settings/readiness`, always in the ACTUAL workspace): what to
    collect after joining and what each item unlocks.
-   Before entering real company data in ACTUAL, the user checks the
    company's policy on personal tools (checklist item 1).

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
