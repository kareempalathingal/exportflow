import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { departmentsFor, stepMessage } from '../../lib/contacts';
import { deliveryDoc, riskDoc, stockDoc, summaryDoc, workDoc } from '../../lib/docs/managerDocs';
import { addDays, formatDay, type JobOrder } from '../../lib/jobOrders';
import {
  atRiskOrders,
  DEFAULT_WORK_DAYS,
  deliverySchedule,
  departmentWork,
  FITS_LABEL,
  managementSummary,
  NEXT_DELIVERY_DAYS,
  OLD_COUNT_DAYS,
  periodRange,
  RISK_LABEL,
  riskText,
  stockAllocation,
  summaryText,
  workRowWhen,
  workText,
  type PeriodPreset,
  type RiskItem,
  type RiskLevel,
} from '../../lib/managerReports';
import type { Department, MasterData } from '../../lib/masters';
import type { StockCount } from '../../lib/materials';
import type { PlanContext } from '../../lib/route';
import { readPref, writePref } from '../../lib/storage';
import { formatQty, unitLabel } from '../../lib/units';
import { DocButtons } from '../docs/DocButtons';
import { StepContacts } from '../masters/ContactButtons';
import { SettingSection } from '../settings/SettingSection';
import { shareText } from './TodayCard';
import { tasksDoc } from '../../lib/docs/tasksDoc';
import { groupTasks, isActive, tasksText, type Task } from '../../lib/tasks';

type Jo = JobOrder & { id: string };
interface Common {
  jos: Jo[];
  ctx: PlanContext;
  today: string;
  company: string;
  generatedAt: () => string;
}

/** Share plain text (WhatsApp, email…) through the share sheet, or copy it. */
function ShareTextButton({ title, text }: { title: string; text: () => string }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    const r = await shareText(title, text());
    if (r === 'cancelled') return;
    setMsg(r === 'shared' ? 'Passed to the share menu.' : 'Copied — paste it where you need it.');
    setTimeout(() => setMsg(null), 3000);
  }
  return (
    <>
      <button type="button" className="secondary small" onClick={() => void go()}>
        Share as text
      </button>
      {msg && <span className="ok small"> {msg}</span>}
    </>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented wrap" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function DateRange({ value, onChange }: { value: { from: string; to: string }; onChange: (v: { from: string; to: string }) => void }) {
  return (
    <div className="grid2">
      <label>
        From
        <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
      </label>
      <label>
        To
        <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </label>
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// Orders at risk
// ---------------------------------------------------------------------------

const RISK_CLS: Record<RiskLevel, string> = { LATE: 'bad', HIGH: 'warn', WATCH: 'neutral' };

function RiskList({ items }: { items: RiskItem[] }) {
  if (!items.length) return <p className="ok small">No open order is late or at risk.</p>;
  return (
    <ul className="today-list report-list">
      {items.map((i) => (
        <li key={i.joId}>
          <span className={`pill ${RISK_CLS[i.level]}`}>{RISK_LABEL[i.level]}</span> <Link to={`/orders/${i.joId}`}>{i.joNumber}</Link>
          <span className="muted small"> · {i.customer || '—'}</span>
          <ul className="small reasons">
            {i.reasons.map((r, n) => (
              <li key={n}>{r}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export function RiskSection({ jos, ctx, today, company, generatedAt, redAt }: Common & { redAt: number }) {
  const items = useMemo(() => atRiskOrders({ jobOrders: jos, ctx, today, redAt }), [jos, ctx, today, redAt]);
  const n = (l: RiskLevel) => items.filter((i) => i.level === l).length;
  const sum = items.length ? [n('LATE') && `${n('LATE')} late`, n('HIGH') && `${n('HIGH')} at risk`, n('WATCH') && `${n('WATCH')} to watch`].filter(Boolean).join(' · ') : 'None';
  return (
    <SettingSection title="Orders at risk" summary={sum} flag={n('LATE') ? 'bad' : n('HIGH') ? 'warn' : null} flagLabel="Late or at risk">
      <div className="card">
        <RiskList items={items} />
        <div className="row gap wrap">
          <ShareTextButton title="Orders at risk" text={() => riskText(items, company, today)} />
        </div>
        <DocButtons label="Orders at risk (PDF)" build={() => riskDoc(items, { company, today, generatedAt: generatedAt() })} />
        <p className="muted small">Late = a deadline has passed. At risk = expected to miss the internal deadline, far behind plan, or still in planning. Watch = slightly behind, a step over plan, or not tracked.</p>
      </div>
    </SettingSection>
  );
}

// ---------------------------------------------------------------------------
// Delivery schedule
// ---------------------------------------------------------------------------

type DeliveryPreset = '30' | '60' | '90' | 'custom';

export function DeliverySection({ jos, ctx, today, company, generatedAt }: Common) {
  const [preset, setPreset] = useState<DeliveryPreset>('30');
  const [custom, setCustom] = useState(() => ({ from: today, to: addDays(today, 29)! }));
  const range = preset === 'custom' ? custom : { from: today, to: addDays(today, Number(preset) - 1)! };
  const valid = range.from <= range.to;
  const s = useMemo(() => (valid ? deliverySchedule({ jobOrders: jos, ctx, today, from: range.from, to: range.to }) : null), [valid, jos, ctx, today, range.from, range.to]);
  // The row's status always covers the next 30 days, whatever is chosen inside.
  const head = useMemo(() => deliverySchedule({ jobOrders: jos, ctx, today, from: today, to: addDays(today, 29)! }), [jos, ctx, today]);
  const passed = head.rows.filter((r) => r.daysLeft < 0).length;
  const notInTime = head.rows.filter((r) => r.outlook.fits === 'NO').length;
  const due = head.rows.length - passed;
  return (
    <SettingSection
      title="Delivery schedule"
      summary={`${due} in 30 days${passed ? ` · ${passed} passed` : ''}${notInTime ? ` · ${notInTime} not in time` : ''}`}
      flag={passed ? 'bad' : notInTime ? 'warn' : null}
      flagLabel="Delivery passed or not in time"
    >
      <div className="card">
        <Segmented
          label="Period"
          value={preset}
          onChange={setPreset}
          options={[
            ['30', '30 days'],
            ['60', '60 days'],
            ['90', '90 days'],
            ['custom', 'Custom'],
          ]}
        />
        {preset === 'custom' && <DateRange value={custom} onChange={setCustom} />}
        {!valid && <p className="error small">“From” must be on or before “To”.</p>}
        {s && (
          <>
            <p className="muted small">
              {formatDay(s.from)} – {formatDay(s.to)} · {plural(s.rows.length, 'order')}
            </p>
            {s.rows.length === 0 ? (
              <p className="muted small">No deliveries in this period.</p>
            ) : (
              <ul className="today-list report-list">
                {s.rows.map((r) => (
                  <li key={r.joId}>
                    <strong>{formatDay(r.deliveryDate)}</strong> · <Link to={`/orders/${r.joId}`}>{r.joNumber}</Link>
                    {r.status === 'DRAFT' && <span className="pill neutral">Draft</span>}
                    <span className="muted small"> · {r.customer || '—'}</span>
                    <span className="small block">
                      {r.daysLeft < 0 ? <span className="error">Delivery date passed · </span> : null}
                      Internal deadline {formatDay(r.internalDeadline)} · {r.progress}
                    </span>
                    <span className="small block">
                      Expected finish {r.outlook.fits === 'DRAFT' ? 'after plan approval' : r.outlook.expectedFinish ? `${formatDay(r.outlook.expectedFinish)}${r.outlook.estimated ? ' (estimate)' : ''}` : 'to be confirmed'} · In time:{' '}
                      <span className={r.outlook.fits === 'NO' ? 'error' : r.outlook.fits === 'YES' ? 'ok' : 'muted'}>{FITS_LABEL[r.outlook.fits]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <DocButtons label="Delivery schedule (PDF)" build={() => deliveryDoc(s, { company, today, generatedAt: generatedAt() })} />
          </>
        )}
      </div>
    </SettingSection>
  );
}

// ---------------------------------------------------------------------------
// Management summary
// ---------------------------------------------------------------------------

type SummaryPreset = PeriodPreset | 'custom';

export function SummarySection({ jos, ctx, today, company, generatedAt, redAt }: Common & { redAt: number }) {
  const [preset, setPreset] = useState<SummaryPreset>('this-week');
  const [custom, setCustom] = useState(() => periodRange('this-week', today));
  const range = preset === 'custom' ? custom : periodRange(preset, today);
  const valid = range.from <= range.to;
  const s = useMemo(() => (valid ? managementSummary({ jobOrders: jos, ctx, today, from: range.from, to: range.to, redAt }) : null), [valid, jos, ctx, today, range.from, range.to, redAt]);
  const pct = (n: number, of: number) => (of ? ` (${Math.round((n / of) * 100)}%)` : '');
  return (
    <SettingSection title="Management summary" summary="Week · month · PDF">
      <div className="card">
        <Segmented
          label="Period"
          value={preset}
          onChange={setPreset}
          options={[
            ['this-week', 'This week'],
            ['last-week', 'Last week'],
            ['this-month', 'This month'],
            ['last-month', 'Last month'],
            ['custom', 'Custom'],
          ]}
        />
        {preset === 'custom' && <DateRange value={custom} onChange={setCustom} />}
        {!valid && <p className="error small">“From” must be on or before “To”.</p>}
        {s && (
          <>
            <p className="muted small">
              {formatDay(s.from)} – {formatDay(s.to)} · weeks run Monday to Sunday
            </p>
            <dl className="kv small">
              <dt>Received</dt>
              <dd>
                {s.received.count}
                {s.received.cancelledSince ? ` (${s.received.cancelledSince} since cancelled)` : ''}
              </dd>
              <dt>Confirmed</dt>
              <dd>{s.confirmed}</dd>
              <dt>Completed</dt>
              <dd>
                {s.completed.count}
                {s.completed.count > 0 &&
                  ` · by internal deadline ${s.completed.onTimeInternal}${pct(s.completed.onTimeInternal, s.completed.count)} · before delivery ${s.completed.onTimeDelivery}${pct(s.completed.onTimeDelivery, s.completed.count)}`}
              </dd>
              <dt>Open today</dt>
              <dd>
                {s.openNow.onTrack} on track · {s.openNow.behind} behind · {s.openNow.late} late · {s.openNow.notTracked} not tracked · {s.openNow.drafts} in planning
              </dd>
              <dt>Next {NEXT_DELIVERY_DAYS} days</dt>
              <dd>{s.nextDeliveries.length ? s.nextDeliveries.map((r) => `${r.joNumber} ${formatDay(r.deliveryDate)}`).join(' · ') : 'No deliveries'}</dd>
              <dt>Risks</dt>
              <dd>{s.riskTotal ? `${s.riskTotal} (top ${s.risks.length} in the summary)` : 'None'}</dd>
            </dl>
            <div className="row gap wrap">
              <ShareTextButton title="Management summary" text={() => summaryText(s, company)} />
            </div>
            <DocButtons label="Management summary (PDF)" build={() => summaryDoc(s, { company, generatedAt: generatedAt() })} />
          </>
        )}
      </div>
    </SettingSection>
  );
}

// ---------------------------------------------------------------------------
// Department work list
// ---------------------------------------------------------------------------

const WORK_DAYS_KEY = 'workListDays';
const readWorkDays = () => {
  const n = Number(readPref(WORK_DAYS_KEY));
  return Number.isInteger(n) && n >= 1 && n <= 30 ? n : DEFAULT_WORK_DAYS;
};

export function WorkSection({ jos, ctx, today, company, generatedAt, departments }: Common & { departments: (Department & { id: string })[] }) {
  const [days, setDays] = useState(readWorkDays);
  const [daysText, setDaysText] = useState(String(readWorkDays()));
  const [only, setOnly] = useState('');
  const w = useMemo(() => departmentWork({ jobOrders: jos, ctx, today, days, departments }), [jos, ctx, today, days, departments]);
  const shown = only ? w.groups.filter((g) => g.id === only) : w.groups;
  const chosen = w.groups.find((g) => g.id === only);
  const total = w.groups.reduce((a, g) => a + g.rows.length, 0);
  const late = w.groups.some((g) => g.rows.some((r) => (r.overrunDays ?? 0) > 0));
  function changeDays(text: string) {
    setDaysText(text);
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= 30) {
      setDays(n);
      writePref(WORK_DAYS_KEY, n === DEFAULT_WORK_DAYS ? null : String(n));
    }
  }
  const daysOk = String(days) === daysText.trim();
  return (
    <SettingSection title="Department work list" summary={`${total} step${total === 1 ? '' : 's'} · ${days} working day${days === 1 ? '' : 's'}`} flag={late ? 'warn' : null} flagLabel="A step is over plan">
      <div className="card">
        <div className="grid2">
          <label>
            Working days ahead
            <input type="number" inputMode="numeric" min={1} max={30} value={daysText} onChange={(e) => changeDays(e.target.value)} />
          </label>
          <label>
            Department
            <select value={only} onChange={(e) => setOnly(e.target.value)}>
              <option value="">All departments</option>
              {w.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.rows.length})
                </option>
              ))}
            </select>
          </label>
        </div>
        {!daysOk && <p className="error small">Enter 1 to 30 working days.</p>}
        <p className="muted small">
          Today to {formatDay(w.until)} · steps running now and steps that start in this period. Each order is planned on its own; department capacity is not checked yet.
        </p>
        {shown.length === 0 && <p className="muted small">No process steps running or due in this period.</p>}
        {shown.map((g) => (
          <div key={g.id} className="today-group">
            <strong>{g.name}</strong>
            <ul className="today-list report-list">
              {g.rows.map((r, n) => {
                const depts = departmentsFor(r.processId, departments);
                return (
                  <li key={n}>
                    <Link to={`/orders/${r.joId}?tab=products`}>
                      {r.joNumber} · {r.product}
                    </Link>
                    <span className="small block">
                      {r.step}
                      {r.quantity ? ` · ${r.quantity}` : ''}
                    </span>
                    <span className={`small block ${(r.overrunDays ?? 0) > 0 ? 'error' : 'muted'}`}>{workRowWhen(r)}</span>
                    {r.state === 'NOW' && depts.length > 0 && (
                      <StepContacts
                        departments={depts}
                        message={(p) => stepMessage({ person: p.name, joNumber: r.joNumber, product: r.product, step: r.step, quantity: r.quantity, plannedFinish: r.finish ? formatDay(r.finish) : null, late: (r.overrunDays ?? 0) > 0 })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="row gap wrap">
          <ShareTextButton title={chosen ? `Work list - ${chosen.name}` : 'Work list'} text={() => workText(shown, { company, today, until: w.until })} />
        </div>
        <DocButtons
          label={chosen ? `Work list · ${chosen.name} (PDF)` : 'Work list · all departments (PDF)'}
          build={() => workDoc(shown, { company, today, until: w.until, generatedAt: generatedAt(), department: chosen?.name })}
        />
      </div>
    </SettingSection>
  );
}

// ---------------------------------------------------------------------------
// Stock allocation
// ---------------------------------------------------------------------------

export function StockSection({ jos, md, counts, today, company, generatedAt }: Omit<Common, 'ctx'> & { md: MasterData; counts: StockCount[] }) {
  const rows = useMemo(() => stockAllocation({ jobOrders: jos, counts, md, today }), [jos, counts, md, today]);
  const over = rows.filter((r) => r.state === 'OVER').length;
  const old = rows.filter((r) => r.oldCount).length;
  const q = (n: number, u: string) => `${formatQty(n)} ${unitLabel(u)}`;
  return (
    <SettingSection
      title="Stock allocation"
      summary={rows.length ? [`${rows.length} item${rows.length === 1 ? '' : 's'}`, over && `${over} over-allocated`, old && `${old} old count${old === 1 ? '' : 's'}`].filter(Boolean).join(' · ') : 'No stock recorded'}
      flag={over ? 'bad' : old ? 'warn' : null}
      flagLabel="Over-allocated or old count"
    >
      <div className="card">
        {rows.length === 0 && <p className="muted small">No stock counted or set aside on open orders.</p>}
        <ul className="today-list report-list">
          {rows.map((r) => (
            <li key={r.key}>
              <strong>{r.name}</strong>
              {r.state === 'OVER' && <span className="pill bad">Over-allocated</span>}
              {r.oldCount && <span className="pill warn">Count is old</span>}
              <span className="small block">
                Counted: {r.counted === null ? <span className="muted">not counted (manual only)</span> : `${q(r.counted, r.unit)} on ${formatDay(r.countedOn)}`}
              </span>
              <span className="small block">
                Set aside (confirmed): {q(r.confirmed, r.unit)}
                {r.free !== null && <> · Free: <span className={r.free < 0 ? 'error' : ''}>{q(r.free, r.unit)}</span></>}
                {r.draft > 0 && <span className="muted"> · drafts {q(r.draft, r.unit)}</span>}
              </span>
              {r.orders.length > 0 && (
                <span className="small block">
                  {r.orders.map((o, i) => (
                    <span key={o.joId}>
                      {i > 0 && ' · '}
                      <Link to={`/orders/${o.joId}?tab=materials`}>{o.joNumber}</Link> {formatQty(o.qty)}
                      {o.status === 'DRAFT' ? ' (draft)' : ''}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
        <DocButtons label="Stock allocation (PDF)" build={() => stockDoc(rows, { company, today, generatedAt: generatedAt(), oldDays: OLD_COUNT_DAYS })} />
        <p className="muted small">Free = last count minus stock set aside on confirmed orders. A count older than {OLD_COUNT_DAYS} days is marked old. Counts are entered on each order’s Materials tab.</p>
      </div>
    </SettingSection>
  );
}


// ---------------------------------------------------------------------------
// Follow-up list (Work tasks)
// ---------------------------------------------------------------------------

export function FollowUpSection({ tasks, departments, company, today, generatedAt }: { tasks: (Task & { id: string })[]; departments: (Department & { id: string })[]; company: string; today: string; generatedAt: () => string }) {
  const [dept, setDept] = useState('');
  const deptName = (id: string) => (id ? (departments.find((d) => d.id === id)?.name ?? 'Unknown department') : 'General');
  const list = tasks.filter((t) => !dept || (dept === 'general' ? !t.departmentId : t.departmentId === dept));
  const open = tasks.filter(isActive).length;
  const overdue = groupTasks(tasks, today).find((g) => g.group === 'OVERDUE')?.tasks.length ?? 0;
  const label = dept ? (dept === 'general' ? 'General' : deptName(dept)) : undefined;
  return (
    <SettingSection title="Follow-ups (Work)" summary={open ? `${open} open${overdue ? ` · ${overdue} overdue` : ''}` : 'Nothing open'} flag={overdue ? 'bad' : null} flagLabel="Overdue tasks">
      <div className="card">
        <label>
          Department
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">All departments</option>
            <option value="general">General</option>
            {departments
              .filter((d) => d.active !== false)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <div className="row gap wrap">
          <ShareTextButton title={label ? `Follow-ups - ${label}` : 'Follow-ups'} text={() => tasksText(list, { company, today, title: label ? `Follow-ups - ${label}` : 'Follow-ups', deptName })} />
        </div>
        <DocButtons label={label ? `Follow-up list · ${label} (PDF)` : 'Follow-up list (PDF)'} build={() => tasksDoc(list, { company, today, generatedAt: generatedAt(), deptName, department: label })} />
        <p className="muted small">
          The working list is in <Link to="/work">Work</Link>.
        </p>
      </div>
    </SettingSection>
  );
}
