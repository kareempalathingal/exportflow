import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder, type JoLine, type JoStep } from '../../lib/jobOrders';
import { suppliersOf, type Supplier } from '../../lib/masters';
import { firstPromise } from '../../lib/jobOrders';
import { COLLECTIONS, type Department, type MasterData, type Process } from '../../lib/masters';
import { departmentsFor, stepDelay, stepMessage } from '../../lib/contacts';
import { StepContacts } from '../masters/ContactButtons';
import { appendProgress, gapColor, plannedPct, trackLabel, trackOf } from '../../lib/progress';
import { addOutput, setPromise, buildLineSteps, canStart, completeCurrent, isBuiltIn, lineSchedule, orderPlan, processPlanRows, orderStart, orderStepProgress, planLines, removeOutput, routeFits, startStepAt, stepDates, stepTime, undoLast, undoStartAt, unitsMap, type LineProgress, type PlanContext, type PlannedLine, type StepView } from '../../lib/route';
import { useProfile } from '../settings/useProfile';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { readRedAt } from '../../lib/theme';
import { istDateKey } from '../../lib/time';
import { formatQty, unitLabel } from '../../lib/units';
import { useCollection, type WithMeta } from '../masters/useCollection';
import { saveRecord } from '../sync/records';
import { jobOrderData } from './MaterialsTab';
import { TrackBar } from './TrackBar';
import { gainText } from '../../lib/itemOrder';
import { compareToPlan, type PlanCompare } from '../../lib/baseline';
import { ItemOrderCard, ProcessPlanCard } from './ProductsCards';
import { OutputForm, PromiseEditor, ReadyRow, StepDate, StepEditor, StepRow, planNote } from './StepParts';

/** Per-product progress: a bar like the dashboard, and every process step from first to last. */
export function ProductsTab({ jo, md, processes }: { jo: WithMeta<JobOrder>; md: MasterData; processes: Map<string, Process> }) {
  const { workspaceId } = useApp();
  const today = istDateKey(new Date());
  const editable = jo.status === 'CONFIRMED';
  const { cal } = useWorkCalendar();
  const { profile } = useProfile(workspaceId);
  const ctx: PlanContext = { md, cal, planningDays: profile?.planningDays, materialsDays: profile?.materialsDays, purchaseDays: profile?.purchaseDays, units: unitsMap(processes) };
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const [params] = useSearchParams();
  const focusLine = params.get('line');
  // Opened from the items list at the top: bring that product into view.
  useEffect(() => {
    if (!focusLine) return;
    const t = setTimeout(() => document.getElementById(`line-${focusLine}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [focusLine]);
  const missing = jo.lines.filter((l) => !l.steps || l.steps.length === 0);
  const planned = planLines(jo, md);
  // Whole-order plan: the items share each process (5 Nov 2026).
  const oplan = jo.status === 'DRAFT' ? null : orderPlan(jo, today, ctx);
  const lpByLine = new Map((oplan?.lines ?? []).map((x) => [x.line.id, x.lp]));
  const vsPlan = oplan ? compareToPlan(jo, oplan, cal) : null;

  function saveLines(lines: JoLine[], what: string) {
    if (!workspaceId) return;
    const next = { ...jobOrderData(jo), lines };
    const p = orderStepProgress(next, today, ctx);
    const data = p ? { ...next, progress: { pct: p.actual, on: today, at: new Date().toISOString() }, progressLog: appendProgress(jo.progressLog, { pct: p.actual, on: today, at: new Date().toISOString() }) } : next;
    saveRecord({ workspaceId, collectionName: COLLECTION_JOB_ORDERS, docId: jo.id, entity: `Work Order: ${jo.joNumber}`, before: jo, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, reason: what });
  }

  function setRush(lineId: string, on: boolean) {
    const name = jo.lines.find((l) => l.id === lineId)?.productName ?? 'item';
    saveLines(
      jo.lines.map((l) => {
        if (l.id !== lineId) return l;
        const { rush: _old, ...rest } = l;
        void _old;
        return on ? { ...rest, rush: true } : rest;
      }),
      on ? `Rush on: ${name}` : `Rush off: ${name}`,
    );
  }

  function usePriority() {
    if (!workspaceId) return;
    const g = oplan ? gainText(oplan.itemOrder.gainDays) : null;
    if (!window.confirm(`Use item priority on ${jo.joNumber}?\n\nRush first, then the item with more work after the shared step. Expected dates change${g ? ` (WO ready ${g.text})` : ''}; the internal deadline stays.`)) return;
    saveRecord({ workspaceId, collectionName: COLLECTION_JOB_ORDERS, docId: jo.id, entity: `Work Order: ${jo.joNumber}`, before: jo, data: JSON.parse(JSON.stringify({ ...jobOrderData(jo), itemOrderRule: 'PRIORITY' })) as Record<string, unknown>, reason: 'Item order: switched to item priority' });
  }

  function setUp() {
    saveLines(
      jo.lines.map((l) => (l.steps && l.steps.length ? l : { ...l, steps: buildLineSteps(l, md, processes) })),
      'Process steps set up from product routes',
    );
  }

  if (jo.status === 'DRAFT') return <p className="muted">Process steps are set from each product’s route when the order is confirmed.</p>;

  return (
    <section>
      {missing.length > 0 && editable && (
        <div className="card subtle">
          <p className="small">
            {missing.length} product{missing.length === 1 ? ' has' : 's have'} no process steps on this order yet. Steps come from each product’s process route
            (Masters → product → Details).
          </p>
          <button type="button" className="secondary small" onClick={setUp}>
            Set up steps from product routes
          </button>
        </div>
      )}
      {oplan && oplan.itemOrder.items.length > 1 && <ItemOrderCard io={oplan.itemOrder} editable={editable} onRush={setRush} onUsePriority={usePriority} />}
      <ul className="master-list">
        {jo.lines.map((l, i) => (
          <li key={l.id} id={`line-${l.id}`}>
            <LineCard jo={jo} raw={l} line={planned[i]!} lp={lpByLine.get(l.id) ?? null} ctx={ctx} today={today} editable={editable} processes={processes} departments={departments.items} suppliers={suppliers.items} onSteps={(steps, what) => saveLines(jo.lines.map((x, j) => (j === i ? { ...x, steps } : x)), what)} vsPlan={vsPlan} />
          </li>
        ))}
      </ul>
      {oplan && <ProcessPlanCard rows={processPlanRows(oplan)} processes={processes} departments={departments.items} />}
      <details className="how-to-read muted small">
        <summary>How to read this</summary>
        <p className="legend">
          <span>✓ done · ● now · ○ to do; tap a step for its details and buttons</span>
          <span>right side: days taken / planned</span>
          <span className="warn">time pending = benchmark not known yet</span>
          <span>amber “plan” = later than the submitted plan</span>
          <span>days and dates are working days (Sundays and company holidays left out)</span>
          <span>items of this order share each process (when several wait for the same one: Rush first, then the item with more work left); a step can start once the previous one has a day of its work ready; waiting behind other orders is not included yet</span>
        </p>
      </details>
    </section>
  );
}

function LineCard(props: {
  jo: JobOrder;
  raw: JoLine;
  line: PlannedLine;
  lp: LineProgress | null;
  ctx: PlanContext;
  today: string;
  editable: boolean;
  processes: Map<string, Process>;
  departments: Department[];
  suppliers: (Supplier & { id: string })[];
  onSteps: (steps: JoStep[], what: string) => void;
  vsPlan: PlanCompare | null;
}) {
  const { jo, line, raw, today, editable, ctx } = props;
  const cal = ctx.cal;
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(today);
  const [outputFor, setOutputFor] = useState<string | null>(null);
  const [promiseFor, setPromiseFor] = useState<string | null>(null);
  const start = orderStart(jo);
  const lp = props.lp;
  const supply = line.supply === 'BUY' ? 'Outright purchase' : 'Make';
  const head = (
    <div className="row between">
      <span>
        <strong>{line.productName}</strong>
        <span className="muted small block">
          {formatQty(line.qty)} {unitLabel(line.unit)} · {supply}
        </span>
      </span>
    </div>
  );
  if (!lp) {
    return (
      <div className="card dashed">
        {head}
        <p className="muted small">No process steps for this product. Add a process route to the product in Masters, then set up steps here.</p>
      </div>
    );
  }
  const track = trackOf(jo, today, { actual: lp.actualPct, planned: lp.plannedPct ?? plannedPct(jo, today, cal) }, cal);
  const color = gapColor(track, readRedAt());
  const fits = routeFits(lp.plannedTotalDays, start, jo.deadline.internalDeadline, cal);
  const current = lp.current;
  // Steps the user acts on (built-in stages are worked out): the first not done, and any running with it.
  const rawSteps = raw.steps ?? [];
  const keyIdx = new Map(rawSteps.map((s, i) => [s.key, i]));
  const firstRaw = rawSteps.findIndex((s) => !s.doneAt);
  const act = firstRaw >= 0 ? lp.steps.find((v) => v.step.key === rawSteps[firstRaw]!.key) : undefined;
  const nextStep = act ? lp.steps[lp.steps.indexOf(act) + 1] : undefined;
  const running = lp.steps.filter((v) => v.state === 'NOW' && !isBuiltIn(v.step) && !v.queued);
  const nowText = running.length ? running.map((v) => v.step.label).join(' + ') : current ? current.step.label : null;
  const dayOfIso = (iso: string | null | undefined) => (iso ? istDateKey(new Date(iso)) : null);
  const product = ctx.md.products.get(line.productId);

  const supplierName = (id: string | null | undefined) => (id ? (props.suppliers.find((x) => x.id === id)?.name ?? 'supplier') : null);
  /** Supplier / vendor line and what is still out (5 Nov 2026). */
  const followFor = (v: StepView): { info: ReactNode; alert: ReactNode } => {
    const s = v.step;
    const parts: string[] = [];
    if (s.outside || (s.processId === null && !s.outsideOf && s.label === 'Ordered')) {
      const who = supplierName(s.supplierId);
      if (who) parts.push(who);
      if (s.poNo) parts.push(`${s.outside ? 'Vendor' : 'Supplier'} PO ${s.poNo}`);
      if (s.orderedOn) parts.push(`${s.outside ? 'dispatched' : 'ordered'} ${formatDay(s.orderedOn)}`);
      if (s.expectedOn) {
        const first = firstPromise(s);
        parts.push(`${s.outside ? 'all landed by' : 'expected'} ${formatDay(s.expectedOn)}${first && first !== s.expectedOn ? ` (first said ${formatDay(first)})` : ''}`);
      }
    }
    let out: string | null = null;
    if (s.outsideOf && !s.passThrough && v.state !== 'DONE') {
      const disp = rawSteps.find((x) => x.outsideOf === s.outsideOf && x.passThrough && x.label.startsWith('Dispatch'));
      const sent = (disp?.outputLog ?? []).reduce((a, e) => a + e.qty, 0);
      const back = s.outputQty ?? 0;
      if (sent > 0) out = `${formatQty(Math.max(0, sent - back))} ${unitLabel(s.qtyUnit ?? '')} still with ${supplierName(rawSteps.find((x) => x.outside && x.processId === s.outsideOf)?.supplierId) ?? 'the vendor'}`;
    }
    return {
      info: parts.length > 0 ? <span className="small block">{parts.join(' · ')}</span> : null,
      alert:
        out || v.lateDays ? (
          <>
            {out && <span className="small block warn">{out}</span>}
            {v.lateDays ? <span className="small block error">{formatQty(v.lateDays)} working day{v.lateDays === 1 ? '' : 's'} late · ask for a new date</span> : null}
          </>
        ) : null,
    };
  };

  const actionsFor = (v: StepView): { main?: ReactNode; actions?: ReactNode; forms?: ReactNode } => {
    if (!editable || v.state === 'DONE') return {};
    const i = keyIdx.get(v.step.key);
    if (i === undefined) return {};
    const isFirst = i === firstRaw;
    const startable = canStart(rawSteps, i);
    const prevStart = i > 0 ? (dayOfIso(rawSteps[i - 1]!.startedAt) ?? dayOfIso(rawSteps[i - 1]!.doneAt)) : null;
    const startMin = isFirst ? v.startOn : prevStart;
    const doneMin = v.startedOn ?? v.startOn;
    const isReceipt = v.step.processId === null && !isBuiltIn(v.step);
    const canOutput = (v.state === 'NOW' || v.step.startedAt || isReceipt) && v.step.qty !== null && (isReceipt || !v.step.passThrough) && v.step.label !== 'Ordered';
    const outLabel = v.step.outsideOf && v.step.passThrough && v.step.label.startsWith('Dispatch') ? '+ Dispatched' : v.step.outsideOf ? '+ Landed' : isReceipt ? '+ Landed' : "+ Day's output";
    const holdsPromise = v.step.outside || (v.step.processId === null && !v.step.outsideOf && v.step.label === 'Ordered');
    const label = v.step.label;
    const btns: ReactNode[] = [];
    const mainBtns: ReactNode[] = [];
    // "X started" stays in view (15 Nov 2026) on the running step not started yet and on the next
    // step: recording the start splits wait (e.g. moving goods) from work in the KPIs.
    const startInView = startable && ((v.state === 'NOW' && !v.step.startedAt) || lp.steps.indexOf(v) === nextTodo);
    if (startable)
      (startInView ? mainBtns : btns).push(
        <button key="start" type="button" className="secondary small" disabled={when > today || (startMin !== null && when < startMin)} onClick={() => props.onSteps(startStepAt(rawSteps, i, stepTime(when, today))!, `${label} started ${when === today ? 'today' : formatDay(when)} (${line.productName})`)}>
          {label} started
        </button>,
      );
    if (canOutput)
      btns.push(
        <button key="out" type="button" className="secondary small" onClick={() => setOutputFor(outputFor === v.step.key ? null : v.step.key)}>
          {outputFor === v.step.key ? 'Close' : outLabel}
        </button>,
      );
    if (holdsPromise)
      btns.push(
        <button key="prom" type="button" className="secondary small" onClick={() => setPromiseFor(promiseFor === v.step.key ? null : v.step.key)}>
          {promiseFor === v.step.key ? 'Close' : v.step.supplierId ? 'Supplier & dates' : v.step.outside ? '+ Vendor, Vendor PO, date' : '+ Supplier, Supplier PO, date'}
        </button>,
      );
    if (isFirst)
      mainBtns.push(
        <button
          key="done"
          type="button"
          className="primary small"
          disabled={when > today || (doneMin !== null && when < doneMin)}
          onClick={() => {
            props.onSteps(completeCurrent(rawSteps, stepTime(when, today))!, `${label} done ${when === today ? 'today' : formatDay(when)} (${line.productName})`);
            setWhen(today);
          }}
        >
          {label} done{nextStep ? ` → ${nextStep.step.label}` : ''}
        </button>,
      );
    else if (v.step.startedAt) btns.push(<span key="wait" className="muted small">“Done” after {rawSteps[i - 1]?.label ?? 'the step before'} is done</span>);
    if (v.step.startedAt && undoStartAt(rawSteps, i))
      btns.push(
        <button key="undo" type="button" className="secondary small" onClick={() => window.confirm(`Remove the recorded start of ${label}?`) && props.onSteps(undoStartAt(rawSteps, i)!, `Undo start of ${label} (${line.productName})`)}>
          Undo start
        </button>,
      );
    return {
      main: mainBtns.length ? <>{mainBtns}</> : null,
      actions: btns.length > 0 ? <span className="row gap step-actions">{btns}</span> : null,
      forms: (
      <>
        {promiseFor === v.step.key && (
          <PromiseEditor
            step={rawSteps[i]!}
            outside={!!v.step.outside}
            suppliers={v.step.outside ? [...props.suppliers].sort((a, b) => Number(!!b.jobWork) - Number(!!a.jobWork) || a.name.localeCompare(b.name)) : (() => {
              const linked = suppliersOf(`PRODUCT:${line.productId}`, props.suppliers);
              return [...linked, ...props.suppliers.filter((x) => !linked.includes(x)).sort((a, b) => a.name.localeCompare(b.name))];
            })()}
            today={today}
            onSave={(p, what) => {
              props.onSteps(setPromise(rawSteps, i, p, new Date().toISOString())!, `${label}: ${what} (${line.productName})`);
              setPromiseFor(null);
            }}
          />
        )}
        {outputFor === v.step.key && (
          <OutputForm
            step={v.step}
            product={product}
            today={today}
            onAdd={(entry) => {
              const next = addOutput(rawSteps, i, entry);
              if (!next) return;
              const total = (v.step.outputQty ?? 0) + (entry.unit === v.step.qtyUnit ? entry.qty : 0);
              const whole = v.step.qty !== null && entry.unit === v.step.qtyUnit && total >= v.step.qty - 1e-9;
              if (whole && isFirst && window.confirm(`Whole quantity ${isReceipt ? 'in' : 'made'}: mark ${label} done?`)) props.onSteps(completeCurrent(next, stepTime(entry.on, today))!, `${label}: ${formatQty(entry.qty)} ${unitLabel(entry.unit)} on ${formatDay(entry.on)}; done (${line.productName})`);
              else props.onSteps(next, `${label}: ${formatQty(entry.qty)} ${unitLabel(entry.unit)} on ${formatDay(entry.on)} (${line.productName})`);
            }}
            onRemove={(k) => window.confirm(`Remove this ${label} entry?`) && props.onSteps(removeOutput(rawSteps, i, k)!, `${label}: output entry removed (${line.productName})`)}
          />
        )}
      </>
      ),
    };
  };

  // Who to ask (5 Nov 2026): the department of every step running now and of
  // the next step to do; the delay goes into the message.
  const sched = new Map(lineSchedule(lp, today, cal).map((x) => [x.view.step.key, x.finish]));
  const lastNow = lp.steps.map((x) => x.state).lastIndexOf('NOW');
  const nextTodo = lp.steps.findIndex((x, j) => j > lastNow && x.state === 'TODO' && !isBuiltIn(x.step));
  const dates = stepDates(lp, today, cal, jo.deadline.internalDeadline);
  const contactFor = (v: StepView) => {
    const idx = lp.steps.indexOf(v);
    if (lastNow < 0 || !(v.state === 'NOW' || idx === nextTodo)) return undefined;
    const pid = v.step.processId ?? v.step.outsideOf ?? null;
    if (!pid) return undefined;
    const depts = departmentsFor(pid, props.departments);
    const finish = sched.get(v.step.key);
    const delay = v.state === 'NOW' ? stepDelay(v) : null;
    return (
      <StepContacts
        departments={depts}
        processId={pid}
        message={(person) =>
          stepMessage({
            person: person.name,
            joNumber: jo.joNumber,
            product: v.step.forProduct || line.productName,
            step: v.step.label,
            quantity: v.step.qty !== null && v.step.qtyUnit ? `${formatQty(v.step.qty)} ${unitLabel(v.step.qtyUnit)}` : null,
            plannedFinish: finish ? formatDay(finish) : null,
            delay,
          })
        }
      />
    );
  };

  // A delayed step keeps its contact buttons in view (15 Nov 2026); others open on tap.
  const delayed = (v: StepView, d: { kind: string }) => v.state === 'NOW' && ((v.overrunDays ?? 0) > 0 || (v.lateDays ?? 0) > 0 || d.kind === 'OVER' || stepDelay(v) !== null);

  return (
    <div className="card edge" style={{ ['--edge' as string]: color }}>
      <div className="row between">
        <span>
          <strong>{line.productName}</strong>
          <span className="muted small block">
            {formatQty(line.qty)} {unitLabel(line.unit)} · {supply}
          </span>
        </span>
        <span className="track-label">
          <span className="dot" style={{ background: color }} aria-hidden="true" />
          {lp.done ? 'Done' : trackLabel(track)}
        </span>
      </div>
      <TrackBar track={track} color={color} />
      <div className="row between small">
        <span>Is {lp.actualPct}%</span>
        <span>Should be {track.planned}%</span>
        <span>{nowText ? `Now: ${nowText}` : 'All steps done'}</span>
      </div>
      {lp.plannedPct === null && <p className="muted small">Some steps have no planned time yet, so “should be” follows the deadline.</p>}
      {lp.expectedFinish && !lp.done && (
        <p className="small">
          Expected to finish <strong>{formatDay(lp.expectedFinish)}</strong>
          <span className="muted"> · internal deadline {formatDay(jo.deadline.internalDeadline)}</span>
        </p>
      )}
      {fits === false && (
        <p className="error small">
          Planned steps take {lp.plannedTotalDays} working days — more than the working days to the internal deadline.
        </p>
      )}

      <ol className="stepper">
        {lp.steps.map((v, i) => (
          <StepRow key={v.step.key} v={v} date={dates.steps[i]!} productName={line.productName} parts={{ ...actionsFor(v), ...followFor(v), contacts: contactFor(v), contactsOpen: delayed(v, dates.steps[i]!), plan: props.vsPlan ? planNote(props.vsPlan, line.id, v) : null }} />
        ))}
      </ol>
      {dates.ready && <ReadyRow ready={dates.ready} />}

      {editable && act && <StepDate current={act} today={today} value={when} onChange={setWhen} />}
      {editable && (
        <div className="row gap step-actions">
          {lp.steps.some((s) => s.state === 'DONE') && (
            <button
              type="button"
              className="secondary small"
              onClick={() => window.confirm(`Undo the last done step of ${line.productName}?`) && props.onSteps(undoLast(raw.steps!)!, `Undo last step (${line.productName})`)}
            >
              Undo last
            </button>
          )}
          <button type="button" className="secondary small" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Close' : 'Edit steps'}
          </button>
        </div>
      )}
      {editing && <StepEditor steps={raw.steps!} processes={props.processes} productName={line.productName} onSave={(s) => props.onSteps(s, `Steps changed for this order (${line.productName})`)} />}
    </div>
  );
}
