/** ERP import aids (confirmed 4 Nov 2026): grouping, guessed units, family steps, item uses, import label. */
import { describe, expect, it } from 'vitest';
import { planBaseUnitCopy, type BaseUnitCopyPlan } from '../../src/lib/baseUnitCopy';
import { BACKUP_FORMAT, type BackupFile } from '../../src/lib/backup';
import { commonRoute, familyMembers, filterItems, groupByCategory, NO_GROUP, planFamilyRoute, sameRoute } from '../../src/lib/itemGroups';
import { itemUses } from '../../src/lib/itemUses';
import type { JobOrder } from '../../src/lib/jobOrders';
import { baseUnitGuessed, itemExtras, type Bom, type MasterData, type Product, type RouteStep } from '../../src/lib/masters';
import type { StockCount } from '../../src/lib/materials';
import { planRestore } from '../../src/lib/restore';
import { buildSampleData } from '../../src/lib/sampleData';

const step = (processId: string, perDay: number | null = null): RouteStep => ({ processId, perDay, perDayUnit: 'pcs', fixedDays: null, status: perDay ? 'USER_PROVIDED' : 'PENDING_VERIFICATION', source: '' });
const item = (name: string, x: Partial<Product> = {}) => ({ id: name, name, active: true, baseUnit: 'pcs', ...x }) as Product & { id: string };

describe('grouping and filters', () => {
  const items = [
    item('a', { category: 'Doormats', productType: 'Tufted', family: 'Printed', baseUnitStatus: 'ESTIMATED' }),
    item('b', { category: 'Doormats', productType: 'Moulded', family: 'Rubber' }),
    item('c', { category: 'Towel', family: 'Beach' }),
    item('d'),
  ];
  it('filters by category, type, family and "no category"; guessed units only', () => {
    expect(filterItems(items, { category: 'Doormats', productType: '', family: '', guessedOnly: false }).map((x) => x.id)).toEqual(['a', 'b']);
    expect(filterItems(items, { category: 'Doormats', productType: 'Moulded', family: '', guessedOnly: false }).map((x) => x.id)).toEqual(['b']);
    expect(filterItems(items, { category: NO_GROUP, productType: '', family: '', guessedOnly: false }).map((x) => x.id)).toEqual(['d']);
    expect(filterItems(items, { category: '', productType: '', family: '', guessedOnly: true }).map((x) => x.id)).toEqual(['a']);
  });
  it('groups by category, items without one last', () => {
    expect(groupByCategory(items).map((g) => [g.name, g.items.length])).toEqual([
      ['Doormats', 2],
      ['Towel', 1],
      [NO_GROUP, 1],
    ]);
  });
  it('extras are carried through a save; only a guess may change the unit', () => {
    expect(itemExtras({ category: 'Doormats', family: '', erpCode: 'X1', baseUnitStatus: 'ESTIMATED' })).toEqual({ category: 'Doormats', erpCode: 'X1', baseUnitStatus: 'ESTIMATED' });
    expect(baseUnitGuessed({ baseUnitStatus: 'ESTIMATED' })).toBe(true);
    expect(baseUnitGuessed({ baseUnitStatus: 'USER_PROVIDED' })).toBe(false);
    expect(baseUnitGuessed({})).toBe(false);
  });
});

describe('steps for a whole family', () => {
  const fam = [
    item('p1', { family: 'F', route: [step('t'), step('pr')] }),
    item('p2', { family: 'F', route: [step('t'), step('pr')] }),
    item('p3', { family: 'F', route: [step('x')] }),
    item('p4', { family: 'F' }),
    item('p5', { family: 'F', active: false }),
    item('q1', { family: 'G' }),
  ];
  it('members are the active items of exactly that family; the start is the most common route', () => {
    expect(familyMembers(fam, 'F').map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(sameRoute(commonRoute(familyMembers(fam, 'F')), [step('t'), step('pr')])).toBe(true);
    expect(commonRoute([item('z')])).toEqual([]);
  });
  it('preview: who changes, who already has it, who is kept', () => {
    const m = familyMembers(fam, 'F');
    const all = planFamilyRoute(m, [step('t'), step('pr')], false, false);
    expect(all.same.map((x) => x.id)).toEqual(['p1', 'p2']);
    expect(all.change.map((x) => x.id)).toEqual(['p3', 'p4']);
    expect(all.replaced).toBe(1);
    const only = planFamilyRoute(m, [step('t'), step('pr')], false, true);
    expect(only.change.map((x) => x.id)).toEqual(['p4']);
    expect(only.kept.map((x) => x.id)).toEqual(['p3']);
    // confirming the order of steps counts as a change
    expect(planFamilyRoute(m, [step('t'), step('pr')], true, false).change).toHaveLength(4);
  });
});

describe('where an item is used (before a guessed unit changes)', () => {
  const boms: (Bom & { id: string })[] = [{ id: 'mat', productId: 'mat', notes: '', lines: [{ componentType: 'RAW_MATERIAL', componentId: 'yarn', qty: 1, unit: 'kg', wastagePct: 0, status: 'USER_PROVIDED', source: '' }] }];
  const jo = { id: 'j', joNumber: 'JO-1', status: 'CONFIRMED', lines: [{ id: 'l', productId: 'mat', productName: 'Mat', qty: 1, unit: 'pcs', supply: 'MAKE' }], bomSnapshot: { mat: { rev: 1, lines: boms[0]!.lines } }, stock: { 'RAW_MATERIAL:yarn': { qty: 1, unit: 'kg' } } } as unknown as JobOrder & { id: string };
  const counts = [{ id: 's', itemType: 'RAW_MATERIAL', itemId: 'yarn', qty: 5, unit: 'kg', countedOn: '2026-11-01', notes: '' }] as (StockCount & { id: string })[];
  it('lists BOMs, orders and stock counts', () => {
    const uses = itemUses('RAW_MATERIAL', 'yarn', { boms, productName: () => 'Mat', jobOrders: [jo], stockCounts: counts });
    expect(uses.map((u) => u.kind)).toEqual(['BOM', 'ORDER', 'STOCK']);
    expect(uses[1]!.text).toBe('JO-1 (in the saved BOMs, stock set aside)');
    expect(itemUses('PRODUCT', 'mat', { boms, productName: () => 'Mat', jobOrders: [jo], stockCounts: [] }).map((u) => u.text)).toEqual([
      'Its own BOM (written per 1 base unit)',
      'JO-1 (ordered, in the saved BOMs)',
    ]);
    expect(itemUses('RAW_MATERIAL', 'other', { boms, productName: () => '', jobOrders: [jo], stockCounts: counts })).toEqual([]);
  });
});

describe('import file and copies', () => {
  it('a file made outside the app is labelled and uses its label as the history reason', () => {
    const file: BackupFile = {
      format: BACKUP_FORMAT, app: 'ExportFlow', appVersion: 'erp', workspaceId: 'erp-import', mode: 'ACTUAL', exportedAt: '2026-11-04T12:00:00.000Z', label: 'ERP import (draft data)', counts: {},
      collections: { processes: [{ id: 'erp_proc_x', data: { name: 'Printing', active: true, notes: '' } }] },
    };
    const plan = planRestore(file, {}, { workspaceId: 'u1_demo', mode: 'DEMO' });
    expect(plan.blocked).toBeNull();
    expect(plan.warnings).toContain('This file was made outside the app: ERP import (draft data).');
    expect(plan.warnings.some((w) => /another login/.test(w))).toBe(false);
    expect(plan.writes[0]!.reason).toBe('Imported: ERP import (draft data)');
  });
  it('a copy in another unit is not a guess any more', () => {
    const writes = buildSampleData('2026-11-04');
    const of = <T,>(c: string) => writes.filter((w) => w.collection === c).map((w) => ({ id: w.docId, ...(w.data as unknown as T) }));
    const products = new Map(of<Product>('products').map((p) => [p.id, p]));
    const md: MasterData = { products, rawMaterials: new Map(), boms: new Map() };
    const mat = { ...products.get('sample_p_mat')!, baseUnitStatus: 'ESTIMATED' as const, category: 'Doormats' };
    const p = planBaseUnitCopy({ productId: 'sample_p_mat', product: mat, newUnit: 'sqm', newName: 'Mat (sq m)', md, suppliers: [], jobOrders: [], newId: 'copy', today: '2026-11-04' }) as BaseUnitCopyPlan;
    expect(p.product.baseUnitStatus).toBeUndefined();
    expect(p.product.category).toBe('Doormats');
  });
});
