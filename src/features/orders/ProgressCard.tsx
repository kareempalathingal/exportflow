import { useState } from 'react';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import { appendProgress, gapColor, trackLabel, trackOf } from '../../lib/progress';
import { orderStepProgress } from '../../lib/route';
import type { MasterData } from '../../lib/masters';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import { readRedAt } from '../../lib/theme';
import { istDateKey } from '../../lib/time';
import type { WithMeta } from '../masters/useCollection';
import { saveRecord } from '../sync/records';
import { jobOrderData } from './MaterialsTab';
import { TrackBar } from './TrackBar';

/** Manual "% complete" until stage tracking exists; compared with the linear plan. */
export function ProgressCard({ jo, md }: { jo: WithMeta<JobOrder>; md: MasterData }) {
  const { workspaceId } = useApp();
  const today = istDateKey(new Date());
  const [pct, setPct] = useState(jo.progress?.pct ?? 0);
  const [saved, setSaved] = useState(false);
  const { cal } = useWorkCalendar();
  const fromSteps = orderStepProgress(jo, today, { md, cal });
  const track = trackOf(jo, today, fromSteps, cal);
  const color = gapColor(track, readRedAt());
  const editable = jo.status === 'CONFIRMED' && !fromSteps;

  function save() {
    if (!workspaceId) return;
    saveRecord({
      workspaceId,
      collectionName: COLLECTION_JOB_ORDERS,
      docId: jo.id,
      entity: `Job Order: ${jo.joNumber}`,
      before: jo,
      data: JSON.parse(JSON.stringify({ ...jobOrderData(jo), progress: { pct, on: today, at: new Date().toISOString() }, progressLog: appendProgress(jo.progressLog, { pct, on: today, at: new Date().toISOString() }) })) as Record<string, unknown>,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (jo.status === 'DRAFT' || jo.status === 'CANCELLED') return null;
  return (
    <div className="card">
      <div className="row between">
        <h3>{fromSteps ? 'Whole order' : 'Progress'}</h3>
        <span className="track-label">
          <span className="dot" style={{ background: color }} aria-hidden="true" />
          {trackLabel(track)}
        </span>
      </div>
      <TrackBar track={track} color={color} />
      <p className="muted small">
        Is {track.actual === null ? '—' : `${track.actual}%`} · should be {track.planned}% today
        {!fromSteps && jo.progress && ` · updated ${formatDay(jo.progress.on)}`}
      </p>
      {fromSteps && <p className="muted small">From the process steps of each product (Products tab).</p>}
      {editable && (
        <>
          <label>
            % complete now: <strong className="mono">{pct}%</strong>
            <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} />
          </label>
          <div className="row between">
            <span className="muted small">Your estimate; stage tracking will replace it later.</span>
            <button type="button" className="primary small" disabled={pct === (jo.progress?.pct ?? -1)} onClick={save}>
              Update
            </button>
          </div>
          {saved && <p className="ok small">Saved</p>}
        </>
      )}
    </div>
  );
}
