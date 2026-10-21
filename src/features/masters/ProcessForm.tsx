import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, findDuplicate, type Department, type Process } from '../../lib/masters';
import { departmentsFor } from '../../lib/contacts';
import { saveRecord } from '../sync/records';
import { FormShell } from './FormShell';
import { TextField } from './fields';
import { safeReturnTo } from './returnTo';
import { newId, useCollection, useDocument } from './useCollection';
import { useMasterData } from './useMasterData';

const EMPTY: Process = { name: '', active: true, notes: '' };

/** A process / treatment shared by many products (weaving, bleaching, packing…). */
export function ProcessForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params);
  const { item, loading } = useDocument<Process>(workspaceId, COLLECTIONS.processes, isNew ? null : id);
  const all = useCollection<Process>(workspaceId, COLLECTIONS.processes);
  const master = useMasterData(workspaceId);
  const [d, setD] = useState<Process>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setD({ ...EMPTY, ...item });
  }, [item]);

  const departments = useCollection<Department>(workspaceId, COLLECTIONS.departments);
  const depts = useMemo(() => departmentsFor(id, departments.items), [id, departments.items]);
  const usedBy = useMemo(() => master.products.items.filter((p) => (p.route ?? []).some((s) => s.processId === id)).sort((a, b) => a.name.localeCompare(b.name)), [master.products.items, id]);

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && !item) return <p className="error">Process not found.</p>;
  const dup = d.name.trim() ? findDuplicate(d.name, all.items, isNew ? undefined : id) : undefined;

  function save(reason: string): boolean {
    if (!workspaceId) return false;
    if (!d.name.trim()) return setError('Name is required'), false;
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTIONS.processes) : id;
    const data: Process = { name: d.name.trim(), active: isNew ? true : d.active, notes: d.notes.trim() };
    saveRecord({ workspaceId, collectionName: COLLECTIONS.processes, docId, entity: `Process: ${data.name}`, before: isNew ? null : item, data: { ...data }, reason });
    if (isNew) navigate(returnTo ?? `/masters/processes/${docId}`, { replace: true });
    return true;
  }

  return (
    <FormShell
      title={isNew ? 'New process' : d.name || 'Process'}
      backTo={returnTo ?? '/masters?tab=processes'}
      isNew={isNew}
      active={d.active}
      onActiveChange={(active) => setD((x) => ({ ...x, active }))}
      rev={item?.rev}
      pending={item?.pending}
      error={error}
      warning={dup ? `A process named “${dup.name}” already exists.` : null}
      onSave={save}
    >
      <TextField label="Name" required value={d.name} onChange={(name) => setD((x) => ({ ...x, name }))} placeholder="e.g. Weaving, Bleaching, Packing" />
      <TextField label="Notes" multiline value={d.notes} onChange={(notes) => setD((x) => ({ ...x, notes }))} />
      <p className="muted small">Department and standard times are added later, when known. Planned days are set per product in its process route.</p>
      {!isNew && (
        <p className="small">
          Used by:{' '}
          {usedBy.length === 0
            ? 'no product yet'
            : usedBy.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link to={`/masters/products/${p.id}?tab=details`}>{p.name}</Link>
                </span>
              ))}
        </p>
      )}
      {!isNew && (
        <p className="small">
          Department:{' '}
          {depts.length === 0 ? (
            <>
              not set · <Link to="/masters/departments/new">+ New department</Link>
            </>
          ) : (
            depts.map((x, i) => (
              <span key={x.id}>
                {i > 0 && ', '}
                <Link to={`/masters/departments/${x.id}`}>{x.name}</Link>
              </span>
            ))
          )}
        </p>
      )}
    </FormShell>
  );
}
