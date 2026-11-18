import { formatDay } from '../jobOrders';
import { diffText, USE_SUGGEST_MIN, USE_SUGGEST_PCT, type UseReportRow } from '../materialUse';
import { formatQty, unitLabel } from '../units';
import type { DocModel } from './model';

/** Reports → Material use vs BOM (18 Nov 2026). A suggestion is never applied by the app. */
export function materialUseDoc(rows: UseReportRow[], opts: { company: string; today: string; generatedAt: string }): DocModel {
  const sug = rows.filter((r) => r.suggestedQty !== null).length;
  return {
    title: 'Material Use vs BOM',
    reference: formatDay(opts.today),
    company: opts.company,
    meta: [['Compared', `${rows.length} BOM line${rows.length === 1 ? '' : 's'}${sug ? ` · ${sug} with a suggested revision` : ''}`]],
    tables: [
      {
        title: 'Actual use per unit of the BOM item (median of all entries) against the current BOM',
        columns: [{ label: 'BOM of' }, { label: 'Material' }, { label: 'Entries', align: 'right' }, { label: 'BOM per unit', align: 'right' }, { label: 'Used per unit', align: 'right' }, { label: 'Diff.', align: 'right' }, { label: 'Suggestion' }],
        rows: rows.map((r) => [
          r.parentName,
          r.material,
          String(r.entries),
          r.bomPerUnit ? `${formatQty(r.bomPerUnit)} ${unitLabel(r.unit)}/${unitLabel(r.parentUnit)}` : '-',
          r.entries ? `${formatQty(r.actualPerUnit)} ${unitLabel(r.unit)}/${unitLabel(r.parentUnit)}` : '-',
          diffText(r.diffPct),
          r.note ?? (r.suggestedQty !== null ? `BOM line ${formatQty(r.suggestedQty)} ${unitLabel(r.unit)}${r.wastagePct ? ` + ${formatQty(r.wastagePct)}% wastage` : ''}` : '-'),
        ]),
        empty: 'No material use entered yet.',
      },
    ],
    notes: [
      'Figures as entered or imported for each WO (WOs: see the app). The BOM per unit includes wastage.',
      `A revision is suggested only with at least ${USE_SUGGEST_MIN} entries and a difference of ${USE_SUGGEST_PCT}% or more. The BOM is never changed by the app.`,
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `material_use_vs_bom_${opts.today}.pdf`,
  };
}
