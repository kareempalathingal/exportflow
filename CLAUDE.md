# CLAUDE.md --- ExportFlow Project Rules

## Project goal

Build ExportFlow as a mobile-first PWA and management-intelligence
assistant that coordinates each Work Order (WO) through final delivery,
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
-   Stock for each Work Order is confirmed manually per order line (and
    per raw material for in-house manufacturing). No automatic
    safety-stock calculation. Warn on over-allocation across orders.
-   Internal deadline: 10% buffer, stored per order with its rule
    version; current rule v2 counts WORKING days (see "Working days and
    step times"). Orders saved under v1 (calendar days) keep it until
    "Recalculate deadline".
-   Skeleton-first: every module works with available data; missing
    data shows Pending Verification / Unavailable / Insufficient Data
    and creates verification tasks. DEMO and ACTUAL data stay separate.
-   Hosting: new GitHub repo + GitHub Pages; new, dedicated Firebase
    project on the free Spark plan (Auth + Firestore) for Phases 1–6.
    No Cloud Functions or Storage until a Blaze-plan decision is made.
-   The user works from a phone only; give setup steps that can be done
    on a phone.

## Company terms (confirmed 15 Nov 2026)

-   The app uses the company's own names wherever the user sees them
    (screens, PDFs, Excel, share texts, import). Taken from the
    company's WO file; display text only. Data names stay as they are
    (`jobOrders` collection, `JobOrder` type, `joNumber`, routes, enum
    ids such as `BUY`, `deliveryDate`), so no data migration.
-   Job Order → **Work Order**, JO → **WO**, JO number → **WO No.**
-   JO received on → **WO date** (the order clock starts on it).
-   Customer delivery date → **Cargo ready date**; "Delivery date
    means" → "Cargo ready date means". New WOs (also from import)
    default to "Factory dispatch (ex-factory)"; saved orders keep their
    choice. Road-map stop "Customer delivery" → "Cargo ready";
    "On-time delivery" KPI → "On time for cargo ready".
-   Customer PO number / import "Buyer PO" → **Customer PO No.**
-   Buy / bought items / traded → **Outright purchase**; Make or buy →
    Make or outright purchase.
-   PO of a supplier (materials, outright purchases) → **Supplier PO**;
    PO of a job-work vendor → **Vendor PO** (so the two are never
    mixed up). Messages to suppliers / vendors keep plain "PO".
-   Outside work: sent out → **Dispatched**, received back →
    **Landed**; outright purchases and materials: Received → **Landed**.
    The second purchase step is now "Landing" (`PURCHASE_STEPS`); old
    orders keep "Received", and `isLandingStep()` accepts both.
-   Kept: Order period (time AVAILABLE, WO date → cargo ready, working
    days). The company's "Lead time" (WO 95: 28 days = WO date →
    planned packing end in calendar days, i.e. the time the plan NEEDS)
    is a different figure: add "Lead time (planned)" later with the
    company WO planning sheet round, after asking how the company counts
    it. Also kept: Internal deadline, Draft / Confirmed / Completed, To
    buy, To produce, Stock allocation, Product.
-   "Job Order" is reserved for the company's Job Order form (a check
    form inside a WO: stock, QC, cost confirmed, packaging requirements;
    to build after seeing a filled one). `tests/unit/terminology.test.ts`
    fails if an old term appears in non-comment source.
-   Later (not now): PI No., PI confirmed date, Customer Code, Revision.

## Data rule (confirmed 13 Nov 2026; replaces "no prices in the app" and "accounting, payroll and HR records never in this app")

-   Amounts and figures may be read and taken into the app ONLY for
    cross-checks (e.g. quotation vs PO vs goods received vs bill). They
    are not kept long-term.
-   A mismatch is recorded with its full details: document, item, field
    and the figure on each side. When everything matches, only the
    result (matched, document numbers, dates) is kept.
-   HR: process steps only (payroll ready, statutory payments done,
    joining / exit formalities, due dates). Personal employee data
    (individual salary, ID numbers, bank details, health) stays in the
    company's systems.
-   Original documents stay where they are (mail, company systems).
-   Still: never import prices or rates from company files into masters,
    and never put company data into this public repo.

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
    missing or unconfirmed. BOTH is assumed "made" until a Work Order decides. BOM versions = record `rev`; Work
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
-   BOM tab (confirmed 15 Nov 2026): a compact read-only table first
    (component, qty + unit, wastage, status; all rows; count, "not
    confirmed yet" and notes below) with "Edit BOM" ("+ Add components"
    when empty); the full editor opens only then, with Cancel (asks when
    there are changes) and Save, both back to the table. The requirement
    calculator stays under it.
-   Masters are never deleted; they are set Inactive. Product code is
    optional and not auto-generated until the company scheme is known.
-   Company-dependent parts (packing, container estimates, approvals,
    real workflows, capacity) wait until the user has joined and seen
    real processes; departments, suppliers and process steps exist as
    skeletons filled with the user's own data.

## Phase 3 decisions (confirmed 19 Oct 2026)

-   Phase 3 is split: 3a Work Order core (header, lines, Make/Buy per
    line, 10% deadline, status, BOM snapshot at confirmation); 3b
    per-WO manual stock confirmation + explosion into To produce / To
    buy with over-allocation warnings; 3c print/share as PDF via the
    Android share sheet (WO summary, To buy, To produce).
-   WO status: Draft → Confirmed → Completed, or Cancelled. Completed
    can be reopened to Confirmed, Cancelled to Draft. Cancelling and
    reopening require a reason (rules check the paired audit event);
    editing a confirmed WO does not (history records old/new values).
    Whether stock-quantity changes need a reason (Req. §31.3 says yes)
    is decided in the 3b design. A later BOM change never alters a
    confirmed WO; it shows a notice and "Use latest BOMs" (with reason).
-   Order Period starts on the WO date. "Cargo ready date means": Not
    confirmed yet / Factory dispatch (ex-factory, default for new WOs) /
    Port / Arrival at customer.
-   WO import: see "WO import" below (Excel / CSV and photo built 5 Nov
    2026; text PDF and "Share → ExportFlow" not yet). No AI extraction;
    imported data is always a draft the user confirms; original files
    stay on the phone.
-   Daily task/blocker list waits for department benchmarks; it must
    also be printable/shareable.
-   3c documents (`src/lib/docs/`): A4 PDF built on the phone, English,
    simple header (company name from Settings, title, WO no., date; logo
    and address later), PROVISIONAL band with reasons when data is
    incomplete, no signature block. Share sheet or download; the app
    never sends anything itself. Later templates on the same engine:
    per-department daily to-do/targets, all-department review summary
    (evening/next morning), supplier RFQ letters and purchase orders —
    always drafts the user sends; no invented prices or supplier data.
-   Document look (confirmed 16 Nov 2026, `src/lib/docs/pdf.ts`): the app's
    name never appears in what is submitted or shared (PDF header shows the
    company name from Settings or nothing; footer "Generated <time>"; Excel
    creator = company; Today share text starts with the company; department
    email preview subject = company). WO documents show "WO No. <no.>"
    (`woRef()`, `referenceStrong`) at the right in 13 pt bold (title 16 pt;
    a long title shrinks, never the WO No.). Sub-headings are a light
    band with navy text (no side bar); each stays on the page of the first block that
    follows it (tables: title + column heads + first row, measured on a
    scratch page); table rows never split across pages; a table that runs
    on repeats its title "(continued)" and its column heads.
-   Products numbered (confirmed 16 Nov 2026): the ordered products (WO
    lines) carry their place on the order (1, 2, 3 …) wherever they are
    listed: Products table, step cards, timeline, working-plan step tables,
    WO summary, the WO page list and the Products tab cards. Raw materials
    and made sub-products (base mat) get no number; "For" columns keep the
    names.
-   Working plan timeline (redrawn 16 Nov 2026): legend (done, running,
    planned, approx. = dashed, over plan / late, "All steps of a product",
    today / internal deadline / cargo ready lines); month band and a label
    and line at every Monday (every day when the range is short); Sundays
    and company holidays shaded (`DocTimeline.offDays`); each product as a
    full-width numbered name row, an "All steps" summary bar, then its
    steps, every bar with its dates (+ "approx.", "N days over"); a product
    is kept on one page when it fits; legend and axis repeat on each page.
    Hour lines were discussed and left out (unreadable on a whole-order
    chart).
-   Performance reports (confirmed 20 Oct 2026), PDF, any date range:
    WO-wise (on time vs internal deadline / delivery, buffer used,
    schedule gap over time, changes after confirmation) and, once stages
    and departments exist, department-wise (output vs target, on-time
    stage %, delays, QC rework if recorded). Plan against company or
    user benchmarks first; when enough real orders are completed,
    compare actual averages with benchmarks and SUGGEST a revision when
    the difference is significant — the user approves; benchmarks are
    versioned like the deadline rule and never changed silently or
    invented. Data captured now: `completedOn` and `progressLog` per WO
    (every update with its time; Phase 4 stage records replace the slider).
-   3b stock: per-WO earmarks for finished products, made sub-products
    (deducted before exploding their components) and raw materials;
    qty + unit required, location/remarks optional, who/when automatic;
    reason optional, but each entry shows when it last changed and the
    previous value (overrides Req. §31.3 "reason required"). A manual
    stock count per item (with date) feeds the over-allocation check:
    warning only for Confirmed WOs, Draft earmarks shown as info; no
    count = "manual only". Plus an all-orders To buy list.
-   Home becomes a dashboard after 3b, layout "Option B · Track"
    (mockup artifact "ExportFlow Home Dashboard"): status counts,
    3-week deadline strip, planned-vs-actual bar per WO, materials from
    stock %, To buy, needs attention. Colour follows schedule gap
    (actual − planned), a smooth gradient green → amber → red (full red
    at about 20% behind, configurable; or past the internal deadline),
    always with the number shown. Until stage tracking (Phase 4) the
    actual % is a manual per-WO slider (dated); planned % rises
    linearly from confirmation to the internal deadline; no update =
    "Not tracked".

## WO import (confirmed 5 Nov 2026, mockup canvas "JO import · Excel and photo")

-   Orders → "Import" (`/orders/import`, `src/features/orders/ImportPage.tsx`;
    logic `src/lib/joImport.ts`, file reading `src/lib/importRead.ts`). The
    format of the boss's WO sheets is not known, so ANY layout: A · choose an
    Excel (.xlsx) / CSV file (first choice) or a photo (extra, "check every
    row"); B · which column is what; C · check before the draft is made.
-   B: sheet (the one with item rows is guessed), heading row (the row naming
    most fields), item columns guessed from the headings (name, code, size,
    quantity, unit, pack quantity; "QTY (NOS)" gives the unit), order details
    found next to their labels with the cell shown (WO no., customer,
    buyer PO, issued / received, delivery / cargo ready; "Work Order Date"
    next to "Work Order No" is the WO date, fixed 15 Nov 2026). Price / rate /
    amount columns are never mapped or read. First rows as read. "Remember
    this layout" (name; phone only, `exportflow:importLayouts`, max 20): a
    file whose sheet and headings match is set up the same way next time.
-   C: order fields editable (dates read day first: 08/09/2026, 10-Oct-26,
    26 Sept 2026; customer matched by name or chosen). Each row: matched by
    remembered text, item code / ERP code, or exact name; else "not found"
    with the closest products first, or "+ New product with this name"
    (product form prefilled, back to the import with the new product). "Remember:
    this text means that product" (phone only, per workspace, max 500).
    Quantity editable (photo: letters inside a number such as "5l6" are
    turned into digits and marked "check qty"; never silently), unit per
    row, base-unit equivalent, Make / Buy from the product. Totals within one
    unit, to compare with the sheet. "Create draft WO" only when every row
    has a product, quantity and unit.
-   Nothing is saved by the import itself: it fills the normal New Work Order
    form (`?from=import`, banner "Filled from the import… check… then Save"),
    which saves a Draft as usual (duplicate-number check, deadline, history).
    Pack quantities have no field yet: they go into the order notes with the
    file name. The file / photo stays on the phone.
-   Engines load on first use: exceljs (same chunk as the Excel export);
    Tesseract.js 7.0.0 (English) for photos, its worker and language data
    (~10 MB) downloaded once from the jsdelivr CDN and kept by the browser;
    OCR runs on the phone. Old .xls files: "save as .xlsx or CSV".
-   Not yet: text PDFs (pdf.js text), "Share → ExportFlow" (share target),
    a WO line field for pack quantity (with packing, after joining).

## Round 1 from the WO 12/2026 files (confirmed 17 Nov 2026)

-   Source: the company files of WO 12/2026, sampling WOs 240 and 266/2025
    and the customer costing / product spec sheet (kept in the private project, never in
    this repo); analysis in the project's open-points notes. Rounds: 1 =
    the items below; 2 = product design fields (colours, stencil plates,
    shape), order requirements (stencil plates, plotter prints, tags,
    labels, shipping marks with supplier, PO and dates, needed before a
    step) and a customer requirements checklist; 3 = actual material
    consumption vs BOM (cross-check).
-   Order references (`JobOrder.refs`, `ORDER_REF_FIELDS`, all optional):
    Customer Code, Customer PO date, PI No., PI date, PI confirmed on,
    Revision; a collapsed "Order references" row on the WO form; shown in
    every WO document's details. WO line: customer article no. and barcode
    (`JoLine.articleNo` / `barcode`, per order, not on the product: the
    same design can go to another customer under another number); a WO
    summary column only when a line has them.
-   Import: the company WO form keeps the header in one cell of
    "Label : value" lines; these cells are read first (`linesValues()`),
    "1234 dated 17-04-2026" also gives the PO / PI date, empty or "Nil"
    values are skipped, a "... form" title is never a label. New order
    fields above and item columns "Customer article no." / "Barcode" (before
    the item code, so ITEM REF NO. stays the code). No customer name on the
    form: an earlier WO with the same Customer Code gives the customer
    (`customerByCode()`). Review labels "WO date" / "Cargo ready date".
-   In-house or outside per order (Edit steps on the Products tab): a to-do
    in-house step can be switched to "Outside (job work)" for this order
    only (`toOutside()`: "Dispatch for X" + "X (outside)" + "Landing from X",
    pass-through); back to in-house only while nothing was dispatched or
    landed and none of the three is done (`toInHouse()`; vendor details are
    dropped). Product routes do not change. Outside steps are not moved
    with ↑ / ↓ (switch back first).
-   Indent on an in-house step (`JoStep.indentNo`, `indentOn`, `requiredBy`;
    "+ Indent" on the step, `IndentEditor`, `setIndent()`): shown in the step
    details; "Required by passed · N working days" on the step and a Today
    item (Overdue after the date, Today / Soon before it) in the process's
    department. A target only: the plan still uses the benchmarks.
-   "Waits for all items of this order" (`JoStep.waitsForOrder`, per order
    in Edit steps, shown when the WO has 2+ products; e.g. packing mixed
    designs on one pallet): in the plan the step starts only after every
    other item has finished its steps before its own step of the same
    process (all its steps when it has none); if one of them cannot be
    dated, this step stays "to be confirmed". Tick it on the same step of
    every product that goes together. Pill "waits for all items".
-   No Firestore rules change (no key lists on Work Orders).

## Round 2 from the WO 12/2026 files (built 17-18 Nov 2026, no mockup on request)

-   Product design fields (optional, collapsed "Design" on the product form):
    `colours`, `stencilPlates` (whole numbers 0-50), `shape` (`SHAPES`:
    Rectangular / Shaped / Half round). Never filled by guess.
-   WO "Checklist" tab (`?tab=checklist`, `ChecklistTab.tsx`, logic
    `src/lib/orderExtras.ts`), saved with `saveJoFields()` (one history
    entry each):
    -   Items to arrange (`JobOrder.orderItems`): things outside any BOM
        (stencil plates, plotter prints, tags, labels, shipping marks): item,
        qty + unit, supplier, Supplier PO, ordered on, supplier's date (old
        date kept in `expectedHistory`), landed on, "needed before" a process
        of the order, note. State Landed / Late / Expected / Ordered · no date
        / To order. "+ N from product designs" (`suggestedItems()`: stencil
        plates per design, a cutting plate per shaped / half-round design,
        needed before the printing process) is a suggestion the user adds and
        checks. "Needed before" feeds Ready to start? (`startChecks()`).
        Today: expected date passed = Overdue, coming = "confirm"
        (Purchase and suppliers group).
    -   Customer requirements (`JobOrder.checklist`): text, due = fixed date
        or N working days before cargo ready (`checkDue()`), done on, note;
        "Copy N from the last WO of this customer" (`lastChecklist()`: text
        and the days-before rule only). Today: overdue / due soon (Whole order
        group). The app never marks anything approved.
-   Fix: `jobOrderData()` (now in `jobOrders.ts`) keeps every data field
    (only record meta dropped); before, step saves dropped `refs`.
-   In documents and Awaited (18 Nov 2026, `src/lib/docs/extrasDoc.ts`):
    the WO summary and both plan PDFs / Excel get "Items to arrange for
    this order" and "Customer requirements" tables (only when there are
    entries; before the open points). Orders → Awaited has kind "Order
    items" (`ITEM`): an item counts once it is ordered (supplier, PO, order
    or expected date) and until it lands; Today takes order items from the
    awaited list (no second entry) with "Landed" / "New date" actions.
-   No Firestore rules change.

## Round 3: material use vs BOM (confirmed 18 Nov 2026, no mockup on request)

-   Material use is quantity, not money: every entry is kept (the data rule's
    "not kept long-term" covers amounts / prices). The ERP production data is
    actual issue from stores (user, 18 Nov 2026).
-   `JobOrder.materialUse` (`UseEntry`: production date, item made = an
    ordered product or a made sub-product such as the base mat, qty + unit,
    material lines in any convertible unit, note, source "Imported: <file>"
    or by hand; logic `src/lib/materialUse.ts`). Confirmed and completed WOs.
-   WO Materials tab card "Material use vs BOM" (`MaterialUseCard.tsx`):
    per material BOM need (the WO's BOMs: the copy saved at confirmation,
    incl. wastage; `compareEntry()` via `explodeBom()`), used, difference %;
    totals count only entries where both figures exist ("not entered in N
    entries", "not in the BOM" shown apart). Entries list (remove with a
    history entry), "+ Add entry" (materials of the item's BOM prefilled),
    link to the import.
-   Orders → Import → "Import material use" (`/orders/use-import`,
    `UseImportPage.tsx`, `parseUseGrid()`): blocks with "WO" / "Production
    Date" / "Size- Cm W L" / "Quantity -Pcs" / "Sq Mtr" / "Material …
    Consumption-Kg"; several WOs per file, each block to its confirmed WO
    (`woKey()`: spaces ignored); item made per WO (default the made item in
    sq m), quantity in sq m when the item converts, else pieces; material
    names matched by remembered text (phone only, `exportflow:useAliases:<ws>`),
    ERP code or same name, else chosen or skipped; an entry with the same
    date, item and quantity is not added again; nothing saved before "Save";
    one history entry per WO. Prices are never read.
-   Colours: Settings → profile "Material use vs BOM: amber from / red from
    (±%)" (`useWarnPct`, `useBadPct`), the user's own values; empty = no
    colour (`materialTone()`).
-   Reports → "Material use vs BOM" (`MaterialUseSection.tsx`, PDF / Excel
    `src/lib/docs/useDoc.ts`, `materialUseReport()`): per BOM line of the
    item that lists the material directly (`directParents()`, e.g. kg coir
    yarn per sq m of base mat): entries, WOs, current BOM per unit (live
    Masters, incl. wastage), median actual per unit, difference; a suggested
    BOM line (median ÷ (1 + wastage)) only with >= 5 entries and >= 15%
    (same rule as step benchmarks). The app never changes a BOM.
-   No Firestore rules change.

## Order items at a glance (confirmed 26 Oct 2026)

-   WO page, under the deadline / delivery / buffer boxes: numbered list
    of products (`ItemsCard`, `src/lib/orderSummary.ts`): name, ordered
    quantity as on the order (+ base-unit equivalent when the unit
    differs), Make/Buy, "now <step>", and that product's own progress bar
    and %; no item count heading and no overall total (overall progress is
    already shown below). First 5, then "+N more". Tap → Products tab
    scrolled to that product (`?line=`).
-   Orders list: "N items · 3,500 pcs + 500 sq m" (totals only within one
    unit, never across units).

## Phase 4 skeleton: process steps (confirmed 20 Oct 2026)

-   Processes master (`processes`, label "Processes"): treatments and
    other steps shared by many products (weaving, bleaching, packing…);
    name + notes only. Departments and standard times come later.
-   Each product has an ordered process route on its form (`route`:
    process + output per working day (with unit) and/or fixed days, one
    data status; both empty = "time pending") and "Order of steps
    confirmed with the company" (`routeConfirmed`). Processes can be created from the route editor.
    Bought (TRADED) products have routes too (labelling, packing…).
-   At confirmation each WO line gets a copy of its steps
    (`lines[].steps`, `src/lib/route.ts` `buildLineSteps`): BUY lines
    start with built-in "Ordered → Landing" (older orders: "Received"); MAKE lines put made
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
-   WO page opens on a "Products" tab (mockup "JO detail · progress per
    product"); Home shows "Now: product · step" and step overruns in
    Needs attention.
-   Expected dates per step (confirmed 28 Oct 2026, `stepDates()` in
    `src/lib/route.ts`, same dates as the plan PDF): running step "Expected
    done <date>"; to-do steps "Expected <start> → <finish>" ("approx." for
    estimates); a step past its plan shows "Over plan by N days · expected
    done not known" and later dates are "at the earliest"; from the first
    step without a time onwards "Date to be confirmed". Below the steps a
    "Ready <date>" row vs the internal deadline (tight = 2 working days or
    less, late, or "to be confirmed" with the step missing a time). Each
    order is planned as if alone (no shared capacity yet).

## Item priority (confirmed 15 Nov 2026)

-   Within one WO (`scheduleOrder()` in `src/lib/schedule.ts`, rule
    `PRIORITY`): the step that can REALLY start earliest is placed next
    (its start on a free unit, `earliestSlot()`), so a unit never waits
    idle for a more urgent item. Items waiting for the same unit at the
    same moment go: Rush first → more work AFTER the shared step → listed
    order (changed the same day from "all work left", which counted the
    contested step itself and could pick the wrong item). Work after =
    planned work days of the item's later steps (`workLeft()`; a promised
    date counts until that date; steps without a time count 0 and are
    flagged "part unknown"). The earlier rule (step ready first, ties in
    listed order) stays as `LISTED`. Valid also when shared capacity
    across WOs comes. No simple rule is always best: hence the comparison.
-   Rule per WO (like the deadline rule version): `JobOrder.itemOrderRule`
    is saved as PRIORITY when a WO is confirmed; drafts always use
    PRIORITY; a confirmed WO without it (confirmed before 15 Nov 2026)
    keeps LISTED, so shared plans do not change silently. Products tab
    "Use item priority" (confirm dialog with the change in days, history
    entry "Item order: switched to item priority") switches it; the
    internal deadline never changes. Sample data confirms with PRIORITY.
    `itemOrderRuleOf()`; the other rule is always computed as the
    comparison.
-   Rush: optional `JoLine.rush` (true or absent). Set on the WO form
    ("Rush: plan this item first", shown when the WO has 2+ lines) and on
    the Products tab (button on each product card, confirmed WOs); each change is a
    history entry ("Rush on / off: <product>"). No rules change.
-   `orderPlan()` returns `itemOrder` (`ItemOrder`): rule, items in the
    rule's order with the current step and days after it, WO ready (last
    item) with the rule in use, with the priority and in listed order, and
    `gainDays` (priority vs listed, working days; positive = earlier).
    Rush buttons show only on WOs using PRIORITY (LISTED ignores Rush).
-   Shown: Products tab "Item order" card (rule, WO ready vs listed order
    with "N working days earlier / later"; since 16 Nov 2026 no item list:
    each product card shows "Nth at shared processes · N days of work
    after <step>" and its Rush button under the track label);
    Reports → "Item priority: effect" (`src/lib/itemOrder.ts`): every open
    WO (drafts planned from the product routes, marked) with 2+ items,
    listed vs priority ready date and the difference (−N earlier, +N
    later, amber flag when any is later), text share, PDF / Excel. Plan
    PDFs: "Item order" key fact; "to submit" = the rule only, working plan
    adds the listed-order comparison and days left per item.
-   Not verified yet against the real WO 95 test order (its data stays
    outside the repo): check Reports → Item priority after the update.

## Submitted plan (baseline, confirmed 15 Nov 2026)

-   `src/lib/baseline.ts`, `JobOrder.baselines` (oldest first, max 20; no
    rules change). Saved only by "Save as submitted plan (vN)" next to the
    plan PDFs on a CONFIRMED WO (`SavePlanForm`), never on share: every
    step's start / finish (`lineId` + step key) from the plan as it stands,
    WO ready (last item), internal deadline, WO rev, saved date / time;
    "Why a new version" required from v2; optional "Approved by / on"
    (written by the user, no future date; the app never approves). History
    entry "Submitted plan vN saved: <reason>".
-   Compared with the LATEST version (`compareToPlan()`): WO page card
    (`BaselineCard`: plan vs now ready with "+N working days", steps
    behind plan, steps not in the plan, approval, "first submitted" (v1)
    and a collapsed versions list); every step on the Products tab "Plan
    <date> (+N)" (amber when later) or "Not in the submitted plan";
    Orders at risk "Watch" when the expected finish is more than
    `BASELINE_WATCH_DAYS` (2) working days after the plan's ready date;
    both plan PDFs a table "Changes since the submitted plan (vN, date)"
    (WO ready + every step whose finish moved).
-   Later: KPI "on time vs the submitted plan", count of plan revisions.

## Speed, reads and file layout (confirmed 15 Nov 2026)

-   Plan cache: `orderPlan()` (`src/lib/route.ts`) keeps the last plans
    per WO record (same record object, same master data object, same
    day, planning benchmark, calendar and parallel units → the same
    result; max 8 per record). `orderPlanUncached()` is the plain
    calculation (tests compare both).
-   One Firestore listener per collection (`useCollection`, shared store
    with `useSyncExternalStore`): every screen using the same list shares
    it; a failed listener is retried after 30 s; listeners of the other
    workspace are closed when nobody uses them.
-   Settings → System health "Reads today (approx.)" of the 50 000
    free reads (`src/lib/readsToday.ts`, per IST day, on the phone):
    a list's first server snapshot after more than 30 min counts every
    document, later ones only the changes; cache reads are free. Backup,
    restore and history reads are not counted (said under the row).
-   Delta sync (confirmed 15 Nov 2026, replaces the planned "Show older";
    rules in `src/lib/deltaSync.ts`, used by `useCollection`): the first
    open of a list each IST day reads it whole from the server; later
    opens start from the phone's saved copy and listen only to records
    with `updatedAt` since the newest one seen, minus a 10-minute overlap.
    Safety nets (the user asked that no record may ever go missing on the
    phone): every start compares the record count with the server
    (`getCountFromServer`, about 1 read per 1 000 records) and reads the
    list whole on any difference, a failed saved-copy read or a refused
    query (logged in System health errors); records saved on this phone
    are watched one by one until the server has them (`setLocalWriteHook`
    in `records.ts`), so they show at once, also offline; the Firestore
    cache is unlimited (never trimmed); Clear DEMO and System health "Read
    everything again" read every list whole; backups always read from the
    server (`getDocsFromServer`, needs internet). Writes are unchanged:
    the server stays the single truth. No rules or index change.
-   File split (no behaviour change): scheduling within one WO in
    `src/lib/schedule.ts` (route.ts re-exports `itemOrderRuleOf`,
    `ItemOrderRule`); plan documents in `src/lib/docs/planDoc.ts`
    (model.ts re-exports them); Products tab parts in
    `ProductsCards.tsx` (item order, plan by process) and
    `StepParts.tsx` (step rows, dates, forms).

## Compact step rows and uniform texts (confirmed 15 Nov 2026)

-   Products tab step rows (`StepRow` in `StepParts.tsx`, mockup shown in
    chat): always shown = name (now / next, estimate, outside, and an
    amber "plan <date> (+N)" pill only when later than the submitted
    plan), one date line, "Waiting: …" and "late · ask for a new date"
    warnings, and the running step's main button ("X done → Y"). Tap the
    row for the rest (days over / on time, started / waited / worked,
    output, supplier / PO, submitted plan date, basis, notes, contacts,
    other buttons); the details stay in the page, hidden. A delayed
    running step keeps its contact buttons in view. The legend is a
    collapsed "How to read this".
-   One text-share helper (`src/lib/share.ts`: `shareText()`,
    `shareMessage()`: "Passed to the share menu." / "Copied. Paste it
    into WhatsApp, email or a note."). Empty states are sentences with a
    full stop ("No … yet." for lists, "No … in this period." for
    reports); short status labels have none. Pill colours: ok = done /
    on time / matched, warn = needs a look, bad = late / missing / error,
    neutral (or none) = information. Native confirm popups stay, worded
    as one question naming the thing.

## Departments and contacts (skeleton, confirmed 21 Oct 2026)

-   Departments master (`departments`, label "Departments"): name, notes,
    people (`Person`: name, designation, phone, WhatsApp if different,
    company email, one main contact; at most 20) and the processes the
    department handles (`processIds`, stored on the department; a
    process in two departments is warned, not blocked). Work contacts
    only. Real names and numbers are added after joining.
-   Contact buttons only — no follow-up log (updates are entered in the
    app as usual): on a Work Order's Products tab for the step running now
    and the next one, and on Today items about steps. Call (`tel:`),
    WhatsApp (`wa.me` with a ready message) and Email (`mailto:` with
    subject and message); the message is a draft the user edits and
    sends — the app never sends anything. Main contact first, others
    under "more people". 10-digit Indian numbers get 91; incomplete
    numbers are refused (`src/lib/contacts.ts`).
-   Products tab contacts (confirmed 5 Nov 2026): every running step (also
    "Now: A + B") and the next step to do always show their department;
    dispatch / landing use the outside process's department. No people →
    "no people added · add a person" (link to the department); no
    department → "No department handles this step yet · link it in
    Departments". The delay goes into the message (`stepDelay()`: "N
    working days over the planned time" / "past the promised date").
-   Sample departments use example.com emails and no phone numbers, so no
    real person can be called from DEMO.

## Working days and step times (confirmed 20 Oct 2026)

-   Step time depends on quantity: planned days = quantity ÷ output per
    working day + fixed days (quantity-independent: drying, curing,
    batches), rounded UP to half a day for display; schedules use the
    unrounded time (`workDays`, changed 5 Nov 2026: rounding every item
    added up across an order). Hour-level planning later.
    Benchmarks are copied to WO steps at confirmation (confirmed, known or
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
-   Within one order (confirmed 5 Nov 2026, `orderPlan()` /
    `scheduleOrder()` in `src/lib/schedule.ts`): the items of the order share
    each process. A process has "Parallel units" (`parallelUnits`, default
    1; output per day in routes is per unit). Who goes first: see "Item
    priority" above; a free gap is used. Finished steps keep their real
    dates and free the unit then; a started step holds its unit. A running
    step still waiting for a unit is "next" (`queued`, "Waiting: X is busy
    with other items of this order"), never counted as over plan. Planned %
    uses the planned span of the whole order. "Plan by process"
    (`processPlanRows()`): process, items, quantity per unit (never added
    across units), output / day, units, work days, start → finish,
    department — a collapsed card on the Products tab and a table in both
    plan PDFs (the working plan adds rate, units and days). Items without
    dates yet are counted ("+ N items not dated yet", finish at the
    earliest).
-   Checked against WO 95 (5 Nov 2026): with the recorded tufting the app
    gives printing 17 → 26 Sep (company plan 17 → 26 Sep), shearing,
    trimming, embossing and shape cutting within 1–2 days of the company
    dates. Remaining gaps need data after joining: the production start
    date (materials), dispatch / landing for outside work, and the bought
    item's lead time (packing dates).
-   Overlap within one item (confirmed 5 Nov 2026, `overlapReady()`), like
    the company WO plan: a step may start once the previous step has made
    one day's worth of this step's output, runs without stopping and ends
    no earlier than one day of its work after the previous step's finish.
    No overlap for fixed-days-only or purchase steps, or when the route
    step has "Waits for the whole quantity of the previous step"
    (`waitAll`, copied to WO steps; outside work, drying, batches). A step
    not started yet never starts before today. Steps can also be tracked
    at the same time (see "Flow tracking" below).
-   Flow tracking (confirmed 5 Nov 2026, mockup canvas "JO Products tab ·
    flow tracking"):
    -   Outside work: a route step ticked "Done outside (job work)"
        (`outside`, optional `landingPerDay` + unit) becomes three order
        steps: "Dispatch for X" (`passThrough`: no time of its own, assumed
        together with the step before), "X (outside)" and "Landing from X"
        (its rate; without one also pass-through). Dispatch / landing have
        `processId` null and `outsideOf` = the process (KPIs and department
        lists use that process; Look ahead leaves them out); never counted
        as over plan.
    -   Materials ready (`MATERIALS_KEY`, built-in like Planning, made lines
        only): orders confirmed from now on carry `materialDates` (per to-buy
        item key: orderedOn / expectedOn / receivedOn, Materials tab, saved
        at once with a history entry); older orders get "Track material
        arrivals". Nothing to buy = done at confirmation; all received =
        done on the last date; else ready by the latest expected date; any
        material without expected / received date = production dates "to
        be confirmed" (lead times never guessed). Every material is needed
        at the product's first step for now ("needed at step" later). A
        started or finished production step means the materials were there
        ("Production has started"). Never counted as over plan.
    -   Steps at the same time: a step can be started once the step before
        it has started (one that waits for the whole quantity: once it is
        done); "done" stays in order; every started step shows as running
        (header "Now: A + B"); Undo start only for the last started step.
    -   Day's output (`JoStep.outputLog`: date (back-dating allowed, never
        future), qty, unit, optional note; stored in the step's unit when it
        converts): progress "X of Y (Z%)", day's / average output vs the
        benchmark, counts into the line's % done; expected done = the rest at
        the benchmark rate from today (from tomorrow when today's output is
        in), never the actual rate. Whole quantity made: the app asks "mark
        done?", never marks it by itself. Entries can be removed (history).
-   Follow-up and readiness (confirmed 5 Nov 2026, mockup canvas
    "Follow-up & readiness"; `src/lib/followUp.ts`):
    -   Bought items: the "Ordered" step holds supplier (Suppliers master),
        PO number (optional), ordered on and the supplier's date
        (`supplierId`, `poNo`, `orderedOn`, `expectedOn`); outside work: the
        same on the outside step (vendor = supplier tagged `jobWork`, offered
        first). Materials to buy: supplier and PO in `materialDates` too.
        No prices. A changed expected date keeps the old one in
        `expectedHistory` (reason optional; `firstPromise()` = the original).
    -   The promised date drives the plan (`withPromises()`): "Received" /
        the outside step lasts until it (`readyBy`); past it and not done =
        "N working days late · ask for a new date" (`lateDays`), never an
        overrun.
    -   Part deliveries: "+ Dispatched" / "+ Received back" / "+ Received"
        use the step's `outputLog`; "still with <vendor>" = dispatched -
        back; the whole quantity in → the app asks "mark done?".
    -   Orders → "Awaited" tab (`awaitedItems()`, `AwaitedList.tsx`): job
        work out, bought items, materials (orders tracking arrivals); Late /
        next N working days / later / date to be confirmed; filters; contact
        buttons with a draft (`supplierMessage()`), "+ Task" (prefilled
        `/work/new?title=&person=&due=&jo=&joNo=`), share text, PDF by
        supplier (`awaitedDoc()`); Reports links to it. Late → Today
        Overdue; due within N days → Today "confirm".
    -   Ready to start? (`startChecks()`, Home card `StartingSoon.tsx`):
        every process step planned to start within N working days (Settings
        → profile `alertDays`, default 2, one value for all) or due and not
        started. The app checks materials, the step before, and supplier /
        vendor + date of bought items and outside work; plus the process's
        own checklist (Processes → "Ready to start?", `readiness`, written
        by the user, never invented), ticked per order step with the date
        (`JoStep.readiness`, history entry). Not ready → Today (Overdue on
        the start day). Contact buttons of the department, "+ Follow-up task".
    -   Not yet: supplier / vendor delay KPIs against the first promise.
-   Lead-time benchmarks (confirmed 15 Nov 2026; the user's own values,
    Settings → profile, like the planning benchmark; empty = not set):
    "Raw materials landed" `materialsDays` (default 5 working days after
    confirmation) and "Outright purchase landed" `purchaseDays` (default
    10 working days after ordering, or after confirmation while not
    ordered; for drafts after the expected end of planning). Used ONLY
    where no date was entered (`materialsStep()`, `withPromises()`): the
    step gets `readyBy` from the benchmark, `estimated: true` (shown
    "approx.") and a `leadNote` that both plan PDFs list as an open point
    ("arrival of … to be confirmed with purchase (planned N working days
    after confirmation)" once for the order's raw materials; "supplier
    landing date to be confirmed …" per bought product). An entered
    expected / landed date always wins. A benchmark date that passes is
    never "late" (the plan moves to today). The "Ordered" step is never
    over plan. Defaults come from the one WO seen (WO 95: indent on the
    2nd working day after the WO date, production a week later; handwoven
    PO → landing 10 days); to be checked after joining.
-   Working hours (confirmed 15 Nov 2026, display only): Settings →
    profile "Working hours per day" `workHours` (default 8: duty 8:30 to
    5:30 with the break, every day except Sunday; empty = not shown).
    `hoursText()` = working days × hours, rounded UP to a whole hour,
    shown next to the basis ("1 200 pcs ÷ 300/day · 32 working hours")
    on the Products tab, in Plan by process ("4" + "32 h") and in the
    working plan PDF / Excel; never in the plan to submit. Plans, dates
    and KPIs stay in working days. [to ask] the day length the company's
    output-per-day benchmarks were measured on.
-   "X started" stays in view (15 Nov 2026) on the running step not
    started yet and on the next step to do, next to "X done": recording
    the start splits wait (e.g. moving goods between units) from work in
    the KPIs. A planned move time per route step is NOT built (needs the
    company's figures).
-   Working days: Sunday is the weekly off (editable); company holidays
    are added on the dashboard calendar (large type; tap a day to add or
    remove). Doc `settings/calendar` {weeklyOff, holidays} lives in the
    ACTUAL workspace; Demo uses the same calendar. No public holidays
    are added automatically.
-   Internal deadline rule v2 `buffer-10pct-ceil-min1-workdays/v2`:
    period = working days after the WO date up to the delivery
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
    Reports holds the daily summary (text share + PDF), the WO
    performance report, the all-orders To buy PDF and History; later the
    department to-do lists and review summaries. The To buy working list
    stays in Orders.
-   Home "Today" card (`src/lib/today.ts`): overdue / running late,
    today, and the next 2 working days — internal deadlines, deliveries,
    step overruns, steps due to finish, upcoming company holidays.
    "Share summary" passes plain text to the share sheet (or copies it);
    the app never sends anything. Backup reminders stay in Needs
    attention.
-   Today by department (confirmed 16 Nov 2026, `todayByDepartment()`):
    the Today card (Home and Reports) has "By department" (default) and "By
    time", remembered on the phone (`exportflow:todayView`). A step goes to
    the department that handles its process (dispatch / landing: the
    outside process), a task to its department; bought items and raw
    materials to "Purchase and suppliers"; deadlines, planning, holidays and
    the backup to "Whole order and general"; unlinked processes to "No
    department linked". Departments with overdue items first. Each group:
    counts, the main contact's buttons (the draft holds the list), "Share
    list" (`todayGroupText()`); "Share summary" follows the chosen view. The
    daily summary PDF (Reports) has one table per department too.
    Departments and their duties are not confirmed yet: the grouping uses
    the current Departments master; a "handles purchase" department comes
    later.
-   Today items lead to the fix (confirmed 17 Nov 2026, round 1): each
    item carries `open` (the button: "Open step" = WO Products tab with
    `?line=&step=`, the step opened and outlined; "Landed or new date";
    "Open WO" / "Open WO to confirm"; "Open task"; "Back up now") and
    `followUp` ("+ Follow-up task", prefilled title, due today, WO and the
    group's department via `/work/new?…&dept=`). "Handled" with an
    optional note (`src/lib/handled.ts`, `exportflow:todayHandled:<ws>`,
    phone only, today only: still there tomorrow = open again): the item is
    greyed and struck through, moves last, leaves the counts ("N handled"),
    Undo; share texts say "[Handled 11:40] … - note". Holidays have no
    buttons (information).
-   Today actions round 2 (built 17 Nov 2026, `TodayActions.tsx`, item
    `act`): on confirmed WOs, right in the card: a running step's "X done"
    (only the first open step; "Date of this update", never future, never
    before the step's start) and "+ Day's output" (same OutputForm; whole
    quantity → asks "mark done?"); awaited materials "Landed" (date, not
    future) and "New date" (not past, old date kept in the history);
    bought items / job work "+ Landed" (part landings on the landing step)
    and "New date" (on the Ordered / outside step); tasks "Done" with "How
    did it end?" (same CloseTask). Every write goes through the same code
    as the WO page (`orders/stepSave.ts`, pure parts in
    `src/lib/stepUpdates.ts`): same record, progress and history text.
    Anything else stays behind "Open".
-   Dashboard (confirmed 17 Nov 2026, redone the same day;
    `src/lib/processBoard.ts`, `src/features/dashboard/DashboardPage.tsx`,
    bottom menu Home · Dashboard · Orders · Work · Reports · Settings): one
    card per active process, in working order (`processOrder()`: from the
    step order of the WO lines and product routes; loops and ties by average
    place). A card counts the process's steps on open CONFIRMED WOs (done
    ones included; Completed WOs left out): % done (quantity share in one
    unit; steps with nothing to make (all from stock) left out; a made
    sub-product shared by several products counts once (each line holds
    its share); with several units the item average and a "check the product
    routes" warning; none seen in the data), the WO-card bar with the
    should-be mark (planned share by today from each item's planned start /
    finish) and gap colour, "made / total unit" at the right end of the bar
    and "N unit still to make / land" under it,
    benchmark (rate or range, parallel units), running / next / done,
    items over the planned time, last update (date + time). A card whose
    items are all done stays in its place, green and faded (until its WOs
    are Completed); processes without work on any open confirmed WO are one
    collapsed row "No work now (N)" at the end. Outside work: one card
    (dispatched, landed; landed counts as done).
-   Dashboard top (moved from Home, 17 Nov 2026, `src/features/home/
    OrdersStanding.tsx`): the order status counts and "Planned vs actual"
    (one card per open WO: bar, is / should be, days left) come first, then
    "Processes". The WO cards no longer list what each product is doing
    (the process cards below show it). Home keeps Today,
    Ready to start, Next 3 weeks, tiles, attention, KPIs and the calendar,
    with a link to the Dashboard.
-   "Update now" (per card, several times a day): date (never future) and
    time (HH:MM, `StepOutput.time`, not future; no rules change). In-house:
    the TOTAL made that day so far; the app adds only the difference to
    what is already recorded that day (less = refused). Outside work:
    Dispatched / Landed with the quantity of that lot; landing at most what
    was dispatched. "All remaining: N unit" (one tap, when the department
    says everything is done) fills the figure with what the open items can
    still take (in-house: the day's recorded total + that); items that
    cannot take it yet are counted beside it. The quantity is filled into the items automatically in
    plan order (running first, then the planned start; ties internal
    deadline, WO, product no.), each up to what it can still take; no
    manual re-ordering (priority / Rush is set in the plan); more than the
    items can take is refused. Only items that can take it that day:
    in-house = started, or the step before started / done (whole quantity
    for "waits for"), not before the WO was confirmed; a plan date never
    blocks. In-house items not started get "started" on that date. Whole
    quantity → one question "mark done?" (in-house / dispatch only the
    line's first open step; landing also closes the dispatch / outside step
    of that process; others are listed). One history entry per WO
    ("Printing on <date> <time>: … (from the dashboard)"), same save path
    as the WO page (`saveJoLines`); after Save the form closes and the card
    shows what was saved. Plans, expected dates and KPIs stay in
    working days (hour planning later). Today department groups have
    "Update all" (`/dashboard?dept=`: that department's cards).
-   Previous step covers (confirmed 18 Nov 2026, `prevLimit()` /
    `overPrevQuestion()` in `src/lib/stepUpdates.ts`): a step's output may go
    only as far as the step before has recorded: allowed = this step's
    quantity × (previous made ÷ previous quantity), so units may differ (base
    mat sq m → mat pcs). No limit when there is no previous step, it is done,
    it has nothing to make or no known quantity, and for landings (already
    limited by dispatch); dispatch is limited by the in-house step before it.
    Beyond it the app ASKS ("<prev> has recorded only X of Y … Save anyway?"),
    never blocks (entries may arrive late): Products tab "+ Day's output",
    Today actions and the Dashboard. The Dashboard fills each item first up to
    what is covered (`BoardRow.prevLeft`), then the rest in plan order, shows
    "<prev> covers N so far" and asks once for the items beyond it
    (`overPrevRows()`).
-   WO performance report (`src/lib/performance.ts`, Reports →
    Work Order performance): presets This month / Last month / Last 90
    days / Custom. Completed orders in the range: working days vs
    internal deadline and delivery, buffer used, allowed / planned /
    actual days, slowest step, furthest behind (from progressLog), plan
    changes after confirmation (from history; step progress excluded).
    Open orders listed separately; cancelled counted. Per process:
    planned vs actual for steps finished in the range; a benchmark
    suggestion only with >= 5 steps differing by >= 15% (median rate) —
    never applied automatically. Screen chart: allowed vs actual days per
    WO; the PDF engine draws simple grouped bar charts (`DocChart`).
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
    pending"), always marked: "estimate" tag on the WO step, "· my
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
    orders; never guesses). "By product" has a search box (more than 8
    items) over name, family, category, type, product code and ERP code
    (`itemMatchesSearch()` in `src/lib/itemGroups.ts`; every word must
    match; "40x60" = "40 × 60"); a single hit is chosen at once.
-   Later, when needed: size → area per piece, GSM + size → weight per
    piece, container fill (after packing data).
-   Number display (confirmed 4 Nov 2026, `groupDigits()` in
    `src/lib/units.ts`): Indian grouping (lakh / crore) with a thin
    no-break space instead of a comma, so the decimal point is never
    confused (12 345 · 1 23 456.75); up to 4 digits no space (7859). PDFs
    print a normal space (`pdfSafe`). Number inputs accept commas or
    spaces.
-   Size of one piece (confirmed 4 Nov 2026, `pieceSize()` in
    `src/lib/units.ts`, `SizeCard`): length × width in cm, mm, inch, ft
    and m, exact decimals only (no ½ / ¼ fractions in any unit, corrected
    4 Nov 2026). Area and weight per piece are not repeated there: the
    conversion table below already shows them. On the product's Conversion
    tab, in Calculator → By product and in the product summary line
    ("40 × 60 cm (15.75 × 23.62 in)"). Nothing shown without a full size;
    never read from the name. Sizes are shown and entered WIDTH first
    (W × L), as the company writes them ("40 × 60" = width 40, length 60;
    confirmed 4 Nov 2026 from a company work order).
-   Long lists (confirmed 4 Nov 2026, `src/components/LongList.tsx`): more
    than 5 entries collapse into one row ("54 products", tap to show),
    grouped by family (biggest first, "Other" last), one entry per line.
    Used in Process "Used by", Supplier "Supplies", Department processes,
    the Materials tab "Made from" / "For" and the "BOM changed" notice. In
    the Materials tab and plan PDFs an item needed for every product of an
    order of 4+ products reads "all N ordered products".

## KPIs (confirmed 26 Oct 2026)

-   Steps: optional "<step> started" and "<step> done" on the WO Products
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
    efficiency, department needing most attention), always shown (a note
    when there is no data yet), placed just above the calendar near the
    end of Home (not needed all the time).
-   Planning KPI (confirmed 26 Oct 2026): counted from every order
    CONFIRMED in the period (completed or not): average planning days
    (received → confirmed, working days), % within the planning benchmark
    (Settings → profile), and the orders over it (KPI page section with
    links, text share, PDF table). Target "Planning within benchmark at
    least %" in KPI targets. No benchmark = no % and nothing marked over.
-   Benchmark suggestions (performance report) now use working time when
    the start was recorded. Daily department output vs target needs a
    production record — decide after joining.

## Work: tasks and follow-ups (confirmed 26 Oct 2026)

-   Other departments (design, finance, HR…) may come under the user. Same
    app, separate "Work" section, for the user only (no other users).
    What may be kept follows the "Data rule" above (amounts for
    cross-checks only; HR = process steps only).
-   Bottom menu: Home · Dashboard · Orders · Work · Reports · Settings (Dashboard added 17 Nov 2026); Masters opens
    from Settings (link row; back link on Masters).
-   Tasks (`tasks` collection, `src/lib/tasks.ts`): title, department
    (or General), whom to ask, due date, priority Normal/High, status
    Open / Waiting (waiting on…) / Done / Dropped, optional Work Order,
    notes; never deleted. Repeats: weekly (weekday of the due date),
    monthly (day of the due date; last day in shorter months), every N
    days; Done adds the next one (never a date already past).
-   Work screen layout (confirmed 5 Nov 2026): "+ Add a task" is one
    collapsed row at the top (quick add inside, link to the full form),
    the list right below; each group shows its first 5, then "See more
    (N)"; Done (last 7 days) is faded at the bottom, older done / dropped
    behind a button.
-   Work screen: Quick add, groups Overdue / Today / This week / Waiting /
    Later / No date / Done (last 7 days; older behind a button), filter by
    department, contact buttons (drafts only), follow-up list text + PDF
    (`src/lib/docs/tasksDoc.ts`). Today card / daily summary include tasks
    (overdue, today, next 2 working days). Reports → "Follow-ups (Work)".
-   Rules: `tasks` validated (title, status, priority, dates, repeat; a
    repeat needs a due date). Included in backup / restore, Check data,
    Check rules. DEMO: Design and Finance sample departments and 4 sample
    tasks; "Add new sample records" adds only missing sample records.
    DEMO-105 (confirmed the day the samples are added, 7 products incl. a
    bought one, one without BOM and yarn in kg) shows a larger plan.
-   Time and outcome (confirmed 27 Oct 2026): optional due time
    (`dueTime` HH:MM, IST; needs a date; past time today = Overdue; same-day
    tasks by time; repeats keep it; shown in Today / summary). Done asks
    "How did it end?": Resolved / Not resolved + optional note (never
    required, also for repeating tasks). Not resolved → next step: Escalate
    (any department from a dropdown, then optionally a person of it — not
    only upwards; parallel departments too), Follow up again (same person),
    or Close anyway; escalation / follow-up = a new task ("Escalated: …" is
    High) linked both ways (`fromTaskId` / `nextTaskId`, `nextStep`).
    Dropped keeps its name and asks an optional reason (`outcomeNote`). Done
    list shows ✓ / ✗ and the outcome; follow-up text / PDF add "Open
    escalations and follow-ups" and "Done in the last 7 days - how it
    ended". No phone-calendar button (declined). Rules validate the new
    fields; older tasks without them stay valid.
-   After joining: department KPIs the user defines (monthly figures),
    approvals register, meeting notes (checklist item "other-departments").

## ERP master import aids (confirmed 4 Nov 2026)

-   The ERP (built by the user's friend, not live yet) gave draft master
    data. It is converted OUTSIDE the repo (the repo is public: no company
    data, names or converter in it) into an `exportflow-backup/v1` file with
    `label` (history reason "Imported: <label>", no "another login"
    warning) and mode ACTUAL, restored first into DEMO, later into ACTUAL.
    Stable ids from the ERP code when unique, else from the name.
-   Products and raw materials have optional `category`, `productType`,
    `family` (Masters: grouped by category, filters, "N of M shown"),
    hidden `erpCode` (form: collapsed "ERP reference"; NOT the product code;
    a later "use ERP codes as product codes" action is possible) and
    `importSource`. Forms carry these fields through every save.
-   `baseUnitStatus` ESTIMATED = unit guessed (not in the source): tag "unit
    guessed", filter "Only units guessed", the unit may be changed (rules
    allow it only while the stored status is ESTIMATED) with a list of where
    the item is used (`src/lib/itemUses.ts`); "Confirm unit" (also in bulk
    for the filtered list) fixes it. Absent = fixed as before.
-   "Steps for a family" (`/masters/family-steps`, `src/lib/itemGroups.ts`):
    one route for all active products of a family, preview (changes / same /
    kept, "only products without steps"), each product a normal history
    entry; families without process data stay without steps until set.
-   Clear DEMO (Settings → Sample data, type CLEAR DEMO): deletes every
    record and audit event in the DEMO workspace; rules allow deletes only in
    `<uid>_demo`. ACTUAL is never deleted.
-   Delete Work Orders in DEMO (confirmed 18 Nov 2026,
    `src/features/settings/demoDelete.ts`, no rules change: deletes were
    already allowed only in `<uid>_demo`): Settings → Sample data "Delete all
    Work Orders (keep masters)" (type DELETE WORK ORDERS) and on the WO page
    "Delete this WO (DEMO only)" (one question). The WO and its history
    entries go; masters, stock counts and settings stay; Work tasks linked to
    it stay with `joId` removed (WO number kept as text, normal history
    entry). "Add new sample records" brings the sample WOs back. Never shown
    or allowed in ACTUAL (`isDemoWorkspace()`).
-   Restore may change a GUESSED base unit (stored `baseUnitStatus`
    ESTIMATED), as the form can; a fixed unit is still skipped (4 Nov 2026).
-   A real work order (plan + recipe) from the company was used for a second
    import file (outside the repo): processes as named in the company plan,
    benchmarks per step with status "Known" (to be confirmed after joining),
    departments linked to processes, a semi-finished "base mat per sq m"
    product with the company recipe as its BOM (company figures already
    include wastage, so wastage 0% to match the company totals; fuel such
    as firewood / diesel kept as BOM lines on request) and one BOM line of
    base mat by area for each tufted mat of that GSM only (other GSMs: no
    recipe, BOM missing). Prices / rates in company files are never imported.
-   Import rules agreed: GSM written as 4 / 4.8 / 5 / 5.2 = kg per sq m
    (× 1000); implausible values left empty "to be checked"; tools (moulds,
    plates, guns) skipped; duplicate names kept once; families with the same
    meaning but different names stay separate products; services other than
    packing / tagging wait for dispatch stages.

## Company WO planning sheet (noted 5 Nov 2026; build AFTER joining)

-   The user needs both: the app's plan PDFs AND the company's own "WO
    Planning" sheet format (Production planning: WO no., issued / cargo
    ready date, lead time, total qty; per process qty, output / day, days,
    planned dates, units, responsible department; base mat, outright
    purchase, dispatch / landing for outside work, tags / labels / packing
    materials purchase, packing plan). Output as Excel, built on the phone,
    after joining (exact layout from the company then).
-   Fields the app does not record yet (indent / processing intend / PO
    "to be issued by" dates, raw material availability, purchase complete
    by, mould / stencil ready, dispatch and landing schedules, tags / packing
    material order and landing dates, QC accepted) are left blank "to be
    filled" in the sheet for now. Lead days for such dates are never
    guessed; they come from the company.
-   Packing (noted 5 Nov 2026, decide AFTER joining): the app packs each
    item as soon as it is ready; the WO 95 plan packs from 28 Sep (after
    embossing landing and packing-material landing). Whether the company
    packs item by item or the whole order together is not known; the user
    will decide in his position. Options discussed, not built: (A) BOM
    line "needed at step" (tags / cartons gate packing only), (B) route
    step "waits for all items of the order", (C) outside-work PO /
    dispatch start date per order.
-   The company overlaps processes (the next process starts before the
    previous one has finished the whole quantity); the app's within-order
    plan overlaps steps within one item since 5 Nov 2026 (see "Overlap
    within one item").

## Factory documentation (noted 27 Oct 2026; build AFTER joining)

-   The user will be answerable for factory records being complete and on
    time (all activities, e.g. even a parcel received), not only Work
    Orders. Idea discussed, not approved: a document register (document
    types master with trigger, owner, due rule, filing place; records
    raised by app events, schedules or quick entries such as "parcel
    received"; status Pending / Prepared / Checked / Filed / Missing /
    Not needed with reason; alerts, documentation status PDF, KPI).
    Wait for the real document list and practice (checklist item
    "documentation"); never invent the company's document list.
-   ERP data from the company's ERP developer may be imported (company
    permission confirmed by the user, 26 Oct 2026): Excel / CSV files →
    checked and converted to an `exportflow-backup/v1` file → Settings →
    Restore with preview. Imported figures get status USER_PROVIDED
    ("Known"). No ERP logins, payroll / personal records, accounts or
    prices.
-   Scan any document (idea 27 Oct 2026; build AFTER joining, together
    with WO import): nearly all factory documents are printed. Photo /
    PDF / "Share → ExportFlow" → text read on the phone (pdf.js for text
    PDFs, on-device OCR for photos; the user can correct it) → find with
    fixed rules (WO / PO / invoice numbers, dates, quantities, names of
    customers, suppliers, products, departments, people) the related open
    tasks and orders, with the reason shown → link it to a task / WO,
    create a prefilled follow-up the user edits, or file it in the
    document register. Images stay on the phone; only key fields are kept
    (no prices). "Explain an unknown document" needs AI: only after a
    Blaze-plan decision and company permission to send documents to an
    AI service.
-   Free-plan reads (noted 27 Oct 2026; do BEFORE importing ERP data):
    storage and writes are far within the Spark limits, but every list is
    read whole (`useCollection`), and after the cache goes stale (~30 min)
    a re-open re-reads it; ~5,000 docs × ~10 opens a day reaches the
    50,000 reads/day limit, and tasks / completed orders keep growing
    (never deleted). Done 15 Nov 2026: the reads-today counter
    and delta sync (see "Speed, reads and file layout"), so a list is read
    whole once a day and otherwise only by changes. Blaze (with a budget
    alert) only if reads still approach the limit.

## My report and Look ahead (confirmed 27 Oct 2026)

-   Reports → "My report" (`src/lib/myReport.ts`, PDF `myReportDoc` in
    `src/lib/docs/reportsDocs.ts`), weekly or monthly (Last / This week,
    Last / This month, custom), for the user's superior; built now (usable
    in the learning period too). Contents: Highlights (suggested from the
    records, edited by the user in a text box, kept on the phone per
    period), at a glance (orders confirmed + planning days, steps finished
    / on time, orders completed, follow-ups closed / resolved /
    escalated), orders (progress at the start → end of the period via
    `asOf()`, what happened, vs internal deadline), delays found (steps
    over their benchmark and how the order stands now), follow-ups closed
    with how they ended, open escalations, KPIs vs the previous period and
    targets, the coming week / month (from Look ahead), signatures. No
    audit history loaded (plan-change counts not shown). After the
    learning period it is the weekly report to management: outcomes over
    activity counts, nothing inflated or invented, every figure checkable;
    a one-line note when a task is marked Done is encouraged.
-   Reports → "Look ahead" (`src/lib/lookAhead.ts`, PDF `lookAheadDoc`):
    next 7 days / 4 weeks / 3 months / custom; CONFIRMED orders only
    (drafts are left out on purpose). Department heat table per week
    (months when the range is over 6 weeks): orders with a step there,
    jobs (one product step each) running at the same time on average and
    at peak; shading compares departments with each other; "quieter
    (leave)" = no work or under a third of that department's busiest
    period. Quantity per process per week (spread evenly over the step's
    planned working days; one unit per row, never summed). Key dates
    (internal deadlines, deliveries, company holidays), Work tasks due
    incl. each coming repeat, materials needed by the start of the first
    step of the product that uses them (only products not started yet),
    bought items, steps without a time ("not placed"). Relative only until
    capacity exists; then the same report uses the shared queue (see
    Capacity planning). Always "as of today": recomputed each time.

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
-   Draft WO "Capacity check": expected finish vs internal deadline, where
    it waits (process, department, behind which orders, days), impact on
    other orders, missing times / capacities listed. Then a Reports
    "Factory load" (weekly load % per process / department, bottlenecks
    first) and expected finish / risks using the shared queue.
-   No probability % until enough completed orders exist (about 10+):
    until then exact spare / late working days plus a Low / Medium / High
    risk level; later a % from actual-vs-planned history per process.

## Planning stage and plan document (confirmed 21 Oct 2026)

-   The order clock starts on the WO date. "Planning"
    (WO date → confirmed) is the built-in first stage of every order
    (`planningStep()` / `withPlanning()` in `src/lib/route.ts`; worked
    out, not stored). Planned % (linear and step-based) counts from the
    WO date. Planning benchmark: Settings → profile
    `planningDays`, default 1 working day (user benchmark; empty = not
    set). Drafts past it show in Today ("still in planning") and in the
    plan's open points; the performance report shows planning days per
    WO and the average.
-   Plan document (`productionPlanDoc()` in `src/lib/docs/planDoc.ts`),
    for submission to superiors: "Proposed Plan" for drafts (steps from
    the product routes at that moment) or "Production Plan — status as
    of <date>" once confirmed. Contents: status band, plan version (WO
    revision + time), key dates, planning time, internal deadline and
    buffer, working days available, expected finish vs internal
    deadline, progress; a timeline (Gantt) with today / internal
    deadline / delivery markers; per-product schedule (quantity and
    basis, days, start, finish, status); materials to produce / to buy;
    open points and risks; notes (working days, capacity limitation);
    "Prepared by" (name + designation from Settings) and an empty
    "Reviewed / approved by" block for signing on paper — the app never
    marks anything approved. Available on the WO page and in Reports
    (choose a WO). PROVISIONAL band when times, routes or BOM data are
    missing.
-   Every PDF button row has View / Share PDF / Download (confirmed 21 Oct
    2026). View shows the PDF inside the app page by page (pdf.js
    `pdfjs-dist` 6.3.289, legacy build for older browsers, loaded on the
    first View and cached by the service worker — not precached), with
    zoom and Share / Download from the viewer.
-   Excel (confirmed 5 Nov 2026, `src/lib/docs/xlsx.ts`): every PDF button
    row also has "Excel" — the same DocModel, so it follows the chosen
    version (default "to submit"). Sheets: "About" (title, reference,
    details, provisional reasons, notes, signature, made at), the road map
    as "Key dates", one sheet per table, the step cards as one table in
    their place; real numbers / percents / dates where a cell is only that
    (`cellValue()`; codes with a leading zero stay text), no charts.
    exceljs 4.4.0 in its own chunk (`xlsx-*`), loaded on first use and
    cached by the service worker, not precached. Android Chrome does not
    share .xlsx from a web app (only PDF, images, text): the app shares
    where `canShare` allows it, otherwise saves to Downloads and says how
    to share it from there.
-   Two versions (confirmed 21 Oct 2026): "to submit" (default, clean:
    no benchmarks, rates, calculation details, PROVISIONAL band or
    technical notes; missing data appears as plain-language open points
    such as "time for Latex backing to be confirmed with production";
    layout below; "to be confirmed" for unknown dates) and "working" (all details, for the
    user only, banner "WORKING PLAN - internal details, not for
    submission"). `productionPlanDoc({ ..., variant })`.
-   Plan "to submit" layout (confirmed 26 Oct 2026, `planOverview()` in
    `src/lib/docs/planDoc.ts`, drawn in `pdf.ts`; mockup canvas "Plan PDF
    timeline options", B + "D polished"): key facts; "The order at a
    glance" road map (Order received → Plan approval / confirmed →
    Production → Internal deadline → Cargo ready, "we are here",
    spare / late days) with an "In short" sentence; a Products table (#,
    product, quantity, start, ready, days before the internal deadline;
    tight = 2 working days or less (`TIGHT_DAYS`), late, to be confirmed
    shaded); then "Steps for each product": one card per product with its
    steps as numbered landmarks (dates; done / now / late / approx. /
    to be confirmed) ending in a "Ready <date>" pill, small products in
    pairs; then materials, open points, notes, signatures. No Gantt chart
    and no per-step tables in this version. The working plan keeps the
    Gantt (today / deadline / delivery lines on every page) and the
    detailed step tables.
-   Materials in the plan (confirmed 27 Oct 2026): `planMaterials()`
    records every BOM step (`links`: made item, quantity to make,
    component, per unit, wastage, needed) and per row `madeFrom`,
    `usedFor` (ordered products, through any BOM depth), `via` (made
    products in between) and `ordered`. Both plan versions show "Products
    to make" (with "Made from", names only), "Raw materials to buy for
    production" (with "For ... (via ...)" and suppliers) and, when any,
    "Ready-made products to buy". Only the working plan adds "Material
    calculation (BOM)" (per-unit figures are recipe data, not in the plan
    to submit). WO To produce / To buy PDFs get "Made from" / "For"; the
    Materials tab shows them plus "How it was worked out" per item.
    PDF tables: right-aligned (number) columns never wrap.
-   Making order and direct links (confirmed 15 Nov 2026): "Products to
    make" is listed in making order (`PlanRow.level`: 0 = made from bought
    items only, e.g. the base mat; each product after every made product it
    is made from; same level by name) and gets a "For" column; "For" on
    raw materials and products is what uses the item DIRECTLY
    (`PlanRow.directFor`, `directForText()`: coir yarn → base mat, base
    mat → the ordered mats, "ordered" / "also ordered"). Plan PDFs, Excel,
    the WO To produce / To buy PDFs and the Materials tab. The all-orders
    To buy list keeps the ordered products (`usedFor`, for purchase).
-   Masters must be complete before material figures (confirmed 15 Nov
    2026, after a plan PDF showed "Nothing to buy" while raw materials
    had not loaded): `useCollection` exposes `fromCache`;
    `useMasterData().notReady` (`mastersNotReady()`) is a message while
    products / raw materials / BOMs are loading, failed, or are only the
    phone's saved copy while online (offline the saved copy is allowed).
    Then the WO page hides the plan PDFs and "Save as submitted plan" and
    the Materials tab, and Reports (plan, To buy) and Orders → To buy show
    the message instead. A BOM line whose item is not in Masters is
    counted (`MaterialPlan.missingLines`, error names the id) and the
    lists read "Not calculated - …" instead of "Nothing to buy".
-   Step cards show progress (confirmed 27 Oct 2026): the line between
    landmarks is dark up to the step reached (`DocStepRoad.reached`: last
    done step, or the running one; the "Ready" pill when all are done).
    Red (confirmed 27 Oct 2026) = the step took / is taking more working
    days than its benchmark (`overDays`, "N days over"); the line into it
    and its landmark are red. A step that only ends late because earlier
    steps were late stays dark (not schedule-based; the comparison with
    the submitted plan is a separate table, see "Submitted plan"). Steps without a
    time are never marked late.
-   Container loading (answers 27 Oct 2026, not built yet): one loading
    per order as far as known (may change); container booking always
    comes before it; the internal deadline covers production only —
    loading is not part of it. Idea: order-level dispatch stages after
    production (e.g. container booking → loading → dispatched) with done
    dates and a user benchmark for loading days; never invented.
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
    restored. Work Orders go through allowed status paths (e.g. Completed
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
-   Rules-out-of-date warning (confirmed 26 Oct 2026,
    `src/features/settings/rulesCheck.ts`): the app probes the newer
    collections (processes, departments, tasks) once per start when online
    and again after any save refused with permission-denied; if any is
    refused, a red banner under the header names what is missing and how to
    publish (link to firestore.rules, then Check rules). Add each new
    collection to `RULES_PROBES`.
-   Reports uses the same layout (confirmed 21 Oct 2026): Today ("2
    overdue · 1 today", red flag when overdue), Plan of a Work Order, To buy
    — all orders ("N items") as collapsed rows; Work Order performance and
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
