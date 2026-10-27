/**
 * Reports → "My report" (weekly / monthly, for my superior) and "Look ahead"
 * (confirmed 27 Oct 2026). Both are built from the records on the phone; the
 * highlights are suggestions the user edits (kept on this phone per period).
 */
import { useEffect, useMemo, useState } from 'react';
import { lookAheadDoc, myReportDoc } from '../../lib/docs/reportsDocs';
import { addDays, formatDay, type JobOrder } from '../../lib/jobOrders';
import type { KpiTargets } from '../../lib/kpi';
import { buildLookAhead, type LookAhead } from '../../lib/lookAhead';
import { periodRange } from '../../lib/managerReports';
import type { Department } from '../../lib/masters';
import { buildMyReport } from '../../lib/myReport';
import type { PlanContext } from '../../lib/route';
import { readPref, writePref } from '../../lib/storage';
import type { Task } from '../../lib/tasks';
import { formatClock } from '../../lib/time';
import { formatQty, unitLabel } from '../../lib/units';
import { DocButtons } from '../docs/DocButtons';
import { SettingSection } from '../settings/SettingSection';
import { DateRange, Segmented } from './ManagerReports';

interface Common {
  jos: (JobOrder & { id: string })[];
  ctx: PlanContext;
  today: string;
  company: string;
  generatedAt: () => string;
  departments: (Department & { id: string })[];
  processNames: Map<string, string>;
  tasks: (Task & { id: string })[];
  deptName: (id: string) => string;
}

type MyPreset = 'last-week' | 'this-week' | 'last-month' | 'this-month' | 'custom';
const HL_KEY = (from: string, to: string) => `reportHighlights:${from}:${to}`;

export function MyReportSection(props: Common & { targets: KpiTargets; preparedBy: { name: string; designation: string } }) {
  const { jos, ctx, today, company, generatedAt, departments, processNames, tasks, deptName, targets, preparedBy } = props;
  const [preset, setPreset] = useState<MyPreset>('last-week');
  const [custom, setCustom] = useState(() => periodRange('last-week', today));
  const range = preset === 'custom' ? custom : periodRange(preset, today);
  const valid = range.from <= range.to;
  const monthly = preset === 'this-month' || preset === 'last-month';
  const r = useMemo(
    () => (valid ? buildMyReport({ jobOrders: jos, ctx, from: range.from, to: range.to, today, monthly, departments, processNames, history: [], tasks, targets, deptName }) : null),
    [valid, jos, ctx, range.from, range.to, today, monthly, departments, processNames, tasks, targets, deptName],
  );
  const suggested = (r?.highlights ?? []).join('\n');
  const [text, setText] = useState<string | null>(null);
  // Edited highlights are kept on this phone for that period.
  useEffect(() => setText(readPref(HL_KEY(range.from, range.to))), [range.from, range.to]);
  const highlights = text ?? suggested;
  const edit = (v: string) => {
    setText(v);
    writePref(HL_KEY(range.from, range.to), v === suggested ? null : v);
  };
  const t = r?.tiles;
  return (
    <SettingSection title="My report" summary="Week · month · for my superior">
      <div className="card">
        <Segmented
          label="Period"
          value={preset}
          onChange={setPreset}
          options={[
            ['last-week', 'Last week'],
            ['this-week', 'This week'],
            ['last-month', 'Last month'],
            ['this-month', 'This month'],
            ['custom', 'Custom'],
          ]}
        />
        {preset === 'custom' && <DateRange value={custom} onChange={setCustom} />}
        {!valid && <p className="error small">“From” must be on or before “To”.</p>}
        {r && t && (
          <>
            <p className="muted small">
              {formatDay(r.from)} – {formatDay(r.to)} · compared with {formatDay(r.prevFrom)} – {formatDay(r.prevTo)}
            </p>
            <dl className="kv small">
              <dt>Orders confirmed</dt>
              <dd>{t.confirmed}</dd>
              <dt>Steps finished</dt>
              <dd>
                {t.stepsDone}
                {t.stepsTimed ? ` · ${t.stepsOnTime} of ${t.stepsTimed} on time` : ''}
              </dd>
              <dt>Orders completed</dt>
              <dd>{t.completed}</dd>
              <dt>Follow-ups closed</dt>
              <dd>
                {t.tasksDone}
                {t.tasksDone ? ` · ${t.resolved} resolved${t.escalated ? ` · ${t.escalated} escalated` : ''}` : ''}
              </dd>
              <dt>Delays found</dt>
              <dd>{r.delays.length}</dd>
            </dl>
            <label>
              Highlights (one per line — edit before sending)
              <textarea rows={Math.min(10, Math.max(3, highlights.split('\n').length + 1))} value={highlights} onChange={(e) => edit(e.target.value)} />
            </label>
            {text !== null && text !== suggested && (
              <button type="button" className="linkish small" onClick={() => edit(suggested)}>
                Back to the suggestions
              </button>
            )}
            {!preparedBy.name && <p className="muted small">Add your name and designation in Settings so they appear under “Prepared by”.</p>}
            <DocButtons
              label={`${monthly ? 'Monthly' : 'Weekly'} report (PDF)`}
              build={() => myReportDoc(r, { company, generatedAt: generatedAt(), highlights: highlights.split('\n'), preparedBy, today })}
            />
            <p className="muted small">Built only from what is recorded in the app. Mark tasks Done with a short note so they show here.</p>
          </>
        )}
      </div>
    </SettingSection>
  );
}

type AheadPreset = '7' | '28' | '91' | 'custom';

export function LookAheadSection(props: Common) {
  const { jos, ctx, today, company, generatedAt, departments, processNames, tasks, deptName } = props;
  const [preset, setPreset] = useState<AheadPreset>('28');
  const [custom, setCustom] = useState(() => ({ from: today, to: addDays(today, 27)! }));
  const range = preset === 'custom' ? custom : { from: today, to: addDays(today, Number(preset) - 1)! };
  const valid = range.from <= range.to;
  const la = useMemo(
    () => (valid ? buildLookAhead({ jobOrders: jos, ctx, from: range.from, to: range.to, today, departments, processNames, tasks, deptName }) : null),
    [valid, jos, ctx, range.from, range.to, today, departments, processNames, tasks, deptName],
  );
  return (
    <SettingSection title="Look ahead" summary="Busy weeks · dates · materials">
      <div className="card">
        <Segmented
          label="Period"
          value={preset}
          onChange={setPreset}
          options={[
            ['7', 'Next 7 days'],
            ['28', 'Next 4 weeks'],
            ['91', 'Next 3 months'],
            ['custom', 'Custom'],
          ]}
        />
        {preset === 'custom' && <DateRange value={custom} onChange={setCustom} />}
        {!valid && <p className="error small">“From” must be on or before “To”.</p>}
        {la && <LookAheadView la={la} today={today} />}
        {la && <DocButtons label="Look ahead (PDF)" build={() => lookAheadDoc(la, { company, generatedAt: generatedAt(), today })} />}
      </div>
    </SettingSection>
  );
}

const HEAT = ['', 'heat-1', 'heat-2', 'heat-3'];

function LookAheadView({ la, today }: { la: LookAhead; today: string }) {
  return (
    <>
      <p className="small">{la.summary}</p>
      <div className="table-scroll">
        <table className="heat-table small">
          <thead>
            <tr>
              <th>Department</th>
              {la.weeks.map((w) => (
                <th key={w.start}>{la.byMonth ? w.label : `wk ${w.label}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {la.departments.map((d) => (
              <tr key={d.id}>
                <th scope="row">{d.name}</th>
                {d.cells.map((c, i) => (
                  <td key={la.weeks[i]!.start} className={HEAT[c.level]}>
                    {c.orders ? (
                      <>
                        <strong>{c.orders}</strong> · pk {c.peak}
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Orders with a step there · peak jobs at the same time. Darker = busier. Department capacity is not known yet, so this is relative.</p>
      {la.departments.some((d) => d.quietWeeks.length) && (
        <dl className="kv small">
          {la.departments.map((d) => (
            <div key={d.id} style={{ display: 'contents' }}>
              <dt>{d.name}</dt>
              <dd>Quieter: {d.quietWeeks.length ? d.quietWeeks.map((w) => la.weeks.find((x) => x.start === w)?.label ?? w).join(', ') : 'none'}</dd>
            </div>
          ))}
        </dl>
      )}
      {la.materials.length > 0 && (
        <>
          <p className="small">
            <strong>Materials needed</strong>
          </p>
          <ul className="small plain-list">
            {la.materials.slice(0, 8).map((m, i) => (
              <li key={i} className={m.overdue ? 'warn' : ''}>
                {m.name}: {formatQty(m.qty)} {unitLabel(m.unit)} by {m.overdue ? 'now' : formatDay(m.neededBy)} ({m.joNumber})
              </li>
            ))}
          </ul>
        </>
      )}
      {(la.dates.length > 0 || la.tasks.length > 0) && (
        <>
          <p className="small">
            <strong>Dates and work</strong>
          </p>
          <ul className="small plain-list">
            {la.dates.map((d, i) => (
              <li key={`d${i}`}>
                {formatDay(d.date)}: {d.text}
              </li>
            ))}
            {la.tasks.slice(0, 8).map((t, i) => (
              <li key={`t${i}`} className={t.date < today ? 'warn' : ''}>
                {formatDay(t.date)}
                {t.time ? ` ${formatClock(t.time)}` : ''}: {t.title}
                {t.repeat ? ' (repeats)' : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
