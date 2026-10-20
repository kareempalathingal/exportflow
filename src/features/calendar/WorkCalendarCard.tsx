import { useState } from 'react';
import { dayOff, holidaysIn, monthGrid, shiftMonth, WEEKDAY_NAMES, type WorkCalendar } from '../../lib/calendar';
import { formatDay } from '../../lib/jobOrders';
import { istDateKey } from '../../lib/time';
import { saveRecord } from '../sync/records';
import { useWorkCalendar } from './useWorkCalendar';

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Month calendar on the dashboard. Tap a day to mark it a company holiday
 * (tap again to remove). Sundays are the weekly off by default. Plans, step
 * times and internal deadlines count working days only.
 */
export function WorkCalendarCard() {
  const today = istDateKey(new Date());
  const { cal, item, workspaceId, loading } = useWorkCalendar();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [msg, setMsg] = useState<string | null>(null);
  const weeks = monthGrid(month);
  const list = holidaysIn(month, cal);

  function save(next: WorkCalendar, what: string) {
    if (!workspaceId) return;
    saveRecord({ workspaceId, collectionName: 'settings', docId: 'calendar', entity: 'Work calendar', before: item, data: { weeklyOff: next.weeklyOff, holidays: next.holidays }, reason: what });
    setMsg(`${what}. Plans and open draft deadlines now use it.`);
    setTimeout(() => setMsg(null), 4000);
  }

  function tap(date: string) {
    const off = dayOff(date, cal);
    if (date in cal.holidays) {
      if (!window.confirm(`Remove the holiday on ${formatDay(date)}${cal.holidays[date] ? ` (${cal.holidays[date]})` : ''}?`)) return;
      const holidays = { ...cal.holidays };
      delete holidays[date];
      save({ ...cal, holidays }, `Holiday removed: ${formatDay(date)}`);
      return;
    }
    if (off.off) {
      setMsg(`${formatDay(date)} is a weekly off day (${off.reason}). Change weekly off days below.`);
      setTimeout(() => setMsg(null), 4000);
      return;
    }
    const name = window.prompt(`Mark ${formatDay(date)} as a company holiday?\nName (optional, e.g. Onam):`, '');
    if (name === null) return;
    save({ ...cal, holidays: { ...cal.holidays, [date]: name.trim().slice(0, 60) } }, `Holiday added: ${formatDay(date)}${name.trim() ? ` (${name.trim()})` : ''}`);
  }

  function toggleWeekly(d: number) {
    const has = cal.weeklyOff.includes(d);
    const weeklyOff = has ? cal.weeklyOff.filter((x) => x !== d) : [...cal.weeklyOff, d].sort();
    if (weeklyOff.length >= 7) return;
    save({ ...cal, weeklyOff }, `Weekly off: ${weeklyOff.length ? weeklyOff.map((x) => WEEKDAY_NAMES[x]).join(', ') : 'none'}`);
  }

  return (
    <section className="card work-cal" aria-label="Company calendar">
      <div className="row between">
        <h3>Calendar</h3>
        <span className="row gap">
          <button type="button" className="secondary small icon" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
            ‹
          </button>
          <button type="button" className="secondary small" onClick={() => setMonth(today.slice(0, 7))} disabled={month === today.slice(0, 7)}>
            Today
          </button>
          <button type="button" className="secondary small icon" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
            ›
          </button>
        </span>
      </div>
      <p className="cal-month">{monthFmt.format(new Date(`${month}-01T00:00:00Z`))}</p>
      {loading ? (
        <p className="muted small">Loading…</p>
      ) : (
        <table className="cal-grid">
          <thead>
            <tr>
              {SHORT.map((d, i) => (
                <th key={d} scope="col" className={cal.weeklyOff.includes(i) ? 'off' : ''}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, wi) => (
              <tr key={wi}>
                {w.map((date, di) => {
                  if (!date) return <td key={`b${wi}-${di}`} />;
                  const off = dayOff(date, cal);
                  const cls = ['cal-day', off.off ? 'off' : '', date in cal.holidays ? 'holiday' : '', date === today ? 'today' : ''].filter(Boolean).join(' ');
                  return (
                    <td key={date}>
                      <button type="button" className={cls} aria-label={`${formatDay(date)}${off.off ? ` — ${off.reason}` : ''}`} disabled={!workspaceId} onClick={() => tap(date)}>
                        {Number(date.slice(8))}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && <p className="ok small">{msg}</p>}
      {list.length > 0 ? (
        <ul className="cal-holidays">
          {list.map((h) => (
            <li key={h.date}>
              <span className="mono">{formatDay(h.date)}</span> {h.name || 'Company holiday'}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No company holidays this month. Tap a day to add one.</p>
      )}
      <details>
        <summary className="small">Weekly off: {cal.weeklyOff.length ? cal.weeklyOff.map((x) => WEEKDAY_NAMES[x]).join(', ') : 'none'}</summary>
        <div className="row gap wrap">
          {WEEKDAY_NAMES.map((n, i) => (
            <label key={n} className="check small">
              <input type="checkbox" checked={cal.weeklyOff.includes(i)} disabled={!workspaceId} onChange={() => toggleWeekly(i)} /> {n}
            </label>
          ))}
        </div>
      </details>
      <p className="muted small">
        Plans, step times and internal deadlines count working days only. Confirmed orders keep their deadline until you recalculate it. The same calendar is used in Demo and Actual.
      </p>
    </section>
  );
}
