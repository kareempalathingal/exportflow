import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, findDuplicate, validGstin, type Supplier } from '../../lib/masters';
import { itemKey, parseItemKey } from '../../lib/materials';
import { saveRecord } from '../sync/records';
import { FormShell } from './FormShell';
import { TextField } from './fields';
import { safeReturnTo } from './returnTo';
import { newId, useCollection, useDocument } from './useCollection';
import { useMasterData } from './useMasterData';

const EMPTY: Supplier = { name: '', active: true, notes: '', place: '', contactPerson: '', phone: '', email: '', gstin: '', items: [] };

export function SupplierForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnTo(searchParams);
  const { item, loading } = useDocument<Supplier>(workspaceId, COLLECTIONS.suppliers, isNew ? null : id);
  const all = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const master = useMasterData(workspaceId);
  const [d, setD] = useState<Supplier>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setD({ ...EMPTY, ...item, items: item.items ?? [] });
  }, [item]);

  const rms = useMemo(() => master.rawMaterials.items.filter((r) => r.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [master.rawMaterials.items]);
  const products = useMemo(() => master.products.items.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [master.products.items]);

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && !item) return <p className="error">Supplier not found.</p>;

  const set = (patch: Partial<Supplier>) => setD((x) => ({ ...x, ...patch }));
  const dup = d.name.trim() ? findDuplicate(d.name, all.items, isNew ? undefined : id) : undefined;
  const nameOf = (key: string) => {
    const p = parseItemKey(key);
    if (!p) return { name: key, kind: '' };
    const x = p.type === 'PRODUCT' ? master.md.products.get(p.id) : master.md.rawMaterials.get(p.id);
    return { name: x?.name ?? '(missing item)', kind: p.type === 'PRODUCT' ? 'Product' : 'Raw material' };
  };

  function save(reason: string): boolean {
    if (!workspaceId) return false;
    if (!d.name.trim()) return setError('Name is required'), false;
    if (d.email.trim() && !/^\S+@\S+\.\S+$/.test(d.email.trim())) return setError('Email looks invalid'), false;
    if (d.gstin.trim() && !validGstin(d.gstin)) return setError('GSTIN should be 15 characters (2 digits, then letters/digits)'), false;
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTIONS.suppliers) : id;
    const data: Supplier = {
      name: d.name.trim(),
      active: isNew ? true : d.active,
      notes: d.notes.trim(),
      place: d.place.trim(),
      contactPerson: d.contactPerson.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
      gstin: d.gstin.trim().toUpperCase(),
      items: [...new Set(d.items)],
    };
    saveRecord({ workspaceId, collectionName: COLLECTIONS.suppliers, docId, entity: `Supplier: ${data.name}`, before: isNew ? null : item, data: { ...data }, reason });
    if (isNew) navigate(returnTo ?? `/masters/suppliers/${docId}`, { replace: true });
    return true;
  }

  return (
    <FormShell
      title={isNew ? 'New supplier' : d.name || 'Supplier'}
      backTo={returnTo ?? '/masters?tab=suppliers'}
      isNew={isNew}
      active={d.active}
      onActiveChange={(active) => set({ active })}
      rev={item?.rev}
      pending={item?.pending}
      error={error}
      warning={dup ? `A supplier named “${dup.name}” already exists.` : null}
      onSave={save}
    >
      <TextField label="Name" required value={d.name} onChange={(name) => set({ name })} />
      <div className="grid2">
        <TextField label="Place / country" value={d.place} onChange={(place) => set({ place })} />
        <TextField label="Contact person" value={d.contactPerson} onChange={(contactPerson) => set({ contactPerson })} />
      </div>
      <div className="grid2">
        <TextField label="Phone" value={d.phone} onChange={(phone) => set({ phone })} />
        <TextField label="Email" value={d.email} onChange={(email) => set({ email })} />
      </div>
      <TextField label="GSTIN (optional)" value={d.gstin} onChange={(gstin) => set({ gstin })} max={15} />

      <fieldset className="tracked">
        <legend>Supplies</legend>
        {d.items.length === 0 && <p className="muted small">No items linked yet.</p>}
        <ul className="chips">
          {d.items.map((k) => {
            const n = nameOf(k);
            return (
              <li key={k} className="chip">
                <span>
                  {n.name} <span className="muted small">{n.kind}</span>
                </span>
                <button type="button" className="chip-x" aria-label={`Remove ${n.name}`} onClick={() => set({ items: d.items.filter((x) => x !== k) })}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <label>
          Add an item
          <select
            value=""
            onChange={(e) => {
              const k = e.target.value;
              if (k && !d.items.includes(k)) set({ items: [...d.items, k] });
            }}
          >
            <option value="">— choose —</option>
            <optgroup label="Raw materials">
              {rms.filter((r) => !d.items.includes(itemKey('RAW_MATERIAL', r.id))).map((r) => (
                <option key={r.id} value={itemKey('RAW_MATERIAL', r.id)}>
                  {r.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Products">
              {products.filter((p) => !d.items.includes(itemKey('PRODUCT', p.id))).map((p) => (
                <option key={p.id} value={itemKey('PRODUCT', p.id)}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <p className="muted small">Saved with the supplier. The links also show on each product and raw material.</p>
      </fieldset>
      <TextField label="Notes" multiline value={d.notes} onChange={(notes) => set({ notes })} />
    </FormShell>
  );
}
