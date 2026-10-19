import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, suppliersOf, type ComponentType, type Supplier } from '../../lib/masters';
import { itemKey } from '../../lib/materials';
import { saveRecord } from '../sync/records';
import { withReturnTo } from './returnTo';
import { useCollection, type WithMeta } from './useCollection';

/**
 * Suppliers of one product or raw material. The link lives on the supplier
 * record, so adding or removing here updates that supplier (with history).
 */
export function ItemSuppliers({ type, id, name, here }: { type: ComponentType; id: string; name: string; here: string }) {
  const { workspaceId } = useApp();
  const suppliers = useCollection<Supplier>(workspaceId, COLLECTIONS.suppliers);
  const key = itemKey(type, id);
  const linked = useMemo(() => suppliersOf(key, suppliers.items, true).sort((a, b) => a.name.localeCompare(b.name)), [key, suppliers.items]);
  const others = useMemo(
    () => suppliers.items.filter((s) => s.active !== false && !(s.items ?? []).includes(key)).sort((a, b) => a.name.localeCompare(b.name)),
    [key, suppliers.items],
  );
  const [msg, setMsg] = useState<string | null>(null);

  function write(s: WithMeta<Supplier>, items: string[], what: string) {
    if (!workspaceId) return;
    const data: Supplier = {
      name: s.name,
      active: s.active,
      notes: s.notes ?? '',
      place: s.place ?? '',
      contactPerson: s.contactPerson ?? '',
      phone: s.phone ?? '',
      email: s.email ?? '',
      gstin: s.gstin ?? '',
      items,
    };
    saveRecord({ workspaceId, collectionName: COLLECTIONS.suppliers, docId: s.id, entity: `Supplier: ${s.name}`, before: s, data: { ...data } });
    setMsg(what);
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="card">
      <h3>Suppliers</h3>
      {suppliers.error && <p className="error small">{suppliers.error === 'permission-denied' ? 'No access to suppliers — publish the new Firestore rules.' : suppliers.error}</p>}
      {!suppliers.loading && linked.length === 0 && <p className="muted small">No supplier linked to {name} yet.</p>}
      <ul className="chips">
        {linked.map((s) => (
          <li key={s.id} className={`chip${s.active === false ? ' inactive' : ''}`}>
            <Link to={`/masters/suppliers/${s.id}`}>{s.name}</Link>
            {s.place && <span className="muted small">{s.place}</span>}
            <button
              type="button"
              className="chip-x"
              aria-label={`Remove ${s.name}`}
              onClick={() => window.confirm(`Remove ${s.name} as a supplier of ${name}?`) && write(s, (s.items ?? []).filter((k) => k !== key), `Removed ${s.name}`)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <label>
          Add a supplier
          <select
            value=""
            onChange={(e) => {
              const s = suppliers.items.find((x) => x.id === e.target.value);
              if (s) write(s, [...(s.items ?? []), key], `Added ${s.name}`);
            }}
          >
            <option value="">— choose —</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.place ? ` (${s.place})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="small create-links">
        <Link to={withReturnTo('/masters/suppliers/new', here)}>+ New supplier</Link>
      </p>
      {msg && <p className="ok small">{msg}</p>}
    </div>
  );
}
