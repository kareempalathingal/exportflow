/**
 * Shared parts of the product and raw material forms (confirmed 4 Nov 2026):
 * grouping (category / type / family), the hidden ERP reference and the
 * "unit guessed" notice with Confirm unit.
 */
import { useId, useMemo } from 'react';
import { useApp } from '../../AppContext';
import { itemUses } from '../../lib/itemUses';
import type { JobOrder } from '../../lib/jobOrders';
import type { ComponentType, ItemExtras } from '../../lib/masters';
import type { StockCount } from '../../lib/materials';
import { unitLabel } from '../../lib/units';
import { useCollection } from './useCollection';
import { useMasterData } from './useMasterData';

export interface GroupDraft {
  category: string;
  productType: string;
  family: string;
}

export const groupDraftOf = (x: ItemExtras | null | undefined): GroupDraft => ({ category: x?.category ?? '', productType: x?.productType ?? '', family: x?.family ?? '' });

/** The draft as stored fields: empty values are left out. */
export function groupFields(d: GroupDraft): Pick<ItemExtras, 'category' | 'productType' | 'family'> {
  const out: Pick<ItemExtras, 'category' | 'productType' | 'family'> = {};
  if (d.category.trim()) out.category = d.category.trim();
  if (d.productType.trim()) out.productType = d.productType.trim();
  if (d.family.trim()) out.family = d.family.trim();
  return out;
}

const uniq = (xs: (string | undefined)[]) => [...new Set(xs.map((x) => x?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

/** Category, type and family, with the values already in use as suggestions. */
export function GroupFields({ value, onChange, existing, product = false }: { value: GroupDraft; onChange: (d: GroupDraft) => void; existing: ItemExtras[]; product?: boolean }) {
  const id = useId();
  const lists = useMemo(
    () => ({ category: uniq(existing.map((x) => x.category)), productType: uniq(existing.map((x) => x.productType)), family: uniq(existing.map((x) => x.family)) }),
    [existing],
  );
  const field = (k: keyof GroupDraft, label: string, hint: string) => (
    <label>
      {label}
      <input list={`${id}-${k}`} value={value[k]} maxLength={200} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
      <datalist id={`${id}-${k}`}>
        {lists[k].map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <span className="muted small block">{hint}</span>
    </label>
  );
  return (
    <fieldset className="tracked">
      <legend>Group (optional)</legend>
      <div className="grid2">
        {field('category', 'Category', 'e.g. Doormats, Packing Materials')}
        {field('productType', 'Type', 'e.g. Tufted Doormats')}
      </div>
      {field('family', 'Family', product ? 'Items of the same kind in different sizes; steps can be set for a whole family' : 'Items of the same kind in different sizes, e.g. Carton Box')}
    </fieldset>
  );
}

/** ERP code and where the record came from: kept out of sight, editable. */
export function ErpReference({ erpCode, onChange, importSource }: { erpCode: string; onChange: (v: string) => void; importSource?: string }) {
  return (
    <details className="erp-ref">
      <summary className="small muted">ERP reference{erpCode ? `: ${erpCode}` : ''}</summary>
      <label>
        ERP code
        <input value={erpCode} maxLength={80} onChange={(e) => onChange(e.target.value)} />
        <span className="muted small block">The code in the company ERP (not live yet). It is not the product code; it is kept so it does not have to be typed again later.</span>
      </label>
      {importSource && <p className="muted small">Came from: {importSource}</p>}
    </details>
  );
}

/**
 * Shown while the base unit is a guess: says so, lists where the item is used
 * (before a change) and offers "Confirm unit".
 */
export function UnitGuess(props: { type: ComponentType; id: string | null; savedUnit: string | null; unit: string; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  const { workspaceId } = useApp();
  const master = useMasterData(workspaceId);
  const jos = useCollection<JobOrder>(workspaceId, 'jobOrders');
  const counts = useCollection<StockCount>(workspaceId, 'stockCounts');
  const changing = !!props.savedUnit && props.unit !== props.savedUnit;
  const uses = useMemo(
    () =>
      changing && props.id
        ? itemUses(props.type, props.id, {
            boms: master.boms.items,
            productName: (pid) => master.md.products.get(pid)?.name ?? '',
            jobOrders: jos.items,
            stockCounts: counts.items,
          })
        : [],
    [changing, props.type, props.id, master.boms.items, master.md.products, jos.items, counts.items],
  );
  if (props.confirmed) {
    return (
      <p className="ok small">
        Unit will be confirmed on save: {unitLabel(props.unit)} is then fixed.{' '}
        <button type="button" className="linkish small" onClick={() => props.onConfirm(false)}>
          Undo
        </button>
      </p>
    );
  }
  return (
    <div className="unit-guess">
      <p className="warn small">
        <strong>Unit guessed</strong> (not in the source data). You can still change it. Confirm it once you know it is right — then it is fixed like any other base unit.
      </p>
      {changing && (
        <div className="small">
          <p>
            Changing {unitLabel(props.savedUnit!)} → {unitLabel(props.unit)}.{' '}
            {uses.length ? 'Check these after saving:' : 'It is not used in any BOM, order or stock count yet.'}
          </p>
          {uses.length > 0 && (
            <ul className="plain-list">
              {uses.map((u, i) => (
                <li key={i} className="warn">
                  {u.text}
                </li>
              ))}
            </ul>
          )}
          {uses.length > 0 && <p className="muted small">Quantities written in units of another kind will show “Conversion needed” until corrected; nothing is converted silently.</p>}
        </div>
      )}
      <button type="button" className="secondary small" onClick={() => props.onConfirm(true)}>
        Confirm unit ({unitLabel(props.unit)})
      </button>
    </div>
  );
}

