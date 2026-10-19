import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, findDuplicate, type Customer, type CustomerType } from '../../lib/masters';
import { saveRecord } from '../sync/records';
import { FormShell } from './FormShell';
import { TextField } from './fields';
import { newId, useCollection, useDocument } from './useCollection';

const EMPTY: Customer = { name: '', active: true, notes: '', country: '', customerType: 'DIRECT', contactPerson: '', phone: '', email: '' };

export function CustomerForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const { item, loading } = useDocument<Customer>(workspaceId, COLLECTIONS.customers, isNew ? null : id);
  const all = useCollection<Customer>(workspaceId, COLLECTIONS.customers);
  const [d, setD] = useState<Customer>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setD({ ...EMPTY, ...item });
  }, [item]);

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && !item) return <p className="error">Customer not found.</p>;

  const set = (patch: Partial<Customer>) => setD((x) => ({ ...x, ...patch }));
  const dup = d.name.trim() ? findDuplicate(d.name, all.items, isNew ? undefined : id) : undefined;

  function save(reason: string): boolean {
    if (!workspaceId) return false;
    if (!d.name.trim()) return setError('Name is required'), false;
    if (d.email.trim() && !/^\S+@\S+\.\S+$/.test(d.email.trim())) return setError('Email looks invalid'), false;
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTIONS.customers) : id;
    const data: Customer = {
      name: d.name.trim(),
      active: isNew ? true : d.active,
      notes: d.notes.trim(),
      country: d.country.trim(),
      customerType: d.customerType,
      contactPerson: d.contactPerson.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
    };
    saveRecord({ workspaceId, collectionName: COLLECTIONS.customers, docId, entity: `Customer: ${data.name}`, before: isNew ? null : item, data: { ...data }, reason });
    if (isNew) navigate(`/masters/customers/${docId}`, { replace: true });
    return true;
  }

  return (
    <FormShell
      title={isNew ? 'New customer' : d.name || 'Customer'}
      backTo="/masters?tab=customers"
      isNew={isNew}
      active={d.active}
      onActiveChange={(active) => set({ active })}
      rev={item?.rev}
      pending={item?.pending}
      error={error}
      warning={dup ? `A customer named “${dup.name}” already exists.` : null}
      onSave={save}
    >
      <TextField label="Name" required value={d.name} onChange={(name) => set({ name })} />
      <div className="grid2">
        <TextField label="Country" value={d.country} onChange={(country) => set({ country })} />
        <label>
          Type
          <select value={d.customerType} onChange={(e) => set({ customerType: e.target.value as CustomerType })}>
            <option value="DIRECT">Direct customer</option>
            <option value="AGENT">Agent / trading company</option>
          </select>
        </label>
      </div>
      <TextField label="Contact person" value={d.contactPerson} onChange={(contactPerson) => set({ contactPerson })} />
      <div className="grid2">
        <TextField label="Phone" value={d.phone} onChange={(phone) => set({ phone })} />
        <TextField label="Email" value={d.email} onChange={(email) => set({ email })} />
      </div>
      <TextField label="Notes" multiline value={d.notes} onChange={(notes) => set({ notes })} />
    </FormShell>
  );
}
