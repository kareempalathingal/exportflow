import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { tasksDoc } from '../../lib/docs/tasksDoc';
import { COLLECTIONS, type Department } from '../../lib/masters';
import {
  completeTask,
  COLLECTION_TASKS,
  dueText,
  emptyTask,
  followUpTask,
  GROUP_LABEL,
  groupTasks,
  isActive,
  isOverdue,
  outcomeText,
  repeatLabel,
  taskMessage,
  tasksText,
  validateTask,
  withTaskDefaults,
  type NextStep,
  type Task,
  type TaskGroup,
  type TaskOutcome,
} from '../../lib/tasks';
import { formatDateTime, istDateKey, istTimeKey } from '../../lib/time';
import { DocButtons } from '../docs/DocButtons';
import { StepContacts } from '../masters/ContactButtons';
import { newId, useCollection, type WithMeta } from '../masters/useCollection';
import { permissionHint } from '../orders/OrderBits';
import { shareText } from '../reports/TodayCard';
import { useProfile } from '../settings/useProfile';
import { saveRecord } from '../sync/records';

const GROUP_CLS: Partial<Record<TaskGroup, string>> = { OVERDUE: 'bad', TODAY: 'warn', WAITING: 'neutral', DONE: 'ok' };

/** How a task ended, and what comes next when it was not resolved (confirmed 27 Oct 2026). */
export interface TaskEnd {
  outcome: TaskOutcome;
  note: string;
  nextStep?: NextStep;
  /** For ESCALATE / FOLLOW_UP. */
  to?: { departmentId: string; person: string; dueDate: string | null; dueTime: string | null };
}

/**
 * Records a task as done with how it ended. A repeating one gets its next occurrence;
 * a task not resolved may get a follow-up or an escalation task linked to it.
 */
export function markDone(workspaceId: string, t: WithMeta<Task>, today: string, end?: TaskEnd): { nextDue: string | null; followUp: string | null } {
  const task = withTaskDefaults(t);
  const { done, next } = completeTask(task, today, end ? { outcome: end.outcome, note: end.note, nextStep: end.nextStep ?? null } : undefined);
  let followUp: string | null = null;
  if (end?.outcome === 'NOT_RESOLVED' && (end.nextStep === 'ESCALATE' || end.nextStep === 'FOLLOW_UP') && end.to) {
    const f = followUpTask(done, t.id, end.nextStep, end.to);
    const fid = newId(workspaceId, COLLECTION_TASKS);
    done.nextTaskId = fid;
    saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: fid, entity: `Task: ${f.title}`, before: null, data: strip(f), reason: end.nextStep === 'ESCALATE' ? `Escalated from: ${task.title}` : `Follow-up of: ${task.title}` });
    followUp = f.title;
  }
  const why = end ? `Done - ${end.outcome === 'RESOLVED' ? 'resolved' : 'not resolved'}` : 'Done';
  saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: t.id, entity: `Task: ${t.title}`, before: t, data: { ...strip(done) }, reason: why });
  if (!next) return { nextDue: null, followUp };
  const id = newId(workspaceId, COLLECTION_TASKS);
  saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: id, entity: `Task: ${next.title}`, before: null, data: { ...strip(next) }, reason: `Next ${repeatLabel(next.repeat)}` });
  return { nextDue: next.dueDate, followUp };
}

/** Only the task's own fields (not id / version fields). */
export function strip(task: Task): Record<string, unknown> {
  const t = withTaskDefaults(task);
  return {
    title: t.title.trim(),
    departmentId: t.departmentId,
    person: t.person.trim(),
    dueDate: t.dueDate,
    priority: t.priority,
    status: t.status,
    waitingOn: t.waitingOn.trim(),
    joId: t.joId,
    joNumber: t.joNumber,
    notes: t.notes.trim(),
    repeat: t.repeat,
    doneOn: t.doneOn,
    dueTime: t.dueTime,
    outcome: t.outcome,
    outcomeNote: t.outcomeNote.trim(),
    nextStep: t.nextStep,
    nextTaskId: t.nextTaskId,
    fromTaskId: t.fromTaskId,
  };
}

/** Work: tasks and follow-ups for every department, for the user only. */
export function WorkPage() {
  const { workspaceId, t: tr } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const today = istDateKey(new Date());
  const now = istTimeKey(new Date());
  const tasks = useCollection<Task>(workspaceId, COLLECTION_TASKS);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const [params, setParams] = useSearchParams();
  const dept = params.get('dept') ?? '';
  const showAllDone = params.get('done') === 'all';
  const deptName = useMemo(() => {
    const m = new Map(departments.items.map((d) => [d.id, d.name]));
    return (id: string) => (id ? (m.get(id) ?? 'Unknown department') : 'General');
  }, [departments.items]);
  const filtered = useMemo(() => tasks.items.filter((t) => !dept || (dept === 'general' ? !t.departmentId : t.departmentId === dept)), [tasks.items, dept]);
  const groups = useMemo(() => groupTasks(filtered, today, now), [filtered, today, now]);
  const oldDone = useMemo(() => filtered.filter((t) => (t.status === 'DONE' || t.status === 'DROPPED') && !groups.some((g) => g.tasks.includes(t))).sort((a, b) => (b.doneOn ?? '').localeCompare(a.doneOn ?? '')), [filtered, groups]);
  const open = filtered.filter(isActive).length;
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };

  // Quick add: what + date + department.
  const [qTitle, setQTitle] = useState('');
  const [qDate, setQDate] = useState('');
  const [qTime, setQTime] = useState('');
  const [qDept, setQDept] = useState('');
  function quickAdd() {
    if (!workspaceId) return;
    const t: Task = { ...emptyTask(), title: qTitle, dueDate: qDate || null, dueTime: qTime || null, departmentId: qDept || (dept && dept !== 'general' ? dept : '') };
    const err = validateTask(t);
    if (err) return flash(err);
    saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: newId(workspaceId, COLLECTION_TASKS), entity: `Task: ${t.title.trim()}`, before: null, data: strip(t) });
    setQTitle('');
    setQDate('');
    setQTime('');
    flash('Added.');
  }

  async function share() {
    const title = dept ? `Follow-ups - ${dept === 'general' ? 'General' : deptName(dept)}` : 'Follow-ups';
    const r = await shareText(title, tasksText(filtered, { company, today, now, title, deptName }));
    if (r !== 'cancelled') flash(r === 'shared' ? 'Passed to the share menu.' : 'Copied — paste it where you need it.');
  }

  const activeDepts = departments.items.filter((d) => d.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section>
      <div className="row between">
        <h2>{tr('navWork')}</h2>
        <Link className="button primary small" to="/work/new">
          + Task
        </Link>
      </div>
      {tasks.error && <p className="error small">{permissionHint(tasks.error)}</p>}

      <div className="card quick-add">
        <label>
          Quick add
          <input value={qTitle} maxLength={200} placeholder="e.g. Ask finance for Hansa payment status" enterKeyHint="done" onChange={(e) => setQTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), quickAdd())} />
        </label>
        <div className="grid2">
          <label>
            Due
            <input type="date" value={qDate} onChange={(e) => setQDate(e.target.value)} />
          </label>
          <label>
            Time (optional)
            <input type="time" value={qTime} disabled={!qDate} onChange={(e) => setQTime(e.target.value)} />
          </label>
        </div>
        <div className="grid2">
          <label>
            Department
            <select value={qDept} onChange={(e) => setQDept(e.target.value)}>
              <option value="">General</option>
              {activeDepts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" className="secondary small" onClick={quickAdd}>
          Add
        </button>
        <span className="muted small"> More details (person, priority, repeat, Job Order): “+ Task”.</span>
      </div>
      {msg && <p className="ok small">{msg}</p>}

      <div className="row between wrap gap">
        <label className="inline">
          Show
          <select value={dept} onChange={(e) => setParams(e.target.value ? { dept: e.target.value } : {}, { replace: true })}>
            <option value="">All departments</option>
            <option value="general">General</option>
            {activeDepts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <span className="muted small">{open} open</span>
      </div>

      {tasks.loading && <p className="muted">{tr('loading')}</p>}
      {!tasks.loading && groups.length === 0 && <p className="muted">Nothing here yet. Add what you need to follow up — any department.</p>}
      {groups.map((g) => (
        <div key={g.group} className="today-group">
          <span className={`pill ${GROUP_CLS[g.group] ?? 'neutral'}`}>
            {GROUP_LABEL[g.group]} · {g.tasks.length}
          </span>
          <ul className="task-list">
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                t={t}
                today={today}
                now={now}
                deptName={deptName}
                department={departments.items.find((d) => d.id === t.departmentId)}
                departments={activeDepts}
                onDone={(end) => {
                  if (!workspaceId) return;
                  const r = markDone(workspaceId, t, today, end);
                  flash(
                    [r.followUp ? `Added: ${r.followUp}.` : 'Done.', r.nextDue ? `Next one due ${dueText({ dueDate: r.nextDue, status: 'OPEN' }, today)}.` : ''].filter(Boolean).join(' '),
                  );
                }}
              />
            ))}
          </ul>
        </div>
      ))}

      {oldDone.length > 0 && (
        <div className="today-group">
          {showAllDone ? (
            <>
              <span className="pill neutral">Older done / dropped · {oldDone.length}</span>
              <ul className="task-list">
                {oldDone.map((t) => (
                  <TaskRow key={t.id} t={t} today={today} now={now} deptName={deptName} />
                ))}
              </ul>
            </>
          ) : (
            <button type="button" className="linkish" onClick={() => setParams({ ...(dept ? { dept } : {}), done: 'all' }, { replace: true })}>
              Show {oldDone.length} older done / dropped
            </button>
          )}
        </div>
      )}

      <div className="card doc-card">
        <div className="row gap wrap">
          <button type="button" className="secondary small" onClick={() => void share()}>
            Share list as text
          </button>
        </div>
        <DocButtons
          label={dept ? `Follow-up list · ${dept === 'general' ? 'General' : deptName(dept)} (PDF)` : 'Follow-up list (PDF)'}
          build={() => tasksDoc(filtered, { company, today, now, generatedAt: `${formatDateTime(new Date())} IST`, deptName, department: dept ? (dept === 'general' ? 'General' : deptName(dept)) : undefined })}
        />
      </div>
    </section>
  );
}

function TaskRow({
  t: raw,
  today,
  now,
  deptName,
  department,
  departments = [],
  onDone,
}: {
  t: WithMeta<Task>;
  today: string;
  now: string;
  deptName: (id: string) => string;
  department?: Department;
  departments?: WithMeta<Department>[];
  onDone?: (end: TaskEnd) => void;
}) {
  const t = withTaskDefaults(raw);
  const active = isActive(t);
  const overdue = active && isOverdue(t, today, now);
  const [closing, setClosing] = useState(false);
  const ended = outcomeText(t);
  return (
    <li className={`task ${t.status.toLowerCase()}`}>
      {active && onDone ? (
        <button type="button" className="task-check" aria-label={`Mark “${t.title}” done`} aria-expanded={closing} onClick={() => setClosing(!closing)}>
          ✓
        </button>
      ) : (
        <span className={`task-check done${t.outcome === 'NOT_RESOLVED' ? ' not-resolved' : ''}`} aria-hidden="true">
          {t.status === 'DONE' ? (t.outcome === 'NOT_RESOLVED' ? '✗' : '✓') : '–'}
        </span>
      )}
      <span className="task-body">
        <Link to={`/work/${t.id}`} className="task-title">
          {t.priority === 'HIGH' && <span className="pill bad">High</span>} {t.title}
          {raw.pending && <span className="muted small"> · saving…</span>}
        </Link>
        <span className="muted small block">
          {[deptName(t.departmentId), t.person, t.joNumber].filter(Boolean).join(' · ')}
          {t.repeat && ` · ↻ ${repeatLabel(t.repeat)}`}
        </span>
        <span className={`small block ${overdue ? 'error' : 'muted'}`}>
          {t.status === 'DONE' ? `Done ${t.doneOn ?? ''}` : t.status === 'DROPPED' ? 'Dropped' : `Due ${dueText(t, today)}`}
          {t.status === 'WAITING' && ` · waiting${t.waitingOn ? ` on ${t.waitingOn}` : ''}`}
        </span>
        {!active && ended && t.status !== 'DROPPED' && <span className={`small block ${t.outcome === 'NOT_RESOLVED' ? 'warn' : 'muted'}`}>{ended}</span>}
        {active && closing && onDone && (
          <CloseTask
            t={t}
            today={today}
            departments={departments}
            onCancel={() => setClosing(false)}
            onSave={(end) => {
              setClosing(false);
              onDone(end);
            }}
          />
        )}
        {active && !closing && department && <StepContacts departments={[department]} message={(p) => taskMessage(t, p.name)} />}
      </span>
    </li>
  );
}

/**
 * "How did it end?" (confirmed 27 Oct 2026): Resolved / Not resolved and an optional note.
 * Not resolved → escalate to any department (and person), follow up again, or close.
 */
export function CloseTask({
  t,
  today,
  departments,
  onSave,
  onCancel,
}: {
  t: Task;
  today: string;
  departments: WithMeta<Department>[];
  onSave: (end: TaskEnd) => void;
  onCancel: () => void;
}) {
  const [outcome, setOutcome] = useState<TaskOutcome>('RESOLVED');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<NextStep>('ESCALATE');
  const [toDept, setToDept] = useState('');
  const [toPerson, setToPerson] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const people = (departments.find((d) => d.id === toDept)?.people ?? []).filter((p) => p.name.trim());
  const needsTarget = outcome === 'NOT_RESOLVED' && step !== 'CLOSE';

  function save() {
    if (needsTarget) {
      if (step === 'ESCALATE' && !toDept) return setErr('Choose the department to escalate to');
      if (!date) return setErr('Choose when to follow it up');
      if (date < today) return setErr('The date cannot be in the past');
    }
    onSave({
      outcome,
      note: note.trim(),
      ...(outcome === 'NOT_RESOLVED' ? { nextStep: step } : {}),
      ...(needsTarget ? { to: { departmentId: toDept, person: toPerson, dueDate: date, dueTime: time || null } } : {}),
    });
  }

  return (
    <div className="close-task card subtle">
      <p className="small">
        <strong>How did it end?</strong>
      </p>
      <div className="row gap wrap">
        {(['RESOLVED', 'NOT_RESOLVED'] as TaskOutcome[]).map((o) => (
          <label key={o} className="inline">
            <input type="radio" name={`outcome-${t.title}`} checked={outcome === o} onChange={() => setOutcome(o)} /> {o === 'RESOLVED' ? 'Resolved' : 'Not resolved'}
          </label>
        ))}
      </div>
      <label>
        Note (optional)
        <input value={note} maxLength={500} placeholder={outcome === 'RESOLVED' ? 'e.g. Artwork approved, sent to printing' : 'e.g. No reply from the buyer'} onChange={(e) => setNote(e.target.value)} />
      </label>
      {outcome === 'NOT_RESOLVED' && (
        <>
          <p className="small">Next step</p>
          <div className="row gap wrap">
            {(['ESCALATE', 'FOLLOW_UP', 'CLOSE'] as NextStep[]).map((x) => (
              <label key={x} className="inline">
                <input type="radio" name={`step-${t.title}`} checked={step === x} onChange={() => setStep(x)} /> {x === 'ESCALATE' ? 'Escalate' : x === 'FOLLOW_UP' ? 'Follow up again' : 'Close anyway'}
              </label>
            ))}
          </div>
          {step === 'ESCALATE' && (
            <div className="grid2">
              <label>
                Escalate to
                <select
                  value={toDept}
                  onChange={(e) => {
                    setToDept(e.target.value);
                    setToPerson('');
                  }}
                >
                  <option value="">Choose department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Person
                <select value={toPerson} disabled={!toDept} onChange={(e) => setToPerson(e.target.value)}>
                  <option value="">{people.length ? 'Department (anyone)' : 'No people added yet'}</option>
                  {people.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.designation ? ` · ${p.designation}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {step === 'FOLLOW_UP' && <p className="muted small">Same {t.person ? `person (${t.person})` : 'department'}, new date.</p>}
          {step !== 'CLOSE' && (
            <div className="grid2">
              <label>
                {step === 'ESCALATE' ? 'Needed by' : 'Follow up on'}
                <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label>
                Time (optional)
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            </div>
          )}
        </>
      )}
      {err && <p className="error small">{err}</p>}
      <div className="row gap wrap">
        <button type="button" className="primary small" onClick={save}>
          {outcome === 'RESOLVED' ? 'Mark done' : step === 'ESCALATE' ? 'Done · escalate' : step === 'FOLLOW_UP' ? 'Done · follow up' : 'Done · close'}
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {t.repeat && <p className="muted small">The next one ({repeatLabel(t.repeat)}) is added as usual.</p>}
    </div>
  );
}
