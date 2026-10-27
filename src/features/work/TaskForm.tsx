import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { WEEKDAY_NAMES } from '../../lib/calendar';
import { COLLECTION_JOB_ORDERS, type JobOrder } from '../../lib/jobOrders';
import { COLLECTIONS, type Department } from '../../lib/masters';
import { COLLECTION_TASKS, emptyTask, isActive, outcomeText, repeatLabel, STATUS_LABEL, taskMessage, validateTask, weekdayOf, withTaskDefaults, type Repeat, type Task, type TaskStatus } from '../../lib/tasks';
import { istDateKey } from '../../lib/time';
import { StepContacts } from '../masters/ContactButtons';
import { newId, useCollection, useDocument } from '../masters/useCollection';
import { saveRecord } from '../sync/records';
import { CloseTask, markDone, strip } from './WorkPage';

type RepeatKind = 'NONE' | Repeat['kind'];

/** Add or edit one task. Tasks are never deleted: Done or Dropped. */
export function TaskForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t: tr } = useApp();
  const navigate = useNavigate();
  const today = istDateKey(new Date());
  const { item, loading } = useDocument<Task>(workspaceId, COLLECTION_TASKS, isNew ? null : id);
  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  // Start from the saved task when it is already loaded (no empty flash), else empty until it arrives.
  const [t, setT] = useState<Task>(() => (item ? ({ ...emptyTask(), ...strip(item as Task) } as Task) : emptyTask()));
  const [kind, setKind] = useState<RepeatKind>(() => item?.repeat?.kind ?? 'NONE');
  const [nText, setNText] = useState(() => (item?.repeat?.kind === 'EVERY_N_DAYS' ? String(item.repeat.days) : '7'));
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const loaded = useRef<string | null>(null);
  const tasks = useCollection<Task>(workspaceId, COLLECTION_TASKS);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setT({ ...emptyTask(), ...strip(item as Task) } as Task);
    setKind(item.repeat?.kind ?? 'NONE');
    if (item.repeat?.kind === 'EVERY_N_DAYS') setNText(String(item.repeat.days));
  }, [item]);

  if (!isNew && loading) return <p className="muted">{tr('loading')}</p>;
  if (!isNew && !item) return <p className="error">Task not found.</p>;

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setT((x) => ({ ...x, [k]: v }));
  const dept = departments.items.find((d) => d.id === t.departmentId);
  const people = (dept?.people ?? []).filter((p) => p.name.trim());

  function repeatFrom(): Repeat | null {
    if (kind === 'NONE') return null;
    const base = t.dueDate ?? today;
    if (kind === 'WEEKLY') return { kind, weekday: weekdayOf(base) };
    if (kind === 'MONTHLY') return { kind, day: Number(base.slice(8, 10)) };
    return { kind, days: Math.round(Number(nText)) };
  }

  function save(next?: Partial<Task>, reason?: string) {
    if (!workspaceId) return;
    const data: Task = { ...t, repeat: repeatFrom(), ...next };
    const err = validateTask(data);
    if (err) return setError(err);
    setError(null);
    // Done chosen in the status list: same as the Done button — ask how it ended first.
    if (!isNew && item && isActive(item) && data.status === 'DONE') {
      setClosing(true);
      return;
    }
    if (data.status === 'DONE' && !data.doneOn) data.doneOn = today;
    if (data.status !== 'DONE') data.doneOn = null;
    const docId = isNew ? newId(workspaceId, COLLECTION_TASKS) : id;
    saveRecord({ workspaceId, collectionName: COLLECTION_TASKS, docId, entity: `Task: ${data.title.trim()}`, before: isNew ? null : item, data: strip(data), reason });
    navigate('/work', { replace: true });
  }

  const openJos = jos.items.filter((j) => j.status === 'DRAFT' || j.status === 'CONFIRMED').sort((a, b) => a.joNumber.localeCompare(b.joNumber));
  const repeat = repeatFrom();

  return (
    <section>
      <p>
        <Link to="/work" className="small">
          ← {tr('navWork')}
        </Link>
      </p>
      <h2>{isNew ? 'New task' : 'Task'}</h2>
      <div className="card form">
        <label>
          What needs to be done *
          <input value={t.title} maxLength={200} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Get artwork approval for the new design" />
        </label>
        <div className="grid2">
          <label>
            Department
            <select value={t.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
              <option value="">General</option>
              {departments.items
                .filter((d) => d.active !== false || d.id === t.departmentId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Whom to ask
            <input value={t.person} list="task-people" maxLength={80} onChange={(e) => set('person', e.target.value)} placeholder={people.length ? 'Choose or type' : 'Name (optional)'} />
            <datalist id="task-people">
              {people.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.designation}
                </option>
              ))}
            </datalist>
          </label>
        </div>
        <div className="grid2">
          <label>
            Due date
            <input type="date" value={t.dueDate ?? ''} onChange={(e) => setT((x) => ({ ...x, dueDate: e.target.value || null, dueTime: e.target.value ? x.dueTime : null }))} />
          </label>
          <label>
            Time (optional)
            <input type="time" value={t.dueTime ?? ''} disabled={!t.dueDate} onChange={(e) => set('dueTime', e.target.value || null)} />
          </label>
        </div>
        <div className="grid2">
          <label>
            Priority
            <select value={t.priority} onChange={(e) => set('priority', e.target.value as Task['priority'])}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
            </select>
          </label>
        </div>
        <div className="grid2">
          <label>
            Status
            <select value={t.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
              {(['OPEN', 'WAITING', 'DONE', 'DROPPED'] as TaskStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          {t.status === 'WAITING' && (
            <label>
              Waiting on
              <input value={t.waitingOn} maxLength={120} onChange={(e) => set('waitingOn', e.target.value)} placeholder="e.g. buyer's reply" />
            </label>
          )}
          {t.status === 'DROPPED' && (
            <label>
              Why not needed (optional)
              <input value={t.outcomeNote} maxLength={500} onChange={(e) => set('outcomeNote', e.target.value)} placeholder="e.g. Buyer cancelled the change" />
            </label>
          )}
        </div>
        <div className="grid2">
          <label>
            Repeats
            <select value={kind} onChange={(e) => setKind(e.target.value as RepeatKind)}>
              <option value="NONE">Does not repeat</option>
              <option value="WEEKLY">Every week{t.dueDate ? ` (${WEEKDAY_NAMES[weekdayOf(t.dueDate)]})` : ''}</option>
              <option value="MONTHLY">Every month{t.dueDate ? ` (day ${Number(t.dueDate.slice(8, 10))})` : ''}</option>
              <option value="EVERY_N_DAYS">Every N days</option>
            </select>
          </label>
          {kind === 'EVERY_N_DAYS' && (
            <label>
              N (days)
              <input inputMode="numeric" value={nText} onChange={(e) => setNText(e.target.value)} />
            </label>
          )}
        </div>
        {kind !== 'NONE' && (
          <p className="muted small">
            {t.dueDate ? `Repeats ${repeat ? repeatLabel(repeat) : ''}. When it is done, the next one is added automatically.` : 'Set the due date of the first one; the repeat follows it.'}
            {kind === 'MONTHLY' && t.dueDate && Number(t.dueDate.slice(8, 10)) > 28 && ' In shorter months it falls on the last day.'}
          </p>
        )}
        <label>
          Job Order (optional)
          <select
            value={t.joId ?? ''}
            onChange={(e) => {
              const j = jos.items.find((x) => x.id === e.target.value);
              setT((x) => ({ ...x, joId: j?.id ?? null, joNumber: j?.joNumber ?? '' }));
            }}
          >
            <option value="">— none —</option>
            {t.joId && !openJos.some((j) => j.id === t.joId) && <option value={t.joId}>{t.joNumber || 'Job Order'}</option>}
            {openJos.map((j) => (
              <option key={j.id} value={j.id}>
                {j.joNumber} · {j.customerName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea value={t.notes} maxLength={2000} rows={3} onChange={(e) => set('notes', e.target.value)} />
        </label>
        {!isNew && item && !isActive(item) && t.status === 'DONE' && outcomeText(withTaskDefaults(item)) && (
          <p className={`small ${withTaskDefaults(item).outcome === 'NOT_RESOLVED' ? 'warn' : 'muted'}`}>How it ended: {outcomeText(withTaskDefaults(item))}</p>
        )}
        {!isNew && item && !isActive(item) && t.status === 'DONE' && (
          <label>
            Note on how it ended
            <input value={t.outcomeNote} maxLength={500} onChange={(e) => set('outcomeNote', e.target.value)} />
          </label>
        )}
        {(() => {
          const from = t.fromTaskId ? tasks.items.find((x) => x.id === t.fromTaskId) : undefined;
          const next = t.nextTaskId ? tasks.items.find((x) => x.id === t.nextTaskId) : undefined;
          return (
            <>
              {from && (
                <p className="small">
                  {t.title.startsWith('Escalated') ? 'Escalated from' : 'Follow-up of'}: <Link to={`/work/${from.id}`}>{from.title}</Link>
                </p>
              )}
              {next && (
                <p className="small">
                  {next.title.startsWith('Escalated') ? 'Escalated to' : 'Followed up in'}: <Link to={`/work/${next.id}`}>{next.title}</Link>
                </p>
              )}
            </>
          );
        })()}
        {error && <p className="error small">{error}</p>}
        {closing && item && workspaceId ? (
          <CloseTask
            t={{ ...withTaskDefaults(item), ...t, repeat: repeatFrom() }}
            today={today}
            departments={departments.items.filter((d) => d.active !== false).sort((a, b) => a.name.localeCompare(b.name))}
            onCancel={() => {
              setClosing(false);
              if (t.status === 'DONE') set('status', item.status);
            }}
            onSave={(end) => {
              markDone(workspaceId, { ...item, ...t, status: item.status, repeat: repeatFrom() } as typeof item, today, end);
              navigate('/work', { replace: true });
            }}
          />
        ) : (
          <div className="row gap wrap">
            <button type="button" className="primary" onClick={() => save()}>
              Save
            </button>
            {!isNew && item && isActive(item) && (
              <button type="button" className="secondary" onClick={() => setClosing(true)}>
                ✓ Done{repeat ? ' (adds the next one)' : ''}
              </button>
            )}
          </div>
        )}
        {!isNew && item?.joId && (
          <p className="small">
            <Link to={`/orders/${item.joId}`}>Open {item.joNumber || 'the Job Order'} →</Link>
          </p>
        )}
        {dept && isActive(t) && t.title.trim() && (
          <>
            <p className="small">Contact {dept.name}:</p>
            <StepContacts departments={[dept]} message={(p) => taskMessage(t, p.name)} />
          </>
        )}
        <p className="muted small">Tasks are never deleted: mark them Done, or Dropped if no longer needed. Every change is kept in History.</p>
      </div>
    </section>
  );
}
