import { useState } from 'react';
import { useApp } from '../../AppContext';
import { formatDay, type JobOrder } from '../../lib/jobOrders';
import type { Process, Product, Supplier } from '../../lib/masters';
import { checkDue, itemState, lastChecklist, newExtraId, suggestedItems, upsertItem, type CheckItem, type ItemState, type OrderItem } from '../../lib/orderExtras';
import { istDateKey } from '../../lib/time';
import { formatQty, unitLabel } from '../../lib/units';
import { useWorkCalendar } from '../calendar/useWorkCalendar';
import type { WithMeta } from '../masters/useCollection';
import { parseNum } from '../masters/fields';
import { saveJoFields } from './stepSave';

const STATE: Record<ItemState, { label: string; cls: string }> = {
  LANDED: { label: 'Landed', cls: 'ok' },
  LATE: { label: 'Late', cls: 'bad' },
  EXPECTED: { label: 'Expected', cls: '' },
  ORDERED: { label: 'Ordered · no date', cls: 'warn' },
  TO_ORDER: { label: 'To order', cls: 'warn' },
};

/**
 * WO "Checklist" tab (round 2, 17 Nov 2026): order items to arrange outside the BOM, and the customer's
 * requirements with due dates. Everything is written by the user; nothing is sent or approved by the app.
 */
export function ChecklistTab({ jo, allJos, products, processes, suppliers, editable }: { jo: WithMeta<JobOrder>; allJos: (JobOrder & { id: string })[]; products: Map<string, Product>; processes: Map<string, Process>; suppliers: (Supplier & { id: string })[]; editable: boolean }) {
  const { workspaceId } = useApp();
  const { cal } = useWorkCalendar();
  const today = istDateKey(new Date());
  const [editItem, setEditItem] = useState<OrderItem | null>(null);
  const [editCheck, setEditCheck] = useState<CheckItem | null>(null);
  const items = jo.orderItems ?? [];
  const checks = jo.checklist ?? [];
  const procName = (id: string | null | undefined) => (id ? (processes.get(id)?.name ?? 'process') : null);
  const supName = (id: string | null | undefined) => (id ? (suppliers.find((s) => s.id === id)?.name ?? 'supplier') : null);
  const saveItems = (next: OrderItem[], what: string) => saveJoFields(workspaceId, jo, { orderItems: next }, what);
  const saveChecks = (next: CheckItem[], what: string) => saveJoFields(workspaceId, jo, { checklist: next }, what);
  const printing = [...processes.entries()].find(([, p]) => /print/i.test(p.name) && p.active !== false)?.[0] ?? null;
  const suggestions = editable ? suggestedItems(jo, products, printing) : [];
  const fromLast = editable && checks.length === 0 ? lastChecklist(allJos, jo.customerId, jo.id) : [];
  const stepProcesses = [...new Set(jo.lines.flatMap((l) => (l.steps ?? []).map((s) => s.processId ?? s.outsideOf ?? '')).filter(Boolean))];

  return (
    <>
      <div className="card">
        <h3>Items to arrange for this order</h3>
        <p className="muted small">Things not in any BOM: stencil plates, plotter prints, swing tickets, care labels, shipping marks… With "Needed before", the process's "Ready to start?" checks that they have landed.</p>
        {items.length === 0 && <p className="muted small">No items yet.</p>}
        <ul className="plain-list">
          {items.map((it) => {
            const st = itemState(it, today);
            return (
              <li key={it.id} className="extra-row">
                <div className="row between">
                  <strong>{it.item}</strong>
                  <span className={`pill ${STATE[st].cls}`}>{STATE[st].label}</span>
                </div>
                <div className="small muted">
                  {[it.qty ? `${formatQty(it.qty)} ${unitLabel(it.unit ?? 'pcs')}` : null, supName(it.supplierId), it.poNo && `Supplier PO ${it.poNo}`, it.orderedOn && `ordered ${formatDay(it.orderedOn)}`, it.expectedOn && !it.landedOn && `expected ${formatDay(it.expectedOn)}`, it.landedOn && `landed ${formatDay(it.landedOn)}`, it.neededAt && `needed before ${procName(it.neededAt)}`].filter(Boolean).join(' · ')}
                </div>
                {it.note && <div className="small">{it.note}</div>}
                {editable && (
                  <div className="row gap">
                    {!it.landedOn && (
                      <button type="button" className="secondary small" onClick={() => saveItems(items.map((x) => (x.id === it.id ? { ...x, landedOn: today } : x)), `${it.item}: landed today`)}>
                        Landed today
                      </button>
                    )}
                    <button type="button" className="secondary small" onClick={() => setEditItem(it)}>
                      Edit
                    </button>
                  </div>
                )}
                {editItem?.id === it.id && <ItemForm value={editItem} today={today} suppliers={suppliers} processes={stepProcesses.map((id) => [id, procName(id)!])} onCancel={() => setEditItem(null)} onSave={(v) => (saveItems(upsertItem(items, v, new Date().toISOString()), `${v.item}: details saved`), setEditItem(null))} onRemove={() => window.confirm(`Remove ${it.item} from this order?`) && (saveItems(items.filter((x) => x.id !== it.id), `${it.item}: removed`), setEditItem(null))} />}
              </li>
            );
          })}
        </ul>
        {editable && editItem && !items.some((x) => x.id === editItem.id) && <ItemForm value={editItem} today={today} suppliers={suppliers} processes={stepProcesses.map((id) => [id, procName(id)!])} onCancel={() => setEditItem(null)} onSave={(v) => (saveItems(upsertItem(items, v, new Date().toISOString()), `${v.item}: added`), setEditItem(null))} />}
        {editable && !editItem && (
          <div className="row gap wrap">
            <button type="button" className="secondary small" onClick={() => setEditItem({ id: newExtraId(), item: '', unit: 'pcs' })}>
              + Add item
            </button>
            {suggestions.length > 0 && (
              <button type="button" className="secondary small" onClick={() => saveItems([...items, ...suggestions], `Order items added from the product designs: ${suggestions.map((s) => s.item).join(', ')}`)}>
                + {suggestions.length} from product designs
              </button>
            )}
          </div>
        )}
        {suggestions.length > 0 && editable && <p className="muted small">From the products' "stencil plates" and shape: {suggestions.map((s) => `${s.item} (${s.qty})`).join(', ')}. Check them after adding.</p>}
      </div>

      <div className="card">
        <h3>Customer requirements</h3>
        <p className="muted small">The customer's own requirements for this order (sample approvals, test reports, certificates, booking…), each with a due date or "N working days before cargo ready". Written by you; the app never marks anything approved.</p>
        {checks.length === 0 && <p className="muted small">No requirements yet.</p>}
        <ul className="plain-list">
          {checks.map((c) => {
            const due = checkDue(c, jo, cal);
            const late = !c.doneOn && due && due < today;
            return (
              <li key={c.id} className={`extra-row${c.doneOn ? ' done' : ''}`}>
                <div className="row between">
                  <span>
                    {c.doneOn ? '✓ ' : ''}
                    {c.text}
                  </span>
                  <span className={`pill ${c.doneOn ? 'ok' : late ? 'bad' : ''}`}>{c.doneOn ? `Done ${formatDay(c.doneOn)}` : due ? `${late ? 'Was due' : 'Due'} ${formatDay(due)}` : 'No date'}</span>
                </div>
                <div className="small muted">
                  {c.daysBefore !== null && c.daysBefore !== undefined && !c.due ? `${c.daysBefore} working day${c.daysBefore === 1 ? '' : 's'} before cargo ready` : null}
                  {c.note ? `${c.daysBefore !== null && c.daysBefore !== undefined && !c.due ? ' · ' : ''}${c.note}` : null}
                </div>
                {editable && (
                  <div className="row gap">
                    <button type="button" className="secondary small" onClick={() => saveChecks(checks.map((x) => (x.id === c.id ? (c.doneOn ? { ...x, doneOn: null } : { ...x, doneOn: today }) : x)), `${c.text}: ${c.doneOn ? 'marked not done' : 'done today'}`)}>
                      {c.doneOn ? 'Not done' : 'Done today'}
                    </button>
                    <button type="button" className="secondary small" onClick={() => setEditCheck(c)}>
                      Edit
                    </button>
                  </div>
                )}
                {editCheck?.id === c.id && <CheckForm value={editCheck} today={today} onCancel={() => setEditCheck(null)} onSave={(v) => (saveChecks(checks.map((x) => (x.id === v.id ? v : x)), `${v.text}: saved`), setEditCheck(null))} onRemove={() => window.confirm(`Remove "${c.text}"?`) && (saveChecks(checks.filter((x) => x.id !== c.id), `${c.text}: removed`), setEditCheck(null))} />}
              </li>
            );
          })}
        </ul>
        {editable && editCheck && !checks.some((x) => x.id === editCheck.id) && <CheckForm value={editCheck} today={today} onCancel={() => setEditCheck(null)} onSave={(v) => (saveChecks([...checks, v], `Customer requirement added: ${v.text}`), setEditCheck(null))} />}
        {editable && !editCheck && (
          <div className="row gap wrap">
            <button type="button" className="secondary small" onClick={() => setEditCheck({ id: newExtraId(), text: '', daysBefore: null })}>
              + Add requirement
            </button>
            {fromLast.length > 0 && (
              <button type="button" className="secondary small" onClick={() => saveChecks(fromLast, `Customer requirements copied from the last WO of ${jo.customerName}`)}>
                Copy {fromLast.length} from the last WO of this customer
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ItemForm({ value, today, suppliers, processes, onSave, onCancel, onRemove }: { value: OrderItem; today: string; suppliers: (Supplier & { id: string })[]; processes: [string, string][]; onSave: (v: OrderItem) => void; onCancel: () => void; onRemove?: () => void }) {
  const [v, setV] = useState<OrderItem>(value);
  const [qtyText, setQty] = useState(value.qty ? String(value.qty) : '');
  const set = (p: Partial<OrderItem>) => setV((x) => ({ ...x, ...p }));
  const qty = parseNum(qtyText);
  const bad = !v.item.trim() ? 'Enter what it is.' : qtyText.trim() && (qty === null || qty < 0) ? 'Check the quantity.' : v.orderedOn && v.orderedOn > today ? 'The order date cannot be in the future.' : v.landedOn && v.landedOn > today ? 'The landed date cannot be in the future.' : v.expectedOn && v.orderedOn && v.expectedOn < v.orderedOn ? 'The expected date is before the order date.' : null;
  return (
    <div className="card subtle output-form">
      <label className="small">
        Item
        <input value={v.item} maxLength={80} placeholder="e.g. Swing tickets" onChange={(e) => set({ item: e.target.value })} />
      </label>
      <div className="grid2">
        <label className="small">
          Quantity (optional)
          <input inputMode="decimal" value={qtyText} onChange={(e) => setQty(e.target.value)} />
        </label>
        <label className="small">
          Unit
          <input value={v.unit ?? 'pcs'} maxLength={12} onChange={(e) => set({ unit: e.target.value })} />
        </label>
      </div>
      <label className="small">
        Supplier
        <select value={v.supplierId ?? ''} onChange={(e) => set({ supplierId: e.target.value || null })}>
          <option value="">— not set —</option>
          {[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="small">
        Supplier PO No. (optional)
        <input value={v.poNo ?? ''} maxLength={40} onChange={(e) => set({ poNo: e.target.value })} />
      </label>
      <div className="grid3">
        <label className="small">
          Ordered on
          <input type="date" value={v.orderedOn ?? ''} max={today} onChange={(e) => set({ orderedOn: e.target.value || null })} />
        </label>
        <label className="small">
          Supplier says: by
          <input type="date" value={v.expectedOn ?? ''} onChange={(e) => set({ expectedOn: e.target.value || null })} />
        </label>
        <label className="small">
          Landed on
          <input type="date" value={v.landedOn ?? ''} max={today} onChange={(e) => set({ landedOn: e.target.value || null })} />
        </label>
      </div>
      <label className="small">
        Needed before (optional)
        <select value={v.neededAt ?? ''} onChange={(e) => set({ neededAt: e.target.value || null })}>
          <option value="">— any time —</option>
          {processes.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="small">
        Note (optional)
        <input value={v.note ?? ''} maxLength={200} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {bad && v.item && <p className="error small">{bad}</p>}
      <div className="row gap">
        <button type="button" className="primary small" disabled={!!bad} onClick={() => onSave(clean({ ...v, item: v.item.trim(), qty: qtyText.trim() ? qty : null }))}>
          Save
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="secondary small" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function CheckForm({ value, today, onSave, onCancel, onRemove }: { value: CheckItem; today: string; onSave: (v: CheckItem) => void; onCancel: () => void; onRemove?: () => void }) {
  const [v, setV] = useState<CheckItem>(value);
  const [mode, setMode] = useState<'BEFORE' | 'DATE'>(value.due ? 'DATE' : 'BEFORE');
  const [daysText, setDays] = useState(value.daysBefore !== null && value.daysBefore !== undefined ? String(value.daysBefore) : '');
  const days = daysText.trim() ? Number(daysText) : null;
  const bad = !v.text.trim() ? 'Enter the requirement.' : mode === 'BEFORE' && days !== null && !(Number.isInteger(days) && days >= 0 && days <= 120) ? 'Days: a whole number from 0 to 120.' : v.doneOn && v.doneOn > today ? 'The done date cannot be in the future.' : null;
  return (
    <div className="card subtle output-form">
      <label className="small">
        Requirement
        <input value={v.text} maxLength={120} placeholder="e.g. Swing tag sample approved by the buyer" onChange={(e) => setV({ ...v, text: e.target.value })} />
      </label>
      <div className="segmented small">
        <button type="button" className={mode === 'BEFORE' ? 'on' : undefined} onClick={() => setMode('BEFORE')}>
          Days before cargo ready
        </button>
        <button type="button" className={mode === 'DATE' ? 'on' : undefined} onClick={() => setMode('DATE')}>
          Fixed date
        </button>
      </div>
      {mode === 'BEFORE' ? (
        <label className="small">
          Working days before cargo ready (empty = no date)
          <input inputMode="numeric" value={daysText} onChange={(e) => setDays(e.target.value)} />
        </label>
      ) : (
        <label className="small">
          Due on
          <input type="date" value={v.due ?? ''} onChange={(e) => setV({ ...v, due: e.target.value || null })} />
        </label>
      )}
      <label className="small">
        Done on (optional)
        <input type="date" value={v.doneOn ?? ''} max={today} onChange={(e) => setV({ ...v, doneOn: e.target.value || null })} />
      </label>
      <label className="small">
        Note (optional)
        <input value={v.note ?? ''} maxLength={200} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      {bad && v.text && <p className="error small">{bad}</p>}
      <div className="row gap">
        <button type="button" className="primary small" disabled={!!bad} onClick={() => onSave(clean({ ...v, text: v.text.trim(), ...(mode === 'BEFORE' ? { daysBefore: days, due: null } : { daysBefore: null }) }))}>
          Save
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="secondary small" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/** Drops empty optional fields (no undefined / empty strings stored). */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined && x !== null && x !== '')) as T;
}
