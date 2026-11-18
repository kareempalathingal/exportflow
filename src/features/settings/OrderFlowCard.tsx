import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, type Department } from '../../lib/masters';
import { LINK_LABEL, ORDER_FLOW_DOC, PHASE_LABEL, routeDiffs, type FlowPhase, type FlowStage, type OrderFlow } from '../../lib/milestones';
import { RuleFields, ruleText, useRuleFields } from '../orders/RuleFields';
import { newExtraId } from '../../lib/orderExtras';
import { useCollection } from '../masters/useCollection';
import { useOrderFlow } from '../orders/useOrderFlow';
import { saveRecord } from '../sync/records';

/** Settings → Order flow (18 Nov 2026): the standard milestones before and after production, and the production order. */
export function OrderFlowCard() {
  const { workspaceId } = useApp();
  const { flow, record, saved, products, processes } = useOrderFlow(workspaceId);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const [draft, setDraft] = useState<OrderFlow>(flow);
  const [edit, setEdit] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [addProc, setAddProc] = useState('');
  const resetKey = `${record?.rev ?? 'default'}|${saved ? '' : flow.production.join(',')}`;
  useEffect(() => setDraft(flow), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(draft) !== JSON.stringify(flow) || !saved;
  const procName = (id: string) => processes.find((p) => p.id === id)?.name ?? 'process (removed)';
  const deptName = (id: string | null | undefined) => (id ? departments.items.find((d) => d.id === id)?.name : null);
  const diffs = routeDiffs(products, draft.production);

  function setStages(next: FlowStage[]) {
    setDraft((d) => ({ ...d, stages: next }));
  }
  function move<T>(list: T[], i: number, by: number): T[] {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j]!, out[i]!];
    return out;
  }
  function save() {
    if (!workspaceId) return;
    saveRecord({ workspaceId, collectionName: 'settings', docId: ORDER_FLOW_DOC, entity: 'Order flow', before: record, data: draft as unknown as Record<string, unknown>, reason: 'Order flow changed' });
    setMsg('Saved.');
    setTimeout(() => setMsg(null), 2500);
  }

  const phase = (ph: FlowPhase, n: number) => {
    const list = draft.stages.map((s, i) => ({ s, i })).filter(({ s }) => s.phase === ph);
    return (
      <div className="flow-phase">
        <h4>
          {n} · {PHASE_LABEL[ph]} <span className="muted small">(per WO)</span>
        </h4>
        <ul className="plain-list">
          {list.map(({ s, i }, k) => (
            <li key={s.id} className="extra-row">
              <div className="row between">
                <strong>{s.name}</strong>
                <span className="row gap">
                  <button type="button" className="secondary small" aria-label={`Move ${s.name} up`} disabled={k === 0} onClick={() => setStages(move(draft.stages, i, list[k - 1]!.i - i))}>
                    ↑
                  </button>
                  <button type="button" className="secondary small" aria-label={`Move ${s.name} down`} disabled={k === list.length - 1} onClick={() => setStages(move(draft.stages, i, list[k + 1]!.i - i))}>
                    ↓
                  </button>
                  <button type="button" className="secondary small" onClick={() => setEdit(edit === s.id ? null : s.id)}>
                    Edit
                  </button>
                </span>
              </div>
              <div className="small muted">{[ruleText(s, (id) => draft.stages.find((x) => x.id === id)?.name), deptName(s.departmentId), s.link && `filled from ${LINK_LABEL[s.link]}`].filter(Boolean).join(' · ')}</div>
              {edit === s.id && (
                <StageForm
                  value={s}
                  others={draft.stages.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, name: x.name }))}
                  departments={departments.items}
                  onCancel={() => setEdit(null)}
                  onSave={(v) => (setStages(draft.stages.map((x) => (x.id === s.id ? v : x))), setEdit(null))}
                  onRemove={() => window.confirm(`Remove "${s.name}" from the order flow?`) && (setStages(draft.stages.filter((x) => x.id !== s.id)), setEdit(null))}
                />
              )}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="secondary small"
          onClick={() => {
            const id = `s${newExtraId()}`;
            setStages([...draft.stages, { id, name: 'New stage', phase: ph }]);
            setEdit(id);
          }}
        >
          + Add stage
        </button>
      </div>
    );
  };

  const missing = processes.filter((p) => p.active !== false && !draft.production.includes(p.id));
  return (
    <div className="card">
      <p className="muted small">The standard flow of every WO, copied to a WO when it is confirmed (then changed per WO if needed). No lead days are filled in for you: a stage without a rule shows "date to be set". Kept per mode (ACTUAL / DEMO).</p>
      {phase('BEFORE', 1)}
      <div className="flow-phase">
        <h4>
          2 · {PHASE_LABEL.PRODUCTION} <span className="muted small">(per product, from the routes)</span>
        </h4>
        <ol className="plain-list">
          {draft.production.map((id, i) => (
            <li key={id} className="row between">
              <span>
                {i + 1}. {procName(id)}
              </span>
              <span className="row gap">
                <button type="button" className="secondary small" aria-label={`Move ${procName(id)} up`} disabled={i === 0} onClick={() => setDraft((d) => ({ ...d, production: move(d.production, i, -1) }))}>
                  ↑
                </button>
                <button type="button" className="secondary small" aria-label={`Move ${procName(id)} down`} disabled={i === draft.production.length - 1} onClick={() => setDraft((d) => ({ ...d, production: move(d.production, i, 1) }))}>
                  ↓
                </button>
                <button type="button" className="secondary small" aria-label={`Remove ${procName(id)}`} onClick={() => setDraft((d) => ({ ...d, production: d.production.filter((x) => x !== id) }))}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
        {missing.length > 0 && (
          <div className="row gap">
            <select value={addProc} onChange={(e) => setAddProc(e.target.value)} aria-label="Process to add">
              <option value="">Add a process…</option>
              {missing.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="button" className="secondary small" disabled={!addProc} onClick={() => (setDraft((d) => ({ ...d, production: [...d.production, addProc] })), setAddProc(''))}>
              Add
            </button>
          </div>
        )}
        {diffs.length === 0 ? (
          <p className="ok small">Every product route follows this order.</p>
        ) : (
          <details className="refs">
            <summary className="warn small">
              {diffs.length} product route{diffs.length === 1 ? '' : 's'} differ{diffs.length === 1 ? 's' : ''} from this order · review
            </summary>
            <ul className="plain-list small">
              {diffs.map((d) => (
                <li key={d.productId}>
                  <Link to={`/masters/products/${d.productId}`}>{d.product}</Link>
                  <div className="muted">
                    {[...d.outOfOrder.map(([a, b]) => `${procName(b)} before ${procName(a)} expected`), ...d.notInList.map((p) => `${procName(p)} is not in the list`)].join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
            <p className="muted small">Shown for a look only: nothing is changed. A process a product does not need is never a difference.</p>
          </details>
        )}
      </div>
      {phase('AFTER', 3)}
      <div className="row gap">
        <button type="button" className="primary small" disabled={!changed} onClick={save}>
          {saved ? 'Save order flow' : 'Save this order flow'}
        </button>
        {changed && saved && (
          <button type="button" className="secondary small" onClick={() => setDraft(flow)}>
            Undo changes
          </button>
        )}
        {msg && <span className="ok small">{msg}</span>}
      </div>
      {!saved && <p className="muted small">Not saved yet: these are the defaults. WOs use them until you save your own.</p>}
    </div>
  );
}

function StageForm({ value, others, departments, onSave, onCancel, onRemove }: { value: FlowStage; others: { id: string; name: string }[]; departments: (Department & { id: string })[]; onSave: (v: FlowStage) => void; onCancel: () => void; onRemove: () => void }) {
  const [name, setName] = useState(value.name);
  const rf = useRuleFields(value.rule, false);
  const [dept, setDept] = useState(value.departmentId ?? '');
  const bad = !name.trim() || rf.bad;
  return (
    <div className="card subtle output-form">
      <label>
        Name
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <RuleFields f={rf} allowFixed={false} others={others} />
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
      {value.link && <p className="muted small">Filled from {LINK_LABEL[value.link]}; you can still mark it done yourself.</p>}
      <div className="row gap">
        <button type="button" className="primary small" disabled={bad} onClick={() => onSave({ ...value, name: name.trim(), rule: rf.value, departmentId: dept || null })}>
          Done
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="secondary small" onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}
