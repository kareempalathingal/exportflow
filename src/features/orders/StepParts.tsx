/** Step rows, dates and forms of the WO Products tab (split out of ProductsTab.tsx, 15 Nov 2026). */
import { useState, type ReactNode } from 'react';
import { formatDay, type JoStep } from '../../lib/jobOrders';
import { productContext, type Product, type Supplier } from '../../lib/masters';
import { firstPromise, type StepOutput } from '../../lib/jobOrders';
import { parseNum } from '../masters/fields';
import { type Process } from '../../lib/masters';
import { hoursText, isBuiltIn, MATERIALS_KEY, type PlannedStep, type ReadyDate, type StepDate, type StepView } from '../../lib/route';
import { istDateKey } from '../../lib/time';
import { availableUnits, convert, formatQty, unitLabel } from '../../lib/units';
import { stepKey, type PlanCompare } from '../../lib/baseline';

export const days = (n: number) => `${formatQty(n)}d`;

/** The date used by "started" / "done": today by default, or an earlier day (back-dated, confirmed 26 Oct 2026). */
export function StepDate({ current, today, value, onChange }: { current: StepView; today: string; value: string; onChange: (d: string) => void }) {
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

export const plural = (n: number, w: string) => `${formatQty(n)} ${w}${n === 1 ? '' : 's'}`;

/** Expected date of a step (confirmed 28 Oct 2026): same dates as the plan PDF. */
export function StepDateLine({ d, materials }: { d: StepDate; materials?: boolean }) {
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

export function ReadyRow({ ready: r }: { ready: ReadyDate }) {
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

/** "· plan 26 Sep (+2)" under a step, against the submitted plan (15 Nov 2026). */
/** Submitted-plan note of a step (15 Nov 2026): `late` = finishes after the submitted plan (shown as a pill on the row). */
export function planNote(c: PlanCompare, lineId: string, v: StepView): { late: boolean; pill: ReactNode; detail: ReactNode } | null {
  if (isBuiltIn(v.step) && v.step.key !== MATERIALS_KEY) return null;
  const p = c.steps.get(stepKey(lineId, v.step.key));
  if (!p) return { late: false, pill: null, detail: <span className="muted small block">Not in the submitted plan (v{c.base.version})</span> };
  if (!p.planFinish) return { late: false, pill: null, detail: <span className="muted small block">Submitted plan: date to be confirmed</span> };
  const range = v.state === 'TODO' && p.planStart && p.planStart !== p.planFinish ? `${formatDay(p.planStart)} → ${formatDay(p.planFinish)}` : formatDay(p.planFinish);
  const late = p.diff !== null && p.diff > 0;
  const diff = p.diff !== null && p.diff !== 0 ? ` (${p.diff > 0 ? '+' : '−'}${Math.abs(p.diff)})` : p.diff === 0 ? ' (same)' : '';
  return {
    late,
    pill: late ? <span className="pill warn">plan {formatDay(p.planFinish)}{diff}</span> : null,
    detail: <span className={`small block ${late ? 'warn' : 'muted'}`}>Plan {range}{diff}</span>,
  };
}

/** What one step row shows (15 Nov 2026, compact rows): `alert` always, `main` (the "done" button) always, the rest on tap. */
export interface StepRowParts {
  contacts?: ReactNode;
  /** Shown without a tap (a delayed step: who to ask matters now). */
  contactsOpen?: boolean;
  main?: ReactNode;
  actions?: ReactNode;
  /** Forms opened from the actions (kept open with the row). */
  forms?: ReactNode;
  info?: ReactNode;
  alert?: ReactNode;
  plan?: { late: boolean; pill: ReactNode; detail: ReactNode } | null;
  /** Working hours per day (display only; undefined = default, null = not shown). */
  workHours?: number | null;
}

/**
 * One step, compact (15 Nov 2026): name, one date line and any warning; details (basis,
 * waited / worked, output, supplier, submitted plan, contacts, other buttons) open on tap.
 */
export function StepRow({ v, date, productName, parts }: { v: StepView; date: StepDate; productName: string; parts: StepRowParts }) {
  const [open, setOpen] = useState(false);
  const s = v.step;
  const sub = s.forProduct !== productName ? ` · ${s.forProduct}` : '';
  const over = v.overrunDays !== null && v.overrunDays > 0;
  const right =
    v.state === 'DONE' ? (
      <>
        {days(v.actualDays!)}
        {s.plannedDays !== null && <span className="muted"> / {days(s.plannedDays)}</span>}
        {over && <span className="block error">+{formatQty(v.overrunDays!)}d</span>}
      </>
    ) : v.state === 'NOW' ? (
      <>
        {days(v.actualDays!)}
        {s.plannedDays !== null && <span className="muted"> / {days(s.plannedDays)}</span>}
        {over && <span className="block error">overrun</span>}
      </>
    ) : s.plannedDays !== null ? (
      <span className="muted">{days(s.plannedDays)}</span>
    ) : (
      <span className="warn">time pending</span>
    );
  const details = (
    <>
      {v.state === 'DONE' && v.overrunDays !== null && <span className={`small block ${over ? 'error' : 'ok'}`}>{over ? `${formatQty(v.overrunDays)} day${v.overrunDays === 1 ? '' : 's'} over the planned time` : 'On time'}</span>}
      {v.state === 'NOW' && !v.queued && v.startOn && !v.startedOn && <span className="muted small block">Since {formatDay(v.startOn)} · {formatQty(v.actualDays!)} working day{v.actualDays === 1 ? '' : 's'} so far</span>}
      {v.state === 'NOW' && v.startedOn && <span className="muted small block">Started {formatDay(v.startedOn)} · waited {days(v.waitDays!)} · working {days(v.workDays!)} so far</span>}
      {v.state === 'DONE' && v.startedOn && <span className="muted small block">Waited {days(v.waitDays!)}, worked {days(v.workDays!)}</span>}
      {s.outputQty !== null && s.outputQty !== undefined && s.qty !== null && s.qtyUnit && v.state !== 'DONE' && <OutputProgress s={s} />}
      {parts.info}
      {parts.plan?.detail}
      {s.basis && (
        <span className="muted small block">
          {s.basis}
          {hoursText(s.workDays ?? s.plannedDays, { workHours: parts.workHours }) && ` · ${hoursText(s.workDays ?? s.plannedDays, { workHours: parts.workHours })}`}
        </span>
      )}
      {s.note && <span className={`small block ${s.plannedDays === null ? 'warn' : 'muted'}`}>{s.note}</span>}
      {!parts.contactsOpen && parts.contacts}
      {parts.actions}
    </>
  );
  return (
    <li className={`step ${v.state.toLowerCase()}${open ? ' open' : ''}`}>
      <span className="step-dot" aria-hidden="true">
        {v.state === 'DONE' ? '✓' : ''}
      </span>
      <span className="step-body">
        <span className="step-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((o) => !o)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen((o) => !o))}>
          <span className="step-name">
            {s.label}
            {v.state === 'NOW' && (v.queued ? ' · next' : ' · now')}
            {s.estimated && s.plannedDays !== null && v.state !== 'DONE' && <span className="pill warn"> estimate</span>}
            {(s.outside || s.outsideOf) && <span className="pill"> outside</span>}
            {parts.plan?.pill}
            <span className="muted small">{sub}</span>
            <span className="step-more muted small" aria-hidden="true">
              {open ? ' ▴' : ' ▾'}
            </span>
          </span>
          {v.state === 'DONE' && v.doneOn && <span className="muted small block">Done {formatDay(v.doneOn)}</span>}
          {v.state === 'NOW' && v.queued && v.startOn && <span className="small block warn">Waiting: {s.label} is busy with other items of this order · can start {formatDay(v.startOn)}</span>}
          <StepDateLine d={date} materials={s.key === MATERIALS_KEY} />
        </span>
        {parts.alert}
        {parts.contactsOpen && parts.contacts}
        <span className="step-details" hidden={!open}>
          {details}
        </span>
        {parts.main && <span className="row gap step-actions">{parts.main}</span>}
        {parts.forms}
      </span>
      <span className="step-time mono small">{right}</span>
    </li>
  );
}

/** Change the steps still to do, for this order only (product routes stay as they are). */
export function StepEditor({ steps, processes, productName, onSave }: { steps: JoStep[]; processes: Map<string, Process>; productName: string; onSave: (s: JoStep[]) => void }) {
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
export function OutputProgress({ s }: { s: PlannedStep }) {
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
export function OutputForm(props: { step: PlannedStep; product: Product | undefined; today: string; onAdd: (e: StepOutput) => void; onRemove: (k: number) => void }) {
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
export function PromiseEditor(props: { step: JoStep; outside: boolean; suppliers: (Supplier & { id: string })[]; today: string; onSave: (p: { supplierId: string | null; poNo: string; orderedOn: string | null; expectedOn: string | null }, what: string) => void }) {
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
        {outside ? 'Vendor PO No. (optional)' : 'Supplier PO No. (optional)'}
        <input value={poNo} maxLength={40} onChange={(e) => setPoNo(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="small">
          {outside ? 'Vendor PO / dispatched on' : 'Ordered on'}
          <input type="date" value={orderedOn} max={today} onChange={(e) => setOrderedOn(e.target.value)} />
        </label>
        <label className="small">
          {outside ? 'Vendor says: all landed by' : 'Supplier says: by'}
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
          const what = [supplierId !== (step.supplierId ?? '') && (supplierId ? 'supplier set' : 'supplier cleared'), poNo !== (step.poNo ?? '') && `${outside ? 'Vendor' : 'Supplier'} PO ${poNo || 'cleared'}`, expectedOn !== (step.expectedOn ?? '') && (expectedOn ? `expected ${formatDay(expectedOn)}` : 'expected date cleared'), orderedOn !== (step.orderedOn ?? '') && orderedOn && `ordered ${formatDay(orderedOn)}`].filter(Boolean).join(', ') || 'details saved';
          props.onSave({ supplierId: supplierId || null, poNo: poNo.trim(), orderedOn: orderedOn || null, expectedOn: expectedOn || null }, what);
        }}
      >
        Save
      </button>
    </div>
  );
}
