import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';
import { KPI_TARGETS_DOC, type KpiTargets } from '../../lib/kpi';
import { useKpiTargets } from '../reports/KpiPage';
import { saveRecord } from '../sync/records';

const FIELDS: { key: keyof KpiTargets; label: string; unit: string; hint: string }[] = [
  { key: 'onTimeDeliveryPct', label: 'On-time delivery at least', unit: '%', hint: 'orders finished by the customer delivery date' },
  { key: 'onTimeInternalPct', label: 'Done by internal deadline at least', unit: '%', hint: '' },
  { key: 'planningOnTimePct', label: 'Planning within benchmark at least', unit: '%', hint: 'orders confirmed within the planning benchmark (Settings → Profile)' },
  { key: 'onTimeStepPct', label: 'Steps on time at least', unit: '%', hint: 'per department too' },
  { key: 'efficiencyPct', label: 'Efficiency at least', unit: '%', hint: 'planned ÷ actual time' },
  { key: 'maxAvgDelayDays', label: 'Average delay per step at most', unit: 'working days', hint: '' },
  { key: 'maxAvgWaitDays', label: 'Average wait before a step at most', unit: 'working days', hint: '' },
];

const toText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** Settings → KPI targets: the user's own targets; empty = no target (no colour). */
export function KpiTargetsCard() {
  const { workspaceId } = useApp();
  const { targets, record } = useKpiTargets(workspaceId);
  const [text, setText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setText(Object.fromEntries(FIELDS.map((f) => [f.key, toText(targets[f.key])])));
  }, [record?.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = FIELDS.map((f) => {
    const s = (text[f.key] ?? '').trim().replace(',', '.');
    if (!s) return [f.key, null] as const;
    const n = Number(s);
    return [f.key, Number.isFinite(n) && n >= 0 && (f.unit !== '%' || n <= 100) ? n : NaN] as const;
  });
  const bad = parsed.some(([, v]) => v !== null && Number.isNaN(v));

  function save() {
    if (!workspaceId || bad) return;
    const data = Object.fromEntries(parsed) as Record<string, number | null>;
    saveRecord({ workspaceId, collectionName: 'settings', docId: KPI_TARGETS_DOC, entity: 'KPI targets', before: record, data, reason: 'KPI targets changed' });
    setMsg('Saved.');
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="card">
      <p className="muted small">Your own targets. Leave empty for no target (the KPI is shown without colour). Kept per mode (ACTUAL / DEMO).</p>
      {FIELDS.map((f) => (
        <label key={f.key}>
          {f.label} ({f.unit})
          <input inputMode="decimal" value={text[f.key] ?? ''} placeholder="no target" onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))} />
          {f.hint && <span className="muted small block">{f.hint}</span>}
        </label>
      ))}
      {bad && <p className="error small">Enter numbers of 0 or more (percentages up to 100).</p>}
      <button type="button" className="primary small" disabled={bad} onClick={save}>
        Save targets
      </button>
      {msg && <span className="ok small"> {msg}</span>}
    </div>
  );
}
