import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, findDuplicate, rawMaterialContext, type RawMaterial } from '../../lib/masters';
import { saveRecord } from '../sync/records';
import { FormShell } from './FormShell';
import {
  CustomUnitsEditor,
  customUnitsFromDrafts,
  draftFromTracked,
  draftsFromCustomUnits,
  TextField,
  trackedFromDraft,
  TrackedNumberField,
  UnitSelect,
  type CustomUnitDraft,
  type TrackedNumberDraft,
} from './fields';
import { newId, useCollection, useDocument } from './useCollection';
import { ConversionCheck } from './ConversionCheck';

export function RawMaterialForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const { item, loading } = useDocument<RawMaterial>(workspaceId, COLLECTIONS.rawMaterials, isNew ? null : id);
  const all = useCollection<RawMaterial>(workspaceId, COLLECTIONS.rawMaterials);

  const [name, setName] = useState('');
  const [baseUnit, setBaseUnit] = useState('kg');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [gsm, setGsm] = useState<TrackedNumberDraft>(draftFromTracked(undefined));
  const [units, setUnits] = useState<CustomUnitDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setName(item.name);
    setBaseUnit(item.baseUnit);
    setNotes(item.notes ?? '');
    setActive(item.active !== false);
    setGsm(draftFromTracked(item.gsm));
    setUnits(draftsFromCustomUnits(item.customUnits));
  }, [item]);

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && !item) return <p className="error">Raw material not found.</p>;

  const dup = name.trim() ? findDuplicate(name, all.items, isNew ? undefined : id) : undefined;
  const unitsParsed = customUnitsFromDrafts(units);
  const gsmParsed = trackedFromDraft(gsm, 'GSM');

  function save(reason: string): boolean {
    if (!workspaceId) return false;
    if (!name.trim()) return setError('Name is required'), false;
    if (typeof unitsParsed === 'string') return setError(unitsParsed), false;
    if (typeof gsmParsed === 'string') return setError(gsmParsed), false;
    if (!isNew && item && item.baseUnit !== baseUnit) {
      // Changing the base unit silently re-scales every BOM that uses it.
      return setError('The base unit cannot be changed after creation. Create a new raw material instead.'), false;
    }
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTIONS.rawMaterials) : id;
    const data: RawMaterial = { name: name.trim(), baseUnit, notes: notes.trim(), active: isNew ? true : active, gsm: gsmParsed, customUnits: unitsParsed };
    saveRecord({ workspaceId, collectionName: COLLECTIONS.rawMaterials, docId, entity: `Raw material: ${data.name}`, before: isNew ? null : item, data: { ...data }, reason });
    if (isNew) navigate(`/masters/raw-materials/${docId}`, { replace: true });
    return true;
  }

  return (
    <>
      <FormShell
        title={isNew ? 'New raw material' : name || 'Raw material'}
        backTo="/masters?tab=raw-materials"
        isNew={isNew}
        active={active}
        onActiveChange={setActive}
        rev={item?.rev}
        pending={item?.pending}
        error={error}
        warning={dup ? `A raw material named “${dup.name}” already exists.` : null}
        onSave={save}
      >
        <TextField label="Name" required value={name} onChange={setName} />
        <UnitSelect label="Base unit (how it is measured and bought)" value={baseUnit} onChange={setBaseUnit} />
        {!isNew && <p className="muted small">The base unit is fixed after creation so existing BOMs stay correct.</p>}
        <TrackedNumberField label="GSM (only for sheet / fabric materials)" unit="g per sq m" draft={gsm} onChange={setGsm} />
        <CustomUnitsEditor baseUnit={baseUnit} rows={units} onChange={setUnits} />
        <TextField label="Notes" multiline value={notes} onChange={setNotes} />
      </FormShell>
      {typeof unitsParsed !== 'string' && typeof gsmParsed !== 'string' && (
        <ConversionCheck ctx={rawMaterialContext({ baseUnit, customUnits: unitsParsed, gsm: gsmParsed })} />
      )}
    </>
  );
}
