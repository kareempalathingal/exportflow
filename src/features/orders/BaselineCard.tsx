/** Submitted plan (15 Nov 2026): plan vs now on the WO page, and the form that saves a new version. */
import { useState } from 'react';
import { useApp } from '../../AppContext';
import { baselineCheck, compareToPlan, diffText, latestBaseline, snapshotPlan } from '../../lib/baseline';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import type { OrderPlan } from '../../lib/route';
import type { WorkCalendar } from '../../lib/calendar';
import { istDateKey } from '../../lib/time';
import { saveRecord } from '../sync/records';
import type { WithMeta } from '../masters/useCollection';
import { jobOrderData } from './MaterialsTab';

export function BaselineCard({ jo, oplan, cal }: { jo: JobOrder; oplan: OrderPlan; cal: WorkCalendar }) {
  const c = compareToPlan(jo, oplan, cal);
  if (!c) return null;
  const { base, first } = c;
  const late = c.readyDiff !== null && c.readyDiff > 0;
  return (
    <div className="card">
      <div className="row between">
        <strong>Submitted plan · v{base.version}</strong>
        <span className="muted small">{formatDay(base.savedOn)}</span>
      </div>
      <p className="small">
        WO ready: plan <strong>{base.ready ? formatDay(base.ready) : 'to be confirmed'}</strong> · now {c.readyNow ? formatDay(c.readyNow) : 'to be confirmed'}
        {c.readyDiff !== null && <span className={`pill ${late ? 'warn' : c.readyDiff < 0 ? 'ok' : 'neutral'} inline-pill`}>{diffText(c.readyDiff)}</span>}
      </p>
      {c.behind.length > 0 && (
        <p className="small muted">
          Behind plan: {c.behind.slice(0, 4).map((b) => `${b.label} (${b.product}) +${b.diff}`).join(' · ')}
          {c.behind.length > 4 && ` · +${c.behind.length - 4} more`}
        </p>
      )}
      {c.notInPlan > 0 && <p className="small muted">{c.notInPlan} step{c.notInPlan === 1 ? ' is' : 's are'} not in the submitted plan (added later).</p>}
      <p className="muted small">
        {base.approvedBy || base.approvedOn ? `Approved${base.approvedBy ? ` by ${base.approvedBy}` : ''}${base.approvedOn ? ` on ${formatDay(base.approvedOn)}` : ''}` : 'Approval not recorded'}
        {first.version !== base.version && ` · first submitted: ${first.ready ? formatDay(first.ready) : 'ready date not known'} (v${first.version})`}
      </p>
      {jo.baselines!.length > 1 && (
        <details>
          <summary className="small">Versions ({jo.baselines!.length})</summary>
          <ul className="small plain-list">
            {[...jo.baselines!].reverse().map((b) => (
              <li key={b.version}>
                v{b.version} · {formatDay(b.savedOn)} · ready {b.ready ? formatDay(b.ready) : 'to be confirmed'}
                {b.reason && <span className="muted"> · {b.reason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** "Save as submitted plan (vN)" next to the plan PDF: a button that opens a short form. */
export function SavePlanForm({ jo, oplan }: { jo: WithMeta<JobOrder>; oplan: OrderPlan }) {
  const { workspaceId } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [approvedOn, setApprovedOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const today = istDateKey(new Date());
  const next = (latestBaseline(jo)?.version ?? 0) + 1;
  if (jo.status !== 'CONFIRMED') return null;

  function save() {
    if (!workspaceId) return;
    const problem = baselineCheck(jo, { reason, approvedOn }, today);
    if (problem) return setError(problem);
    const snap = snapshotPlan(jo, oplan, { today, now: new Date().toISOString() }, { reason, approvedBy, approvedOn });
    const data = { ...jobOrderData(jo), baselines: [...(jo.baselines ?? []), snap] };
    saveRecord({
      workspaceId,
      collectionName: COLLECTION_JOB_ORDERS,
      docId: jo.id,
      entity: `Work Order: ${jo.joNumber}`,
      before: jo,
      data: JSON.parse(JSON.stringify(data)) as Record<string, unknown>,
      reason: `Submitted plan v${snap.version} saved${snap.reason ? `: ${snap.reason}` : ''}`,
    });
    setError(null);
    setOpen(false);
    setReason('');
    setApprovedBy('');
    setApprovedOn('');
    setSaved(snap.version);
    setTimeout(() => setSaved(null), 3000);
  }

  if (!open)
    return (
      <>
        <button type="button" className="secondary small" onClick={() => setOpen(true)}>
          Save as submitted plan (v{next})
        </button>
        {saved && <span className="ok small"> Submitted plan v{saved} saved.</span>}
      </>
    );
  return (
    <div className="card subtle">
      <strong>Save as submitted plan (v{next})</strong>
      <p className="muted small">Saves today’s step dates as the plan given to management. Later dates are compared with it. Sharing the PDF does not save it.</p>
      {next > 1 && (
        <label>
          Why a new version<span className="req"> *</span>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Customer added an item" />
        </label>
      )}
      <div className="grid2">
        <label>
          Approved by (optional)
          <input value={approvedBy} maxLength={80} onChange={(e) => setApprovedBy(e.target.value)} />
        </label>
        <label>
          Approved on (optional)
          <input type="date" value={approvedOn} max={today} onChange={(e) => setApprovedOn(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <div className="row gap">
        <button type="button" className="secondary small" onClick={() => (setOpen(false), setError(null))}>
          Cancel
        </button>
        <button type="button" className="primary small" onClick={save}>
          Save plan
        </button>
      </div>
    </div>
  );
}
