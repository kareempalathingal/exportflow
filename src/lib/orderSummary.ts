/**
 * What an order contains, at a glance (confirmed 26 Oct 2026): per product
 * the ordered quantity (as on the order), the base-unit equivalent when the
 * unit differs, Make/Buy and that product's own progress. Totals are only
 * added up within one unit (pcs + pcs), never across units.
 */
import { effectiveSupply, resolveLine, type JobOrder } from './jobOrders';
import type { MasterData } from './masters';
import { lineProgress, orderStart, planLines, withPlanning, type PlanContext } from './route';
import { formatQty, unitLabel } from './units';

export interface LineSummary {
  id: string;
  productName: string;
  qty: number;
  unit: string;
  /** e.g. "= 1,250 pcs" when the order's unit is not the product's base unit. */
  baseText: string | null;
  supply: 'MAKE' | 'BUY' | null;
  /** Progress of this product's steps; null when it has no steps (drafts, no route). */
  pct: number | null;
  done: boolean;
  now: string | null;
}

export function lineSummaries(jo: JobOrder, md: MasterData, today: string, ctx: PlanContext): LineSummary[] {
  const planned = jo.status === 'DRAFT' ? null : planLines(jo, md);
  const start = orderStart(jo);
  return jo.lines.map((l, i) => {
    const r = resolveLine(l, md);
    const baseText = r.baseQty !== null && r.baseUnit && r.baseUnit !== l.unit ? `= ${formatQty(r.baseQty)} ${unitLabel(r.baseUnit)}` : null;
    const lp = planned ? lineProgress(withPlanning(planned[i]?.steps, jo, ctx), start, today, ctx.cal) : null;
    return {
      id: l.id,
      productName: l.productName || md.products.get(l.productId)?.name || 'Product',
      qty: l.qty,
      unit: l.unit,
      baseText,
      supply: effectiveSupply(l, md.products.get(l.productId)),
      pct: lp ? lp.actualPct : null,
      done: lp?.done ?? false,
      now: lp?.current ? lp.current.step.label : null,
    };
  });
}

/** "3,500 pcs + 500 sq m": ordered quantities added up per unit, in order of first appearance. */
export function quantityTotals(jo: Pick<JobOrder, 'lines'>): string {
  const sums = new Map<string, number>();
  for (const l of jo.lines) if (Number.isFinite(l.qty)) sums.set(l.unit, (sums.get(l.unit) ?? 0) + l.qty);
  return [...sums.entries()].map(([u, q]) => `${formatQty(q)} ${unitLabel(u)}`).join(' + ');
}
