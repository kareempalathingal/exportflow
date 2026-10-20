import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { DATA_STATUSES, type DataStatus } from '../../lib/dataStatus';
import { COLLECTIONS, normalizeName, type Process, type RouteStep } from '../../lib/masters';
import { saveRecord } from '../sync/records';
import { parseNum, STATUS_LABEL, UnitSelect } from './fields';
import { newId, useCollection } from './useCollection';

export interface RouteDraft {
  processId: string;
  perDayText: string;
  perDayUnit: string;
  fixedText: string;
  status: DataStatus;
}

export function draftsFromRoute(route: RouteStep[] | undefined, baseUnit: string): RouteDraft[] {
  return (route ?? []).map((s) => ({
    processId: s.processId,
    perDayText: s.perDay === null || s.perDay === undefined ? '' : String(s.perDay),
    perDayUnit: s.perDayUnit || baseUnit,
    fixedText: s.fixedDays === null || s.fixedDays === undefined ? '' : String(s.fixedDays),
    status: s.status ?? 'PENDING_VERIFICATION',
  }));
}

/** Returns the route or an error message. Both fields empty = time not known yet. */
export function routeFromDrafts(rows: RouteDraft[]): RouteStep[] | string {
  const out: RouteStep[] = [];
  for (const [i, r] of rows.entries()) {
    if (!r.processId) return `Process step ${i + 1}: choose a process`;
    const perDay = parseNum(r.perDayText);
    const fixed = parseNum(r.fixedText);
    if (perDay !== null && (!Number.isFinite(perDay) || perDay <= 0)) return `Process step ${i + 1}: output per day must be more than 0`;
    if (fixed !== null && (!Number.isFinite(fixed) || fixed <= 0)) return `Process step ${i + 1}: fixed days must be more than 0 (or leave it empty)`;
    const known = perDay !== null || fixed !== null;
    const status: DataStatus = !known
      ? r.status === 'UNAVAILABLE'
        ? 'UNAVAILABLE'
        : 'PENDING_VERIFICATION'
      : r.status === 'UNAVAILABLE' || r.status === 'PENDING_VERIFICATION'
        ? 'USER_PROVIDED'
        : r.status;
    out.push({ processId: r.processId, perDay, perDayUnit: r.perDayUnit, fixedDays: fixed, status, source: '' });
  }
  return out;
}

/** Ordered processes of a product; new processes can be created on the spot. */
export function RouteEditor(props: { rows: RouteDraft[]; onChange: (r: RouteDraft[]) => void; confirmed: boolean; onConfirmedChange: (v: boolean) => void; units: string[]; baseUnit: string }) {
  const { workspaceId } = useApp();
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const active = useMemo(() => processes.items.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [processes.items]);
  const nameOf = (id: string) => processes.items.find((p) => p.id === id)?.name ?? '(missing process)';
  const { rows, onChange } = props;
  const set = (i: number, patch: Partial<RouteDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = (processId: string) => onChange([...rows, { processId, perDayText: '', perDayUnit: props.baseUnit, fixedText: '', status: 'PENDING_VERIFICATION' }]);

  function createProcess() {
    const name = newName.trim().replace(/\s+/g, ' ');
    if (!name || !workspaceId) return;
    const existing = processes.items.find((p) => normalizeName(p.name) === normalizeName(name));
    if (existing) {
      add(existing.id);
      setMsg(`“${existing.name}” already exists — added it.`);
    } else {
      const id = newId(workspaceId, COLLECTIONS.processes);
      const data: Process = { name, active: true, notes: '' };
      saveRecord({ workspaceId, collectionName: COLLECTIONS.processes, docId: id, entity: `Process: ${name}`, before: null, data: { ...data } });
      add(id);
      setMsg(`Created “${name}” and added it.`);
    }
    setNewName('');
    setTimeout(() => setMsg(null), 3000);
  }

  return (
    <fieldset className="tracked">
      <legend>Process route</legend>
      <p className="muted small">Treatments and other steps this product goes through, in order (include packing etc.). Steps of sub-products such as yarn are added from their own route.</p>
      {rows.length === 0 && <p className="muted small">No steps yet.</p>}
      <ol className="route-list">
        {rows.map((r, i) => (
          <li key={`${r.processId}-${i}`} className="route-row">
            <div className="row between">
              <strong>
                {i + 1}. {nameOf(r.processId)}
              </strong>
              <span className="row gap">
                <button type="button" className="secondary small icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="secondary small icon" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="secondary small icon" aria-label={`Remove ${nameOf(r.processId)}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            </div>
            <div className="qty-unit">
              <label>
                Output per day
                <input inputMode="decimal" placeholder="not known" value={r.perDayText} onChange={(e) => set(i, { perDayText: e.target.value })} />
              </label>
              <UnitSelect label="Unit" value={r.perDayUnit} units={props.units.includes(r.perDayUnit) ? props.units : [...props.units, r.perDayUnit]} onChange={(perDayUnit) => set(i, { perDayUnit })} />
            </div>
            <div className="qty-unit">
              <label>
                Fixed days
                <input inputMode="decimal" placeholder="none" value={r.fixedText} onChange={(e) => set(i, { fixedText: e.target.value })} />
              </label>
              <label>
                Status
                <select value={r.status} onChange={(e) => set(i, { status: e.target.value as DataStatus })}>
                  {DATA_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ol>
      <label>
        Add a step
        <select value="" onChange={(e) => e.target.value && add(e.target.value)}>
          <option value="">— choose a process —</option>
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="qty-unit">
        <label>
          Or create a new process
          <input value={newName} maxLength={80} placeholder="e.g. Bleaching" onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button type="button" className="secondary small create-btn" disabled={!newName.trim()} onClick={createProcess}>
          Create &amp; add
        </button>
      </div>
      {msg && <p className="ok small">{msg}</p>}
      <label className="check">
        <input type="checkbox" checked={props.confirmed} onChange={(e) => props.onConfirmedChange(e.target.checked)} /> Order of steps confirmed with the company
      </label>
      <p className="muted small">
        On an order, planned days = quantity ÷ output per day + fixed days (working days, rounded up to ½ day). Fixed days are for things that do not depend on quantity,
        like drying. Leave both empty if not known (“time pending”). <Link to="/masters?tab=processes">All processes</Link>
      </p>
    </fieldset>
  );
}
