import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { COLLECTION_JOB_ORDERS, formatDay, type JobOrder } from '../../lib/jobOrders';
import { readDate } from '../../lib/joImport';
import { readSheetFile, type ReadSheet } from '../../lib/importRead';
import { productContext } from '../../lib/masters';
import { isDuplicateUse, matchMaterial, newUseId, parseUseGrid, materialAliasKey, woKey, type ParsedUse, type UseEntry } from '../../lib/materialUse';
import { readJson, writeJson } from '../../lib/storage';
import { convert, formatQty, unitLabel } from '../../lib/units';
import { useCollection } from '../masters/useCollection';
import { useMasterData } from '../masters/useMasterData';
import { madeItems } from './MaterialUseCard';
import { saveJoFields } from './stepSave';

const aliasesKey = (ws: string) => `useAliases:${ws}`;
const SKIP = '__skip';

/**
 * Orders → Import material use (Round 3, 18 Nov 2026): the ERP production data (one block per WO and
 * production date, material used in kg). Read on the phone; nothing is saved until "Save". Prices are
 * never read. Entries already there (same date, item and quantity) are not added again.
 */
export function UseImportPage() {
  const { workspaceId } = useApp();
  const master = useMasterData(workspaceId);
  const md = master.md;
  const jos = useCollection<JobOrder>(workspaceId, COLLECTION_JOB_ORDERS);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<ReadSheet[]>([]);
  const [sheetIx, setSheetIx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [itemFor, setItemFor] = useState<Record<string, string>>({});
  const [matFor, setMatFor] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<string | null>(null);

  const parsed: ParsedUse[] = useMemo(() => (sheets[sheetIx] ? parseUseGrid(sheets[sheetIx]!.grid, readDate) : []), [sheets, sheetIx]);
  const raws = useMemo(() => [...md.rawMaterials.entries()].map(([id, r]) => ({ id, name: r.name, erpCode: r.erpCode, active: r.active })), [md]);
  const aliases = workspaceId ? readJson<Record<string, string>>(aliasesKey(workspaceId), {}) : {};
  const names = [...new Set(parsed.flatMap((p) => p.materials.map((m) => m.name)))];
  const matOf = (name: string) => matFor[name] ?? matchMaterial(name, raws, aliases)?.id ?? '';
  const groups = useMemo(() => {
    const by = new Map<string, ParsedUse[]>();
    for (const p of parsed) by.set(woKey(p.joNo), [...(by.get(woKey(p.joNo)) ?? []), p]);
    return [...by.entries()].map(([k, list]) => ({ key: k, label: list[0]!.joNo, list, jo: jos.items.find((j) => woKey(j.joNumber) === k && j.status !== 'CANCELLED' && j.status !== 'DRAFT') ?? null }));
  }, [parsed, jos.items]);

  async function open(f: File) {
    setError(null);
    setDone(null);
    try {
      const s = await readSheetFile(f);
      setFileName(f.name);
      setSheets(s);
      const best = s.findIndex((x) => parseUseGrid(x.grid, readDate).length > 0);
      setSheetIx(best < 0 ? 0 : best);
      if (best < 0) setError('No production blocks found (rows with "WO", "Production Date", "Material" and "Consumption").');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const build = (jo: JobOrder & { id: string }, list: ParsedUse[]) => {
    const items = madeItems(jo, md);
    const pid = itemFor[jo.id] ?? (items.find((x) => x.unit === 'sqm') ?? items[0])?.id ?? '';
    const product = md.products.get(pid);
    let dup = 0;
    const out: UseEntry[] = [];
    const problems: string[] = [];
    for (const p of list) {
      if (!product) break;
      if (!p.on) {
        problems.push('a block without a production date');
        continue;
      }
      const ctx = productContext(product);
      const useSqm = p.sqm !== null && convert(1, 'sqm', product.baseUnit, ctx).ok;
      const qty = useSqm ? p.sqm! : p.pcs;
      if (!qty) {
        problems.push(`${formatDay(p.on)}: no quantity`);
        continue;
      }
      const lines = p.materials.flatMap((m) => {
        const id = matOf(m.name);
        const r = id && id !== SKIP ? md.rawMaterials.get(id) : null;
        return r ? [{ type: 'RAW_MATERIAL' as const, id, name: r.name, qty: m.qty, unit: p.unit }] : [];
      });
      const e: UseEntry = { id: newUseId(), on: p.on, productId: pid, productName: product.name, qty, unit: useSqm ? 'sqm' : 'pcs', lines, at: new Date().toISOString(), source: `Imported: ${fileName}`, ...(p.widthCm && p.lengthCm ? { note: `${formatQty(p.widthCm)} × ${formatQty(p.lengthCm)} cm${p.pcs ? `, ${formatQty(p.pcs)} pcs` : ''}` } : {}) };
      if (isDuplicateUse([...(jo.materialUse ?? []), ...out], e)) dup++;
      else out.push(e);
    }
    return { items, pid, out, dup, problems };
  };

  const unmapped = names.filter((n) => !matOf(n));
  function save() {
    if (!workspaceId) return;
    let n = 0;
    for (const g of groups) {
      if (!g.jo) continue;
      const b = build(g.jo, g.list);
      if (!b.out.length) continue;
      saveJoFields(workspaceId, g.jo, { materialUse: [...(g.jo.materialUse ?? []), ...b.out] }, `Material use imported: ${b.out.length} entr${b.out.length === 1 ? 'y' : 'ies'} from ${fileName}`);
      n += b.out.length;
    }
    const al = readJson<Record<string, string>>(aliasesKey(workspaceId), {});
    for (const nm of names) if (remember[nm] && matFor[nm] && matFor[nm] !== SKIP) al[materialAliasKey(nm)] = matFor[nm]!;
    writeJson(aliasesKey(workspaceId), al);
    setDone(`${n} entr${n === 1 ? 'y' : 'ies'} saved. The file stays on your phone.`);
  }

  return (
    <section>
      <p>
        <Link to="/orders">← Orders</Link>
      </p>
      <h2>Import material use</h2>
      <p className="muted small">The ERP production data: one block per WO and production date with the material used. Read on the phone; nothing is saved until you press Save. Prices are never read.</p>
      {master.notReady && <p className="warn small">{master.notReady}</p>}
      <div className="card import-card">
        <label className="button primary file-button">
          Choose Excel / CSV file
          <input type="file" accept=".xlsx,.xlsm,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => (e.target.files?.[0] && open(e.target.files[0]), (e.target.value = ''))} />
        </label>
        {fileName && <p className="small">{fileName}</p>}
        {sheets.length > 1 && (
          <label className="small">
            Sheet
            <select value={sheetIx} onChange={(e) => setSheetIx(Number(e.target.value))}>
              {sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && <p className="error small">{error}</p>}
      </div>

      {names.length > 0 && (
        <div className="card">
          <h3>Materials in the file</h3>
          {names.map((nm) => {
            const m = matchMaterial(nm, raws, aliases);
            return (
              <div key={nm} className="extra-row">
                <label className="small">
                  {nm}
                  {m && !matFor[nm] ? <span className="muted"> · {m.by === 'remembered' ? 'remembered' : m.by === 'code' ? 'ERP code' : 'same name'}</span> : null}
                  <select value={matOf(nm)} onChange={(e) => setMatFor({ ...matFor, [nm]: e.target.value })}>
                    <option value="">— choose —</option>
                    <option value={SKIP}>Skip this material</option>
                    {[...raws].sort((a, b) => a.name.localeCompare(b.name)).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                {matFor[nm] && matFor[nm] !== SKIP && (
                  <label className="check small">
                    <input type="checkbox" checked={!!remember[nm]} onChange={(e) => setRemember({ ...remember, [nm]: e.target.checked })} /> Remember: this text means that material
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}

      {groups.map((g) => {
        const sq = g.list.reduce((a, p) => a + (p.sqm ?? 0), 0);
        if (!g.jo)
          return (
            <div key={g.key} className="card subtle">
              <strong>WO {g.label}</strong> · {g.list.length} entr{g.list.length === 1 ? 'y' : 'ies'}
              <p className="muted small">Not a confirmed WO in the app: skipped.</p>
            </div>
          );
        const b = build(g.jo, g.list);
        return (
          <div key={g.key} className="card">
            <strong>WO {g.jo.joNumber}</strong> · {g.list.length} entr{g.list.length === 1 ? 'y' : 'ies'}
            {sq > 0 ? ` · ${formatQty(sq)} sq m` : ''}
            <label className="small">
              Item made
              <select value={b.pid} onChange={(e) => setItemFor({ ...itemFor, [g.jo!.id]: e.target.value })}>
                {b.items.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({unitLabel(x.unit)})
                  </option>
                ))}
              </select>
            </label>
            {!b.items.length && <p className="warn small">This WO has no made items to compare.</p>}
            <p className="small">
              {b.out.length} new{b.dup ? ` · ${b.dup} already there (not added again)` : ''}
              {b.problems.length ? ` · skipped: ${b.problems.join(', ')}` : ''}
            </p>
          </div>
        );
      })}

      {groups.some((g) => g.jo) && (
        <div className="card">
          {unmapped.length > 0 && <p className="warn small">Choose a material (or Skip) for: {unmapped.join(', ')}.</p>}
          <button type="button" className="primary" disabled={unmapped.length > 0 || !!master.notReady || !!done} onClick={save}>
            Save
          </button>
          {done && <p className="ok small">{done}</p>}
        </div>
      )}
    </section>
  );
}
