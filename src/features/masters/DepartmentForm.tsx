import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { mailHref, phoneDigits } from '../../lib/contacts';
import { COLLECTIONS, findDuplicate, type Department, type Person, type Process } from '../../lib/masters';
import { saveRecord } from '../sync/records';
import { PersonContact } from './ContactButtons';
import { FormShell } from './FormShell';
import { TextField } from './fields';
import { safeReturnTo } from './returnTo';
import { newId, useCollection, useDocument } from './useCollection';

const EMPTY: Department = { name: '', active: true, notes: '', people: [], processIds: [] };
const NEW_PERSON: Person = { name: '', designation: '', phone: '', whatsapp: '', email: '', primary: false };
const MAX_PEOPLE = 20;

/** Checks people before saving; returns an error message or null. */
export function peopleError(people: Person[]): string | null {
  for (const [i, p] of people.entries()) {
    const n = `Person ${i + 1}${p.name ? ` (${p.name})` : ''}`;
    if (!p.name.trim()) return `${n}: name is required`;
    if (p.phone.trim() && !phoneDigits(p.phone)) return `${n}: phone number looks incomplete`;
    if (p.whatsapp.trim() && !phoneDigits(p.whatsapp)) return `${n}: WhatsApp number looks incomplete`;
    if (p.email.trim() && !mailHref(p, '', '')) return `${n}: email address looks wrong`;
  }
  return people.length > MAX_PEOPLE ? `At most ${MAX_PEOPLE} people per department` : null;
}

/** A department: its people (work contacts) and the processes it handles. */
export function DepartmentForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params);
  const { item, loading } = useDocument<Department>(workspaceId, COLLECTIONS.departments, isNew ? null : id);
  const all = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const processes = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const [d, setD] = useState<Department>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setD({ ...EMPTY, ...item, people: item.people ?? [], processIds: item.processIds ?? [] });
  }, [item]);

  const procName = useMemo(() => new Map(processes.items.map((p) => [p.id, p.name])), [processes.items]);
  const elsewhere = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of all.items) if (o.id !== id && o.active !== false) for (const pid of o.processIds ?? []) m.set(pid, o.name);
    return m;
  }, [all.items, id]);

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && !item) return <p className="error">Department not found.</p>;
  const dup = d.name.trim() ? findDuplicate(d.name, all.items, isNew ? undefined : id) : undefined;
  const set = (patch: Partial<Department>) => setD((x) => ({ ...x, ...patch }));
  const setPerson = (i: number, patch: Partial<Person>) => set({ people: d.people.map((p, j) => (j === i ? { ...p, ...patch } : patch.primary ? { ...p, primary: false } : p)) });

  function save(reason: string): boolean {
    if (!workspaceId) return false;
    if (!d.name.trim()) return setError('Name is required'), false;
    const people = d.people.map((p) => ({ name: p.name.trim(), designation: p.designation.trim(), phone: p.phone.trim(), whatsapp: p.whatsapp.trim(), email: p.email.trim(), primary: p.primary === true }));
    const pe = peopleError(people);
    if (pe) return setError(pe), false;
    if (people.length && !people.some((p) => p.primary)) people[0]!.primary = true;
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTIONS.departments) : id;
    const data: Department = { name: d.name.trim(), active: isNew ? true : d.active, notes: d.notes.trim(), people, processIds: [...new Set(d.processIds)] };
    saveRecord({ workspaceId, collectionName: COLLECTIONS.departments, docId, entity: `Department: ${data.name}`, before: isNew ? null : item, data: { ...data }, reason });
    if (isNew) navigate(returnTo ?? `/masters/departments/${docId}`, { replace: true });
    return true;
  }

  const available = processes.items.filter((p) => p.active !== false && !d.processIds.includes(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  const preview = (p: Person) => ({ subject: 'ExportFlow', body: `Hi ${p.name.split(' ')[0]},` });

  return (
    <FormShell
      title={isNew ? 'New department' : d.name || 'Department'}
      backTo={returnTo ?? '/masters?tab=departments'}
      isNew={isNew}
      active={d.active}
      onActiveChange={(active) => set({ active })}
      rev={item?.rev}
      pending={item?.pending}
      error={error}
      warning={dup ? `A department named “${dup.name}” already exists.` : null}
      onSave={save}
    >
      <TextField label="Name" required value={d.name} onChange={(name) => set({ name })} placeholder="e.g. Weaving, Finishing, Packing" />

      <fieldset className="tracked">
        <legend>People</legend>
        <p className="muted small">Work contacts only. The main contact shows first on process steps; the others appear under “more people”.</p>
        {d.people.length === 0 && <p className="muted small">No people yet.</p>}
        {d.people.map((p, i) => (
          <div key={i} className="person-row">
            <div className="grid2">
              <TextField label="Name" required value={p.name} onChange={(name) => setPerson(i, { name })} />
              <TextField label="Designation" value={p.designation} onChange={(designation) => setPerson(i, { designation })} placeholder="e.g. Supervisor" />
            </div>
            <div className="grid2">
              <label>
                Phone
                <input type="tel" inputMode="tel" value={p.phone} onChange={(e) => setPerson(i, { phone: e.target.value })} placeholder="10-digit mobile" />
              </label>
              <label>
                WhatsApp (if different)
                <input type="tel" inputMode="tel" value={p.whatsapp} onChange={(e) => setPerson(i, { whatsapp: e.target.value })} placeholder="same as phone" />
              </label>
            </div>
            <label>
              Email
              <input type="email" inputMode="email" value={p.email} onChange={(e) => setPerson(i, { email: e.target.value })} placeholder="company email" />
            </label>
            <div className="row between">
              <label className="check small">
                <input type="radio" name="primary" checked={p.primary} onChange={() => setPerson(i, { primary: true })} /> Main contact
              </label>
              <button type="button" className="secondary small" onClick={() => set({ people: d.people.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
            {p.name.trim() && <PersonContact person={p} message={preview} />}
          </div>
        ))}
        <button type="button" className="secondary small" disabled={d.people.length >= MAX_PEOPLE} onClick={() => set({ people: [...d.people, { ...NEW_PERSON, primary: d.people.length === 0 }] })}>
          + Add person
        </button>
      </fieldset>

      <fieldset className="tracked">
        <legend>Processes this department handles</legend>
        {d.processIds.length === 0 && <p className="muted small">None yet.</p>}
        <ul className="chips">
          {d.processIds.map((pid) => (
            <li key={pid} className="chip">
              <span>
                {procName.get(pid) ?? '(missing process)'}
                {elsewhere.has(pid) && <span className="warn small"> · also in {elsewhere.get(pid)}</span>}
              </span>
              <button type="button" className="chip-x" aria-label={`Remove ${procName.get(pid) ?? pid}`} onClick={() => set({ processIds: d.processIds.filter((x) => x !== pid) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <label>
          Add a process
          <select value="" onChange={(e) => e.target.value && set({ processIds: [...d.processIds, e.target.value] })}>
            <option value="">— choose —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {elsewhere.has(p.id) ? ` (now in ${elsewhere.get(p.id)})` : ''}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Steps of these processes show this department’s contacts on each Job Order. <Link to="/masters?tab=processes">All processes</Link>
        </p>
      </fieldset>

      <TextField label="Notes" multiline value={d.notes} onChange={(notes) => set({ notes })} />
    </FormShell>
  );
}
