import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTIONS, findDuplicate, productContext, type Product, type SupplyType } from '../../lib/masters';
import { completeFacts, LENGTH_UNITS, areaFromSize, formatQty } from '../../lib/units';
import type { DataStatus } from '../../lib/dataStatus';
import { saveRecord } from '../sync/records';
import { FormShell } from './FormShell';
import {
  CustomUnitsEditor,
  customUnitsFromDrafts,
  draftFromTracked,
  draftsFromCustomUnits,
  numText,
  parseNum,
  StatusSelect,
  TextField,
  trackedFromDraft,
  TrackedNumberField,
  UnitSelect,
  type CustomUnitDraft,
  type TrackedNumberDraft,
} from './fields';
import { newId, useCollection, useDocument } from './useCollection';
import { ConversionCheck } from './ConversionCheck';
import { BomEditor } from './BomEditor';

export function ProductForm() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { workspaceId, t } = useApp();
  const navigate = useNavigate();
  const { item, loading } = useDocument<Product>(workspaceId, COLLECTIONS.products, isNew ? null : id);
  const all = useCollection<Product>(workspaceId, COLLECTIONS.products);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [baseUnit, setBaseUnit] = useState('pcs');
  const [supplyType, setSupplyType] = useState<SupplyType>('MANUFACTURED');
  const [specifications, setSpecs] = useState('');
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [lenText, setLen] = useState('');
  const [widText, setWid] = useState('');
  const [sizeUnit, setSizeUnit] = useState('cm');
  const [sizeStatus, setSizeStatus] = useState<DataStatus>('USER_PROVIDED');
  const [gsm, setGsm] = useState<TrackedNumberDraft>(draftFromTracked(undefined));
  const [thick, setThick] = useState<TrackedNumberDraft>(draftFromTracked(undefined));
  const [weight, setWeight] = useState<TrackedNumberDraft>(draftFromTracked(undefined));
  const [units, setUnits] = useState<CustomUnitDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setName(item.name);
    setCode(item.code ?? '');
    setBaseUnit(item.baseUnit);
    setSupplyType(item.supplyType);
    setSpecs(item.specifications ?? '');
    setNotes(item.notes ?? '');
    setActive(item.active !== false);
    setLen(numText(item.size?.length));
    setWid(numText(item.size?.width));
    setSizeUnit(item.size?.unit ?? 'cm');
    setSizeStatus(item.size?.status ?? 'USER_PROVIDED');
    setGsm(draftFromTracked(item.gsm));
    setThick(draftFromTracked(item.thicknessMm));
    setWeight(draftFromTracked(item.weightPerPieceKg));
    setUnits(draftsFromCustomUnits(item.customUnits));
  }, [item]);

  if (!isNew && loading) return <p className="muted">{t('loading')}</p>;
  if (!isNew && !item) return <p className="error">Product not found.</p>;

  const dup = name.trim() ? findDuplicate(name, all.items, isNew ? undefined : id) : undefined;

  // Parse once for both save and the live preview.
  const len = parseNum(lenText);
  const wid = parseNum(widText);
  const sizeError =
    (len === null) !== (wid === null)
      ? 'Enter both length and width, or neither'
      : (len !== null && !(len > 0)) || (wid !== null && !(wid > 0))
        ? 'Length and width must be positive numbers'
        : null;
  const gsmP = trackedFromDraft(gsm, 'GSM');
  const thickP = trackedFromDraft(thick, 'Thickness');
  const weightP = trackedFromDraft(weight, 'Weight per piece');
  const unitsP = customUnitsFromDrafts(units);
  const parseError = sizeError ?? [gsmP, thickP, weightP, unitsP].find((x): x is string => typeof x === 'string') ?? null;

  const draftProduct: Product | null =
    parseError === null && typeof gsmP !== 'string' && typeof thickP !== 'string' && typeof weightP !== 'string' && typeof unitsP !== 'string'
      ? {
          name: name.trim(),
          code: code.trim(),
          baseUnit,
          supplyType,
          specifications: specifications.trim(),
          notes: notes.trim(),
          active: isNew ? true : active,
          size: { length: len, width: wid, unit: sizeUnit, status: len === null ? 'UNAVAILABLE' : sizeStatus },
          gsm: gsmP,
          thicknessMm: thickP,
          weightPerPieceKg: weightP,
          customUnits: unitsP,
        }
      : null;

  const facts = draftProduct ? completeFacts(productContext(draftProduct)) : null;
  const area = len !== null && wid !== null ? areaFromSize(len, wid, sizeUnit) : null;

  function save(reason: string): boolean {
    if (!workspaceId) return false;
    if (!name.trim()) return setError('Name is required'), false;
    if (parseError || !draftProduct) return setError(parseError ?? 'Check the values'), false;
    if (!isNew && item && item.baseUnit !== baseUnit) {
      return setError('The base unit cannot be changed after creation (the BOM is written per base unit). Create a new product instead.'), false;
    }
    setError(null);
    const docId = isNew ? newId(workspaceId, COLLECTIONS.products) : id;
    saveRecord({ workspaceId, collectionName: COLLECTIONS.products, docId, entity: `Product: ${draftProduct.name}`, before: isNew ? null : item, data: { ...draftProduct }, reason });
    if (isNew) navigate(`/masters/products/${docId}`, { replace: true });
    return true;
  }

  return (
    <>
      <FormShell
        title={isNew ? 'New product' : name || 'Product'}
        backTo="/masters?tab=products"
        isNew={isNew}
        active={active}
        onActiveChange={setActive}
        rev={item?.rev}
        pending={item?.pending}
        error={error}
        warning={dup ? `A product named “${dup.name}” already exists.` : null}
        onSave={save}
      >
        <TextField label="Name" required value={name} onChange={setName} placeholder="e.g. Coir Mat 40×60 Natural" />
        <div className="grid2">
          <UnitSelect label="Base unit (BOM is written per 1 of this)" value={baseUnit} onChange={setBaseUnit} />
          <label>
            Supply type
            <select value={supplyType} onChange={(e) => setSupplyType(e.target.value as SupplyType)}>
              <option value="MANUFACTURED">Manufactured (own factory)</option>
              <option value="TRADED">Traded (bought from outside)</option>
              <option value="BOTH">Both</option>
            </select>
          </label>
        </div>
        {!isNew && <p className="muted small">The base unit is fixed after creation so the BOM stays correct.</p>}
        <TextField label="Product code (optional)" value={code} onChange={setCode} max={40} />
        <TextField label="Specifications" multiline value={specifications} onChange={setSpecs} />

        <fieldset className="tracked">
          <legend>Size of one piece</legend>
          <div className="grid3">
            <label>
              Length
              <input inputMode="decimal" value={lenText} onChange={(e) => setLen(e.target.value)} />
            </label>
            <label>
              Width
              <input inputMode="decimal" value={widText} onChange={(e) => setWid(e.target.value)} />
            </label>
            <UnitSelect label="Unit" value={sizeUnit} onChange={setSizeUnit} units={LENGTH_UNITS.map((u) => u.id)} />
          </div>
          <StatusSelect value={sizeStatus} onChange={setSizeStatus} />
          {area !== null && <p className="muted small">Area of one piece: {formatQty(area)} sq m</p>}
        </fieldset>
        <TrackedNumberField label="GSM" unit="g per sq m" draft={gsm} onChange={setGsm} />
        <TrackedNumberField label="Weight per piece (if GSM is not used)" unit="kg" draft={weight} onChange={setWeight} />
        <TrackedNumberField label="Thickness" unit="mm" draft={thick} onChange={setThick} />
        {facts?.massPerPieceKg && (
          <p className="muted small">
            Weight of one piece: {formatQty(facts.massPerPieceKg.value)} kg
            {facts.gsm && ` · GSM ${formatQty(facts.gsm.value)}`}
          </p>
        )}
        <CustomUnitsEditor baseUnit={baseUnit} rows={units} onChange={setUnits} />
        <TextField label="Notes" multiline value={notes} onChange={setNotes} />
      </FormShell>

      {draftProduct && <ConversionCheck ctx={productContext(draftProduct)} />}

      {!isNew && item && (item.supplyType === 'MANUFACTURED' || item.supplyType === 'BOTH') && <BomEditor product={item} />}
      {!isNew && item && item.supplyType === 'TRADED' && (
        <p className="muted small card subtle">Traded product: bought from outside, so no BOM is needed.</p>
      )}
      {isNew && <p className="muted small">Save the product first to add its BOM.</p>}
    </>
  );
}
