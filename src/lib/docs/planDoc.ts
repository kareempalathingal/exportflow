/**
 * Plan documents (split out of model.ts, 15 Nov 2026): the plan to submit and the working plan
 * of a Work Order (`productionPlanDoc()`), with the overview used by the plan to submit.
 */
import { addDays, bufferText, DELIVERY_DATE_TYPES, formatDay, effectiveSupply, type JobOrder } from '../jobOrders';
import { workingDaysBetween, type WorkCalendar } from '../calendar';
import { ITEM_ORDER_RULE, LISTED_RULE, daysLeftText, gainText } from '../itemOrder';
import { compareToPlan, diffText as baselineDiffText, stepKey } from '../baseline';
import { buildLineSteps, isLandingStep, DEFAULT_PLANNING_DAYS, isBuiltIn, lineProgress, MATERIALS_KEY, lineSchedule, orderPlan, orderStart, orderTrack, planLines, PLANNING_KEY, processPlanRows, type ItemOrder, type PlanContext } from '../route';
import type { Department, MasterData, Process } from '../masters';
import { departmentsFor } from '../contacts';
import { planMaterials, type PlanRow } from '../materials';
import { formatQty, unitLabel } from '../units';
import { type DocModel, type DocRoadMap, type DocRoadStop, type DocStepNode, type DocStepRoad, type DocStepRoads, type DocTable, type DocTimeline, type DocTone, type SupplierNames, directForText, madeFromText, orderedProductCount, qty, safeFileName, supplierCell } from './model';

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
  /** For the department column of "Plan by process". */
  departments?: Department[];
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
    const start = known ? (prod.find((st) => !isBuiltIn(st.view.step)) ?? prod[0]!).start : null;
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
      badge = unknownStep!.view.step.key === MATERIALS_KEY ? 'material dates to be confirmed' : unknownStep!.view.step.processId === null ? 'supplier dates to be confirmed' : 'dates to be confirmed';
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
      // Late = took (or is taking) more working days than its benchmark (confirmed 27 Oct 2026);
      // a step that only finishes late because earlier steps were late stays on time.
      const over = (v.state === 'DONE' || v.state === 'NOW') && s.plannedDays !== null && (v.overrunDays ?? 0) > 0 ? v.overrunDays! : 0;
      const state: DocStepNode['state'] =
        v.state === 'DONE' ? 'done' : !st.finish && v.state !== 'NOW' ? 'unknown' : over > 0 ? 'late' : v.state === 'NOW' ? 'now' : s.estimated ? 'approx' : 'planned';
      const overText = over > 0 ? ` - ${plural(over, 'day')} over` : '';
      const dates =
        state === 'done'
          ? `done ${st.finish ? shortDay(st.finish) : ''}${overText}`.trim()
          : v.state === 'NOW'
            ? `${st.finish ? `now - to ${shortDay(st.finish)}` : 'now'}${overText}`
            : state === 'unknown'
              ? st.start ? `${shortDay(st.start)} - ?` : 'to be confirmed'
              : `${dayRange(st.start, st.finish)}${s.estimated ? ' - approx.' : ''}`;
      return { label: s.label, sub: s.forProduct !== line.productName ? `for ${s.forProduct}` : '', dates, state, overDays: over };
    });
    const what = supply === 'MAKE' ? 'made in house' : supply === 'BUY' ? 'outright purchase' : 'make or outright purchase to be decided';
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
        reached: doneAll ? nodes.length : prod.some((st) => st.view.state === 'NOW') ? prod.filter((st) => st.view.state === 'DONE').length : prod.filter((st) => st.view.state === 'DONE').length - 1,
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
    { label: 'WO date', date: shortDay(order.receivedDate), note: '', kind: 'done' },
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
      label: 'Cargo ready',
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
      `${i.line.productName}${i.supply === 'BUY' ? ' (outright purchase)' : ''}`,
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
      note: `Red = the step took (or is taking) longer than planned. Dashed = date approximate or to be confirmed. Days spare = working days before the internal deadline (${shortDay(deadline)}).`,
    },
  };
}

/** Plan PDFs (15 Nov 2026): the item order rule; the working plan adds the listed-order comparison and work left per item. */
function itemOrderMeta(io: ItemOrder, clean: boolean): [string, string][] {
  if (io.items.length < 2) return [];
  const rule = io.rule === 'PRIORITY' ? ITEM_ORDER_RULE : LISTED_RULE;
  if (clean) return [['Item order', `${rule}.`]];
  const gain = gainText(io.gainDays);
  const vs =
    io.rule === 'PRIORITY'
      ? io.readyListed ? `In listed order: ${formatDay(io.readyListed)}${gain ? ` (with the priority ${gain.text})` : ''}` : 'Listed order: date not known yet'
      : io.readyPriority ? `With item priority: ${formatDay(io.readyPriority)}${gain ? ` (${gain.text})` : ''}` : 'With item priority: date not known yet';
  const items = io.items.map((i, n) => `${n + 1}. ${i.product}${i.rush ? ' [Rush]' : ''} - ${daysLeftText(i)}`).join('\n');
  return [['Item order', `${rule}. ${vs}.\n${items}`]];
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
  // Whole-order plan: the items share each process (5 Nov 2026).
  const oplan = orderPlan(order, today, ctx);
  const lpOf = new Map(oplan.lines.map((x) => [x.line.id, x.lp]));
  const lines = planned.map((line) => {
    const lp = lpOf.get(line.id) ?? null;
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
      if (s.key === MATERIALS_KEY && s.plannedDays === null && st.view.state !== 'DONE' && s.note) {
        points.push(`${line.productName}: ${s.note.replace('Expected date not entered: ', 'arrival date of ')} to be confirmed with purchase`);
        provisional.push(`Material arrival date missing (${line.productName})`);
      }
      if (isBuiltIn(s)) continue;
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
            ? `${line.productName}: supplier ${isLandingStep(s.label) ? 'landing' : 'order'} date to be confirmed`
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
    risks.push('What the cargo ready date means is not confirmed yet');
    points.push('Cargo ready date basis (ex-factory / port / arrival) to be confirmed with the customer');
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
    ...(order.poNumber ? ([['Customer PO No.', order.poNumber]] as [string, string][]) : []),
    ['WO date', formatDay(order.receivedDate)],
    clean
      ? ['Planning', draft ? `Started ${formatDay(order.receivedDate)} - this plan` : `${formatDay(order.receivedDate)} to ${formatDay(order.confirmedOn)}`]
      : [
      'Planning',
      draft
        ? `In planning for ${formatQty(planningDaysUsed)} working day${planningDaysUsed === 1 ? '' : 's'}${bench !== null ? ` (benchmark ${formatQty(bench)})` : ''}`
        : `Confirmed ${formatDay(order.confirmedOn)} · ${formatQty(planningDaysUsed)} working day${planningDaysUsed === 1 ? '' : 's'}${bench !== null ? ` (benchmark ${formatQty(bench)})` : ''}`,
      ],
    ['Cargo ready', `${formatDay(order.deliveryDate)} · ${DELIVERY_DATE_TYPES.find((x) => x.id === order.deliveryDateType)?.label ?? ''}`],
    ['Internal deadline', clean ? formatDay(deadline) : `${formatDay(deadline)} · ${bufferText(order.deadline)} (10%, rounded up)`],
    ...(clean ? [] : ([['Working days available', `${available} (WO date to internal deadline)`]] as [string, string][])),
    [
      'Expected finish',
      expected
        ? `${formatDay(expected)} · ${spare! >= 0 ? `${spare} working day${spare === 1 ? '' : 's'} before the internal deadline` : `${-spare!} working day${spare === -1 ? '' : 's'} AFTER the internal deadline`}`
        : clean
          ? 'To be confirmed (see open points)'
          : 'Not known yet - some steps have no time',
    ],
    ...(track && track.actual !== null ? ([['Progress', clean ? `${track.actual}% complete (planned ${track.planned}% by today)` : `${track.actual}% done · should be ${track.planned}% today`]] as [string, string][]) : []),
    ...itemOrderMeta(oplan.itemOrder, clean),
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
      title: `${line.productName} - ${qty(line.qty, line.unit)} · ${supply === 'MAKE' ? 'Make' : supply === 'BUY' ? 'Outright purchase' : 'Make or outright purchase not decided'}`,
      columns: clean
        ? [{ label: 'Step' }, { label: 'Quantity', align: 'right' }, { label: 'Start' }, { label: 'Finish' }, { label: 'Status' }]
        : [{ label: 'Step' }, { label: 'Quantity / basis' }, { label: 'Days', align: 'right' }, { label: 'Start' }, { label: 'Finish' }, { label: 'Status' }],
      rows: lp
        ? sched.map((st) => {
            const s = st.view.step;
            const name = s.key === PLANNING_KEY ? 'Planning (whole order)' : `${s.label}${s.forProduct !== line.productName ? ` (${s.forProduct})` : ''}`;
            if (clean) {
              const amount = s.qty !== null && s.qtyUnit ? qty(s.qty, s.qtyUnit) : isBuiltIn(s) ? '—' : s.processId === null ? qty(line.qty, line.unit) : '—';
              const late = st.view.overrunDays !== null && st.view.overrunDays > 0;
              const status = st.view.state === 'DONE' ? 'Done' : st.view.state === 'NOW' ? (late ? 'In progress - delayed' : 'In progress') : st.finish ? 'Planned' : 'To be confirmed';
              return [name, amount, st.start ? formatDay(st.start) : 'To be confirmed', st.finish ? formatDay(st.finish) : 'To be confirmed', status];
            }
            const basis = [s.basis, s.note].filter(Boolean).join(' · ') || (s.processId === null && !isBuiltIn(s) ? 'Purchase' : '—');
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

  // Plan by process (5 Nov 2026): the company's WO planning view - each process with the
  // items of this order it handles, one after another on its units.
  const procRows = processPlanRows(oplan);
  const procName = (id: string) => input.processes.get(id)?.name ?? 'Process';
  const deptOf = (id: string) => departmentsFor(id, input.departments ?? []).map((d) => d.name).join(', ') || '—';
  const procTable: DocTable = {
    title: 'Plan by process (items of this order share each process)',
    columns: clean
      ? [{ label: 'Process' }, { label: 'Department' }, { label: 'Items', align: 'right' }, { label: 'Quantity', align: 'right' }, { label: 'Start' }, { label: 'Finish' }]
      : [{ label: 'Process' }, { label: 'Department' }, { label: 'Items', align: 'right' }, { label: 'Quantity', align: 'right' }, { label: 'Output / day' }, { label: 'Units', align: 'right' }, { label: 'Work days', align: 'right' }, { label: 'Start' }, { label: 'Finish' }],
    rows: procRows.map((r) => {
      const name = `${procName(r.processId)}${r.done ? ' (done)' : ''}`;
      const from = r.start ? formatDay(r.start) : clean ? 'To be confirmed' : '—';
      const to = r.finish ? `${formatDay(r.finish)}${r.undated ? ` (${r.undated} item${r.undated === 1 ? '' : 's'} to be confirmed)` : ''}` : clean ? 'To be confirmed' : '—';
      return clean
        ? [name, deptOf(r.processId), String(r.items), r.qty, from, to]
        : [name, deptOf(r.processId), String(r.items), r.qty, r.rate, String(r.units), r.days === null ? 'pending' : formatQty(r.days), from, to];
    }),
    empty: 'No process steps yet.',
  };
  if (procRows.length) tables.push(procTable);

  // Materials (confirmed 27 Oct 2026): what to make (and from what), raw materials to buy for
  // production, ready-made products to buy. Since 15 Nov 2026: products in making order (base
  // mat first) and "For" = what uses the item directly.
  const matRow = (r: PlanRow, extra: string[]) => [
    `${r.name}${r.provisional && !clean ? ' *' : ''}`,
    qty(r.gross, r.unit),
    r.fromStock > 0 ? qty(r.fromStock, r.unit) : '—',
    qty(r.net, r.unit),
    ...extra,
  ];
  const nums: DocTable['columns'] = [{ label: 'Needed', align: 'right' }, { label: 'From stock', align: 'right' }];
  const forProduction = mat.toBuy.filter((r) => !r.ordered || r.usedFor.length > 0);
  const readyMade = mat.toBuy.filter((r) => r.ordered && r.usedFor.length === 0);
  tables.push(
    {
      title: 'Products to make',
      columns: [{ label: 'Item' }, ...nums, { label: 'To make', align: 'right' }, { label: 'Made from' }, { label: 'For' }],
      rows: mat.toProduce.map((r) => matRow(r, [madeFromText(r), directForText(r, orderedProductCount(jo), true)])),
      empty: 'Nothing to make.',
    },
    {
      title: 'Raw materials to buy for production',
      columns: [{ label: 'Item' }, ...nums, { label: 'To buy', align: 'right' }, { label: 'For' }, { label: 'Suppliers' }],
      rows: forProduction.map((r) => matRow(r, [directForText(r, orderedProductCount(jo)), supplierCell(input.supplierNames, r.key)])),
      empty: mat.missingLines ? 'Not calculated - BOM lines point to items not found in Masters (see open points).' : 'Nothing to buy for production.',
    },
    ...(readyMade.length
      ? [
          {
            title: 'Ready-made products to buy',
            columns: [{ label: 'Item' }, ...nums, { label: 'To buy', align: 'right' as const }, { label: 'Suppliers' }],
            rows: readyMade.map((r) => matRow(r, [supplierCell(input.supplierNames, r.key)])),
            empty: 'Nothing.',
          },
        ]
      : []),
    ...(!clean && mat.links.length
      ? [
          {
            title: 'Material calculation (BOM)',
            columns: [{ label: 'Made item' }, { label: 'To make', align: 'right' as const }, { label: 'Component' }, { label: 'Per unit', align: 'right' as const }, { label: 'Wastage', align: 'right' as const }, { label: 'Needed', align: 'right' as const }],
            rows: mat.links.map((l) => [
              l.parentName,
              qty(l.parentQty, l.parentUnit),
              `${l.childName}${l.provisional ? ' *' : ''}`,
              `${formatQty(l.perUnit)} ${unitLabel(l.childUnit)} / ${unitLabel(l.parentUnit)}`,
              l.wastagePct ? `${formatQty(l.wastagePct)}%` : '—',
              qty(l.qty, l.childUnit),
            ]),
            empty: '',
          },
        ]
      : []),
    {
      title: clean ? 'Open points' : 'Open points and risks',
      columns: [{ label: 'Point' }],
      rows: (clean ? [...new Set(points)] : risks).map((r) => [r]),
      empty: 'None found in the data available.',
    },
  );

  // Submitted plan (15 Nov 2026): what moved since the plan given to management (both versions).
  const vs = draft ? null : compareToPlan(order, oplan, cal);
  if (vs) {
    const day = (d: string | null) => (d ? formatDay(d) : 'to be confirmed');
    const rows: string[][] = [['WO ready (last item)', day(vs.base.ready), day(vs.readyNow), vs.readyDiff === null ? '-' : baselineDiffText(vs.readyDiff)]];
    for (const { line, lp } of oplan.lines) {
      for (const st of lp.schedule ?? []) {
        const p = vs.steps.get(stepKey(line.id, st.view.step.key));
        if (!p || p.diff === null || p.diff === 0 || st.view.step.key === PLANNING_KEY) continue;
        rows.push([`${line.productName} · ${st.view.step.label}`, day(p.planFinish), day(st.finish), baselineDiffText(p.diff)]);
      }
    }
    tables.splice(tables.length - 1, 0, {
      title: `Changes since the submitted plan (v${vs.base.version}, ${formatDay(vs.base.savedOn)})`,
      columns: [{ label: 'Item / step' }, { label: 'Plan' }, { label: 'Now' }, { label: 'Change' }],
      rows,
      empty: '',
    });
  }

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
        { date: order.deliveryDate, label: 'Cargo ready', color: [180, 40, 30] },
      ],
      rows: rowsTl,
    },
    tables: overview ? [overview.table, ...tables.slice(lines.length)] : tables,
    notes: clean
      ? ['Dates are in working days; Sundays and company holidays are not worked.', `Prepared from the information available on ${formatDay(today)}.`]
      : [
      'Day counts are working days. Each step starts on the day the previous one finishes; planned days = quantity / output per day + fixed days, rounded up to half a day.',
      'Items of this order share each process, first come first served (a process with several units works on that many items at once). A step starts once the previous step has one day of its work ready, unless it waits for the whole quantity. Times are worked out exactly and shown rounded up to half a day. Other orders in the same department are not counted yet (capacity across orders is not planned).',
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
