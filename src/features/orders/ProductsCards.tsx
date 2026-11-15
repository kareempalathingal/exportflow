/** Cards on the WO Products tab (split out of ProductsTab.tsx, 15 Nov 2026). */
import { formatDay } from '../../lib/jobOrders';
import { type Department, type Process } from '../../lib/masters';
import { departmentsFor } from '../../lib/contacts';
import { hoursText, processPlanRows } from '../../lib/route';
import { formatQty } from '../../lib/units';
import { daysLeftText, gainText, itemOrderRule } from '../../lib/itemOrder';
import type { ItemOrder } from '../../lib/route';

/** Item order (15 Nov 2026): who goes first at a shared process, and what it changes against the other rule. */
export function ItemOrderCard({ io, editable, onRush, onUsePriority }: { io: ItemOrder; editable: boolean; onRush: (lineId: string, on: boolean) => void; onUsePriority: () => void }) {
  const gain = gainText(io.gainDays);
  const prio = io.rule === 'PRIORITY';
  const other = prio ? io.readyListed : io.readyPriority;
  return (
    <div className="card">
      <strong>Item order</strong>
      <p className="small">{itemOrderRule(io)}</p>
      <p className="small">
        {io.ready ? (
          <>
            WO ready <strong>{formatDay(io.ready)}</strong>
            {other && ` · ${prio ? 'in listed order' : 'with item priority'}: ${formatDay(other)}`}
          </>
        ) : (
          'WO ready date to be confirmed (a step has no time yet)'
        )}
        {gain && gain.tone !== 'neutral' && <span className={`pill ${gain.tone} inline-pill`}>{prio ? gain.text : `priority: ${gain.text}`}</span>}
        {gain && gain.tone === 'neutral' && <span className="muted"> · {gain.text}</span>}
      </p>
      <ol className="small plain-list">
        {io.items.map((i, n) => (
          <li key={i.lineId} className="row between">
            <span>
              {n + 1}. {i.product}
              {prio && i.rush && <span className="pill warn inline-pill">Rush</span>}
              <span className="muted"> · {daysLeftText(i)}</span>
            </span>
            {editable && prio && (
              <button type="button" className="secondary small" onClick={() => onRush(i.lineId, !i.rush)}>
                {i.rush ? 'Rush off' : 'Rush'}
              </button>
            )}
          </li>
        ))}
      </ol>
      {!prio && editable && (
        <>
          <p className="muted small">This WO was confirmed before item priority, so its plan keeps the listed order. Switching changes its expected dates{gain ? ` (${gain.text})` : ''}; the internal deadline stays.</p>
          <button type="button" className="secondary small" onClick={onUsePriority}>
            Use item priority
          </button>
        </>
      )}
    </div>
  );
}


/** The company's WO planning view: each process with the items of this order it handles (5 Nov 2026). */
export function ProcessPlanCard({ rows, processes, departments, workHours }: { rows: ReturnType<typeof processPlanRows>; processes: Map<string, Process>; departments: Department[]; workHours?: number | null }) {
  if (!rows.length) return null;
  return (
    <details className="card">
      <summary>
        <strong>Plan by process</strong> <span className="muted small">{rows.length} processes · tap to show</span>
      </summary>
      <div className="table-scroll">
        <table className="small proc-plan">
          <thead>
            <tr>
              <th>Process</th>
              <th className="num">Quantity</th>
              <th>Output / day</th>
              <th className="num">Days</th>
              <th>Start → finish</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dept = departmentsFor(r.processId, departments).map((d) => d.name).join(', ');
              return (
                <tr key={r.processId}>
                  <td>
                    {processes.get(r.processId)?.name ?? 'Process'}
                    {r.done && ' ✓'}
                    <span className="muted block">
                      {r.items} item{r.items === 1 ? '' : 's'}
                      {dept && ` · ${dept}`}
                    </span>
                  </td>
                  <td className="num">{r.qty}</td>
                  <td>
                    {r.rate}
                    {r.units > 1 && <span className="muted block">× {r.units} units</span>}
                  </td>
                  <td className="num">
                    {r.days === null ? <span className="warn">pending</span> : formatQty(r.days)}
                    {hoursText(r.rawDays, { workHours }) && <span className="muted block">{hoursText(r.rawDays, { workHours })!.replace(' working hours', ' h').replace(' working hour', ' h')}</span>}
                  </td>
                  <td>
                    {r.start && r.finish ? `${formatDay(r.start)} → ${formatDay(r.finish)}` : <span className="warn">to be confirmed</span>}
                    {r.undated > 0 && r.start && (
                      <span className="warn block">
                        + {r.undated} item{r.undated === 1 ? '' : 's'} not dated yet (finish at the earliest)
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Days = work at the planned output, on the process's parallel units (Masters → Processes). A step starts once the previous step has one day of its work ready; items waiting for the same process go in the order set in the Item order card. Quantities are never added across
        units.
      </p>
    </details>
  );
}
