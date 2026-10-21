import { useState, type ReactNode } from 'react';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder, type JoLine, type JoStep } from '../../lib/jobOrders';
import { COLLECTIONS, type Department, type MasterData, type Process } from '../../lib/masters';
import { departmentsFor, stepMessage } from '../../lib/contacts';
import { StepContacts } from '../masters/ContactButtons';
import { appendProgress, gapColor, plannedPct, trackLabel, trackOf } from '../../lib/progress';
import { buildLineSteps, completeCurrent, lineProgress, lineSchedule, orderStart, orderStepProgress, planLines, routeFits, undoLast, withPlanning, type PlanContext, type PlannedLine, type StepView } from '../../lib/route';
import { useProfile } from '../settings/useProfile';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { readRedAt } from '../../lib/theme';
import { istDateKey } from '../../lib/time';
import { formatQty, unitLabel } from '../../lib/units';
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
  const ctx = { md, cal, planningDays: profile?.planningDays };
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const missing = jo.lines.filter((l) => !l.steps || l.steps.length === 0);
  const planned = planLines(jo, md);

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
          <li key={l.id}>
            <LineCard jo={jo} raw={l} line={planned[i]!} ctx={ctx} today={today} editable={editable} processes={processes} departments={departments.items} onSteps={(steps, what) => saveLines(jo.lines.map((x, j) => (j === i ? { ...x, steps } : x)), what)} />
          </li>
        ))}
      </ul>
      <p className="muted small legend">
        <span>✓ done (actual / planned days)</span>
        <span>● now</span>
        <span>○ to do</span>
        <span className="warn">time pending = benchmark not known yet</span>
        <span>days are working days (Sundays and company holidays left out)</span>
      </p>
    </section>
  );
}

function LineCard(props: {
  jo: JobOrder;
  raw: JoLine;
  line: PlannedLine;
  ctx: PlanContext;
  today: string;
  editable: boolean;
  processes: Map<string, Process>;
  departments: Department[];
  onSteps: (steps: JoStep[], what: string) => void;
}) {
  const { jo, line, raw, today, editable, ctx } = props;
  const cal = ctx.cal;
  const [editing, setEditing] = useState(false);
  const start = orderStart(jo);
  const lp = lineProgress(withPlanning(line.steps, jo, ctx), start, today, cal);
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
  const nextStep = current ? lp.steps[lp.steps.indexOf(current) + 1] : undefined;

  // Who to ask: the department of the step running now and of the next one.
  const sched = new Map(lineSchedule(lp, today, cal).map((x) => [x.view.step.key, x.finish]));
  const nowIndex = lp.steps.findIndex((x) => x.state === 'NOW');
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
        <span>{current ? `Now: ${current.step.label}` : 'All steps done'}</span>
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
        {lp.steps.map((v) => (
          <StepRow key={v.step.key} v={v} productName={line.productName} contacts={contactFor(v)} />
        ))}
      </ol>

      {editable && (
        <div className="row gap step-actions">
          {current && (
            <button type="button" className="primary small" onClick={() => props.onSteps(completeCurrent(raw.steps!, new Date().toISOString())!, `${current.step.label} done (${line.productName})`)}>
              {current.step.label} done{nextStep ? ` → ${nextStep.step.label}` : ''}
            </button>
          )}
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

function StepRow({ v, productName, contacts }: { v: StepView; productName: string; contacts?: ReactNode }) {
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
          {v.state === 'NOW' && ' · now'}
          <span className="muted small">{sub}</span>
        </span>
        <span className="muted small block">
          {v.state === 'DONE' && v.doneOn && `Done ${formatDay(v.doneOn)}`}
          {v.state === 'NOW' && v.startOn && `Since ${formatDay(v.startOn)} · ${formatQty(v.actualDays!)} working day${v.actualDays === 1 ? '' : 's'} so far`}
        </span>
        {s.basis && <span className="muted small block">{s.basis}</span>}
        {s.note && <span className={`small block ${s.plannedDays === null ? 'warn' : 'muted'}`}>{s.note}</span>}
        {contacts}
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
