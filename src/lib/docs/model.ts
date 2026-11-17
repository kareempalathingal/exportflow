/**
 * Printable documents (Phase 3c). A document is built as plain data here
 * (testable, deterministic) and drawn to PDF elsewhere. English only for now.
 */
import { refPairs, bufferText, DELIVERY_DATE_TYPES, formatDay, JO_STATUS_LABEL, resolveLine, effectiveSupply, type JobOrder } from '../jobOrders';
import { DEFAULT_CALENDAR, type WorkCalendar } from '../calendar';
import { orderStepProgress, orderTrack } from '../route';
import type { Department, MasterData } from '../masters';
import { type BuyTotal, type MaterialPlan, type PlanRow } from '../materials';
import { formatQty, unitLabel } from '../units';
import type { PerformanceReport } from '../performance';
import { countsText, TODAY_HEADINGS, todayByDepartment, type TodaySummary, type TodayWhen } from '../today';

export interface DocTable {
  title: string;
  columns: { label: string; align?: 'left' | 'right' }[];
  rows: string[][];
  empty: string;
  /** Optional row shading (same order as rows). */
  rowTones?: (DocTone | null)[];
  /** Optional heat shading per cell, 1 (light) – 3 (dark); null / 0 = none. */
  cellLevels?: (number | null)[][];
  /** No header row (e.g. a list of highlights). */
  noHead?: boolean;
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
  /** 'late' = running past its benchmark; a done step that took longer has overDays > 0. */
  state: 'done' | 'now' | 'late' | 'planned' | 'approx' | 'unknown';
  /** Working days over the step's benchmark (done or running); 0 = on time or not known. */
  overDays: number;
}
export interface DocStepRoad {
  name: string;
  sub: string;
  badge: { text: string; tone: DocTone };
  nodes: DocStepNode[];
  ready: { text: string; tone: DocTone };
  /** Index of the furthest landmark reached (the "Ready" pill = nodes.length); the line is dark up to it; -1 = not started. */
  reached: number;
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
  rows: {
    label: string;
    group: string;
    from: string | null;
    to: string | null;
    kind: 'done' | 'now' | 'planned' | 'late' | 'unknown';
    /** Date is approximate (estimate or benchmark): dashed bar. */
    approx?: boolean;
    /** Added after the dates on the bar, e.g. "1 day over". */
    note?: string;
  }[];
  /** Sundays and company holidays between from and to (shaded). */
  offDays?: string[];
}

export interface DocSignature {
  preparedBy: string;
  designation: string;
  date: string;
}

export interface DocModel {
  title: string; // e.g. "Work Order Summary"
  reference: string; // printed right of the title, e.g. "WO No. 95/2026"
  /** The reference is a WO No.: printed as large and bold as the title (16 Nov 2026). */
  referenceStrong?: boolean;
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

export const qty = (n: number, unit: string) => `${formatQty(n)} ${unitLabel(unit)}`;

export function safeFileName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'document';
}

/** How a WO is named at the top of its documents. */
export const woRef = (joNumber: string) => `WO No. ${joNumber}`;

export function base(jo: Pick<JobOrder, 'joNumber' | 'customerName' | 'poNumber'> & Partial<Pick<JobOrder, 'refs'>>, company: string, generatedAt: string) {
  return {
    company,
    reference: woRef(jo.joNumber),
    referenceStrong: true,
    generatedAt,
    meta: [
      ['Customer', jo.customerName || '—'],
      ...(jo.poNumber ? ([['Customer PO No.', jo.poNumber]] as [string, string][]) : []),
      ...refPairs(jo.refs),
    ] as [string, string][],
  };
}

export function joSummaryDoc(jo: JobOrder, md: MasterData, opts: { company: string; today: string; generatedAt: string; cal?: WorkCalendar }): DocModel {
  const b = base(jo, opts.company, opts.generatedAt);
  const reasons: string[] = [];
  const withCodes = jo.lines.some((l) => l.articleNo || l.barcode);
  const rows = jo.lines.map((l, n) => {
    const r = resolveLine(l, md);
    const p = md.products.get(l.productId);
    const supply = effectiveSupply(l, p);
    if (r.problem) reasons.push(`${p?.name ?? l.productName}: ${r.problem}`);
    if (!supply) reasons.push(`${p?.name ?? l.productName}: Make or outright purchase not decided`);
    return [
      String(n + 1),
      p?.name ?? l.productName,
      qty(l.qty, l.unit),
      r.baseQty !== null && r.baseUnit && r.baseUnit !== l.unit ? `${qty(r.baseQty, r.baseUnit)}${r.provisional ? ' (est.)' : ''}` : r.baseQty === null ? 'Conversion needed' : '—',
      supply === 'MAKE' ? 'Make' : supply === 'BUY' ? 'Outright purchase' : 'Not decided',
      ...(withCodes ? [l.articleNo ?? '', l.barcode ?? ''] : []),
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
    title: 'Work Order Summary',
    meta: [
      ...b.meta,
      ['Status', JO_STATUS_LABEL[jo.status]],
      ['WO date', formatDay(jo.receivedDate)],
      ['Cargo ready', `${formatDay(jo.deliveryDate)} (${DELIVERY_DATE_TYPES.find((x) => x.id === jo.deliveryDateType)?.label ?? '—'})`],
      ['Internal deadline', `${formatDay(jo.deadline.internalDeadline)} · ${bufferText(jo.deadline)} (10%, rounded up)`],
      ['Progress', progress],
      ...(jo.completedOn ? ([['Completed on', formatDay(jo.completedOn)]] as [string, string][]) : []),
    ],
    tables: [
      {
        title: 'Products',
        columns: [{ label: '#' }, { label: 'Product' }, { label: 'Ordered', align: 'right' }, { label: 'In base unit', align: 'right' }, { label: 'Make / Outright purchase' }, ...(withCodes ? [{ label: 'Article no.' }, { label: 'Barcode' }] : [])],
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
export const supplierCell = (names: SupplierNames | undefined, key: string) => names?.(key).join(', ') || '—';

/** "Coir yarn, Latex compound" — direct components of a made product (names only, no BOM figures). */
export function madeFromText(r: Pick<PlanRow, 'madeFrom'>): string {
  return r.madeFrom.join(', ') || '—';
}

/** Distinct products ordered on a Work Order (for "all N ordered products"). */
export function orderedProductCount(jo: Pick<JobOrder, 'lines'>): number {
  return new Set(jo.lines.map((l) => l.productId)).size;
}

/**
 * "Coir mat, Coir rug (via Coir yarn)" — the ordered products an item is needed for.
 * When it is needed for every product of a larger order: "all 35 ordered products"
 * (confirmed 4 Nov 2026: long lists are shortened).
 */
export function usedForText(r: Pick<PlanRow, 'usedFor' | 'via' | 'ordered'>, orderedCount = 0): string {
  const parts: string[] = [];
  const all = orderedCount > 3 && r.usedFor.length === orderedCount;
  if (r.usedFor.length) parts.push(`${all ? `all ${orderedCount} ordered products` : r.usedFor.join(', ')}${r.via.length ? ` (via ${r.via.join(', ')})` : ''}`);
  if (r.ordered) parts.push(r.usedFor.length ? 'also ordered as is' : 'ordered as is');
  return parts.join('; ') || '—';
}

/**
 * "Tufted base mat 5000 GSM" — what uses an item DIRECTLY (15 Nov 2026), so the chain reads
 * raw material → base mat → ordered mat. "ordered" when the item is itself on the order.
 */
export function directForText(r: Pick<PlanRow, 'directFor' | 'ordered'>, orderedCount = 0, made = false): string {
  const parts: string[] = [];
  const all = orderedCount > 3 && r.directFor.length === orderedCount;
  if (r.directFor.length) parts.push(all ? `all ${orderedCount} ordered products` : r.directFor.join(', '));
  if (r.ordered) parts.push(made ? (r.directFor.length ? 'also ordered' : 'ordered') : r.directFor.length ? 'also ordered as is' : 'ordered as is');
  return parts.join('; ') || '—';
}

function planRows(rows: PlanRow[], withType: boolean, names?: SupplierNames, orderedCount = 0): string[][] {
  return rows.map((r) => [
    `${r.name}${r.provisional ? ' *' : ''}`,
    ...(withType ? [r.type === 'PRODUCT' ? 'Product' : 'Raw material'] : []),
    qty(r.gross, r.unit),
    r.fromStock > 0 ? qty(Math.min(r.fromStock, r.gross), r.unit) : '—',
    qty(r.net, r.unit),
    withType ? directForText(r, orderedCount) : madeFromText(r),
    ...(withType ? [supplierCell(names, r.key)] : [directForText(r, orderedCount, true)]),
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
        title: produce ? 'Products to make' : 'Raw materials and outright purchases',
        columns: [
          { label: 'Item' },
          ...(produce ? [] : [{ label: 'Type' }]),
          { label: 'Needed', align: 'right' as const },
          { label: 'From stock', align: 'right' as const },
          { label: produce ? 'To produce' : 'To buy', align: 'right' as const },
          { label: produce ? 'Made from' : 'For' },
          ...(produce ? [{ label: 'For' }] : [{ label: 'Suppliers' }]),
        ],
        rows: planRows(rows, !produce, opts.supplierNames, orderedProductCount(jo)),
        empty: plan.missingLines ? 'Not calculated - BOM lines point to items not found in Masters (see the reasons at the top).' : produce ? 'Nothing to make for this order.' : 'Nothing to buy for this order.',
      },
    ],
    notes: planNotes(plan, rows),
    provisional: plan.provisional || plan.errors.length > 0 || jo.status === 'DRAFT',
    provisionalReasons: [...(jo.status === 'DRAFT' ? ['This order is still a draft'] : []), ...plan.errors, ...(plan.provisional && plan.errors.length === 0 ? ['Some figures use estimated or unconfirmed data'] : [])],
    fileName: `${safeFileName(jo.joNumber)}_${produce ? 'to-produce' : 'to-buy'}.pdf`,
  };
}

/**
 * The "Orders" cell of a To buy row (5 Nov 2026): one order = just its number (the
 * quantity is already in "To buy"); several = each order's share.
 */
export function ordersCell(r: Pick<BuyTotal, 'orders'>): string {
  return r.orders.length === 1 ? r.orders[0]!.joNumber : r.orders.map((o) => `${o.joNumber}: ${formatQty(o.net)}`).join(', ');
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
          ordersCell(r),
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
    .replace(/[\u00A0\u202F]/g, ' ')
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
    title: 'Work Order Performance',
    reference: `${formatDay(r.from)} - ${formatDay(r.to)}`,
    company: opts.company,
    meta: [
      ['Completed', String(s.completed)],
      ['On time (internal)', `${s.onTimeInternal} of ${s.completed} (${pct(s.onTimeInternal, s.completed)})`],
      ['On time (cargo ready)', `${s.onTimeDelivery} of ${s.completed} (${pct(s.onTimeDelivery, s.completed)})`],
      ['Average delay', s.avgLateDays === null ? 'No late orders' : `${formatQty(s.avgLateDays)} working days (late orders only)`],
      ['Average buffer used', s.avgBufferUsed === null ? '—' : `${formatQty(s.avgBufferUsed)} working days`],
      ['Average planning time', s.avgPlanningDays === null ? '—' : `${formatQty(s.avgPlanningDays)} working days (WO date to confirmed)`],
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
        columns: [{ label: 'WO' }, { label: 'Customer' }, { label: 'Completed' }, { label: 'vs internal' }, { label: 'vs cargo ready' }, { label: 'Buffer used', align: 'right' }, { label: 'Planning', align: 'right' }, { label: 'Days plan / actual', align: 'right' }, { label: 'Changes', align: 'right' }],
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
        columns: [{ label: 'WO' }, { label: 'Product' }, { label: 'Step' }, { label: 'Planned', align: 'right' }, { label: 'Actual', align: 'right' }, { label: 'Over', align: 'right' }],
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
        columns: [{ label: 'WO' }, { label: 'Customer' }, { label: 'Internal deadline' }, { label: 'Now' }],
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

/** Daily summary PDF; one table per department when departments are given (16 Nov 2026). */
export function todayDoc(t: TodaySummary, opts: { company: string; generatedAt: string; departments?: (Department & { id?: string })[] }): DocModel {
  const WHEN: Record<TodayWhen, string> = { OVERDUE: 'Overdue', TODAY: 'Today', SOON: 'Next 2 days' };
  const byDept: DocTable[] | null = opts.departments
    ? todayByDepartment(t, opts.departments).map((g) => ({
        title: `${g.name} (${countsText(g.counts)})`,
        columns: [{ label: 'When' }, { label: 'What' }],
        rows: g.items.map((i) => [WHEN[i.when], i.text]),
        rowTones: g.items.map((i) => (i.when === 'OVERDUE' ? 'late' : null)),
        empty: 'Nothing.',
      }))
    : null;
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
    tables: byDept ? (byDept.length ? byDept : [table('TODAY')]) : [table('OVERDUE'), table('TODAY'), table('SOON')],
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

// Plan documents (plan to submit / working plan) live in ./planDoc.ts (split 15 Nov 2026).
export { planOverview, productionPlanDoc, TIGHT_DAYS, type PlanDocInput } from './planDoc';
