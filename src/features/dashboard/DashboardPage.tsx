import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, type Department, type Process } from '../../lib/masters';
import { allocate, boardRows, boardWrites, completes, rowKey, type BoardRow } from '../../lib/processBoard';
import { istDateKey } from '../../lib/time';
import { formatQty, unitLabel } from '../../lib/units';
import { parseNum } from '../masters/fields';
import { useCollection } from '../masters/useCollection';
import { saveJoLines } from '../orders/stepSave';
import { usePlanContext } from '../settings/usePlanContext';

/**
 * Dashboard (confirmed 17 Nov 2026): one process across all confirmed WOs. The department's
 * total for the day is filled into the items in plan order (no manual re-ordering: priorities
 * are set in the plan). Starts are recorded for items not started yet; items whose whole
 * quantity is made are marked done only after one question.
 */
export function DashboardPage() {
  const { workspaceId } = useApp();
  const { ctx, master } = usePlanContext();
  const [qp] = useSearchParams();
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const today = istDateKey(new Date());
  const [date, setDate] = useState(today);
  const [total, setTotal] = useState('');
  const [unitPick, setUnitPick] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Every process with open work, grouped by its department (as in Masters).
  const options = useMemo(() => {
    const list = processes.items
      .filter((p) => p.active !== false)
      .map((p) => ({ p, rows: boardRows(jos.items, p.id, date, today, ctx) }))
      .filter((x) => x.rows.length > 0);
    const deptOf = (pid: string) => departments.items.find((d) => d.active !== false && (d.processIds ?? []).includes(pid));
    return list
      .map((x) => ({ ...x, dept: deptOf(x.p.id) }))
      .sort((a, b) => (a.dept?.name ?? '~').localeCompare(b.dept?.name ?? '~') || a.p.name.localeCompare(b.p.name));
  }, [processes.items, departments.items, jos.items, date, today, ctx]);
  const deptParam = qp.get('dept');
  const [pick, setPick] = useState<string | null>(qp.get('process'));
  const chosen = options.find((o) => o.p.id === pick) ?? options.find((o) => deptParam && o.dept?.id === deptParam) ?? options[0];

  if (master.notReady) return <p className="muted">{master.notReady}</p>;
  if (jos.loading || processes.loading) return <p className="muted">Loading…</p>;

  const rows: BoardRow[] = chosen?.rows ?? [];
  const units = [...new Set(rows.filter((r) => r.open && r.unit).map((r) => r.unit!))];
  const unit = unitPick && units.includes(unitPick) ? unitPick : (units[0] ?? null);
  const qty = parseNum(total);
  const alloc = unit && qty !== null && qty > 0 ? allocate(rows, qty, unit) : null;
  const filled = alloc ? [...alloc.given.values()].reduce((a, b) => a + b, 0) : 0;
  const bad = date > today ? 'The date cannot be in the future.' : alloc && alloc.extra > 0 ? `${formatQty(alloc.extra)} ${unitLabel(unit!)} more than the items still need. Check the total.` : null;

  function save() {
    if (!chosen || !alloc || !workspaceId || bad) return;
    const whole = completes(rows, alloc);
    const markDone = whole.length > 0 && window.confirm(`Whole quantity made: mark ${chosen.p.name} done for ${whole.map((r) => `${r.joNumber} · ${r.no}. ${r.product}`).join(', ')}?`);
    const { writes, done, notDone } = boardWrites(jos.items, rows, alloc, chosen.p.name, date, today, markDone);
    for (const w of writes) {
      const jo = jos.items.find((j) => j.id === w.joId);
      if (jo) saveJoLines(workspaceId, jo, w.lines, w.what, today, ctx);
    }
    setTotal('');
    setMsg(
      `Saved ${formatQty(filled)} ${unitLabel(unit!)} on ${writes.length} WO${writes.length === 1 ? '' : 's'}.` +
        (done.length ? ` Done: ${done.join(', ')}.` : '') +
        (notDone.length ? ` Whole quantity made, but the step before is not done yet: ${notDone.join(', ')}.` : ''),
    );
  }

  return (
    <section className="dashboard">
      <h2>Dashboard</h2>
      <p className="muted small">A department's output for the day, filled into the items in plan order. Priorities (Rush, item order) are set in each WO's plan.</p>
      {options.length === 0 ? (
        <p className="muted">No process has open work on a confirmed WO yet.</p>
      ) : (
        <div className="card">
          <label>
            Process
            <select value={chosen?.p.id ?? ''} onChange={(e) => setPick(e.target.value)}>
              {options.map((o) => (
                <option key={o.p.id} value={o.p.id}>
                  {o.p.name} · {o.dept?.name ?? 'no department'} ({o.rows.length})
                </option>
              ))}
            </select>
          </label>
          <div className="row gap wrap">
            <label className="small">
              Date
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
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
            <label className="small">
              Made today{unit ? ` (${unitLabel(unit)})` : ''}
              <input inputMode="decimal" value={total} placeholder="0" disabled={!unit} onChange={(e) => setTotal(e.target.value)} />
            </label>
          </div>
          {!unit && <p className="muted small">No item can take output on {formatDay(date)}.</p>}
          <table className="board">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Made / ordered</th>
                <th className="num">Today</th>
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
                        {r.overDays > 0 && <span className="bad"> · {formatQty(r.overDays)} days over</span>}
                        {r.waiting && <span className="muted"> · {r.waiting}</span>}
                        {r.unit && r.unit !== unit && r.open && <span className="muted"> · in {unitLabel(r.unit)}: enter on the WO</span>}
                      </div>
                    </td>
                    <td className="num">
                      {r.qty !== null ? `${formatQty(r.made)} / ${formatQty(r.qty)} ${unitLabel(r.unit ?? '')}` : '-'}
                    </td>
                    <td className="num">{q ? <strong>{formatQty(q)}</strong> : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {bad && <p className="error small">{bad}</p>}
          <div className="row between">
            <span className="small muted">{alloc ? `${formatQty(filled)} ${unitLabel(unit!)} into ${alloc.given.size} item${alloc.given.size === 1 ? '' : 's'}` : 'Enter the total to see where it goes.'}</span>
            <button type="button" className="primary" disabled={!alloc || !!bad || alloc.given.size === 0} onClick={save}>
              Save
            </button>
          </div>
          {msg && <p className="ok small">{msg}</p>}
        </div>
      )}
    </section>
  );
}
