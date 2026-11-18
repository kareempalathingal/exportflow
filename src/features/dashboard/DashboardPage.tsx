import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, type Department, type Process } from '../../lib/masters';
import { addedSince, allocate, boardRows, boardWrites, completes, overPrevRows, processCards, rowKey, type BoardMode, type ProcessCard } from '../../lib/processBoard';
import { gapColor, type Track } from '../../lib/progress';
import { readRedAt } from '../../lib/theme';
import { istDateKey, istTimeKey } from '../../lib/time';
import { formatQty, unitLabel } from '../../lib/units';
import { parseNum } from '../masters/fields';
import { useCollection, type WithMeta } from '../masters/useCollection';
import { TrackBar } from '../orders/TrackBar';
import { saveJoLines } from '../orders/stepSave';
import { usePlanContext } from '../settings/usePlanContext';
import { OrdersStanding } from '../home/OrdersStanding';

/**
 * Dashboard (confirmed 17 Nov 2026): one card per process in working order, its state across
 * all open confirmed WOs (% done, done / total quantity, should-be mark, benchmark), and
 * "Update now": the department's figure, filled into the items in plan order.
 */
export function DashboardPage() {
  const { workspaceId } = useApp();
  const { ctx, master } = usePlanContext();
  const [qp, setQp] = useSearchParams();
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const today = istDateKey(new Date());
  const [open, setOpen] = useState<string | null>(qp.get('process'));
  const cards = useMemo(() => processCards(jos.items, processes.items, departments.items, today, ctx), [jos.items, processes.items, departments.items, today, ctx]);

  if (master.notReady) return <p className="muted">{master.notReady}</p>;
  if (jos.loading || processes.loading) return <p className="muted">Loading…</p>;

  const dept = qp.get('dept');
  const shown = dept ? cards.filter((c) => c.department?.id === dept) : cards;
  const confirmed = jos.items.filter((j) => j.status === 'CONFIRMED').length;
  return (
    <section className="dashboard">
      <div className="row between">
        <h2>Dashboard</h2>
        <span className="small muted">
          {confirmed} confirmed WO{confirmed === 1 ? '' : 's'}
        </span>
      </div>
      {!dept && <OrdersStanding jos={jos.items} ctx={ctx} today={today} loading={jos.loading} emptyText="No open work orders yet." />}
      {!dept && <h3>Processes</h3>}
      {dept && (
        <p className="small">
          {shown[0]?.department?.name ?? 'One department'} only ·{' '}
          <button type="button" className="linkish small" onClick={() => setQp({})}>
            Show all processes
          </button>
        </p>
      )}
      {cards.length === 0 && <p className="muted">No processes yet. Add them in Masters → Processes.</p>}
      {shown
        .filter((c) => c.items > 0)
        .map((c) => (
          <ProcessCardView key={c.processId} c={c} open={open === c.processId} onToggle={() => setOpen(open === c.processId ? null : c.processId)} jos={jos.items} today={today} ctx={ctx} workspaceId={workspaceId} />
        ))}
      {/* Processes without work on any open confirmed WO: one collapsed row at the end (17 Nov 2026). */}
      {shown.some((c) => c.items === 0) && (
        <details className="card idle-row">
          <summary>
            No work now ({shown.filter((c) => c.items === 0).length})
          </summary>
          <ul className="small muted">
            {shown
              .filter((c) => c.items === 0)
              .map((c) => (
                <li key={c.processId}>
                  {c.name}
                  {c.department ? ` · ${c.department.name}` : ''}
                </li>
              ))}
          </ul>
        </details>
      )}
      <p className="small muted">Bar = done · thin line = where it should be today by the plan · colour = behind or ahead, as on the WO cards. Open confirmed WOs only.</p>
    </section>
  );
}

type Ctx = ReturnType<typeof usePlanContext>['ctx'];
type Jos = WithMeta<JobOrder>[];

function ProcessCardView({ c, open, onToggle, jos, today, ctx, workspaceId }: { c: ProcessCard; open: boolean; onToggle: () => void; jos: Jos; today: string; ctx: Ctx; workspaceId: string | null }) {
  const idle = c.items === 0;
  const track: Track = {
    kind: c.pct !== null && c.pct >= 100 ? 'DONE' : 'TRACKED',
    planned: c.planned ?? c.pct ?? 0,
    actual: c.pct,
    gap: c.pct !== null && c.planned !== null ? c.pct - c.planned : null,
    daysLeft: 0,
    updatedDaysAgo: null,
  };
  const color = gapColor(track, readRedAt());
  const [saved, setSaved] = useState<string | null>(null);
  const counts = [c.running && `${c.running} running`, c.next && `${c.next} next`, c.done && `${c.done} done`].filter(Boolean).join(' · ');
  return (
    <div className={`card process-card${idle ? ' idle' : ''}${!idle && c.done === c.items ? ' complete' : ''}`}>
      <div className="row between">
        <span>
          <strong>{c.name}</strong>{' '}
          <span className="small muted">
            {c.department?.name ?? 'no department'}
            {c.outside ? ' · outside work' : ''}
          </span>
        </span>
        {!idle && c.pct !== null && (
          <strong className="pc-pct" style={{ color }}>
            {c.pct}%
          </strong>
        )}
      </div>
      {idle ? (
        <p className="small muted">No work now.</p>
      ) : (
        <>
          <div className="pc-bar">
            <TrackBar track={track} color={color} />
            {c.total !== null && c.made !== null && (
              <span className="small nowrap">
                <strong>{formatQty(c.made)}</strong> / {formatQty(c.total)} {unitLabel(c.units[0]!)}
              </span>
            )}
          </div>
          {c.total !== null && c.made !== null && c.total - c.made > 1e-9 && (
            <div className="small">
              <strong>
                {formatQty(c.total - c.made)} {unitLabel(c.units[0]!)}
              </strong>{' '}
              still to {c.outside ? 'land' : 'make'}
            </div>
          )}
          <div className="small muted">
            {c.benchmark ? `Benchmark ${c.benchmark}` : 'No benchmark yet'}
            {c.parallel > 1 ? ` · ${c.parallel} units` : ''}
            {c.planned !== null && c.pct !== null && c.pct < 100 && c.planned !== c.pct ? ` · should be ${c.planned}%` : ''}
          </div>
          <div className="small muted">
            {counts}
            {c.outside && c.dispatched !== null ? ` · dispatched ${formatQty(c.dispatched)}, landed ${formatQty(c.made ?? 0)}` : ''}
            {c.lastUpdate ? ` · last update ${c.lastUpdate}` : ''}
          </div>
          {c.overItems > 0 && (
            <div className="small error">
              {c.overItems} item{c.overItems === 1 ? '' : 's'} over the planned time
            </div>
          )}
          {c.units.length > 1 && (
            <div className="small warn">
              {c.units.length} units in this process ({c.units.map(unitLabel).join(', ')}): check the product routes. % is the average of the items.
            </div>
          )}
          {c.qtyMissing && <div className="small warn">Some items have no quantity yet.</div>}
          {c.done < c.items && (
            <button type="button" className={open ? 'small' : 'small primary'} onClick={() => { setSaved(null); onToggle(); }}>
              {open ? 'Close' : 'Update now'}
            </button>
          )}
          {open && <UpdateForm c={c} jos={jos} today={today} ctx={ctx} workspaceId={workspaceId} onDone={onToggle} onSaved={(m) => { setSaved(m); onToggle(); }} />}
          {saved && !open && <p className="ok small">{saved}</p>}
        </>
      )}
    </div>
  );
}

function UpdateForm({ c, jos, today, ctx, workspaceId, onDone, onSaved }: { c: ProcessCard; jos: Jos; today: string; ctx: Ctx; workspaceId: string | null; onDone: () => void; onSaved: (msg: string) => void }) {
  // Outside work: "Dispatched" only while something is left to dispatch (e.g. not already
  // entered on the WO's Products tab); otherwise the form opens on "Landed".
  const canDispatch = c.outside && boardRows(jos, c.processId, today, today, ctx, 'DISPATCH').some((r) => r.open);
  const canLand = c.outside && boardRows(jos, c.processId, today, today, ctx, 'LAND').some((r) => r.open);
  const [mode, setMode] = useState<BoardMode>(c.outside ? (canDispatch || !canLand ? 'DISPATCH' : 'LAND') : 'MAKE');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState(istTimeKey(new Date()));
  const [figure, setFigure] = useState('');
  const [unitPick, setUnitPick] = useState<string | null>(null);

  const rows = boardRows(jos, c.processId, date, today, ctx, mode);
  const units = [...new Set(rows.filter((r) => r.open && r.unit).map((r) => r.unit!))];
  const unit = unitPick && units.includes(unitPick) ? unitPick : (units[0] ?? null);
  const n = parseNum(figure);
  const since = mode === 'MAKE' && unit && n !== null ? addedSince(rows, unit, n) : null;
  const qty = mode === 'MAKE' ? (since?.add ?? null) : n;
  const alloc = unit && qty !== null && qty > 0 ? allocate(rows, qty, unit) : null;
  const filled = alloc ? [...alloc.given.values()].reduce((a, b) => a + b, 0) : 0;
  const already = mode === 'MAKE' && unit ? addedSince(rows, unit, 0).already : 0;
  const nowTime = istTimeKey(new Date());
  const bad =
    date > today || (date === today && time > nowTime)
      ? 'The date and time cannot be in the future.'
      : !/^\d{2}:\d{2}$/.test(time)
        ? 'Enter the time.'
        : since && since.add === null
          ? `Less than already recorded on ${formatDay(date)} (${formatQty(already)} ${unitLabel(unit!)}). Enter the total made so far that day.`
          : alloc && alloc.extra > 0
            ? `${formatQty(alloc.extra)} ${unitLabel(unit!)} more than the items can take. Check the figure.`
            : null;
  const dayLog = rows.filter((r) => r.onDate > 0);
  // One tap when the department says everything is done: what the open items can still take.
  const canTake = unit ? rows.filter((r) => r.open && r.unit === unit).reduce((a, r) => a + (r.left ?? 0), 0) : 0;
  const cannot = rows.filter((r) => !r.open && (r.left ?? 0) > 1e-9).length;
  const fillAll = () => setFigure(String(Math.round((mode === 'MAKE' ? already + canTake : canTake) * 1000) / 1000));

  function save() {
    if (!alloc || !workspaceId || bad || alloc.given.size === 0) return;
    const over = overPrevRows(rows, alloc);
    if (over.length && !window.confirm(`The step before has not recorded enough yet for: ${over.map((r) => `${r.joNumber} · ${r.no}. ${r.product} (${r.prevLabel} covers ${formatQty(r.prevLeft ?? 0)}, this update gives ${formatQty(alloc.given.get(rowKey(r)) ?? 0)} ${unitLabel(r.unit ?? '')})`).join('; ')}. Save anyway?`)) return;
    const whole = completes(rows, alloc);
    const word = mode === 'DISPATCH' ? 'dispatched' : mode === 'LAND' ? 'landed' : 'made';
    const markDone = whole.length > 0 && window.confirm(`Whole quantity ${word}: mark it done for ${whole.map((r) => `${r.joNumber} · ${r.no}. ${r.product}`).join(', ')}?`);
    const { writes, done, notDone } = boardWrites(jos, rows, alloc, c.name, date, time, today, markDone, mode);
    for (const w of writes) {
      const jo = jos.find((j) => j.id === w.joId);
      if (jo) saveJoLines(workspaceId, jo, w.lines, w.what, today, ctx);
    }
    // Saved: the form closes and the card shows what was saved (17 Nov 2026).
    onSaved(
      `Saved ${formatQty(filled)} ${unitLabel(unit!)} on ${writes.length} WO${writes.length === 1 ? '' : 's'}.` +
        (done.length ? ` Done: ${done.join(', ')}.` : '') +
        (notDone.length ? ` Whole quantity reached, but a step before is not done yet (mark it on the WO): ${notDone.join(', ')}.` : ''),
    );
  }

  const pickMode = (m: BoardMode) => {
    setMode(m);
  };

  return (
    <div className="update-form">
      {c.outside && (
        <div className="small">
          What happened?{' '}
          <span className="segmented">
            {(['DISPATCH', 'LAND'] as const).map((m) => (
              <button key={m} type="button" className={mode === m ? 'on' : undefined} aria-pressed={mode === m} onClick={() => pickMode(m)}>
                {m === 'DISPATCH' ? 'Dispatched' : 'Landed'}
              </button>
            ))}
          </span>
          {!canDispatch && <span className="muted"> · nothing left to dispatch</span>}
          {!canLand && mode === 'LAND' && <span className="muted"> · nothing dispatched to land yet</span>}
        </div>
      )}
      <div className="row gap wrap">
        <label className="small">
          Date
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </label>
        <label className="small">
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        {units.length > 1 && (
          <label className="small">
            Unit
            <select value={unit ?? ''} onChange={(e) => setUnitPick(e.target.value)}>
              {units.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {unit ? (
        <label className="small block">
          {mode === 'MAKE' ? `Total made ${date === today ? 'today' : `on ${formatDay(date)}`} so far (${unitLabel(unit)})` : `Quantity ${mode === 'DISPATCH' ? 'dispatched' : 'landed'} now (${unitLabel(unit)})`}
          <input inputMode="decimal" value={figure} placeholder="0" onChange={(e) => setFigure(e.target.value)} />
          {mode === 'MAKE' && already > 0 && (
            <span className="muted">
              Already recorded that day: {formatQty(already)} {unitLabel(unit)}
              {since?.add ? ` · this update adds ${formatQty(since.add)}` : ''}
            </span>
          )}
        </label>
      ) : null}
      {unit && canTake > 1e-9 && (
        <p className="small">
          <button type="button" className="small" onClick={fillAll}>
            All remaining: {formatQty(canTake)} {unitLabel(unit)}
          </button>
          {cannot > 0 && (
            <span className="muted">
              {' '}
              {cannot} item{cannot === 1 ? '' : 's'} cannot take it yet (see below)
            </span>
          )}
        </p>
      )}
      {unit ? null : (
        <p className="muted small">
          No item can take {mode === 'DISPATCH' ? 'a dispatch' : mode === 'LAND' ? 'a landing' : 'output'} on {formatDay(date)}.
        </p>
      )}
      <table className="board">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">{mode === 'DISPATCH' ? 'Sent' : mode === 'LAND' ? 'Landed' : 'Made'} / total</th>
            <th className="num">Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = alloc?.given.get(rowKey(r));
            return (
              <tr key={rowKey(r)} className={r.open ? undefined : 'muted'}>
                <td>
                  <Link to={`/orders/${r.joId}?tab=products&line=${encodeURIComponent(r.lineId)}&step=${encodeURIComponent(r.stepKey)}`}>
                    {r.joNumber} · {r.no}. {r.product}
                  </Link>
                  <div className="small">
                    {r.state === 'NOW' ? (r.started ? 'running' : 'to start') : 'next'}
                    {r.start && r.state !== 'NOW' && ` · planned ${formatDay(r.start)}`}
                    {r.overDays > 0 && <span className="error"> · {formatQty(r.overDays)} days over</span>}
                    {r.waiting && <span className="muted"> · {r.waiting}</span>}
                    {r.open && r.prevLeft !== null && r.left !== null && r.prevLeft < r.left - 1e-9 && (
                      <span className={q && q > r.prevLeft + 1e-9 ? 'warn' : 'muted'}>
                        {' '}
                        · {r.prevLabel} covers {formatQty(r.prevLeft)} so far
                      </span>
                    )}
                  </div>
                </td>
                <td className="num">{r.qty !== null ? `${formatQty(r.made)} / ${formatQty(r.qty)} ${unitLabel(r.unit ?? '')}` : '-'}</td>
                <td className="num">{q ? <strong>{formatQty(q)}</strong> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dayLog.length > 0 && (
        <p className="small muted">
          On {formatDay(date)}: {dayLog.map((r) => `${r.no}. ${r.product} ${formatQty(r.onDate)}`).join(', ')}
        </p>
      )}
      {bad && <p className="error small">{bad}</p>}
      <div className="row between">
        <span className="small muted">{alloc ? `${formatQty(filled)} ${unitLabel(unit!)} into ${alloc.given.size} item${alloc.given.size === 1 ? '' : 's'}` : 'Enter the figure to see where it goes.'}</span>
        <span>
          <button type="button" className="small" onClick={onDone}>
            Cancel
          </button>{' '}
          <button type="button" className="primary small" disabled={!alloc || !!bad || alloc.given.size === 0} onClick={save}>
            {mode === 'DISPATCH' ? 'Save dispatch' : mode === 'LAND' ? 'Save landing' : 'Save'}
          </button>
        </span>
      </div>
    </div>
  );
}
