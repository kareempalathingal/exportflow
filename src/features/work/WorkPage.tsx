import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { tasksDoc } from '../../lib/docs/tasksDoc';
import { COLLECTIONS, type Department } from '../../lib/masters';
import { completeTask, COLLECTION_TASKS, dueText, emptyTask, GROUP_LABEL, groupTasks, isActive, repeatLabel, taskMessage, tasksText, validateTask, type Task, type TaskGroup } from '../../lib/tasks';
import { formatDateTime, istDateKey } from '../../lib/time';
import { DocButtons } from '../docs/DocButtons';
import { StepContacts } from '../masters/ContactButtons';
import { newId, useCollection, type WithMeta } from '../masters/useCollection';
import { permissionHint } from '../orders/OrderBits';
import { shareText } from '../reports/TodayCard';
import { useProfile } from '../settings/useProfile';
import { saveRecord } from '../sync/records';

const GROUP_CLS: Partial<Record<TaskGroup, string>> = { OVERDUE: 'bad', TODAY: 'warn', WAITING: 'neutral', DONE: 'ok' };

/** Records a task as done; a repeating one gets its next occurrence as a new task. */
export function markDone(workspaceId: string, t: WithMeta<Task>, today: string): string | null {
  const { done, next } = completeTask(t, today);
  saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: t.id, entity: `Task: ${t.title}`, before: t, data: { ...strip(done) }, reason: 'Done' });
  if (!next) return null;
  const id = newId(workspaceId, COLLECTION_TASKS);
  saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: id, entity: `Task: ${next.title}`, before: null, data: { ...strip(next) }, reason: `Next ${repeatLabel(next.repeat)}` });
  return next.dueDate;
}

/** Only the task's own fields (not id / version fields). */
export function strip(t: Task): Record<string, unknown> {
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
  };
}

/** Work: tasks and follow-ups for every department, for the user only. */
export function WorkPage() {
  const { workspaceId, t: tr } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const today = istDateKey(new Date());
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
  const groups = useMemo(() => groupTasks(filtered, today), [filtered, today]);
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
  const [qDept, setQDept] = useState('');
  function quickAdd() {
    if (!workspaceId) return;
    const t: Task = { ...emptyTask(), title: qTitle, dueDate: qDate || null, departmentId: qDept || (dept && dept !== 'general' ? dept : '') };
    const err = validateTask(t);
    if (err) return flash(err);
    saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId: newId(workspaceId, COLLECTION_TASKS), entity: `Task: ${t.title.trim()}`, before: null, data: strip(t) });
    setQTitle('');
    setQDate('');
    flash('Added.');
  }

  async function share() {
    const title = dept ? `Follow-ups - ${dept === 'general' ? 'General' : deptName(dept)}` : 'Follow-ups';
    const r = await shareText(title, tasksText(filtered, { company, today, title, deptName }));
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
                deptName={deptName}
                department={departments.items.find((d) => d.id === t.departmentId)}
                onDone={() => {
                  if (!workspaceId) return;
                  const next = markDone(workspaceId, t, today);
                  flash(next ? `Done. Next one due ${dueText({ dueDate: next, status: 'OPEN' }, today)}.` : 'Done.');
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
                  <TaskRow key={t.id} t={t} today={today} deptName={deptName} />
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
          build={() => tasksDoc(filtered, { company, today, generatedAt: `${formatDateTime(new Date())} IST`, deptName, department: dept ? (dept === 'general' ? 'General' : deptName(dept)) : undefined })}
        />
      </div>
    </section>
  );
}

function TaskRow({ t, today, deptName, department, onDone }: { t: WithMeta<Task>; today: string; deptName: (id: string) => string; department?: Department; onDone?: () => void }) {
  const active = isActive(t);
  const overdue = active && t.dueDate !== null && t.dueDate < today;
  return (
    <li className={`task ${t.status.toLowerCase()}`}>
      {active && onDone ? (
        <button type="button" className="task-check" aria-label={`Mark “${t.title}” done`} onClick={onDone}>
          ✓
        </button>
      ) : (
        <span className="task-check done" aria-hidden="true">
          {t.status === 'DONE' ? '✓' : '–'}
        </span>
      )}
      <span className="task-body">
        <Link to={`/work/${t.id}`} className="task-title">
          {t.priority === 'HIGH' && <span className="pill bad">High</span>} {t.title}
          {t.pending && <span className="muted small"> · saving…</span>}
        </Link>
        <span className="muted small block">
          {[deptName(t.departmentId), t.person, t.joNumber].filter(Boolean).join(' · ')}
          {t.repeat && ` · ↻ ${repeatLabel(t.repeat)}`}
        </span>
        <span className={`small block ${overdue ? 'error' : 'muted'}`}>
          {t.status === 'DONE' ? `Done ${t.doneOn ?? ''}` : t.status === 'DROPPED' ? 'Dropped' : `Due ${dueText(t, today)}`}
          {t.status === 'WAITING' && ` · waiting${t.waitingOn ? ` on ${t.waitingOn}` : ''}`}
        </span>
        {active && department && <StepContacts departments={[department]} message={(p) => taskMessage(t, p.name)} />}
      </span>
    </li>
  );
}
