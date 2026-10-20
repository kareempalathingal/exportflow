import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { bomStatus, COLLECTIONS, findDuplicate, needsBom, productContext, type Product, type SupplyType } from '../../lib/masters';
import { useMasterData } from './useMasterData';
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
import { safeReturnTo, withAdded } from './returnTo';
import { itemKey } from '../../lib/materials';
import { newId, useCollection, useDocument } from './useCollection';
import { ConversionCheck } from './ConversionCheck';
import { BomEditor } from './BomEditor';
import { ProductSummary } from './ProductSummary';
import { ItemSuppliers } from './ItemSuppliers';
import { draftsFromRoute, RouteEditor, routeFromDrafts, type RouteDraft } from './RouteEditor';

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
  const [usualSupply, setUsualSupply] = useState<'MAKE' | 'BUY' | ''>('');
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
  const [route, setRoute] = useState<RouteDraft[]>([]);
  const [routeConfirmed, setRouteConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef<string | null>(null);
  const [params, setParams] = useSearchParams();
  const returnTo = safeReturnTo(params);
  const master = useMasterData(workspaceId);

  useEffect(() => {
    if (!item) return;
    const key = `${item.id}:${item.rev}`;
    if (loaded.current === key) return;
    loaded.current = key;
    setName(item.name);
    setCode(item.code ?? '');
    setBaseUnit(item.baseUnit);
    setSupplyType(item.supplyType);
    setUsualSupply(item.usualSupply ?? '');
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
    setRoute(draftsFromRoute(item.route));
    setRouteConfirmed(item.routeConfirmed === true);
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
  const routeP = routeFromDrafts(route);
  const parseError = sizeError ?? [gsmP, thickP, weightP, unitsP, routeP].find((x): x is string => typeof x === 'string') ?? null;

  const draftProduct: Product | null =
    parseError === null && typeof gsmP !== 'string' && typeof thickP !== 'string' && typeof weightP !== 'string' && typeof unitsP !== 'string' && typeof routeP !== 'string'
      ? {
          name: name.trim(),
          code: code.trim(),
          baseUnit,
          supplyType,
          usualSupply: supplyType === 'BOTH' && usualSupply ? usualSupply : null,
          specifications: specifications.trim(),
          notes: notes.trim(),
          active: isNew ? true : active,
          size: { length: len, width: wid, unit: sizeUnit, status: len === null ? 'UNAVAILABLE' : sizeStatus },
          gsm: gsmP,
          thicknessMm: thickP,
          weightPerPieceKg: weightP,
          customUnits: unitsP,
          route: routeP,
          routeConfirmed,
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
    if (isNew) navigate(returnTo ? withAdded(returnTo, itemKey('PRODUCT', docId)) : `/masters/products/${docId}?tab=${needsBom(draftProduct) ? 'bom' : 'details'}`, { replace: true });
    return true;
  }

  const savedNeedsBom = !!item && needsBom(item);
  const tabs = savedNeedsBom ? (['bom', 'details', 'conversion'] as const) : (['details', 'conversion'] as const);
  type TabId = (typeof tabs)[number];
  const requested = params.get('tab') as TabId | null;
  const tab: TabId = isNew ? 'details' : requested && (tabs as readonly string[]).includes(requested) ? requested : tabs[0];
  const TAB_LABEL: Record<string, string> = { bom: 'BOM', details: 'Details', conversion: 'Conversion' };
  const status = item ? bomStatus(id, master.md) : 'MISSING';

  const formEl = (
      <FormShell
        title={isNew ? 'New product' : 'Details'}
        backTo={isNew ? (returnTo ?? '/masters?tab=products') : ''}
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
        {supplyType === 'BOTH' && (
          <label>
            Usually
            <select value={usualSupply} onChange={(e) => setUsualSupply(e.target.value as 'MAKE' | 'BUY' | '')}>
              <option value="">Not set — decide on each Job Order</option>
              <option value="MAKE">Made in our factory</option>
              <option value="BUY">Bought from outside</option>
            </select>
            <span className="muted small block">Pre-fills Make/Buy on new Job Order lines; you can still change it per order.</span>
          </label>
        )}
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
        <RouteEditor rows={route} onChange={setRoute} confirmed={routeConfirmed} onConfirmedChange={setRouteConfirmed} />
        <TextField label="Notes" multiline value={notes} onChange={setNotes} />
      </FormShell>
  );

  if (isNew) return formEl;

  return (
    <>
      {item && <ProductSummary product={item} bomStatus={status} bomVersion={master.boms.items.find((b) => b.id === id)?.rev ?? 0} />}
      <div className="tabs" role="tablist">
        {tabs.map((x) => (
          <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setParams({ tab: x }, { replace: true })}>
            {TAB_LABEL[x]}
          </button>
        ))}
      </div>
      {tab === 'bom' && item && <BomEditor product={item} />}
      {tab === 'details' && formEl}
      {tab === 'details' && item && item.supplyType !== 'MANUFACTURED' && (
        <ItemSuppliers type="PRODUCT" id={id} name={item.name} here={`/masters/products/${id}?tab=details`} />
      )}
      {tab === 'conversion' && (draftProduct ? <ConversionCheck ctx={productContext(draftProduct)} /> : <p className="error">{parseError}</p>)}
    </>
  );
}
