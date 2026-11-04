import { useEffect, useMemo, useRef, useState } from 'react';
import { LongList } from '../../components/LongList';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, findDuplicate, processUnits, type Department, type Process } from '../../lib/masters';
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
  const [unitsText, setUnitsText] = useState('1');
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setD({ ...EMPTY, ...item });
    setUnitsText(String(processUnits(item)));
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
    const units = Math.floor(Number(unitsText));
    if (!Number.isFinite(units) || units < 1 || units > 99) return setError('Parallel units must be a whole number from 1 to 99'), false;
    const extra = d as Process & { importSource?: string };
    const data: Process & { importSource?: string } = {
      name: d.name.trim(),
      active: isNew ? true : d.active,
      notes: d.notes.trim(),
      ...(units > 1 ? { parallelUnits: units } : {}),
      ...(extra.importSource ? { importSource: extra.importSource } : {}),
    };
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
      <label>
        Parallel units
        <input inputMode="numeric" value={unitsText} onChange={(e) => setUnitsText(e.target.value)} style={{ maxWidth: 90 }} />
        <span className="muted small block">
          How many items this process can work on at the same time (machines, lines, printing units). The output per day in each product's steps is per unit. Items of an order wait for a free unit.
        </span>
      </label>
      <p className="muted small">Planned days are set per product in its process route.</p>
      {!isNew && (
        <div className="small">
          Used by:{' '}
          <LongList
            as="comma"
            summary={`${usedBy.length} products`}
            empty="no product yet"
            entries={usedBy.map((p) => ({ key: p.id, group: p.family, node: <Link to={`/masters/products/${p.id}?tab=details`}>{p.name}</Link> }))}
          />
        </div>
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
