import { useMemo } from 'react';
import type { JobOrder } from '../../lib/jobOrders';
import type { MasterData } from '../../lib/masters';
import { diffText, materialTone, materialUseReport } from '../../lib/materialUse';
import { materialUseDoc } from '../../lib/docs/useDoc';
import { formatQty, unitLabel } from '../../lib/units';
import { DocButtons } from '../docs/DocButtons';
import { SettingSection } from '../settings/SettingSection';

/** Reports → "Material use vs BOM" (Round 3, 18 Nov 2026). */
export function MaterialUseSection({ jos, md, today, company, generatedAt, warnPct, badPct }: { jos: (JobOrder & { id: string })[]; md: MasterData; today: string; company: string; generatedAt: () => string; warnPct?: number | null; badPct?: number | null }) {
  const rows = useMemo(() => materialUseReport(jos, md), [jos, md]);
  const sug = rows.filter((r) => r.suggestedQty !== null).length;
  return (
    <SettingSection title="Material use vs BOM" summary={rows.length ? `${rows.length} BOM lines${sug ? ` · ${sug} to review` : ''}` : 'No entries yet'} flag={sug ? 'warn' : undefined}>
      <div className="card doc-card">
        <p className="muted small">Actual use per unit of the item whose BOM lists the material (e.g. kg per sq m of base mat), median of all entries, against the current BOM. A revision is only suggested; the BOM is changed by you in Masters.</p>
        {rows.length === 0 ? (
          <p className="muted small">No material use entered yet. Enter it on a WO's Materials tab or import the ERP production data.</p>
        ) : (
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
              {rows.map((r) => {
                const t = materialTone(r.diffPct, warnPct, badPct);
                return (
                  <tr key={`${r.parentId}|${r.key}`}>
                    <td>
                      {r.material}
                      <span className="muted small block">
                        {r.parentName} · {r.entries} entr{r.entries === 1 ? 'y' : 'ies'} · WO {r.wos.join(', ')}
                      </span>
                      {r.note && <span className="muted small block">{r.note}</span>}
                      {r.suggestedQty !== null && (
                        <span className="warn small block">
                          Suggested BOM line: {formatQty(r.suggestedQty)} {unitLabel(r.unit)} per {unitLabel(r.parentUnit)}
                          {r.wastagePct ? ` + ${formatQty(r.wastagePct)}% wastage` : ''}
                        </span>
                      )}
                    </td>
                    <td className="num">{r.bomPerUnit ? formatQty(r.bomPerUnit) : '-'}</td>
                    <td className="num">{r.entries ? formatQty(r.actualPerUnit) : '-'}</td>
                    <td className="num">{r.diffPct === null ? '-' : <span className={`pill ${t ?? ''}`}>{diffText(r.diffPct)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <DocButtons label="Material use vs BOM (PDF)" build={() => materialUseDoc(rows, { company, today, generatedAt: generatedAt() })} />
      </div>
    </SettingSection>
  );
}
