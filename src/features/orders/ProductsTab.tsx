import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder, type JoLine, type JoStep } from '../../lib/jobOrders';
import { productContext, suppliersOf, type Product, type Supplier } from '../../lib/masters';
import { firstPromise, type StepOutput } from '../../lib/jobOrders';
import { parseNum } from '../masters/fields';
import { COLLECTIONS, type Department, type MasterData, type Process } from '../../lib/masters';
import { departmentsFor, stepMessage } from '../../lib/contacts';
import { StepContacts } from '../masters/ContactButtons';
import { appendProgress, gapColor, plannedPct, trackLabel, trackOf } from '../../lib/progress';
import { addOutput, setPromise, buildLineSteps, canStart, completeCurrent, isBuiltIn, lineSchedule, MATERIALS_KEY, orderPlan, processPlanRows, orderStart, orderStepProgress, planLines, removeOutput, routeFits, startStepAt, stepDates, stepTime, undoLast, undoStartAt, unitsMap, type LineProgress, type PlanContext, type PlannedLine, type PlannedStep, type ReadyDate, type StepDate, type StepView } from '../../lib/route';
import { useProfile } from '../settings/useProfile';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { readRedAt } from '../../lib/theme';
import { istDateKey } from '../../lib/time';
import { availableUnits, convert, formatQty, unitLabel } from '../../lib/units';
import { useCollection, type WithMeta } from '../masters/useCollection';
import { saveRecord } from '../sync/records';
import { jobOrderData } from './MaterialsTab';
import { TrackBar } from './TrackBar';

/** Per-product progress: a bar like the dashboard, and every process step from first to last. */
export function ProductsTab({ jo, md, processes }: { jo: WithMeta<JobOrder>; md: MasterData; processes: Map<string, Process> }) {
  const { workspaceId } = useApp();
  const today = istDateKey(new Date());
  const editable = jo.status === 'CONFIRMED';
  const { cal } = useWorkCalendar();
  const { profile } = useProfile(workspaceId);
  const ctx: PlanContext = { md, cal, planningDays: profile?.planningDays, units: unitsMap(processes) };
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

  function saveLines(lines: JoLine[], what: string) {
    if (!workspaceId) return;
    const next = { ...jobOrderData(jo), lines };
    const p = orderStepProgress(next, today, ctx);
    const data = p ? { ...next, progress: { pct: p.actual, on: today, at: new Date().toISOString() }, progressLog: appendProgress(jo.progressLog, { pct: p.actual, on: today, at: new Date().toISOString() }) } : next;
    saveRecord({ workspaceId, collectionName: COLLECTION_JOB_ORDERS, docId: jo.id, entity: `Job Order: ${jo.joNumber}`, before: jo, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>, reason: what });
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
      <ul className="master-list">
        {jo.lines.map((l, i) => (
          <li key={l.id} id={`line-${l.id}`}>
            <LineCard jo={jo} raw={l} line={planned[i]!} lp={lpByLine.get(l.id) ?? null} ctx={ctx} today={today} editable={editable} processes={processes} departments={departments.items} suppliers={suppliers.items} onSteps={(steps, what) => saveLines(jo.lines.map((x, j) => (j === i ? { ...x, steps } : x)), what)} />
          </li>
        ))}
      </ul>
      {oplan && <ProcessPlanCard rows={processPlanRows(oplan)} processes={processes} departments={departments.items} />}
      <p className="muted small legend">
        <span>✓ done (actual / planned days)</span>
        <span>● now</span>
        <span>○ to do</span>
        <span className="warn">time pending = benchmark not known yet</span>
        <span>days and dates are working days (Sundays and company holidays left out)</span>
        <span>items of this order share each process (first come, first served); a step can start once the previous one has a day of its work ready; waiting behind other orders is not included yet</span>
      </p>
    </section>
  );
}

/** The company's WO planning view: each process with the items of this order it handles (5 Nov 2026). */
function ProcessPlanCard({ rows, processes, departments }: { rows: ReturnType<typeof processPlanRows>; processes: Map<string, Process>; departments: Department[] }) {
  if (!rows.length) return null;
  return (
    <details className="card">
      <summary>
        <strong>Plan by process</strong> <span className="muted small">{rows.length} processes · tap to show</span>
      </summary>
      <div className="table-scroll">
        <table className="small proc-plan">
          <thead>
            <tr>
              <th>Process</th>
              <th className="num">Quantity</th>
              <th>Output / day</th>
              <th className="num">Days</th>
              <th>Start → finish</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dept = departmentsFor(r.processId, departments).map((d) => d.name).join(', ');
              return (
                <tr key={r.processId}>
                  <td>
                    {processes.get(r.processId)?.name ?? 'Process'}
                    {r.done && ' ✓'}
                    <span className="muted block">
                      {r.items} item{r.items === 1 ? '' : 's'}
                      {dept && ` · ${dept}`}
                    </span>
                  </td>
                  <td className="num">{r.qty}</td>
                  <td>
                    {r.rate}
                    {r.units > 1 && <span className="muted block">× {r.units} units</span>}
                  </td>
                  <td className="num">{r.days === null ? <span className="warn">pending</span> : formatQty(r.days)}</td>
                  <td>
                    {r.start && r.finish ? `${formatDay(r.start)} → ${formatDay(r.finish)}` : <span className="warn">to be confirmed</span>}
                    {r.undated > 0 && r.start && (
                      <span className="warn block">
                        + {r.undated} item{r.undated === 1 ? '' : 's'} not dated yet (finish at the earliest)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Days = work at the planned output, on the process's parallel units (Masters → Processes). A step starts once the previous step has one day of its work ready; items are taken first come, first served (ties: in the order listed). Quantities are never added across
        units.
      </p>
    </details>
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
}) {
  const { jo, line, raw, today, editable, ctx } = props;
  const cal = ctx.cal;
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(today);
  const [outputFor, setOutputFor] = useState<string | null>(null);
  const [promiseFor, setPromiseFor] = useState<string | null>(null);
  const start = orderStart(jo);
  const lp = props.lp;
  const supply = line.supply === 'BUY' ? 'Buy' : 'Make';
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
  const followFor = (v: StepView): ReactNode => {
    const s = v.step;
    const parts: string[] = [];
    if (s.outside || (s.processId === null && !s.outsideOf && s.label === 'Ordered')) {
      const who = supplierName(s.supplierId);
      if (who) parts.push(who);
      if (s.poNo) parts.push(`PO ${s.poNo}`);
      if (s.orderedOn) parts.push(`ordered ${formatDay(s.orderedOn)}`);
      if (s.expectedOn) {
        const first = firstPromise(s);
        parts.push(`${s.outside ? 'back by' : 'expected'} ${formatDay(s.expectedOn)}${first && first !== s.expectedOn ? ` (first said ${formatDay(first)})` : ''}`);
      }
    }
    let out: string | null = null;
    if (s.outsideOf && !s.passThrough && v.state !== 'DONE') {
      const disp = rawSteps.find((x) => x.outsideOf === s.outsideOf && x.passThrough && x.label.startsWith('Dispatch'));
      const sent = (disp?.outputLog ?? []).reduce((a, e) => a + e.qty, 0);
      const back = s.outputQty ?? 0;
      if (sent > 0) out = `${formatQty(Math.max(0, sent - back))} ${unitLabel(s.qtyUnit ?? '')} still with ${supplierName(rawSteps.find((x) => x.outside && x.processId === s.outsideOf)?.supplierId) ?? 'the vendor'}`;
    }
    if (!parts.length && !out && !v.lateDays) return null;
    return (
      <>
        {parts.length > 0 && <span className="small block">{parts.join(' · ')}</span>}
        {out && <span className="small block warn">{out}</span>}
        {v.lateDays ? <span className="small block error">{formatQty(v.lateDays)} working day{v.lateDays === 1 ? '' : 's'} late · ask for a new date</span> : null}
      </>
    );
  };

  const actionsFor = (v: StepView): ReactNode => {
    if (!editable || v.state === 'DONE') return null;
    const i = keyIdx.get(v.step.key);
    if (i === undefined) return null;
    const isFirst = i === firstRaw;
    const startable = canStart(rawSteps, i);
    const prevStart = i > 0 ? (dayOfIso(rawSteps[i - 1]!.startedAt) ?? dayOfIso(rawSteps[i - 1]!.doneAt)) : null;
    const startMin = isFirst ? v.startOn : prevStart;
    const doneMin = v.startedOn ?? v.startOn;
    const isReceipt = v.step.processId === null && !isBuiltIn(v.step);
    const canOutput = (v.state === 'NOW' || v.step.startedAt || isReceipt) && v.step.qty !== null && (isReceipt || !v.step.passThrough) && v.step.label !== 'Ordered';
    const outLabel = v.step.outsideOf && v.step.passThrough && v.step.label.startsWith('Dispatch') ? '+ Dispatched' : v.step.outsideOf ? '+ Received back' : isReceipt ? '+ Received' : "+ Day's output";
    const holdsPromise = v.step.outside || (v.step.processId === null && !v.step.outsideOf && v.step.label === 'Ordered');
    const label = v.step.label;
    const btns: ReactNode[] = [];
    if (startable)
      btns.push(
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
          {promiseFor === v.step.key ? 'Close' : v.step.supplierId ? 'Supplier & dates' : v.step.outside ? '+ Vendor, PO, date' : '+ Supplier, PO, date'}
        </button>,
      );
    if (isFirst)
      btns.push(
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
    return (
      <>
        {btns.length > 0 && <span className="row gap step-actions">{btns}</span>}
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
            onRemove={(k) => window.confirm('Remove this output entry?') && props.onSteps(removeOutput(rawSteps, i, k)!, `${label}: output entry removed (${line.productName})`)}
          />
        )}
      </>
    );
  };

  // Who to ask: the department of the step running now and of the next one.
  const sched = new Map(lineSchedule(lp, today, cal).map((x) => [x.view.step.key, x.finish]));
  const nowIndex = lp.steps.findIndex((x) => x.state === 'NOW');
  const dates = stepDates(lp, today, cal, jo.deadline.internalDeadline);
  const contactFor = (v: StepView) => {
    const idx = lp.steps.indexOf(v);
    if (nowIndex < 0 || (idx !== nowIndex && idx !== nowIndex + 1)) return undefined;
    const depts = departmentsFor(v.step.processId, props.departments);
    if (!depts.length) return undefined;
    const finish = sched.get(v.step.key);
    const late = v.overrunDays !== null && v.overrunDays > 0;
    return (
      <StepContacts
        departments={depts}
        message={(person) =>
          stepMessage({
            person: person.name,
            joNumber: jo.joNumber,
            product: v.step.forProduct || line.productName,
            step: v.step.label,
            quantity: v.step.qty !== null && v.step.qtyUnit ? `${formatQty(v.step.qty)} ${unitLabel(v.step.qtyUnit)}` : null,
            plannedFinish: finish ? formatDay(finish) : null,
            late,
          })
        }
      />
    );
  };

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
          <StepRow key={v.step.key} v={v} date={dates.steps[i]!} productName={line.productName} contacts={contactFor(v)} actions={actionsFor(v)} follow={followFor(v)} />
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
              onClick={() => window.confirm('Undo the last completed step?') && props.onSteps(undoLast(raw.steps!)!, `Undo last step (${line.productName})`)}
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

const days = (n: number) => `${formatQty(n)}d`;

/** The date used by "started" / "done": today by default, or an earlier day (back-dated, confirmed 26 Oct 2026). */
function StepDate({ current, today, value, onChange }: { current: StepView; today: string; value: string; onChange: (d: string) => void }) {
  const min = current.startedOn ?? current.startOn ?? undefined;
  const bad = value > today ? 'The date cannot be in the future.' : min && value < min ? `The date cannot be before ${formatDay(min)} (when the previous step finished${current.startedOn ? ' / this step started' : ''}).` : null;
  return (
    <div className="step-date">
      <label className="small">
        Date of this update
        <input type="date" value={value} max={today} min={min} onChange={(e) => onChange(e.target.value || today)} />
      </label>
      {value !== today && !bad && <span className="muted small">Recording for {formatDay(value)} (not today).</span>}
      {bad && <span className="error small">{bad}</span>}
    </div>
  );
}

const plural = (n: number, w: string) => `${formatQty(n)} ${w}${n === 1 ? '' : 's'}`;

/** Expected date of a step (confirmed 28 Oct 2026): same dates as the plan PDF. */
function StepDateLine({ d, materials }: { d: StepDate; materials?: boolean }) {
  const tail = (approx: boolean, earliest: boolean) => (approx || earliest ? <span className="muted"> {[approx && '(approx.)', earliest && 'at the earliest'].filter(Boolean).join(' ')}</span> : null);
  switch (d.kind) {
    case 'DONE':
      return null;
    case 'DUE':
      return (
        <span className="small block">
          Expected done <strong>{formatDay(d.finish)}</strong>
          {tail(d.approx, d.earliest)}
        </span>
      );
    case 'OVER':
      return <span className="small block error">Over plan by {plural(d.overDays, 'day')} · expected done not known</span>;
    case 'PLANNED':
      return (
        <span className="small block">
          Expected{' '}
          <strong>
            {formatDay(d.start)} → {formatDay(d.finish)}
          </strong>
          {tail(d.approx, d.earliest)}
        </span>
      );
    case 'UNKNOWN':
      if (materials) return <span className="small block warn">Arrival date to be confirmed (Materials tab)</span>;
      return <span className={`small block ${d.noTime ? 'warn' : 'muted'}`}>Date to be confirmed{d.noTime ? ' (no time yet)' : ''}</span>;
  }
}

function ReadyRow({ ready: r }: { ready: ReadyDate }) {
  const why =
    r.date === null
      ? `${r.missing ?? 'A step'} has no time yet`
      : r.spareDays! < 0
        ? `${plural(-r.spareDays!, 'working day')} after the internal deadline`
        : r.spareDays === 0
          ? 'on the internal deadline'
          : `${plural(r.spareDays!, 'working day')} before the internal deadline`;
  const extra = [r.approx && r.date && 'approx.', r.earliest && r.date && 'at the earliest'].filter(Boolean).join(' · ');
  return (
    <div className={`ready-row ${r.tone}`}>
      <span className="ready-date">
        Ready <strong>{r.date ? formatDay(r.date) : 'to be confirmed'}</strong>
      </span>
      <span className="small">
        {why}
        {extra && <span className="muted"> · {extra}</span>}
      </span>
    </div>
  );
}

function StepRow({ v, date, productName, contacts, actions, follow }: { v: StepView; date: StepDate; productName: string; contacts?: ReactNode; actions?: ReactNode; follow?: ReactNode }) {
  const s = v.step;
  const sub = s.forProduct !== productName ? ` · ${s.forProduct}` : '';
  const over = v.overrunDays !== null && v.overrunDays > 0;
  const right =
    v.state === 'DONE' ? (
      <>
        {days(v.actualDays!)}
        {s.plannedDays !== null && <span className="muted"> / {days(s.plannedDays)}</span>}
        {v.overrunDays !== null && <span className={`block ${over ? 'error' : 'ok'}`}>{over ? `+${formatQty(v.overrunDays)} day${v.overrunDays === 1 ? '' : 's'}` : 'on time'}</span>}
      </>
    ) : v.state === 'NOW' ? (
      <>
        {days(v.actualDays!)}
        {s.plannedDays !== null && <span className="muted"> / {days(s.plannedDays)}</span>}
        {over && <span className="block error">overrun</span>}
      </>
    ) : s.plannedDays !== null ? (
      <span className="muted">plan {days(s.plannedDays)}</span>
    ) : (
      <span className="warn">time pending</span>
    );
  return (
    <li className={`step ${v.state.toLowerCase()}`}>
      <span className="step-dot" aria-hidden="true">
        {v.state === 'DONE' ? '✓' : ''}
      </span>
      <span className="step-body">
        <span className="step-name">
          {s.label}
          {v.state === 'NOW' && (v.queued ? ' · next' : ' · now')}
          {s.estimated && s.plannedDays !== null && v.state !== 'DONE' && <span className="pill warn"> estimate</span>}
          {(s.outside || s.outsideOf) && <span className="pill"> outside</span>}
          <span className="muted small">{sub}</span>
        </span>
        <span className="muted small block">
          {v.state === 'DONE' && v.doneOn && `Done ${formatDay(v.doneOn)}`}
          {v.state === 'NOW' && v.queued && v.startOn && `Waiting: ${s.label} is busy with other items of this order · can start ${formatDay(v.startOn)}`}
          {v.state === 'NOW' && !v.queued && v.startOn && !v.startedOn && `Since ${formatDay(v.startOn)} · ${formatQty(v.actualDays!)} working day${v.actualDays === 1 ? '' : 's'} so far`}
          {v.state === 'NOW' && v.startedOn && `Started ${formatDay(v.startedOn)} · waited ${days(v.waitDays!)} · working ${days(v.workDays!)} so far`}
          {v.state === 'DONE' && v.startedOn && ` · waited ${days(v.waitDays!)}, worked ${days(v.workDays!)}`}
        </span>
        {s.outputQty !== null && s.outputQty !== undefined && s.qty !== null && s.qtyUnit && v.state !== 'DONE' && <OutputProgress s={s} />}
        {follow}
        <StepDateLine d={date} materials={s.key === MATERIALS_KEY} />
        {s.basis && <span className="muted small block">{s.basis}</span>}
        {s.note && <span className={`small block ${s.plannedDays === null ? 'warn' : 'muted'}`}>{s.note}</span>}
        {contacts}
        {actions}
      </span>
      <span className="step-time mono small">{right}</span>
    </li>
  );
}

/** Change the steps still to do, for this order only (product routes stay as they are). */
function StepEditor({ steps, processes, productName, onSave }: { steps: JoStep[]; processes: Map<string, Process>; productName: string; onSave: (s: JoStep[]) => void }) {
  const [draft, setDraft] = useState(steps);
  const firstTodo = draft.findIndex((s) => !s.doneAt);
  const canEdit = (i: number) => firstTodo >= 0 && i >= firstTodo;
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (!canEdit(i) || !canEdit(j) || j >= draft.length) return;
    const n = [...draft];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setDraft(n);
  };
  const options = [...processes.entries()].filter(([, p]) => p.active !== false).sort((a, b) => a[1].name.localeCompare(b[1].name));
  return (
    <div className="card subtle step-editor">
      <p className="small">Steps still to do on this order. Done steps cannot be changed here (use Undo).</p>
      <ol className="route-list">
        {draft.map((s, i) => (
          <li key={s.key} className="route-row row between">
            <span className={s.doneAt ? 'muted' : ''}>
              {i + 1}. {s.label}
              {s.doneAt && ' ✓'}
            </span>
            {canEdit(i) && (
              <span className="row gap">
                <button type="button" className="secondary small icon" aria-label="Move up" disabled={!canEdit(i - 1)} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="secondary small icon" aria-label="Move down" disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="secondary small icon" aria-label={`Remove ${s.label}`} onClick={() => setDraft(draft.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <label>
        Add a step at the end
        <select
          value=""
          onChange={(e) => {
            const p = processes.get(e.target.value);
            if (p) setDraft([...draft, { key: `x${Date.now().toString(36)}`, processId: e.target.value, label: p.name, forProduct: productName, productId: null, perDay: null, perDayUnit: null, fixedDays: null, doneAt: null }]);
          }}
        >
          <option value="">— choose a process —</option>
          {options.map(([id, p]) => (
            <option key={id} value={id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="primary small" disabled={JSON.stringify(draft) === JSON.stringify(steps)} onClick={() => onSave(draft)}>
        Save steps
      </button>
    </div>
  );
}

/** Output recorded so far on a running step (5 Nov 2026). */
function OutputProgress({ s }: { s: PlannedStep }) {
  const pct = Math.min(100, Math.round((s.outputQty! / s.qty!) * 100));
  const daysLogged = new Set((s.outputLog ?? []).map((e) => e.on)).size;
  const avg = daysLogged ? s.outputQty! / daysLogged : null;
  const behind = avg !== null && s.perDay !== null && s.perDayUnit === s.qtyUnit && avg < s.perDay;
  return (
    <span className="small block output-progress">
      <span className="output-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="mono">
        {formatQty(s.outputQty!)} of {formatQty(s.qty!)} {unitLabel(s.qtyUnit!)} ({pct}%)
      </span>
      {avg !== null && s.perDay !== null && s.perDayUnit === s.qtyUnit && (
        <span className={`block ${behind ? 'warn' : 'muted'}`}>
          {daysLogged === 1 ? "Day's output" : `Average of ${daysLogged} days`} {formatQty(avg)} {unitLabel(s.qtyUnit!)} · plan {formatQty(s.perDay)} per day
        </span>
      )}
    </span>
  );
}

/** Record one day's output of a step (mockup B, confirmed 5 Nov 2026). The app never marks a step done by itself. */
function OutputForm(props: { step: PlannedStep; product: Product | undefined; today: string; onAdd: (e: StepOutput) => void; onRemove: (k: number) => void }) {
  const { step, product, today } = props;
  const units = [...new Set([step.qtyUnit, ...(product ? availableUnits(productContext(product)) : [])].filter((u): u is string => !!u))];
  const [on, setOn] = useState(today);
  const [qtyText, setQtyText] = useState('');
  const [unit, setUnit] = useState(units[0] ?? 'pcs');
  const [note, setNote] = useState('');
  const qty = parseNum(qtyText);
  const conv = qty !== null && step.qtyUnit && unit !== step.qtyUnit && product ? convert(qty, unit, step.qtyUnit, productContext(product)) : null;
  const bad = on > today ? 'The date cannot be in the future.' : qtyText && (qty === null || !(qty > 0)) ? 'Enter a quantity above 0.' : conv && !conv.ok ? 'Conversion needed for this unit' : null;
  return (
    <div className="card subtle output-form">
      <label className="small">
        Date of this output
        <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value || today)} />
      </label>
      <div className="qty-unit">
        <label>
          Quantity made
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
        </label>
        <label>
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {conv && conv.ok && (
        <span className="muted small">
          = {formatQty(conv.value)} {unitLabel(step.qtyUnit!)}
        </span>
      )}
      <label className="small">
        Note (optional)
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>
      {bad && <p className="error small">{bad}</p>}
      <button
        type="button"
        className="primary small"
        disabled={!!bad || qty === null || !(qty > 0)}
        onClick={() => {
          // Stored in the step's unit when it converts, so totals add up simply.
          const entry: StepOutput = conv && conv.ok ? { on, qty: conv.value, unit: step.qtyUnit!, at: new Date().toISOString() } : { on, qty: qty!, unit, at: new Date().toISOString() };
          props.onAdd(note.trim() ? { ...entry, note: note.trim() } : entry);
          setQtyText('');
          setNote('');
        }}
      >
        Save output
      </button>
      {(step.outputLog ?? []).length > 0 && (
        <ul className="plain-list small">
          {step.outputLog!.map((e, k) => (
            <li key={`${e.on}-${e.at}`} className="row between">
              <span>
                {formatDay(e.on)} · <span className="mono">{formatQty(e.qty)} {unitLabel(e.unit)}</span>
                {e.note && <span className="muted"> · {e.note}</span>}
              </span>
              <button type="button" className="secondary small icon" aria-label="Remove this entry" onClick={() => props.onRemove(k)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">The figures feed the KPIs. A benchmark change is only suggested after enough steps, never applied by itself.</p>
    </div>
  );
}

/** Supplier / vendor, PO and dates (mockup B, confirmed 5 Nov 2026). Prices are never asked. */
function PromiseEditor(props: { step: JoStep; outside: boolean; suppliers: (Supplier & { id: string })[]; today: string; onSave: (p: { supplierId: string | null; poNo: string; orderedOn: string | null; expectedOn: string | null }, what: string) => void }) {
  const { step, outside, today } = props;
  const [supplierId, setSupplierId] = useState(step.supplierId ?? '');
  const [poNo, setPoNo] = useState(step.poNo ?? '');
  const [orderedOn, setOrderedOn] = useState(step.orderedOn ?? (step.label === 'Ordered' && step.doneAt ? istDateKey(new Date(step.doneAt)) : ''));
  const [expectedOn, setExpectedOn] = useState(step.expectedOn ?? '');
  const bad = orderedOn && orderedOn > today ? 'The order date cannot be in the future.' : expectedOn && orderedOn && expectedOn < orderedOn ? 'The expected date is before the order date.' : null;
  const first = firstPromise(step);
  return (
    <div className="card subtle output-form">
      <label className="small">
        {outside ? 'Vendor (job work)' : 'Supplier'}
        <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">— not set —</option>
          {props.suppliers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {outside && x.jobWork ? ' · job work' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="small">
        PO number (optional)
        <input value={poNo} maxLength={40} onChange={(e) => setPoNo(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="small">
          {outside ? 'PO / sent on' : 'Ordered on'}
          <input type="date" value={orderedOn} max={today} onChange={(e) => setOrderedOn(e.target.value)} />
        </label>
        <label className="small">
          {outside ? 'Vendor says: all back by' : 'Supplier says: by'}
          <input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} />
        </label>
      </div>
      {first && step.expectedOn && expectedOn && expectedOn !== step.expectedOn && <span className="muted small">The earlier date ({formatDay(step.expectedOn)}) stays in the history{first !== step.expectedOn ? `; first promised ${formatDay(first)}` : ''}.</span>}
      {bad && <p className="error small">{bad}</p>}
      <button
        type="button"
        className="primary small"
        disabled={!!bad}
        onClick={() => {
          const what = [supplierId !== (step.supplierId ?? '') && (supplierId ? 'supplier set' : 'supplier cleared'), poNo !== (step.poNo ?? '') && `PO ${poNo || 'cleared'}`, expectedOn !== (step.expectedOn ?? '') && (expectedOn ? `expected ${formatDay(expectedOn)}` : 'expected date cleared'), orderedOn !== (step.orderedOn ?? '') && orderedOn && `ordered ${formatDay(orderedOn)}`].filter(Boolean).join(', ') || 'details saved';
          props.onSave({ supplierId: supplierId || null, poNo: poNo.trim(), orderedOn: orderedOn || null, expectedOn: expectedOn || null }, what);
        }}
      >
        Save
      </button>
    </div>
  );
}
