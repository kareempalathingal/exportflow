/**
 * Where a product or raw material is used (confirmed 4 Nov 2026): shown
 * before a guessed base unit is changed, so nothing is re-read in the wrong
 * unit without the user knowing.
 */
import type { JobOrder } from './jobOrders';
import { lineComponent, type Bom, type ComponentType } from './masters';
import type { StockCount } from './materials';

export interface ItemUse {
  kind: 'BOM' | 'ORDER' | 'STOCK';
  text: string;
}

export function itemUses(
  type: ComponentType,
  id: string,
  data: {
    boms: (Bom & { id: string })[];
    productName: (id: string) => string;
    jobOrders: (JobOrder & { id: string })[];
    stockCounts: (StockCount & { id: string })[];
  },
): ItemUse[] {
  const out: ItemUse[] = [];
  const uses = (b: { lines: Bom['lines'] }) => b.lines.some((l) => {
    const c = lineComponent(l);
    return c.type === type && c.id === id;
  });
  for (const b of data.boms) {
    if (type === 'PRODUCT' && b.productId === id && b.lines.length) out.push({ kind: 'BOM', text: 'Its own BOM (written per 1 base unit)' });
    if (uses(b)) out.push({ kind: 'BOM', text: `BOM of ${data.productName(b.productId) || 'a product'}` });
  }
  const key = `${type}:${id}`;
  for (const jo of data.jobOrders) {
    if (jo.status === 'CANCELLED') continue;
    const why: string[] = [];
    if (type === 'PRODUCT' && jo.lines.some((l) => l.productId === id)) why.push('ordered');
    if (Object.values(jo.bomSnapshot ?? {}).some(uses) || (type === 'PRODUCT' && jo.bomSnapshot?.[id])) why.push('in the saved BOMs');
    if (jo.stock?.[key]) why.push('stock set aside');
    if (why.length) out.push({ kind: 'ORDER', text: `${jo.joNumber} (${why.join(', ')})` });
  }
  if (data.stockCounts.some((s) => s.itemType === type && s.itemId === id)) out.push({ kind: 'STOCK', text: 'Stock count (in the old unit: count again after the change)' });
  return out;
}
