/**
 * Order flow and milestones (confirmed 18 Nov 2026, mockup "order_flow_three_phases").
 *
 * Every WO runs in three phases: 1 · before production (order level), 2 · production (per product,
 * from the routes) and 3 · after production (order level, up to payment and incentives). The standard
 * list lives in Settings → Order flow (doc `settings/orderFlow`, per workspace); it is copied to a WO
 * when the WO is confirmed and can then be changed for that WO only.
 *
 * Some milestones are filled from data the app already has (indents on steps, vendor orders on
 * outside steps, materials landed, order items landed): they never need a second entry. The others are
 * recorded by the user (done on, note, not needed). The app never approves anything and never invents
 * a lead time: a stage without a due rule shows "date to be set". Only dates are kept, never amounts.
 * Pure functions, no I/O.
 */
import { addWorkingDays, type WorkCalendar } from './calendar';
import type { JobOrder, JoStep } from './jobOrders';
import type { Product } from './masters';
import { newExtraId } from './orderExtras';
import { isBuiltIn, MATERIALS_KEY, orderPlan, type PlanContext } from './route';

export const ORDER_FLOW_DOC = 'orderFlow';

export type FlowPhase = 'BEFORE' | 'AFTER';
export const PHASE_LABEL: Record<FlowPhase | 'PRODUCTION', string> = { BEFORE: 'Before production', PRODUCTION: 'Production', AFTER: 'After production' };

/** Filled from data the app already has. */
export type MilestoneLink = 'SAMPLES' | 'INDENTS' | 'VENDOR_ORDERS' | 'MATERIALS' | 'ORDER_ITEMS';
export const LINK_LABEL: Record<MilestoneLink, string> = {
  SAMPLES: 'sampling WOs (approval recorded by you)',
  INDENTS: 'indents on the in-house steps',
  VENDOR_ORDERS: 'vendor and order date on the outside steps',
  MATERIALS: 'raw materials landed (Materials tab)',
  ORDER_ITEMS: 'items to arrange you tick (Checklist tab)',
};

export type DueKind = 'AFTER_WO' | 'BEFORE_CARGO' | 'AFTER_PRODUCTION';
export const DUE_KIND_LABEL: Record<DueKind | 'FIXED', string> = {
  AFTER_WO: 'working days after the WO date',
  BEFORE_CARGO: 'working days before cargo ready',
  AFTER_PRODUCTION: 'working days after production is ready',
  FIXED: 'a date set on the WO',
};
export interface DueRule {
  kind: DueKind;
  days: number;
}

export interface FlowStage {
  id: string;
  name: string;
  phase: FlowPhase;
  link?: MilestoneLink;
  /** Empty = the date is set on each WO (or stays "to be set"). */
  rule?: DueRule | null;
  departmentId?: string | null;
}

export interface OrderFlow {
  stages: FlowStage[];
  /** Standard order of the production processes (process ids); product routes are compared with it. */
  production: string[];
}

/** One milestone on a WO (copied from the order flow at confirmation). */
export interface Milestone extends FlowStage {
  /** Fixed due date on this WO (used instead of the rule). */
  due?: string | null;
  /** Old due dates (first = the original). */
  dueHistory?: { on: string; at: string }[];
  doneOn?: string | null;
  note?: string;
  notNeeded?: boolean;
  /** "Samples approved": the sampling WOs (in the app or typed) and who approved. */
  samplingWos?: { joId?: string; joNumber: string }[];
  approvedBy?: string;
  /** ORDER_ITEMS: the order items that count (ids of `JobOrder.orderItems`). */
  itemIds?: string[];
}

/**
 * Default stages (from the WO process tree, 18 Nov 2026; [inference] for payment and incentives).
 * No due rule is set by default: the company's lead days are not known.
 */
export const DEFAULT_STAGES: FlowStage[] = [
  { id: 'samples', name: 'Samples approved', phase: 'BEFORE', link: 'SAMPLES' },
  { id: 'indents', name: 'Indents', phase: 'BEFORE', link: 'INDENTS' },
  { id: 'materials', name: 'Raw materials landed', phase: 'BEFORE', link: 'MATERIALS' },
  { id: 'vendorOrders', name: 'Vendor orders (job work)', phase: 'BEFORE', link: 'VENDOR_ORDERS' },
  { id: 'tagArtwork', name: 'Tag artwork approved', phase: 'BEFORE' },
  { id: 'gs1', name: 'GS1 test', phase: 'BEFORE' },
  { id: 'tags', name: 'Tags and labels landed', phase: 'BEFORE', link: 'ORDER_ITEMS' },
  { id: 'packingMaterials', name: 'Packing materials landed', phase: 'BEFORE', link: 'ORDER_ITEMS' },
  { id: 'booking', name: 'Forwarder booking', phase: 'AFTER' },
  { id: 'fumigation', name: 'Fumigation', phase: 'AFTER' },
  { id: 'exportDocs', name: 'Export documents', phase: 'AFTER' },
  { id: 'loading', name: 'Loading and B/L', phase: 'AFTER' },
  { id: 'docsToCustomer', name: 'Documents to customer', phase: 'AFTER' },
  { id: 'vendorBills', name: 'Vendor bills paid', phase: 'AFTER' },
  { id: 'payment', name: 'Payment received', phase: 'AFTER' },
  { id: 'ebrc', name: 'e-BRC', phase: 'AFTER' },
  { id: 'incentives', name: 'Export incentives (RoDTEP / drawback / GST refund)', phase: 'AFTER' },
];

/** The saved flow, or the default stages and the working order of the processes seen in the data. */
export function orderFlowOf(saved: Partial<OrderFlow> | null | undefined, defaultProduction: string[]): OrderFlow {
  return { stages: saved?.stages ?? DEFAULT_STAGES, production: saved?.production ?? defaultProduction };
}

/** Sampling WO (18 Nov 2026): set on the form; when not set, a customer PO "Sampling" makes it one. */
export function isSamplingWo(jo: Pick<JobOrder, 'poNumber'> & { sampling?: boolean }): boolean {
  return jo.sampling ?? /\bsampl/i.test(jo.poNumber ?? '');
}

/** The milestones a WO gets from the flow (a sampling WO has no "Samples approved" and no phase 3). */
export function milestonesFor(flow: OrderFlow, sampling: boolean): Milestone[] {
  return flow.stages.filter((s) => !(sampling && (s.phase === 'AFTER' || s.link === 'SAMPLES'))).map((s) => ({ ...s, id: newExtraId() + s.id.slice(0, 4) }));
}

// ---------------------------------------------------------------------------
// State of one milestone
// ---------------------------------------------------------------------------

export type MilestoneState = 'DONE' | 'NOT_NEEDED' | 'LATE' | 'OPEN' | 'NO_DATE';

export interface MilestoneView {
  m: Milestone;
  state: MilestoneState;
  due: string | null;
  doneOn: string | null;
  /** Where an automatic state comes from ("3 of 3 steps have an indent"). */
  auto: string | null;
}

/** What the plan says about the order (worked out once per WO). */
export interface MilestoneFacts {
  /** All products' steps done: the day of the last one; null when not done. */
  productionDone: string | null;
  /** Planned production ready (last item), when known. */
  productionReady: string | null;
  /** Production progress 0–100 (average of the lines). */
  productionPct: number;
  /** Raw materials landed: the day; null = not yet; undefined = nothing to buy / no made line. */
  materialsDone: string | null | undefined;
  /** Every step of the order (for indents and vendor orders). */
  steps: JoStep[];
}

const latest = (ds: (string | null | undefined)[]) => ds.filter((d): d is string => !!d).sort().at(-1) ?? null;

export function milestoneFacts(jo: Parameters<typeof orderPlan>[0], today: string, ctx: PlanContext): MilestoneFacts {
  const plan = orderPlan(jo, today, ctx);
  const withSteps = plan.lines.filter(({ lp }) => lp.steps.length > 0);
  const allDone = withSteps.length > 0 && withSteps.every(({ lp }) => lp.done);
  const materials = plan.lines.flatMap(({ lp }) => lp.steps.filter((v) => v.step.key === MATERIALS_KEY));
  return {
    productionDone: allDone ? latest(withSteps.flatMap(({ lp }) => lp.steps.map((v) => v.doneOn))) : null,
    productionReady: plan.itemOrder.ready ?? latest(withSteps.map(({ lp }) => lp.expectedFinish)),
    productionPct: withSteps.length ? Math.round(withSteps.reduce((s, { lp }) => s + lp.actualPct, 0) / withSteps.length) : 0,
    materialsDone: materials.length === 0 ? undefined : materials.every((v) => v.state === 'DONE') ? latest(materials.map((v) => v.doneOn)) : null,
    steps: jo.lines.flatMap((l) => l.steps ?? []),
  };
}

/** The due date of a milestone: its own date, or its rule. */
export function milestoneDue(m: Milestone, jo: Pick<JobOrder, 'receivedDate' | 'deliveryDate'>, facts: Pick<MilestoneFacts, 'productionDone' | 'productionReady'>, cal: WorkCalendar): string | null {
  if (m.due) return m.due;
  const r = m.rule;
  if (!r || !Number.isFinite(r.days)) return null;
  const n = Math.abs(r.days);
  if (r.kind === 'AFTER_WO') return jo.receivedDate ? addWorkingDays(jo.receivedDate, n, cal) : null;
  if (r.kind === 'BEFORE_CARGO') return !jo.deliveryDate ? null : n === 0 ? jo.deliveryDate : addWorkingDays(jo.deliveryDate, -n, cal);
  const from = facts.productionDone ?? facts.productionReady;
  return from ? (n === 0 ? from : addWorkingDays(from, n, cal)) : null;
}

/** In-house process steps (not built-in, not outside, not dispatch / landing). */
const inHouse = (s: JoStep) => !!s.processId && !s.outside && !s.outsideOf && !isBuiltIn(s);

/** Automatic state from the WO's data: done date (or null) and a short source; undefined = not linked / nothing to check. */
function autoState(m: Milestone, jo: Pick<JobOrder, 'orderItems'>, f: MilestoneFacts): { done: string | null; auto: string; notNeeded?: boolean } | undefined {
  switch (m.link) {
    case 'INDENTS': {
      const ss = f.steps.filter(inHouse);
      if (ss.length === 0) return undefined;
      const have = ss.filter((s) => s.indentNo?.trim() || s.indentOn);
      const all = have.length === ss.length;
      return { done: all ? (latest(have.map((s) => s.indentOn)) ?? '') : null, auto: `${have.length} of ${ss.length} in-house steps have an indent` };
    }
    case 'VENDOR_ORDERS': {
      const ss = f.steps.filter((s) => s.outside);
      if (ss.length === 0) return { done: null, auto: 'No outside work on this order', notNeeded: true };
      const have = ss.filter((s) => s.supplierId && (s.orderedOn || s.poNo?.trim()));
      return { done: have.length === ss.length ? (latest(have.map((s) => s.orderedOn)) ?? '') : null, auto: `${have.length} of ${ss.length} outside steps ordered` };
    }
    case 'MATERIALS':
      if (f.materialsDone === undefined) return { done: null, auto: 'Nothing to buy for production', notNeeded: true };
      return { done: f.materialsDone, auto: f.materialsDone ? 'All raw materials landed' : 'Raw materials not all landed yet' };
    case 'ORDER_ITEMS': {
      const ids = new Set(m.itemIds ?? []);
      const its = (jo.orderItems ?? []).filter((x) => ids.has(x.id));
      if (its.length === 0) return undefined;
      const landed = its.filter((x) => x.landedOn);
      return { done: landed.length === its.length ? latest(landed.map((x) => x.landedOn)) : null, auto: `${landed.length} of ${its.length} items landed` };
    }
    default:
      return undefined;
  }
}

export function milestoneView(m: Milestone, jo: Pick<JobOrder, 'receivedDate' | 'deliveryDate' | 'orderItems'>, facts: MilestoneFacts, cal: WorkCalendar, today: string): MilestoneView {
  const due = milestoneDue(m, jo, facts, cal);
  if (m.notNeeded) return { m, state: 'NOT_NEEDED', due, doneOn: null, auto: null };
  const a = autoState(m, jo, facts);
  if (m.doneOn) return { m, state: 'DONE', due, doneOn: m.doneOn, auto: a?.auto ?? null };
  if (a?.notNeeded) return { m, state: 'NOT_NEEDED', due, doneOn: null, auto: a.auto };
  if (a && a.done !== null) return { m, state: 'DONE', due, doneOn: a.done || null, auto: a.auto };
  return { m, state: !due ? 'NO_DATE' : due < today ? 'LATE' : 'OPEN', due, doneOn: null, auto: a?.auto ?? null };
}

export interface MilestoneSummary {
  before: MilestoneView[];
  after: MilestoneView[];
  done: number;
  total: number;
  late: number;
  facts: MilestoneFacts;
}

export function milestoneSummary(jo: JobOrder, today: string, ctx: PlanContext): MilestoneSummary {
  const facts = milestoneFacts(jo, today, ctx);
  const views = (jo.milestones ?? []).map((m) => milestoneView(m, jo, facts, ctx.cal, today));
  const counted = views.filter((v) => v.state !== 'NOT_NEEDED');
  return {
    before: views.filter((v) => v.m.phase === 'BEFORE'),
    after: views.filter((v) => v.m.phase === 'AFTER'),
    done: counted.filter((v) => v.state === 'DONE').length,
    total: counted.length,
    late: counted.filter((v) => v.state === 'LATE').length,
    facts,
  };
}

/** A new due date on a milestone, keeping the previous one in its history. */
export function withDue(m: Milestone, next: string | null, prev: string | null, at: string): Milestone {
  if (!prev || prev === next) return { ...m, due: next };
  return { ...m, due: next, dueHistory: [...(m.dueHistory ?? []), { on: prev, at }] };
}

// ---------------------------------------------------------------------------
// Product routes against the standard production order
// ---------------------------------------------------------------------------

export interface RouteDiff {
  productId: string;
  product: string;
  /** Pairs out of the standard order: [earlier in the route, later in the route]. */
  outOfOrder: [string, string][];
  /** Processes of the route that are not in the standard list. */
  notInList: string[];
}

/**
 * Products whose route differs from the standard order. A process the product does not need is
 * never a difference; only the order of the processes it has, and processes not in the list.
 */
export function routeDiffs(products: (Pick<Product, 'name' | 'route' | 'active'> & { id: string })[], production: string[]): RouteDiff[] {
  const pos = new Map(production.map((id, i) => [id, i]));
  const out: RouteDiff[] = [];
  for (const p of products) {
    if (p.active === false) continue;
    const ids = (p.route ?? []).map((s) => s.processId);
    const notInList = [...new Set(ids.filter((id) => !pos.has(id)))];
    const known = ids.filter((id) => pos.has(id));
    const outOfOrder: [string, string][] = [];
    for (let i = 1; i < known.length; i++) {
      const a = known[i - 1]!, b = known[i]!;
      if (pos.get(b)! < pos.get(a)!) outOfOrder.push([a, b]);
    }
    if (outOfOrder.length || notInList.length) out.push({ productId: p.id, product: p.name, outOfOrder, notInList });
  }
  return out;
}
