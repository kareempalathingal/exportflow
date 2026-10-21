import { useId } from 'react';
import { DATA_STATUS_HINT, DATA_STATUS_LABEL, DATA_STATUSES, type DataStatus, type Tracked } from '../../lib/dataStatus';
import { STANDARD_UNITS, unitLabel, type CustomUnit } from '../../lib/units';

export const STATUS_LABEL = DATA_STATUS_LABEL;

export function StatusSelect({ value, onChange, label = 'Data status' }: { value: DataStatus; onChange: (s: DataStatus) => void; label?: string }) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as DataStatus)}>
        {DATA_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <span className="muted small block">{DATA_STATUS_HINT[value]}</span>
    </label>
  );
}

export function TextField(props: { label: string; value: string; onChange: (v: string) => void; required?: boolean; max?: number; multiline?: boolean; placeholder?: string }) {
  return (
    <label>
      {props.label}
      {props.required && <span className="req"> *</span>}
      {props.multiline ? (
        <textarea value={props.value} maxLength={props.max ?? 1000} rows={3} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      ) : (
        <input value={props.value} maxLength={props.max ?? 200} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      )}
    </label>
  );
}

/** Parse a user-typed number; empty → null. Invalid → NaN (caller validates). */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (t === '') return null;
  return Number(t);
}

export function numText(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '' : String(n);
}

export interface TrackedNumberDraft {
  text: string;
  status: DataStatus;
  source: string;
}

export function draftFromTracked(t: Tracked<number> | undefined): TrackedNumberDraft {
  return { text: numText(t?.value ?? null), status: t?.status ?? 'UNAVAILABLE', source: t?.source ?? '' };
}

/** Returns the Tracked value or an error message. */
export function trackedFromDraft(d: TrackedNumberDraft, label: string): Tracked<number> | string {
  const n = parseNum(d.text);
  if (n === null) return { value: null, status: d.status === 'PENDING_VERIFICATION' ? 'PENDING_VERIFICATION' : 'UNAVAILABLE', source: d.source.trim() };
  if (!Number.isFinite(n) || n <= 0) return `${label} must be a positive number`;
  return { value: n, status: d.status === 'UNAVAILABLE' ? 'USER_PROVIDED' : d.status, source: d.source.trim() };
}

export function TrackedNumberField({ label, unit, draft, onChange }: { label: string; unit?: string; draft: TrackedNumberDraft; onChange: (d: TrackedNumberDraft) => void }) {
  return (
    <fieldset className="tracked">
      <legend>
        {label}
        {unit && <span className="muted"> ({unit})</span>}
      </legend>
      <div className="grid3">
        <label>
          Value
          <input inputMode="decimal" value={draft.text} onChange={(e) => onChange({ ...draft, text: e.target.value })} />
        </label>
        <StatusSelect value={draft.status} onChange={(status) => onChange({ ...draft, status })} label="Status" />
        <label>
          Source
          <input value={draft.source} maxLength={120} onChange={(e) => onChange({ ...draft, source: e.target.value })} />
        </label>
      </div>
    </fieldset>
  );
}

export function UnitSelect({ value, onChange, label, units, allowEmpty }: { value: string; onChange: (v: string) => void; label: string; units?: string[]; allowEmpty?: boolean }) {
  const id = useId();
  const list = units ?? STANDARD_UNITS.map((u) => u.id);
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowEmpty && <option value="">—</option>}
        {list.map((u) => (
          <option key={u} value={u}>
            {unitLabel(u)}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface CustomUnitDraft {
  name: string;
  factorText: string;
  status: DataStatus;
}

export function CustomUnitsEditor({ baseUnit, rows, onChange }: { baseUnit: string; rows: CustomUnitDraft[]; onChange: (r: CustomUnitDraft[]) => void }) {
  const set = (i: number, patch: Partial<CustomUnitDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="tracked">
      <legend>Other units (e.g. bale, roll)</legend>
      {rows.length === 0 && <p className="muted small">None. Standard units like g, kg, cm, sq ft convert automatically.</p>}
      {rows.map((r, i) => (
        <div key={i} className="unit-row">
          <span>1</span>
          <input aria-label="Unit name" placeholder="bale" value={r.name} maxLength={30} onChange={(e) => set(i, { name: e.target.value })} />
          <span>=</span>
          <input aria-label="How many base units" inputMode="decimal" placeholder="50" value={r.factorText} onChange={(e) => set(i, { factorText: e.target.value })} />
          <span>{unitLabel(baseUnit)}</span>
          <select aria-label="Status" value={r.status} onChange={(e) => set(i, { status: e.target.value as DataStatus })}>
            {DATA_STATUSES.filter((s) => s !== 'UNAVAILABLE').map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button type="button" className="secondary small" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary small" onClick={() => onChange([...rows, { name: '', factorText: '', status: 'USER_PROVIDED' }])}>
        + Add unit
      </button>
    </fieldset>
  );
}

export function customUnitsFromDrafts(rows: CustomUnitDraft[]): CustomUnit[] | string {
  const out: CustomUnit[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (STANDARD_UNITS.some((u) => u.id === key || u.label.toLowerCase() === key)) return `"${name}" is already a standard unit`;
    if (seen.has(key)) return `Unit "${name}" is listed twice`;
    const f = parseNum(r.factorText);
    if (f === null || !Number.isFinite(f) || f <= 0) return `Enter how much one "${name}" is`;
    seen.add(key);
    out.push({ name, factor: f, status: r.status });
  }
  return out;
}

export function draftsFromCustomUnits(units: CustomUnit[] | undefined): CustomUnitDraft[] {
  return (units ?? []).map((u) => ({ name: u.name, factorText: String(u.factor), status: u.status }));
}

export function StatusTag({ status }: { status: DataStatus }) {
  return <span className={`status-tag s-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}
