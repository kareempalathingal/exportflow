/**
 * Printable documents (Phase 3c). A document is built as plain data here
 * (testable, deterministic) and drawn to PDF elsewhere. English only for now.
 */
import { addDays, bufferText, DELIVERY_DATE_TYPES, formatDay, JO_STATUS_LABEL, resolveLine, effectiveSupply, type JobOrder } from '../jobOrders';
import { DEFAULT_CALENDAR, workingDaysBetween, type WorkCalendar } from '../calendar';
import { buildLineSteps, DEFAULT_PLANNING_DAYS, lineProgress, lineSchedule, orderStart, orderStepProgress, orderTrack, planLines, PLANNING_KEY, withPlanning, type PlanContext } from '../route';
import type { MasterData, Process } from '../masters';
import { planMaterials, type BuyTotal, type MaterialPlan, type PlanRow } from '../materials';
import { formatQty, unitLabel } from '../units';
import type { PerformanceReport } from '../performance';
import { TODAY_HEADINGS, type TodaySummary, type TodayWhen } from '../today';

export interface DocTable {
  title: string;
  columns: { label: string; align?: 'left' | 'right' }[];
  rows: string[][];
  empty: string;
  /** Optional row shading (same order as rows). */
  rowTones?: (DocTone | null)[];
}

/** How a product / order stands against the internal deadline. */
export type DocTone = 'ok' | 'tight' | 'late' | 'unknown' | 'done';

/** The order's journey on one line: received → plan → production → internal deadline → delivery. */
export interface DocRoadStop {
  label: string;
  date: string;
  note: string;
  kind: 'done' | 'now' | 'next' | 'deadline' | 'delivery';
  /** "we are here" */
  here?: boolean;
}
export interface DocRoadMap {
  title: string;
  stops: DocRoadStop[];
  /** Index of the stop the order has reached (the line is drawn solid up to it). */
  reached: number;
  summary: string;
}

/** One product's steps as landmarks, ending in "Ready". */
export interface DocStepNode {
  label: string;
  sub: string; // e.g. "for Coir yarn" (a made sub-product's step)
  dates: string;
  state: 'done' | 'now' | 'late' | 'planned' | 'approx' | 'unknown';
}
export interface DocStepRoad {
  name: string;
  sub: string;
  badge: { text: string; tone: DocTone };
  nodes: DocStepNode[];
  ready: { text: string; tone: DocTone };
  dashed: boolean;
  /** Shown instead of the steps when there are none. */
  empty?: string;
}
export interface DocStepRoads {
  title: string;
  /** Drawn after this many tables (0 = before the first table). */
  afterTables: number;
  counts: { text: string; tone: DocTone }[];
  items: DocStepRoad[];
  note: string;
}

/** A simple grouped bar chart (e.g. allowed vs actual days per order). */
export interface DocChart {
  title: string;
  unit: string;
  series: { label: string; color: [number, number, number] }[];
  rows: { label: string; values: number[] }[];
}

/** Bars on a date axis (a simple Gantt chart). */
export interface DocTimeline {
  title: string;
  from: string; // YYYY-MM-DD
  to: string;
  markers: { date: string; label: string; color: [number, number, number] }[];
  rows: { label: string; group: string; from: string | null; to: string | null; kind: 'done' | 'now' | 'planned' | 'late' | 'unknown' }[];
}

export interface DocSignature {
  preparedBy: string;
  designation: string;
  date: string;
}

export interface DocModel {
  title: string; // e.g. "Job Order Summary"
  reference: string; // printed under the title, e.g. "JO-1042"
  company: string;
  /** Status band under the header (e.g. "PROPOSED PLAN"). */
  banner?: string;
  meta: [string, string][];
  charts?: DocChart[];
  timeline?: DocTimeline;
  roadMap?: DocRoadMap;
  stepRoads?: DocStepRoads;
  /** "Prepared by" and an empty "Reviewed / approved by" block at the end. */
  signature?: DocSignature;
  tables: DocTable[];
  notes: string[]; // shown after the tables
  provisional: boolean; // prints a warning band on every page
  provisionalReasons: string[];
  generatedAt: string; // human text, IST
  fileName: string;
}

const qty = (n: number, unit: string) => `${formatQty(n)} ${unitLabel(unit)}`;

export function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document';
}

function base(jo: Pick<JobOrder, 'joNumber' | 'customerName' | 'poNumber'>, company: string, generatedAt: string) {
  return {
    company,
    reference: jo.joNumber,
    generatedAt,
    meta: [
      ['Customer', jo.customerName || '—'],
      ...(jo.poNumber ? ([['Customer PO', jo.poNumber]] as [string, string][]) : []),
    ] as [string, string][],
  };
}

export function joSummaryDoc(jo: JobOrder, md: MasterData, opts: { company: string; today: string; generatedAt: string; cal?: WorkCalendar }): DocModel {
  const b = base(jo, opts.company, opts.generatedAt);
  const reasons: string[] = [];
  const rows = jo.lines.map((l) => {
    const r = resolveLine(l, md);
    const p = md.products.get(l.productId);
    const supply = effectiveSupply(l, p);
    if (r.problem) reasons.push(`${p?.name ?? l.productName}: ${r.problem}`);
    if (!supply) reasons.push(`${p?.name ?? l.productName}: Make or Buy not decided`);
    return [
      p?.name ?? l.productName,
      qty(l.qty, l.unit),
      r.baseQty !== null && r.baseUnit && r.baseUnit !== l.unit ? `${qty(r.baseQty, r.baseUnit)}${r.provisional ? ' (est.)' : ''}` : r.baseQty === null ? 'Conversion needed' : '—',
      supply === 'MAKE' ? 'Make' : supply === 'BUY' ? 'Buy' : 'Not decided',
    ];
  });
  const ctx = { md, cal: opts.cal ?? DEFAULT_CALENDAR };
  const t = orderTrack(jo, opts.today, ctx);
  const fromSteps = jo.status !== 'DRAFT' && orderStepProgress(jo, opts.today, ctx) !== null;
  const progress =
    jo.status === 'DRAFT'
      ? 'Not tracked (draft)'
      : t.actual === null
        ? `Not entered · should be ${t.planned}% today`
        : `${t.actual}% (${fromSteps ? 'from process steps' : `updated ${formatDay(jo.progress?.on)}`}) · should be ${t.planned}% today`;
  return {
    ...b,
    title: 'Job Order Summary',
    meta: [
      ...b.meta,
      ['Status', JO_STATUS_LABEL[jo.status]],
      ['JO received', formatDay(jo.receivedDate)],
      ['Customer delivery', `${formatDay(jo.deliveryDate)} (${DELIVERY_DATE_TYPES.find((x) => x.id === jo.deliveryDateType)?.label ?? '—'})`],
      ['Internal deadline', `${formatDay(jo.deadline.internalDeadline)} · ${bufferText(jo.deadline)} (10%, rounded up)`],
      ['Progress', progress],
      ...(jo.completedOn ? ([['Completed on', formatDay(jo.completedOn)]] as [string, string][]) : []),
    ],
    tables: [
      {
        title: 'Products',
        columns: [{ label: 'Product' }, { label: 'Ordered', align: 'right' }, { label: 'In base unit', align: 'right' }, { label: 'Make / Buy' }],
        rows,
        empty: 'No products on this order.',
      },
    ],
    notes: jo.notes ? [`Notes: ${jo.notes}`] : [],
    provisional: reasons.length > 0 || jo.status === 'DRAFT',
    provisionalReasons: jo.status === 'DRAFT' ? ['This order is still a draft', ...reasons] : reasons,
    fileName: `${safeFileName(jo.joNumber)}_summary.pdf`,
  };
}

/** Supplier names for an item key (from the Suppliers master). */
export type SupplierNames = (key: string) => string[];
const supplierCell = (names: SupplierNames | undefined, key: string) => names?.(key).join(', ') || '—';

function planRows(rows: PlanRow[], withType: boolean, names?: SupplierNames): string[][] {
  return rows.map((r) => [
    `${r.name}${r.provisional ? ' *' : ''}`,
    ...(withType ? [r.type === 'PRODUCT' ? 'Product' : 'Raw material'] : []),
    qty(r.gross, r.unit),
    r.fromStock > 0 ? qty(Math.min(r.fromStock, r.gross), r.unit) : '—',
    qty(r.net, r.unit),
    ...(withType ? [supplierCell(names, r.key)] : []),
  ]);
}

function planNotes(plan: MaterialPlan, rows: PlanRow[]): string[] {
  const out: string[] = [];
  if (rows.some((r) => r.provisional)) out.push('* Based on estimated or unconfirmed data (BOM line, conversion or size/GSM).');
  out.push('From stock = stock checked and set aside for this order. Quantities include BOM wastage.');
  return out.concat(plan.notes);
}

export function planDoc(
  kind: 'TO_PRODUCE' | 'TO_BUY',
  jo: JobOrder,
  plan: MaterialPlan,
  opts: { company: string; generatedAt: string; supplierNames?: SupplierNames },
): DocModel {
  const b = base(jo, opts.company, opts.generatedAt);
  const produce = kind === 'TO_PRODUCE';
  const rows = produce ? plan.toProduce : plan.toBuy;
  return {
    ...b,
    title: produce ? 'To Produce' : 'To Buy',
    meta: [
      ...b.meta,
      ['Status', JO_STATUS_LABEL[jo.status]],
      ['Internal deadline', formatDay(jo.deadline.internalDeadline)],
      ['BOM used', jo.status !== 'DRAFT' && jo.bomSnapshot ? 'Copy saved at confirmation' : 'Current BOMs (order not confirmed)'],
    ],
    tables: [
      {
        title: produce ? 'Products to make' : 'Raw materials and bought products',
        columns: [
          { label: 'Item' },
          ...(produce ? [] : [{ label: 'Type' }]),
          { label: 'Needed', align: 'right' as const },
          { label: 'From stock', align: 'right' as const },
          { label: produce ? 'To produce' : 'To buy', align: 'right' as const },
          ...(produce ? [] : [{ label: 'Suppliers' }]),
        ],
        rows: planRows(rows, !produce, opts.supplierNames),
        empty: produce ? 'Nothing to make for this order.' : 'Nothing to buy for this order.',
      },
    ],
    notes: planNotes(plan, rows),
    provisional: plan.provisional || plan.errors.length > 0 || jo.status === 'DRAFT',
    provisionalReasons: [...(jo.status === 'DRAFT' ? ['This order is still a draft'] : []), ...plan.errors, ...(plan.provisional && plan.errors.length === 0 ? ['Some figures use estimated or unconfirmed data'] : [])],
    fileName: `${safeFileName(jo.joNumber)}_${produce ? 'to-produce' : 'to-buy'}.pdf`,
  };
}

export function toBuyAllDoc(
  rows: BuyTotal[],
  ordersWithErrors: string[],
  opts: { company: string; generatedAt: string; includeDrafts: boolean; today: string; supplierNames?: SupplierNames },
): DocModel {
  return {
    title: 'To Buy — All Orders',
    reference: opts.includeDrafts ? 'Confirmed and draft orders' : 'Confirmed orders',
    company: opts.company,
    meta: [['Items', String(rows.length)]],
    tables: [
      {
        title: 'Still to buy after stock set aside on each order',
        columns: [{ label: 'Item' }, { label: 'Type' }, { label: 'To buy', align: 'right' }, { label: 'Suppliers' }, { label: 'Orders' }],
        rows: rows.map((r) => [
          `${r.name}${r.provisional ? ' *' : ''}`,
          r.type === 'PRODUCT' ? 'Product' : 'Raw material',
          qty(r.net, r.unit),
          supplierCell(opts.supplierNames, r.key),
          r.orders.map((o) => `${o.joNumber}: ${formatQty(o.net)}`).join(', '),
        ]),
        empty: 'Nothing to buy.',
      },
    ],
    notes: rows.some((r) => r.provisional) ? ['* Based on estimated or unconfirmed data.'] : [],
    provisional: ordersWithErrors.length > 0 || rows.some((r) => r.provisional) || opts.includeDrafts,
    provisionalReasons: [
      ...(ordersWithErrors.length ? [`Incomplete data on ${ordersWithErrors.join(', ')} — those orders are not fully included`] : []),
      ...(opts.includeDrafts ? ['Includes draft orders'] : []),
      ...(rows.some((r) => r.provisional) ? ['Some figures use estimated or unconfirmed data'] : []),
    ],
    generatedAt: opts.generatedAt,
    fileName: `to-buy_all-orders_${opts.today}.pdf`,
  };
}

/**
 * The built-in PDF fonts cover Latin-1 (plus a few typographic marks). Anything
 * else is replaced so the PDF never shows broken glyphs.
 */
export function pdfSafe(s: string): string {
  return s
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/[\u2212\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2192/g, '->')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\u0020-\u007E\u00A1-\u00FF]+/g, '?');
}

// ---------------------------------------------------------------------------
// Reports (Reports tab)
// ---------------------------------------------------------------------------

const signedDays = (n: number) => (n > 0 ? `${formatQty(n)} late` : n < 0 ? `${formatQty(-n)} early` : 'on the day');
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

export function performanceDoc(r: PerformanceReport, opts: { company: string; generatedAt: string }): DocModel {
  const s = r.summary;
  const over = r.completed.flatMap((c) => c.steps.filter((x) => x.overrun !== null && x.overrun > 0).map((x) => ({ c, x })));
  return {
    title: 'Job Order Performance',
    reference: `${formatDay(r.from)} - ${formatDay(r.to)}`,
    company: opts.company,
    meta: [
      ['Completed', String(s.completed)],
      ['On time (internal)', `${s.onTimeInternal} of ${s.completed} (${pct(s.onTimeInternal, s.completed)})`],
      ['On time (delivery)', `${s.onTimeDelivery} of ${s.completed} (${pct(s.onTimeDelivery, s.completed)})`],
      ['Average delay', s.avgLateDays === null ? 'No late orders' : `${formatQty(s.avgLateDays)} working days (late orders only)`],
      ['Average buffer used', s.avgBufferUsed === null ? '—' : `${formatQty(s.avgBufferUsed)} working days`],
      ['Average planning time', s.avgPlanningDays === null ? '—' : `${formatQty(s.avgPlanningDays)} working days (received to confirmed)`],
      ['Cancelled', `${r.cancelled} (received in this period)`],
      ['Still open', String(r.open.length)],
    ],
    charts: r.completed.length
      ? [
          {
            title: 'Working days: allowed (to internal deadline) vs actual',
            unit: 'days',
            series: [
              { label: 'Allowed', color: [180, 190, 205] },
              { label: 'Actual', color: [31, 58, 95] },
            ],
            rows: r.completed.map((c) => ({ label: c.joNumber, values: [c.allowedDays, c.actualDays] })),
          },
        ]
      : [],
    tables: [
      {
        title: 'Completed orders',
        columns: [{ label: 'JO' }, { label: 'Customer' }, { label: 'Completed' }, { label: 'vs internal' }, { label: 'vs delivery' }, { label: 'Buffer used', align: 'right' }, { label: 'Planning', align: 'right' }, { label: 'Days plan / actual', align: 'right' }, { label: 'Changes', align: 'right' }],
        rows: r.completed.map((c) => [
          c.joNumber,
          c.customerName,
          formatDay(c.completedOn),
          signedDays(c.vsInternal),
          signedDays(c.vsDelivery),
          `${formatQty(c.bufferUsed)} of ${c.bufferDays}`,
          c.planningDays === null ? '—' : `${formatQty(c.planningDays)}d`,
          `${c.plannedDays === null ? '—' : formatQty(c.plannedDays)} / ${formatQty(c.actualDays)}`,
          c.changes.count ? `${c.changes.count} (${Object.keys(c.changes.fields).join(', ')})` : '0',
        ]),
        empty: 'No orders completed in this period.',
      },
      {
        title: 'Steps that took longer than planned',
        columns: [{ label: 'JO' }, { label: 'Product' }, { label: 'Step' }, { label: 'Planned', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Over', align: 'right' }],
        rows: over
          .sort((a, b) => b.x.overrun! - a.x.overrun!)
          .map(({ c, x }) => [c.joNumber, x.product, x.label, formatQty(x.planned ?? 0), formatQty(x.actual), `+${formatQty(x.overrun!)}`]),
        empty: 'No step ran over its plan.',
      },
      {
        title: 'Processes (steps finished in this period)',
        columns: [{ label: 'Process' }, { label: 'Steps', align: 'right' }, { label: 'Planned', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Actual vs plan', align: 'right' }, { label: 'Suggestion' }],
        rows: r.processes.map((p) => [
          p.label,
          String(p.steps),
          formatQty(p.plannedTotal),
          formatQty(p.actualTotal),
          p.ratio === null ? '—' : `${Math.round(p.ratio * 100)}%`,
          p.suggestion ?? '',
        ]),
        empty: 'No process steps finished in this period.',
      },
      {
        title: 'Open orders',
        columns: [{ label: 'JO' }, { label: 'Customer' }, { label: 'Internal deadline' }, { label: 'Now' }],
        rows: r.open.map((o) => [o.joNumber, o.customerName, formatDay(o.internalDeadline), o.late ? 'Past internal deadline' : o.gap === null ? 'Not tracked' : o.gap < 0 ? `${-o.gap}% behind plan` : 'On plan']),
        empty: 'No open orders.',
      },
    ],
    notes: [
      'All day counts are working days (Sundays and company holidays left out).',
      'Buffer used = working days after the internal deadline, up to the buffer. Changes = plan changes after confirmation (products, quantities, dates, BOMs, stock).',
      `Suggestions appear when at least 5 steps differ from the plan by 15% or more. They are not applied automatically; change the product route if you agree.`,
      ...(r.completed.some((c) => c.ruleNote) ? ['Some orders use the older calendar-day deadline rule.'] : []),
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `jo-performance_${r.from}_${r.to}.pdf`,
  };
}

export function todayDoc(t: TodaySummary, opts: { company: string; generatedAt: string }): DocModel {
  const table = (w: TodayWhen): DocTable => ({
    title: TODAY_HEADINGS[w],
    columns: [{ label: 'What' }],
    rows: t.items.filter((i) => i.when === w).map((i) => [i.text]),
    empty: 'Nothing.',
  });
  return {
    title: 'Daily Summary',
    reference: formatDay(t.today),
    company: opts.company,
    meta: [['Covers', `Today and the next 2 working days (to ${formatDay(t.soonUntil)})`]],
    tables: [table('OVERDUE'), table('TODAY'), table('SOON')],
    notes: ['Working days exclude Sundays and company holidays.'],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `daily-summary_${t.today}.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Production plan (Proposed Plan for drafts) — a document to submit
// ---------------------------------------------------------------------------

export interface PlanDocInput {
  jo: JobOrder & { rev?: number };
  md: MasterData;
  processes: Map<string, Process>;
  ctx: PlanContext;
  today: string;
  company: string;
  generatedAt: string;
  preparedBy: { name: string; designation: string };
  supplierNames?: SupplierNames;
  /** 'submit' = clean plan for superiors (no benchmarks or calculation details); 'working' = full details. */
  variant?: 'submit' | 'working';
}

/** Two days or less before the internal deadline counts as "tight". */
export const TIGHT_DAYS = 2;

const shortDay = (d: string) => formatDay(d).replace(/ \d{4}$/, '');
function dayRange(a: string | null, b: string | null): string {
  if (!a || !b) return a ? `${shortDay(a)} - ?` : 'to be confirmed';
  if (a === b) return shortDay(a);
  return a.slice(0, 7) === b.slice(0, 7) ? `${a.slice(8, 10)} - ${shortDay(b)}` : `${shortDay(a)} - ${shortDay(b)}`;
}
const plural = (n: number, w: string) => `${formatQty(n)} ${w}${n === 1 ? '' : 's'}`;

interface OverviewInput {
  order: JobOrder;
  lines: { line: ReturnType<typeof planLines>[number]; lp: ReturnType<typeof lineProgress>; sched: ReturnType<typeof lineSchedule> }[];
  md: MasterData;
  cal: WorkCalendar;
  today: string;
  draft: boolean;
  track: ReturnType<typeof orderTrack> | null;
  expected: string | null;
  spare: number | null;
}

/**
 * The clean plan's overview (confirmed 26 Oct 2026): the order's road map with a
 * one-line summary, a product table (start, ready, days before the internal
 * deadline) and each product's steps as landmarks ending in "Ready".
 */
export function planOverview(o: OverviewInput): { roadMap: DocRoadMap; table: DocTable; stepRoads: DocStepRoads } {
  const { order, md, cal, today, draft } = o;
  const deadline = order.deadline.internalDeadline;
  const items = o.lines.map(({ line, lp, sched }) => {
    const supply = effectiveSupply(line, md.products.get(line.productId));
    const prod = sched.filter((st) => st.view.step.key !== PLANNING_KEY);
    const known = lp !== null && prod.length > 0;
    const doneAll = known && prod.every((st) => st.view.state === 'DONE');
    const unknownStep = prod.find((st) => !st.finish);
    const ready = known && !unknownStep ? prod[prod.length - 1]!.finish : null;
    const start = known ? prod[0]!.start : null;
    let tone: DocTone;
    let badge: string;
    let cell: string;
    let spareDays: number | null = null;
    if (!known) {
      tone = 'unknown';
      badge = 'steps to be confirmed';
      cell = 'to be confirmed';
    } else if (doneAll) {
      tone = 'done';
      badge = `done ${shortDay(ready!)}`;
      cell = 'done';
    } else if (!ready) {
      tone = 'unknown';
      badge = unknownStep!.view.step.processId === null ? 'supplier dates to be confirmed' : 'dates to be confirmed';
      cell = 'to be confirmed';
    } else if (ready > deadline) {
      const late = workingDaysBetween(deadline, ready, cal) ?? 0;
      tone = 'late';
      badge = `${plural(late, 'day')} late`;
      cell = `${plural(late, 'day')} late`;
    } else {
      spareDays = workingDaysBetween(ready, deadline, cal) ?? 0;
      tone = spareDays <= TIGHT_DAYS ? 'tight' : 'ok';
      badge = spareDays === 0 ? 'ready on the deadline' : tone === 'tight' ? `only ${plural(spareDays, 'day')} spare` : `${plural(spareDays, 'day')} spare`;
      cell = tone === 'tight' ? `${plural(spareDays, 'day')} - tight` : plural(spareDays, 'day');
    }
    const nodes: DocStepNode[] = prod.map((st) => {
      const s = st.view.step;
      const v = st.view;
      const late = v.state !== 'DONE' && ((v.overrunDays ?? 0) > 0 || (st.finish !== null && st.finish > deadline));
      const state: DocStepNode['state'] =
        v.state === 'DONE' ? 'done' : !st.finish && v.state !== 'NOW' ? 'unknown' : late ? 'late' : v.state === 'NOW' ? 'now' : s.estimated ? 'approx' : 'planned';
      const dates =
        state === 'done'
          ? `done ${st.finish ? shortDay(st.finish) : ''}`.trim()
          : v.state === 'NOW'
            ? st.finish ? `now - to ${shortDay(st.finish)}` : 'now'
            : state === 'unknown'
              ? st.start ? `${shortDay(st.start)} - ?` : 'to be confirmed'
              : `${dayRange(st.start, st.finish)}${s.estimated ? ' - approx.' : ''}`;
      return { label: s.label, sub: s.forProduct !== line.productName ? `for ${s.forProduct}` : '', dates, state };
    });
    const what = supply === 'MAKE' ? 'made in house' : supply === 'BUY' ? 'bought' : 'make or buy to be decided';
    return {
      line,
      supply,
      start,
      ready,
      doneAll,
      tone,
      cell,
      spareDays,
      road: {
        name: line.productName,
        sub: `${qty(line.qty, line.unit)} · ${what}`,
        badge: { text: badge, tone },
        nodes,
        ready: doneAll ? { text: `Done ${shortDay(ready!)}`, tone: 'done' as DocTone } : ready ? { text: `Ready ${shortDay(ready)}`, tone } : { text: 'Ready ?', tone: 'unknown' as DocTone },
        dashed: tone === 'unknown',
        ...(known ? {} : { empty: 'Production steps to be confirmed with production' }),
      } satisfies DocStepRoad,
    };
  });

  // Road map.
  const starts = items.map((i) => i.start).filter((d): d is string => !!d).sort();
  const readies = items.map((i) => i.ready).filter((d): d is string => !!d).sort();
  const allKnown = items.length > 0 && items.every((i) => i.ready);
  const allDone = items.length > 0 && items.every((i) => i.doneAll);
  const prodFrom = starts[0] ?? null;
  const prodTo = allKnown ? (o.expected ?? readies.at(-1) ?? null) : null;
  const spare = o.spare;
  const prodStop: DocRoadStop = {
    label: 'Production',
    date: prodFrom ? (prodTo ? dayRange(prodFrom, prodTo) : `${shortDay(prodFrom)} - ?`) : 'to be confirmed',
    note: !draft && o.track && o.track.actual !== null && !allDone ? `${o.track.actual}% complete` : '',
    kind: draft ? 'next' : allDone ? 'done' : 'now',
    ...(!draft && !allDone ? { here: true } : {}),
  };
  const stops: DocRoadStop[] = [
    { label: 'Order received', date: shortDay(order.receivedDate), note: '', kind: 'done' },
    draft
      ? { label: 'Plan approval', date: `today, ${shortDay(today)}`, note: '', kind: 'now', here: true }
      : { label: 'Plan confirmed', date: order.confirmedOn ? shortDay(order.confirmedOn) : '-', note: '', kind: 'done' },
    prodStop,
    {
      label: 'Internal deadline',
      date: shortDay(deadline),
      note: allKnown && spare !== null ? (spare >= 0 ? `${plural(spare, 'day')} spare` : `${plural(-spare, 'day')} late`) : '',
      kind: 'deadline',
    },
    {
      label: 'Customer delivery',
      date: shortDay(order.deliveryDate),
      note: order.deliveryDateType === 'UNCONFIRMED' ? 'basis to be confirmed' : (DELIVERY_DATE_TYPES.find((x) => x.id === order.deliveryDateType)?.label ?? ''),
      kind: 'delivery',
    },
  ];
  const pending = items.filter((i) => !i.ready).map((i) => i.line.productName);
  const lastKnown = readies.at(-1) ?? null;
  const vsDeadline = (d: string) => {
    if (d > deadline) {
      const n = workingDaysBetween(deadline, d, cal) ?? 0;
      return `${plural(n, 'working day')} AFTER the internal deadline - action needed`;
    }
    return `${plural(workingDaysBetween(d, deadline, cal) ?? 0, 'working day')} before the internal deadline`;
  };
  const summary = allDone
    ? `All products done (last on ${shortDay(readies.at(-1)!)}).`
    : allKnown && prodTo
      ? `All products ready by ${shortDay(prodTo)}, ${vsDeadline(prodTo)}.`
      : lastKnown
        ? `Products with known times ready by ${shortDay(lastKnown)} (${vsDeadline(lastKnown)}). Still to be confirmed: ${pending.join(', ')}.`
        : 'Dates to be confirmed - see the open points.';

  const table: DocTable = {
    title: 'Products',
    columns: [{ label: '#' }, { label: 'Product' }, { label: 'Quantity', align: 'right' }, { label: 'Start' }, { label: 'Ready' }, { label: 'Before deadline' }],
    rows: items.map((i, n) => [
      String(n + 1),
      `${i.line.productName}${i.supply === 'BUY' ? ' (bought)' : ''}`,
      qty(i.line.qty, i.line.unit),
      i.start ? (i.supply === 'BUY' && !i.doneAll ? `ordered ${shortDay(i.start)}` : shortDay(i.start)) : 'to be confirmed',
      i.ready ? (i.doneAll ? `done ${shortDay(i.ready)}` : shortDay(i.ready)) : 'to be confirmed',
      i.cell,
    ]),
    rowTones: items.map((i) => (i.tone === 'ok' || i.tone === 'done' ? null : i.tone)),
    empty: 'No products on this order.',
  };

  const count = (t: DocTone) => items.filter((i) => i.tone === t).length;
  const counts: { text: string; tone: DocTone }[] = [
    { text: `${count('done')} done`, tone: 'done' as DocTone, n: count('done') },
    { text: `${count('ok')} with time to spare`, tone: 'ok' as DocTone, n: count('ok') },
    { text: `${count('tight')} tight`, tone: 'tight' as DocTone, n: count('tight') },
    { text: `${count('late')} late`, tone: 'late' as DocTone, n: count('late') },
    { text: `${count('unknown')} waiting for dates`, tone: 'unknown' as DocTone, n: count('unknown') },
  ]
    .filter((c) => c.n > 0)
    .map(({ text, tone }) => ({ text, tone }));

  return {
    roadMap: { title: 'The order at a glance', stops, reached: stops.findIndex((s) => s.here) >= 0 ? stops.findIndex((s) => s.here) : allDone ? 2 : 1, summary },
    table,
    stepRoads: {
      title: 'Steps for each product',
      afterTables: 1,
      counts,
      items: items.map((i) => i.road),
      note: `Dashed = date approximate or to be confirmed. Days spare = working days before the internal deadline (${shortDay(deadline)}).`,
    },
  };
}

export function productionPlanDoc(input: PlanDocInput): DocModel {
  const { jo, md, ctx, today } = input;
  const cal = ctx.cal;
  const draft = jo.status === 'DRAFT';
  const clean = (input.variant ?? 'submit') === 'submit';
  // Open points in plain business language (the clean plan shows these instead of technical risks).
  const points: string[] = [];
  // Drafts: steps come from the product routes as they are now (a proposal).
  const order: JobOrder = draft ? { ...jo, lines: jo.lines.map((l) => (l.steps?.length ? l : { ...l, steps: buildLineSteps(l, md, input.processes) })) } : jo;
  const start = orderStart(order);
  const planned = planLines(order, md);
  const lines = planned.map((line) => {
    const lp = lineProgress(withPlanning(line.steps, order, ctx), start, today, cal);
    return { line, lp, sched: lp ? lineSchedule(lp, today, cal) : [] };
  });
  const risks: string[] = [];
  const provisional: string[] = [];

  // Expected finish: the latest product; unknown if any product has an unknown finish.
  const finishes = lines.filter((x) => x.lp).map((x) => x.sched[x.sched.length - 1]?.finish ?? null);
  const expected = finishes.length && finishes.every((f) => f) ? (finishes as string[]).sort().at(-1)! : null;
  const deadline = order.deadline.internalDeadline;
  const spare = expected ? workingDaysBetween(expected, deadline, cal) : null;
  const available = workingDaysBetween(start, deadline, cal) ?? 0;

  // Risks and missing data.
  for (const { line, lp, sched } of lines) {
    const product = md.products.get(line.productId);
    if (!lp) {
      risks.push(`${line.productName}: no process route — steps and times cannot be planned`);
      provisional.push(`${line.productName}: no process route`);
      points.push(`${line.productName}: production steps and schedule to be confirmed with production`);
      continue;
    }
    if (product && product.route?.length && !product.routeConfirmed) {
      risks.push(`${line.productName}: order of steps not yet confirmed with the company`);
      points.push(`${line.productName}: sequence of process steps to be confirmed with production`);
    }
    for (const st of sched) {
      const s = st.view.step;
      if (s.key === PLANNING_KEY) continue;
      if (s.estimated && s.plannedDays !== null && st.view.state !== 'DONE') {
        risks.push(`${line.productName} · ${s.label}: time is my estimate`);
        provisional.push(`Estimated time for ${s.label} (${line.productName})`);
        points.push(`${line.productName}: time for ${s.label} is approximate - to be confirmed with production`);
      }
      if (s.plannedDays === null) {
        const why = s.note ?? (s.processId === null ? 'supplier lead time not known' : 'time benchmark not known');
        risks.push(`${line.productName} · ${s.label}: ${why}`);
        provisional.push(`Time not known for ${s.label} (${line.productName})`);
        points.push(
          s.processId === null
            ? `${line.productName}: supplier ${s.label === 'Received' ? 'delivery' : 'order'} date to be confirmed`
            : s.note?.startsWith('Conversion')
              ? `${line.productName}: quantity for ${s.label} to be confirmed (size / weight details needed)`
              : `${line.productName}: time for ${s.label} to be confirmed with production`,
        );
      }
      if (st.view.state !== 'DONE' && st.view.overrunDays !== null && st.view.overrunDays > 0) {
        risks.push(`${line.productName} · ${s.label}: running ${formatQty(st.view.overrunDays)} working days over plan`);
        points.push(`${line.productName}: ${s.label} is running behind schedule`);
      }
    }
  }
  const mat = planMaterials(order, md);
  for (const e of mat.errors) {
    risks.push(e);
    provisional.push(e);
    const m = /^BOM missing for (.+?) —/.exec(e);
    points.push(m ? `${m[1]}: material list (BOM) to be confirmed` : `Material requirement to be confirmed: ${e}`);
  }
  if (mat.provisional && !mat.errors.length) provisional.push('Some material figures use estimated or unconfirmed BOM data');
  if (spare !== null && spare < 0) {
    const t = `Expected finish is ${-spare} working day${spare === -1 ? '' : 's'} after the internal deadline`;
    risks.push(t);
    points.unshift(`${t} - action needed`);
  }
  if (draft && order.deliveryDateType === 'UNCONFIRMED') {
    risks.push('Delivery date type is not confirmed yet');
    points.push('Delivery date basis (ex-factory / port / arrival) to be confirmed with the customer');
  }
  const planningNow = lines.find((x) => x.lp?.current?.step.key === PLANNING_KEY)?.lp?.current;
  if (planningNow && planningNow.overrunDays !== null && planningNow.overrunDays > 0) {
    risks.unshift(`Planning is ${formatQty(planningNow.overrunDays)} working day${planningNow.overrunDays === 1 ? '' : 's'} over its benchmark - confirm the plan to start production`);
    points.unshift('Plan confirmation pending - production can start once this plan is approved');
  }

  const planningDaysUsed = draft ? workingDaysBetween(order.receivedDate, today, cal) ?? 0 : workingDaysBetween(order.receivedDate, order.confirmedOn ?? order.receivedDate, cal) ?? 0;
  const bench = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  const track = draft ? null : orderTrack(order, today, ctx);

  const meta: [string, string][] = [
    ['Status', draft ? 'PROPOSED PLAN - draft, not yet confirmed' : `PRODUCTION PLAN - status as of ${formatDay(today)}`],
    ['Plan version', `Revision ${jo.rev ?? '-'} · generated ${input.generatedAt}`],
    ['Customer', order.customerName || '—'],
    ...(order.poNumber ? ([['Customer PO', order.poNumber]] as [string, string][]) : []),
    ['JO received', formatDay(order.receivedDate)],
    clean
      ? ['Planning', draft ? `Started ${formatDay(order.receivedDate)} - this plan` : `${formatDay(order.receivedDate)} to ${formatDay(order.confirmedOn)}`]
      : [
      'Planning',
      draft
        ? `In planning for ${formatQty(planningDaysUsed)} working day${planningDaysUsed === 1 ? '' : 's'}${bench !== null ? ` (benchmark ${formatQty(bench)})` : ''}`
        : `Confirmed ${formatDay(order.confirmedOn)} · ${formatQty(planningDaysUsed)} working day${planningDaysUsed === 1 ? '' : 's'}${bench !== null ? ` (benchmark ${formatQty(bench)})` : ''}`,
      ],
    ['Customer delivery', `${formatDay(order.deliveryDate)} · ${DELIVERY_DATE_TYPES.find((x) => x.id === order.deliveryDateType)?.label ?? ''}`],
    ['Internal deadline', clean ? formatDay(deadline) : `${formatDay(deadline)} · ${bufferText(order.deadline)} (10%, rounded up)`],
    ...(clean ? [] : ([['Working days available', `${available} (received to internal deadline)`]] as [string, string][])),
    [
      'Expected finish',
      expected
        ? `${formatDay(expected)} · ${spare! >= 0 ? `${spare} working day${spare === 1 ? '' : 's'} before the internal deadline` : `${-spare!} working day${spare === -1 ? '' : 's'} AFTER the internal deadline`}`
        : clean
          ? 'To be confirmed (see open points)'
          : 'Not known yet - some steps have no time',
    ],
    ...(track && track.actual !== null ? ([['Progress', clean ? `${track.actual}% complete (planned ${track.planned}% by today)` : `${track.actual}% done · should be ${track.planned}% today`]] as [string, string][]) : []),
  ];

  // Timeline (Gantt): one row per step, grouped by product.
  const rowsTl: DocTimeline['rows'] = [];
  let lastDate = order.deliveryDate;
  for (const { line, sched } of lines) {
    for (const st of sched) {
      const s = st.view.step;
      const kind: DocTimeline['rows'][number]['kind'] =
        st.view.state === 'DONE' ? 'done' : !st.finish ? 'unknown' : st.finish > deadline ? 'late' : st.view.state === 'NOW' ? 'now' : 'planned';
      rowsTl.push({ label: s.key === PLANNING_KEY ? 'Planning (order)' : `${s.label}${s.forProduct !== line.productName ? ` · ${s.forProduct}` : ''}`, group: line.productName, from: st.start, to: st.finish, kind });
      if (st.finish && st.finish > lastDate) lastDate = st.finish;
    }
  }

  const tables: DocTable[] = lines.map(({ line, lp, sched }) => {
    const supply = effectiveSupply(line, md.products.get(line.productId));
    return {
      title: `${line.productName} - ${qty(line.qty, line.unit)} · ${supply === 'MAKE' ? 'Make' : supply === 'BUY' ? 'Buy' : 'Make/Buy not decided'}`,
      columns: clean
        ? [{ label: 'Step' }, { label: 'Quantity', align: 'right' }, { label: 'Start' }, { label: 'Finish' }, { label: 'Status' }]
        : [{ label: 'Step' }, { label: 'Quantity / basis' }, { label: 'Days', align: 'right' }, { label: 'Start' }, { label: 'Finish' }, { label: 'Status' }],
      rows: lp
        ? sched.map((st) => {
            const s = st.view.step;
            const name = s.key === PLANNING_KEY ? 'Planning (whole order)' : `${s.label}${s.forProduct !== line.productName ? ` (${s.forProduct})` : ''}`;
            if (clean) {
              const amount = s.qty !== null && s.qtyUnit ? qty(s.qty, s.qtyUnit) : s.key === PLANNING_KEY ? '—' : s.processId === null ? qty(line.qty, line.unit) : '—';
              const late = st.view.overrunDays !== null && st.view.overrunDays > 0;
              const status = st.view.state === 'DONE' ? 'Done' : st.view.state === 'NOW' ? (late ? 'In progress - delayed' : 'In progress') : st.finish ? 'Planned' : 'To be confirmed';
              return [name, amount, st.start ? formatDay(st.start) : 'To be confirmed', st.finish ? formatDay(st.finish) : 'To be confirmed', status];
            }
            const basis = [s.basis, s.note].filter(Boolean).join(' · ') || (s.processId === null && s.key !== PLANNING_KEY ? 'Purchase' : '—');
            const days =
              st.view.state === 'DONE'
                ? `${formatQty(st.view.actualDays ?? 0)}${s.plannedDays !== null ? ` (plan ${formatQty(s.plannedDays)})` : ''}`
                : s.plannedDays === null
                  ? 'pending'
                  : formatQty(s.plannedDays);
            const status = st.view.state === 'DONE' ? 'Done' : st.view.state === 'NOW' ? (st.view.overrunDays !== null && st.view.overrunDays > 0 ? 'Now - over plan' : 'Now') : s.plannedDays === null ? 'Time pending' : 'Planned';
            return [name, basis, days, st.start ? formatDay(st.start) : '—', st.finish ? formatDay(st.finish) : '—', status];
          })
        : [],
      empty: 'No process route for this product yet.',
    };
  });

  const matRow = (r: PlanRow, suppliers: boolean) => [
    `${r.name}${r.provisional && !clean ? ' *' : ''}`,
    qty(r.gross, r.unit),
    r.fromStock > 0 ? qty(r.fromStock, r.unit) : '—',
    qty(r.net, r.unit),
    ...(suppliers ? [supplierCell(input.supplierNames, r.key)] : []),
  ];
  tables.push(
    {
      title: 'Materials - to produce',
      columns: [{ label: 'Item' }, { label: 'Needed', align: 'right' }, { label: 'From stock', align: 'right' }, { label: 'To produce', align: 'right' }],
      rows: mat.toProduce.map((r) => matRow(r, false)),
      empty: 'Nothing to produce.',
    },
    {
      title: 'Materials - to buy',
      columns: [{ label: 'Item' }, { label: 'Needed', align: 'right' }, { label: 'From stock', align: 'right' }, { label: 'To buy', align: 'right' }, { label: 'Suppliers' }],
      rows: mat.toBuy.map((r) => matRow(r, true)),
      empty: 'Nothing to buy.',
    },
    {
      title: clean ? 'Open points' : 'Open points and risks',
      columns: [{ label: 'Point' }],
      rows: (clean ? [...new Set(points)] : risks).map((r) => [r]),
      empty: 'None found in the data available.',
    },
  );

  const uniq = [...new Set(provisional)];
  const overview = clean ? planOverview({ order, lines, md, cal, today, draft, track, expected, spare }) : null;
  return {
    title: clean ? (draft ? 'Proposed Plan' : 'Production Plan') : draft ? 'Working Plan (proposed)' : 'Working Plan',
    reference: order.joNumber,
    company: input.company,
    banner: clean
      ? draft
        ? 'PROPOSED PLAN - for review and approval'
        : `PRODUCTION PLAN - status as of ${formatDay(today)}`
      : 'WORKING PLAN - internal details (benchmarks and calculations), not for submission',
    meta,
    ...(overview ? { roadMap: overview.roadMap, stepRoads: overview.stepRoads } : {}),
    timeline: overview ? undefined : {
      title: 'Timeline (working days; Sundays and company holidays are not worked)',
      from: order.receivedDate,
      to: addDays(lastDate, 1)!,
      markers: [
        { date: today, label: 'Today', color: [91, 101, 115] },
        { date: deadline, label: 'Internal deadline', color: [180, 120, 0] },
        { date: order.deliveryDate, label: 'Delivery', color: [180, 40, 30] },
      ],
      rows: rowsTl,
    },
    tables: overview ? [overview.table, ...tables.slice(lines.length)] : tables,
    notes: clean
      ? ['Dates are in working days; Sundays and company holidays are not worked.', `Prepared from the information available on ${formatDay(today)}.`]
      : [
      'Day counts are working days. Each step starts on the day the previous one finishes; planned days = quantity / output per day + fixed days, rounded up to half a day.',
      'Each order is planned as if it had the departments to itself; other orders in the same department may delay it (capacity across orders is not planned yet).',
      'Times and quantities come from the benchmarks and BOMs entered in ExportFlow. Times marked "my estimate" are approximate; items marked * use estimated or unconfirmed data.',
      `Prepared from the data available on ${formatDay(today)}.`,
    ],
    provisional: !clean && uniq.length > 0,
    provisionalReasons: clean ? [] : uniq.slice(0, 8),
    signature: { preparedBy: input.preparedBy.name, designation: input.preparedBy.designation, date: formatDay(today) },
    generatedAt: input.generatedAt,
    fileName: `${safeFileName(order.joNumber)}_${clean ? (draft ? 'proposed-plan' : 'production-plan') : 'working-plan'}_${today}.pdf`,
  };
}
