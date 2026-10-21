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
    timeline: {
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
    tables,
    notes: clean
      ? ['Dates are in working days; Sundays and company holidays are not worked.', `Prepared from the information available on ${formatDay(today)}.`]
      : [
      'Day counts are working days. Each step starts on the day the previous one finishes; planned days = quantity / output per day + fixed days, rounded up to half a day.',
      'Each order is planned as if it had the departments to itself; other orders in the same department may delay it (capacity across orders is not planned yet).',
      'Times and quantities come from the benchmarks and BOMs entered in ExportFlow (user-provided unless marked verified). Items marked * use estimated or unconfirmed data.',
      `Prepared from the data available on ${formatDay(today)}.`,
    ],
    provisional: !clean && uniq.length > 0,
    provisionalReasons: clean ? [] : uniq.slice(0, 8),
    signature: { preparedBy: input.preparedBy.name, designation: input.preparedBy.designation, date: formatDay(today) },
    generatedAt: input.generatedAt,
    fileName: `${safeFileName(order.joNumber)}_${clean ? (draft ? 'proposed-plan' : 'production-plan') : 'working-plan'}_${today}.pdf`,
  };
}
