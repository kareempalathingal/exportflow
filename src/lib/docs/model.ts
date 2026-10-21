/**
 * Printable documents (Phase 3c). A document is built as plain data here
 * (testable, deterministic) and drawn to PDF elsewhere. English only for now.
 */
import { bufferText, DELIVERY_DATE_TYPES, formatDay, JO_STATUS_LABEL, resolveLine, effectiveSupply, type JobOrder } from '../jobOrders';
import { DEFAULT_CALENDAR, type WorkCalendar } from '../calendar';
import { orderStepProgress, orderTrack } from '../route';
import type { MasterData } from '../masters';
import type { BuyTotal, MaterialPlan, PlanRow } from '../materials';
import { formatQty, unitLabel } from '../units';
import type { PerformanceReport } from '../performance';
import { TODAY_HEADINGS, type TodaySummary, type TodayWhen } from '../today';

export interface DocTable {
  title: string;
  columns: { label: string; align?: 'left' | 'right' }[];
  rows: string[][];
  empty: string;
}

/** A simple grouped bar chart (e.g. allowed vs actual days per order). */
export interface DocChart {
  title: string;
  unit: string;
  series: { label: string; color: [number, number, number] }[];
  rows: { label: string; values: number[] }[];
}

export interface DocModel {
  title: string; // e.g. "Job Order Summary"
  reference: string; // printed under the title, e.g. "JO-1042"
  company: string;
  meta: [string, string][];
  charts?: DocChart[];
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
        columns: [{ label: 'JO' }, { label: 'Customer' }, { label: 'Completed' }, { label: 'vs internal' }, { label: 'vs delivery' }, { label: 'Buffer used', align: 'right' }, { label: 'Days plan / actual', align: 'right' }, { label: 'Changes', align: 'right' }],
        rows: r.completed.map((c) => [
          c.joNumber,
          c.customerName,
          formatDay(c.completedOn),
          signedDays(c.vsInternal),
          signedDays(c.vsDelivery),
          `${formatQty(c.bufferUsed)} of ${c.bufferDays}`,
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
