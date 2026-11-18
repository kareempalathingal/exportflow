import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { formatDay, type JobOrder } from '../../lib/jobOrders';
import { componentContext, explodeBom, productContext, type MasterData } from '../../lib/masters';
import { bomsForJobOrder, itemKey, planMaterials } from '../../lib/materials';
import { compareEntry, diffText, newUseId, materialTone, materialTotals, type UseEntry, type UseLine } from '../../lib/materialUse';
import { istDateKey } from '../../lib/time';
import { availableUnits, formatQty, unitLabel } from '../../lib/units';
import type { WithMeta } from '../masters/useCollection';
import { parseNum } from '../masters/fields';
import { useProfile } from '../settings/useProfile';
import { saveJoFields } from './stepSave';

const TONE_CLASS = { ok: 'ok', warn: 'warn', bad: 'bad' } as const;

/** The items of a WO that are made (ordered products and made sub-products such as the base mat). */
export function madeItems(jo: Pick<JobOrder, 'lines' | 'status' | 'bomSnapshot' | 'stock'>, md: MasterData): { id: string; name: string; unit: string }[] {
  const plan = planMaterials(jo, md);
  const out = new Map<string, { id: string; name: string; unit: string }>();
  for (const r of plan.toProduce) if (r.type === 'PRODUCT') out.set(r.id, { id: r.id, name: r.name, unit: r.unit });
  return [...out.values()];
}

/**
 * Materials tab, Round 3 (18 Nov 2026): material actually used vs what the WO's BOMs need for the
 * quantity made. Entered by hand or imported from the ERP production data. Quantities only.
 */
export function MaterialUseCard({ jo, md }: { jo: WithMeta<JobOrder>; md: MasterData }) {
  const { workspaceId } = useApp();
  const { profile } = useProfile(workspaceId);
  const [adding, setAdding] = useState(false);
  const woMd = useMemo(() => bomsForJobOrder(jo, md), [jo, md]);
  const totals = useMemo(() => materialTotals(jo, md), [jo, md]);
  const entries = jo.materialUse ?? [];
  const editable = jo.status === 'CONFIRMED' || jo.status === 'COMPLETED';
  const tone = (d: number | null) => materialTone(d, profile?.useWarnPct, profile?.useBadPct);
  if (jo.status === 'DRAFT') return null;
  return (
    <div className="card">
      <h3>Material use vs BOM</h3>
      <p className="muted small">What was actually used, against what this order's BOMs need for the quantity made (incl. wastage). Totals count only entries where both figures exist.</p>
      {entries.length === 0 && <p className="muted small">No material use entered yet.</p>}
      {totals.rows.length > 0 && (
        <table className="board">
          <thead>
            <tr>
              <th>Material</th>
              <th className="num">BOM</th>
              <th className="num">Used</th>
              <th className="num">Diff.</th>
            </tr>
          </thead>
          <tbody>
            {totals.rows.map((r) => {
              const t = tone(r.diffPct);
              return (
                <tr key={r.key}>
                  <td>
                    {r.name}
                    {r.expected === null && <span className="muted small block">not in the BOM</span>}
                    {r.notEntered > 0 && <span className="muted small block">not entered in {r.notEntered} entr{r.notEntered === 1 ? 'y' : 'ies'}</span>}
                    {r.problem && <span className="error small block">{r.problem}</span>}
                  </td>
                  <td className="num">{r.expected !== null && r.compared ? `${formatQty(r.expected)} ${unitLabel(r.unit)}` : '-'}</td>
                  <td className="num">{r.actual !== null ? `${formatQty(r.actual)} ${unitLabel(r.unit)}` : '-'}</td>
                  <td className="num">{r.diffPct === null ? '-' : <span className={`pill ${t ? TONE_CLASS[t] : ''}`}>{diffText(r.diffPct)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {totals.errors.length > 0 && <p className="warn small">BOM: {totals.errors.slice(0, 3).join('; ')}</p>}
      {entries.length > 0 && (
        <details>
          <summary className="small">
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </summary>
          <ul className="plain-list">
            {[...entries].sort((a, b) => b.on.localeCompare(a.on)).map((e) => {
              const c = compareEntry(e, woMd);
              const both = c.rows.filter((r) => r.expected !== null && r.actual !== null);
              const exp = both.reduce((a, r) => a + (r.unit === 'kg' ? r.expected! : 0), 0);
              const act = both.reduce((a, r) => a + (r.unit === 'kg' ? r.actual! : 0), 0);
              const d = exp > 0 ? ((act - exp) / exp) * 100 : null;
              return (
                <li key={e.id} className="extra-row">
                  <div className="row between">
                    <span>
                      {formatDay(e.on)} · {e.productName} · {formatQty(e.qty)} {unitLabel(e.unit)}
                    </span>
                    {d !== null && <span className={`pill ${tone(d) ? TONE_CLASS[tone(d)!] : ''}`}>kg {diffText(d)}</span>}
                  </div>
                  <div className="small muted">
                    {e.lines.map((l) => `${l.name} ${formatQty(l.qty)} ${unitLabel(l.unit)}`).join(' · ')}
                    {e.source ? ` · ${e.source}` : ' · entered by hand'}
                    {e.note ? ` · ${e.note}` : ''}
                  </div>
                  {editable && (
                    <button type="button" className="secondary small" onClick={() => window.confirm(`Remove the entry of ${formatDay(e.on)} (${e.productName})?`) && saveJoFields(workspaceId, jo, { materialUse: entries.filter((x) => x.id !== e.id) }, `Material use of ${formatDay(e.on)} removed (${e.productName})`)}>
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {editable && adding && <UseForm jo={jo} md={md} woMd={woMd} onCancel={() => setAdding(false)} onSave={(e) => (saveJoFields(workspaceId, jo, { materialUse: [...entries, e] }, `Material use of ${formatDay(e.on)} added (${e.productName}, ${formatQty(e.qty)} ${unitLabel(e.unit)})`), setAdding(false))} />}
      {editable && !adding && (
        <div className="row gap wrap">
          <button type="button" className="secondary small" onClick={() => setAdding(true)}>
            + Add entry
          </button>
          <Link className="button secondary small" to="/orders/use-import">
            Import ERP production data
          </Link>
        </div>
      )}
    </div>
  );
}

function UseForm({ jo, md, woMd, onSave, onCancel }: { jo: JobOrder; md: MasterData; woMd: MasterData; onSave: (e: UseEntry) => void; onCancel: () => void }) {
  const today = istDateKey(new Date());
  const items = useMemo(() => madeItems(jo, md), [jo, md]);
  const [on, setOn] = useState(today);
  const [productId, setProductId] = useState(items[0]?.id ?? '');
  const product = md.products.get(productId);
  const units = product ? availableUnits(productContext(product)) : [];
  const [unit, setUnit] = useState(product?.baseUnit ?? '');
  const [qtyText, setQtyText] = useState('');
  const [actual, setActual] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const qty = parseNum(qtyText);
  const exp = productId && qty && qty > 0 && unit ? explodeBom(productId, qty, unit, woMd) : null;
  const mats = useMemo(() => (productId ? explodeBom(productId, 1, md.products.get(productId)?.baseUnit ?? 'pcs', woMd).toBuy : []), [productId, md, woMd]);
  const lines: UseLine[] = mats.flatMap((m) => {
    const q = parseNum(actual[itemKey(m.type, m.id)] ?? '');
    return q !== null && q >= 0 && (actual[itemKey(m.type, m.id)] ?? '').trim() ? [{ type: m.type, id: m.id, name: m.name, qty: q, unit: m.unit }] : [];
  });
  const bad = !productId ? 'Choose the item made.' : !(qty && qty > 0) ? 'Enter the quantity made.' : on > today ? 'The date cannot be in the future.' : !lines.length ? 'Enter at least one material used.' : exp && !exp.productBaseQty ? 'Conversion needed for this unit.' : null;
  return (
    <div className="card subtle output-form">
      <label className="small">
        Production date
        <input type="date" value={on} max={today} onChange={(e) => setOn(e.target.value || today)} />
      </label>
      <label className="small">
        Item made
        <select
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value);
            setUnit(md.products.get(e.target.value)?.baseUnit ?? '');
            setActual({});
          }}
        >
          {items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid2">
        <label className="small">
          Quantity made
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
        </label>
        <label className="small">
          Unit
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {units.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mats.length === 0 && productId && <p className="warn small">This item has no BOM materials to compare.</p>}
      {mats.map((m) => {
        const k = itemKey(m.type, m.id);
        const e = exp?.toBuy.find((x) => itemKey(x.type, x.id) === k);
        const comp = componentContext(m.type, m.id, md);
        return (
          <label key={k} className="small">
            {m.name} used ({unitLabel(comp?.ctx.baseUnit ?? m.unit)}){e ? ` · BOM ${formatQty(e.qty)}` : ''}
            <input inputMode="decimal" value={actual[k] ?? ''} placeholder="not entered" onChange={(ev) => setActual({ ...actual, [k]: ev.target.value })} />
          </label>
        );
      })}
      <label className="small">
        Note (optional)
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </label>
      {bad && qtyText && <p className="error small">{bad}</p>}
      <div className="row gap">
        <button type="button" className="primary small" disabled={!!bad} onClick={() => product && qty && onSave({ id: newUseId(), on, productId, productName: product.name, qty, unit, lines, at: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) })}>
          Save
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
