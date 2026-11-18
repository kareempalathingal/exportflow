import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { daysBetween, formatDay, type JobOrder } from '../../lib/jobOrders';
import type { Department } from '../../lib/masters';
import { DUE_KIND_LABEL, isSamplingWo, LINK_LABEL, milestonesFor, milestoneSummary, PHASE_LABEL, withDue, type DueKind, type FlowPhase, type Milestone, type MilestoneView, type OrderFlow } from '../../lib/milestones';
import { newExtraId } from '../../lib/orderExtras';
import { istDateKey } from '../../lib/time';
import type { WithMeta } from '../masters/useCollection';
import { ruleText } from '../settings/OrderFlowCard';
import { usePlanContext } from '../settings/usePlanContext';
import { saveJoFields } from './stepSave';

const STATE_PILL: Record<MilestoneView['state'], string> = { DONE: 'ok', NOT_NEEDED: '', LATE: 'bad', OPEN: '', NO_DATE: 'warn' };

function stateText(v: MilestoneView, today: string): string {
  if (v.state === 'DONE') return v.doneOn ? `Done ${formatDay(v.doneOn)}` : 'Done';
  if (v.state === 'NOT_NEEDED') return 'Not needed';
  if (v.state === 'NO_DATE') return 'Date to be set';
  if (v.state === 'LATE') {
    const n = daysBetween(v.due!, today) ?? 0;
    return `${n} day${n === 1 ? '' : 's'} late`;
  }
  return v.due === today ? 'Due today' : `Due ${formatDay(v.due!)}`;
}

/**
 * WO "Milestones" tab (18 Nov 2026): the order flow before and after production. Linked milestones are
 * filled from the WO's own data; the others are recorded here. The app never approves anything itself.
 */
export function MilestonesTab({ jo, flow, allJos, departments, editable }: { jo: WithMeta<JobOrder>; flow: OrderFlow; allJos: (JobOrder & { id: string })[]; departments: (Department & { id: string })[]; editable: boolean }) {
  const { workspaceId } = useApp();
  const { ctx } = usePlanContext();
  const today = istDateKey(new Date());
  const [edit, setEdit] = useState<string | null>(null);
  const [adding, setAdding] = useState<FlowPhase | null>(null);
  const sampling = isSamplingWo(jo);
  const list = jo.milestones ?? [];
  const deptName = (id: string | null | undefined) => (id ? departments.find((d) => d.id === id)?.name : null);
  const save = (next: Milestone[], what: string) => saveJoFields(workspaceId, jo, { milestones: next }, what);

  if (!jo.milestones) {
    const preview = milestonesFor(flow, sampling);
    return (
      <div className="card">
        <h3>Milestones</h3>
        {jo.status === 'DRAFT' ? (
          <p className="muted small">The milestones of Settings → Order flow are copied to this WO when it is confirmed{sampling ? ' (sampling WO: no "Samples approved" and nothing after production)' : ''}:</p>
        ) : (
          <p className="muted small">This WO was confirmed before milestones existed.</p>
        )}
        {(['BEFORE', 'AFTER'] as const).map((ph) => {
          const names = preview.filter((m) => m.phase === ph).map((m) => m.name);
          return names.length ? (
            <p key={ph} className="small">
              <strong>{PHASE_LABEL[ph]}:</strong> {names.join(' · ')}
            </p>
          ) : null;
        })}
        {jo.status !== 'DRAFT' && editable && (
          <button type="button" className="primary small" onClick={() => save(preview, 'Milestones set up from the order flow')}>
            Set up milestones from the order flow
          </button>
        )}
        <p className="muted small">
          <Link to="/settings">Settings → Order flow</Link> holds the standard list.
        </p>
      </div>
    );
  }

  const sum = milestoneSummary(jo, today, ctx);
  const update = (m: Milestone, what: string) => (save(list.map((x) => (x.id === m.id ? m : x)), `${m.name}: ${what}`), setEdit(null));

  const row = (v: MilestoneView) => {
    const m = v.m;
    return (
      <li key={m.id} className="extra-row">
        <div className="row between">
          <strong className={v.state === 'NOT_NEEDED' ? 'muted' : ''}>{m.name}</strong>
          <span className={`pill ${STATE_PILL[v.state]}`}>{stateText(v, today)}</span>
        </div>
        <div className="small muted">
          {[v.state === 'DONE' && v.due ? `due ${formatDay(v.due)}` : null, m.due ? 'date set on this WO' : ruleText(m), deptName(m.departmentId), v.auto, m.approvedBy && `approved by ${m.approvedBy}`, m.samplingWos?.length && `sampling WO ${m.samplingWos.map((s) => s.joNumber).join(', ')}`].filter(Boolean).join(' · ')}
        </div>
        {m.note && <div className="small">{m.note}</div>}
        {editable && edit !== m.id && (
          <div className="row gap">
            {v.state !== 'DONE' && v.state !== 'NOT_NEEDED' && m.link !== 'SAMPLES' && (
              <button type="button" className="secondary small" onClick={() => (m.phase !== 'AFTER' || sum.facts.productionDone || window.confirm(`Production is not finished yet. Mark ${m.name} done today anyway?`)) && update({ ...m, doneOn: today }, 'done today')}>
                Done today
              </button>
            )}
            <button type="button" className="secondary small" onClick={() => setEdit(m.id)}>
              {m.link === 'SAMPLES' && v.state !== 'DONE' ? 'Record approval' : 'Edit'}
            </button>
          </div>
        )}
        {edit === m.id && (
          <MilestoneForm
            value={m}
            jo={jo}
            allJos={allJos}
            departments={departments}
            today={today}
            productionDone={sum.facts.productionDone}
            onCancel={() => setEdit(null)}
            onSave={(next, what) => update(next, what)}
            onRemove={() => window.confirm(`Remove "${m.name}" from this WO?`) && (save(list.filter((x) => x.id !== m.id), `${m.name}: removed`), setEdit(null))}
          />
        )}
      </li>
    );
  };

  const phase = (ph: FlowPhase, n: number, views: MilestoneView[]) => (
    <div className="card">
      <h3>
        {n} · {PHASE_LABEL[ph]} <span className="muted small">{views.filter((v) => v.state === 'DONE').length} of {views.filter((v) => v.state !== 'NOT_NEEDED').length} done</span>
      </h3>
      {views.length === 0 && <p className="muted small">No milestones yet.</p>}
      <ul className="plain-list">{views.map(row)}</ul>
      {editable && adding !== ph && (
        <button type="button" className="secondary small" onClick={() => setAdding(ph)}>
          + Add milestone
        </button>
      )}
      {adding === ph && (
        <MilestoneForm
          value={{ id: newExtraId(), name: '', phase: ph }}
          jo={jo}
          allJos={allJos}
          departments={departments}
          today={today}
          productionDone={sum.facts.productionDone}
          onCancel={() => setAdding(null)}
          onSave={(m) => (save([...list, m], `${m.name}: added`), setAdding(null))}
        />
      )}
    </div>
  );

  const f = sum.facts;
  return (
    <>
      <div className="card">
        <div className="row between">
          <h3>Milestones</h3>
          <span className={`pill ${sum.late ? 'bad' : sum.done === sum.total && sum.total ? 'ok' : ''}`}>
            {sum.done} of {sum.total} done{sum.late ? ` · ${sum.late} late` : ''}
          </span>
        </div>
        {sampling && <p className="muted small">Sampling WO: no milestones after production.</p>}
      </div>
      {phase('BEFORE', 1, sum.before)}
      <div className="card">
        <h3>
          2 · {PHASE_LABEL.PRODUCTION} <span className="muted small">{f.productionPct}%</span>
        </h3>
        <div className="trackbar" aria-label={`Production ${f.productionPct}% done`}>
          <div className="trackbar-fill" style={{ width: `${f.productionPct}%`, background: 'var(--brand)' }} />
        </div>
        <p className="small muted">
          {f.productionDone ? `All products done ${formatDay(f.productionDone)}` : f.productionReady ? `Production ready ${formatDay(f.productionReady)} (expected)` : 'Production ready: date to be confirmed'}
          {' · '}
          <Link to={`/orders/${jo.id}?tab=products`}>Products tab</Link>
        </p>
      </div>
      {!sampling && phase('AFTER', 3, sum.after)}
    </>
  );
}

function MilestoneForm({ value, jo, allJos, departments, today, productionDone, onSave, onCancel, onRemove }: { value: Milestone; productionDone: string | null; jo: JobOrder & { id: string }; allJos: (JobOrder & { id: string })[]; departments: (Department & { id: string })[]; today: string; onSave: (m: Milestone, what: string) => void; onCancel: () => void; onRemove?: () => void }) {
  const [name, setName] = useState(value.name);
  const [kind, setKind] = useState<DueKind | 'FIXED' | ''>(value.due ? 'FIXED' : (value.rule?.kind ?? ''));
  const [days, setDays] = useState(value.rule ? String(value.rule.days) : '');
  const [due, setDue] = useState(value.due ?? '');
  const [dept, setDept] = useState(value.departmentId ?? '');
  const [doneOn, setDoneOn] = useState(value.doneOn ?? '');
  const [note, setNote] = useState(value.note ?? '');
  const [notNeeded, setNotNeeded] = useState(!!value.notNeeded);
  const [approvedBy, setApprovedBy] = useState(value.approvedBy ?? '');
  const [wos, setWos] = useState(value.samplingWos ?? []);
  const [woText, setWoText] = useState('');
  const [itemIds, setItemIds] = useState<string[]>(value.itemIds ?? []);
  const n = Number(days.trim());
  const badDays = kind !== '' && kind !== 'FIXED' && (!days.trim() || !Number.isInteger(n) || n < 0 || n > 365);
  const badDone = !!doneOn && doneOn > today;
  const bad = !name.trim() || badDays || badDone || (kind === 'FIXED' && !due);
  const samplingWos = allJos.filter((j) => j.id !== jo.id && isSamplingWo(j)).sort((a, b) => (a.customerId === jo.customerId ? -1 : 0) - (b.customerId === jo.customerId ? -1 : 0) || b.receivedDate.localeCompare(a.receivedDate));

  function submit() {
    const nextDue = kind === 'FIXED' ? due : null;
    // Unusual but possible (asked, then allowed): before the WO date, or after production while production is still running.
    const asks = [
      doneOn && doneOn !== value.doneOn && value.link !== 'SAMPLES' && doneOn < jo.receivedDate && `The done date is before the WO date (${formatDay(jo.receivedDate)}).`,
      nextDue && nextDue !== value.due && nextDue < jo.receivedDate && `The due date is before the WO date (${formatDay(jo.receivedDate)}).`,
      doneOn && doneOn !== value.doneOn && value.phase === 'AFTER' && !productionDone && 'Production is not finished yet.',
    ].filter(Boolean);
    if (asks.length && !window.confirm(`${asks.join(' ')} Save anyway?`)) return;
    let m: Milestone = {
      ...value,
      name: name.trim(),
      rule: kind === '' || kind === 'FIXED' ? null : { kind, days: n },
      departmentId: dept || null,
      doneOn: doneOn || null,
      note: note.trim(),
      notNeeded,
      ...(value.link === 'SAMPLES' ? { approvedBy: approvedBy.trim(), samplingWos: wos } : {}),
      ...(value.link === 'ORDER_ITEMS' ? { itemIds } : {}),
    };
    m = withDue(m, nextDue, value.due ?? null, new Date().toISOString());
    const what = notNeeded && !value.notNeeded ? 'not needed' : doneOn && doneOn !== value.doneOn ? `done ${formatDay(doneOn)}` : nextDue !== (value.due ?? null) && nextDue ? `due date ${formatDay(nextDue)}` : 'details saved';
    onSave(m, what);
  }

  return (
    <div className="card subtle output-form">
      <label>
        Name
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Due
        <select value={kind} onChange={(e) => setKind(e.target.value as DueKind | 'FIXED' | '')}>
          <option value="">To be set</option>
          <option value="FIXED">On a date</option>
          {(['AFTER_WO', 'BEFORE_CARGO', 'AFTER_PRODUCTION'] as DueKind[]).map((k) => (
            <option key={k} value={k}>
              N {DUE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {kind === 'FIXED' && (
        <label>
          Due date
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          {value.dueHistory?.length ? <span className="muted small block">Earlier: {value.dueHistory.map((h) => formatDay(h.on)).join(', ')}</span> : null}
        </label>
      )}
      {kind !== '' && kind !== 'FIXED' && (
        <label>
          N (working days)
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      )}
      {badDays && <p className="error small">Enter whole working days from 0 to 365.</p>}
      <label>
        Department (optional)
        <select value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">Whole order</option>
          {departments
            .filter((d) => d.active !== false)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
      </label>
      {value.link === 'SAMPLES' && (
        <>
          <label>
            Sampling WO
            <span className="row gap">
              <input list="sampling-wos" value={woText} placeholder="choose or type the WO No." onChange={(e) => setWoText(e.target.value)} />
              <button
                type="button"
                className="secondary small"
                disabled={!woText.trim()}
                onClick={() => {
                  const hit = samplingWos.find((j) => j.joNumber.trim() === woText.trim());
                  setWos([...wos, hit ? { joId: hit.id, joNumber: hit.joNumber } : { joNumber: woText.trim() }]);
                  setWoText('');
                }}
              >
                Add
              </button>
            </span>
            <datalist id="sampling-wos">
              {samplingWos.map((j) => (
                <option key={j.id} value={j.joNumber}>
                  {j.customerName}
                </option>
              ))}
            </datalist>
          </label>
          {wos.length > 0 && (
            <ul className="plain-list small">
              {wos.map((w, i) => (
                <li key={`${w.joNumber}${i}`} className="row between">
                  <span>{w.joId && allJos.some((j) => j.id === w.joId) ? <Link to={`/orders/${w.joId}`}>WO {w.joNumber}</Link> : `WO ${w.joNumber}`}</span>
                  <button type="button" className="secondary small" onClick={() => setWos(wos.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label>
            Approved by
            <input value={approvedBy} maxLength={80} onChange={(e) => setApprovedBy(e.target.value)} placeholder="who approved the samples" />
          </label>
        </>
      )}
      {value.link === 'ORDER_ITEMS' && (
        <fieldset className="plain">
          <legend className="small">Items to arrange that count (Checklist tab)</legend>
          {(jo.orderItems ?? []).length === 0 && <p className="muted small">No items to arrange on this WO yet.</p>}
          {(jo.orderItems ?? []).map((it) => (
            <label key={it.id} className="check">
              <input type="checkbox" checked={itemIds.includes(it.id)} onChange={(e) => setItemIds(e.target.checked ? [...itemIds, it.id] : itemIds.filter((x) => x !== it.id))} /> {it.item}
            </label>
          ))}
        </fieldset>
      )}
      <label>
        {value.link === 'SAMPLES' ? 'Approved on' : 'Done on'}
        <input type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} />
      </label>
      {badDone && <p className="error small">The date cannot be in the future.</p>}
      {value.link && value.link !== 'SAMPLES' && <p className="muted small">Filled from {LINK_LABEL[value.link]}; a date here marks it done anyway.</p>}
      <label>
        Note
        <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={notNeeded} onChange={(e) => setNotNeeded(e.target.checked)} /> Not needed for this WO
      </label>
      <div className="row gap">
        <button type="button" className="primary small" disabled={bad} onClick={submit}>
          Save
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="secondary small" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
