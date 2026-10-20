/**
 * DEMO-only sample data so every screen can be tried at once. Every name ends
 * in "(sample)" and every figure is marked as DEMO data — none of it describes
 * a real company, recipe or benchmark. Never written to ACTUAL.
 */
import type { Tracked } from './dataStatus';
import { addDays, computeDeadline, snapshotBoms, type JobOrder, type JoLine, type JoStatus, type StockEntry } from './jobOrders';
import type { Bom, BomLine, Customer, MasterData, Process, Product, RawMaterial, RouteStep, Supplier } from './masters';
import { buildLineSteps, completeCurrent } from './route';
import type { StockCount } from './materials';

export interface SampleWrite {
  collection: string;
  docId: string;
  entity: string;
  before: ({ rev: number } & Record<string, unknown>) | null;
  data: Record<string, unknown>;
  reason?: string;
}

export const SAMPLE_MARKER_ID = 'sample_p_mat';
const SRC = 'DEMO sample - not real data';
const na: Tracked<number> = { value: null, status: 'UNAVAILABLE', source: '' };
const up = (value: number): Tracked<number> => ({ value, status: 'USER_PROVIDED', source: SRC });
const line = (componentType: 'RAW_MATERIAL' | 'PRODUCT', componentId: string, qty: number, unit: string, wastagePct = 0, status: BomLine['status'] = 'USER_PROVIDED'): BomLine => ({
  componentType, componentId, qty, unit, wastagePct, status, source: SRC,
});

function product(name: string, supplyType: Product['supplyType'], baseUnit: string, extra: Partial<Product> = {}): Product {
  return {
    name: `${name} (sample)`, code: '', active: true, notes: SRC, baseUnit, supplyType, specifications: '',
    size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [],
    usualSupply: null, ...extra,
  };
}
const rm = (name: string, baseUnit = 'kg'): RawMaterial => ({ name: `${name} (sample)`, active: true, notes: SRC, baseUnit, gsm: na, customUnits: [] });

export function buildSampleData(today: string): SampleWrite[] {
  const d = (n: number) => addDays(today, n)!;
  const at = (n: number, h = 10) => `${d(n)}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const writes: SampleWrite[] = [];
  const create = (collection: string, docId: string, entity: string, data: object) =>
    writes.push({ collection, docId, entity, before: null, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> });

  // Masters
  const processes: Record<string, Process> = {
    sample_pr_spin: { name: 'Spinning (sample)', active: true, notes: SRC },
    sample_pr_weave: { name: 'Weaving (sample)', active: true, notes: SRC },
    sample_pr_bleach: { name: 'Bleaching (sample)', active: true, notes: SRC },
    sample_pr_dye: { name: 'Dyeing (sample)', active: true, notes: SRC },
    sample_pr_latex: { name: 'Latex backing (sample)', active: true, notes: SRC },
    sample_pr_label: { name: 'Labelling (sample)', active: true, notes: SRC },
    sample_pr_pack: { name: 'Packing (sample)', active: true, notes: SRC },
  };
  for (const [id, p] of Object.entries(processes)) create('processes', id, `Process: ${p.name}`, p);
  const st = (processId: string, days: number | null): RouteStep => ({
    processId,
    plannedDays: days === null ? { value: null, status: 'PENDING_VERIFICATION', source: '' } : { value: days, status: 'USER_PROVIDED', source: SRC },
  });
  const rawMaterials: Record<string, RawMaterial> = {
    sample_rm_fibre: rm('Coir fibre'),
    sample_rm_latex: rm('Latex compound'),
    sample_rm_dye: rm('Natural dye'),
  };
  const products: Record<string, Product> = {
    sample_p_yarn: product('Coir yarn', 'MANUFACTURED', 'kg', { route: [st('sample_pr_spin', 3)] }),
    sample_p_mat: product('Coir mat 40×60', 'MANUFACTURED', 'pcs', {
      size: { length: 40, width: 60, unit: 'cm', status: 'USER_PROVIDED' },
      gsm: up(1500),
      route: [st('sample_pr_weave', 4), st('sample_pr_bleach', 2), st('sample_pr_dye', 2), st('sample_pr_latex', null), st('sample_pr_pack', 1)],
    }),
    sample_p_door: product('Printed door mat 45×75', 'TRADED', 'pcs', { size: { length: 45, width: 75, unit: 'cm', status: 'USER_PROVIDED' }, route: [st('sample_pr_label', 1), st('sample_pr_pack', 1)] }),
    sample_p_rubber: product('Rubber-backed mat 50×80', 'BOTH', 'pcs', { usualSupply: 'MAKE', size: { length: 50, width: 80, unit: 'cm', status: 'USER_PROVIDED' }, route: [st('sample_pr_weave', 3), st('sample_pr_pack', 1)] }),
  };
  const boms: Record<string, Bom> = {
    sample_p_yarn: { productId: 'sample_p_yarn', notes: SRC, lines: [line('RAW_MATERIAL', 'sample_rm_fibre', 1.1, 'kg')] },
    sample_p_mat: {
      productId: 'sample_p_mat', notes: SRC,
      lines: [line('PRODUCT', 'sample_p_yarn', 0.9, 'kg', 3), line('RAW_MATERIAL', 'sample_rm_latex', 150, 'g', 0, 'ESTIMATED'), line('RAW_MATERIAL', 'sample_rm_dye', 20, 'g')],
    },
    // No BOM for the rubber-backed mat: shows the "BOM missing" warnings.
  };
  for (const [id, r] of Object.entries(rawMaterials)) create('rawMaterials', id, `Raw material: ${r.name}`, r);
  for (const [id, p] of Object.entries(products)) create('products', id, `Product: ${p.name}`, p);
  for (const [id, b] of Object.entries(boms)) create('boms', id, `BOM: ${products[id]!.name}`, b);

  const customers: Record<string, Customer> = {
    sample_c_hansa: { name: 'Hansa Floor GmbH (sample)', active: true, notes: SRC, country: 'Germany', customerType: 'AGENT', contactPerson: '', phone: '', email: '' },
    sample_c_nordic: { name: 'Nordic Mats AB (sample)', active: true, notes: SRC, country: 'Sweden', customerType: 'DIRECT', contactPerson: '', phone: '', email: '' },
  };
  for (const [id, c] of Object.entries(customers)) create('customers', id, `Customer: ${c.name}`, c);

  const suppliers: Record<string, Supplier> = {
    sample_s_fibre: { name: 'Alappuzha Fibre Traders (sample)', active: true, notes: SRC, place: 'Alappuzha', contactPerson: '', phone: '', email: '', gstin: '', items: ['RAW_MATERIAL:sample_rm_fibre'] },
    sample_s_chem: { name: 'Kochi Chem Supplies (sample)', active: true, notes: SRC, place: 'Kochi', contactPerson: '', phone: '', email: '', gstin: '', items: ['RAW_MATERIAL:sample_rm_latex', 'RAW_MATERIAL:sample_rm_dye'] },
    sample_s_print: { name: 'Mat Printers (sample)', active: true, notes: SRC, place: 'Coimbatore', contactPerson: '', phone: '', email: '', gstin: '', items: ['PRODUCT:sample_p_door'] },
  };
  for (const [id, s] of Object.entries(suppliers)) create('suppliers', id, `Supplier: ${s.name}`, s);

  const count: StockCount = { itemType: 'RAW_MATERIAL', itemId: 'sample_rm_fibre', qty: 800, unit: 'kg', countedOn: d(-3), notes: SRC };
  create('stockCounts', 'RAW_MATERIAL_sample_rm_fibre', 'Stock count: Coir fibre (sample)', count);

  // Job Orders: created as Draft, then moved through their statuses like real ones.
  const md: MasterData = { products: new Map(Object.entries(products)), rawMaterials: new Map(Object.entries(rawMaterials)), boms: new Map(Object.entries(boms)) };
  const processMap = new Map(Object.entries(processes));
  const stock = (baseQty: number, unit: string, daysAgo: number): StockEntry => ({ qty: baseQty, unit, baseQty, location: 'Godown (sample)', remarks: '', changedAt: at(-daysAgo), prevBaseQty: null });
  const jl = (id: string, productId: string, qty: number, supply: JoLine['supply']): JoLine => ({ id, productId, productName: products[productId]!.name, qty, unit: 'pcs', supply });

  const orders: {
    id: string; no: string; cust: string; rec: number; del: number; type: JobOrder['deliveryDateType'];
    lines: JoLine[]; final: JoStatus; confirmed?: number; completed?: number; done?: [number, number][] /* [line index, day] step completions */; stock?: Record<string, StockEntry>;
  }[] = [
    { id: 'sample_jo_099', no: 'DEMO-099', cust: 'sample_c_nordic', rec: -70, del: -20, type: 'PORT', lines: [jl('a', 'sample_p_mat', 800, 'MAKE')], final: 'COMPLETED', confirmed: -68, completed: -25, done: [[0, -60], [0, -50], [0, -45], [0, -40], [0, -33], [0, -26]] },
    { id: 'sample_jo_101', no: 'DEMO-101', cust: 'sample_c_hansa', rec: -40, del: 3, type: 'PORT', lines: [jl('a', 'sample_p_mat', 1500, 'MAKE')], final: 'CONFIRMED', confirmed: -38, done: [[0, -34], [0, -27], [0, -22], [0, -17], [0, -5]], stock: { 'PRODUCT:sample_p_mat': stock(300, 'pcs', 30) } },
    {
      id: 'sample_jo_102', no: 'DEMO-102', cust: 'sample_c_nordic', rec: -25, del: 12, type: 'FACTORY_DISPATCH',
      lines: [jl('a', 'sample_p_mat', 1200, 'MAKE'), jl('b', 'sample_p_door', 300, 'BUY')], final: 'CONFIRMED', confirmed: -24, done: [[0, -21], [1, -20], [0, -17], [1, -12], [0, -15], [0, -13], [1, -1], [0, -1]],
      stock: { 'PRODUCT:sample_p_yarn': stock(300, 'kg', 20), 'RAW_MATERIAL:sample_rm_fibre': stock(400, 'kg', 20) },
    },
    { id: 'sample_jo_103', no: 'DEMO-103', cust: 'sample_c_hansa', rec: -10, del: 35, type: 'PORT', lines: [jl('a', 'sample_p_mat', 2000, 'MAKE')], final: 'CONFIRMED', confirmed: -9, done: [[0, -6]], stock: { 'RAW_MATERIAL:sample_rm_fibre': stock(500, 'kg', 8) } },
    { id: 'sample_jo_104', no: 'DEMO-104', cust: 'sample_c_nordic', rec: -2, del: 60, type: 'UNCONFIRMED', lines: [jl('a', 'sample_p_rubber', 500, 'MAKE')], final: 'DRAFT' },
  ];

  for (const o of orders) {
    const deadline = computeDeadline(d(o.rec), d(o.del));
    if (!deadline.ok) throw new Error(deadline.error);
    const dl = { orderPeriodDays: deadline.orderPeriodDays, bufferDays: deadline.bufferDays, internalDeadline: deadline.internalDeadline, ruleVersion: deadline.ruleVersion };
    let rev = 1;
    const base: JobOrder = {
      joNumber: o.no, customerId: o.cust, customerName: customers[o.cust]!.name, poNumber: '', receivedDate: d(o.rec), deliveryDate: d(o.del),
      deliveryDateType: o.type, deadline: dl, status: 'DRAFT', lines: o.lines, notes: SRC, bomSnapshot: null, confirmedOn: null,
      stock: {}, progress: null, progressLog: [], completedOn: null,
    };
    create('jobOrders', o.id, `Job Order: ${o.no}`, base);
    let current: JobOrder = base;
    const step = (next: JobOrder) => {
      writes.push({ collection: 'jobOrders', docId: o.id, entity: `Job Order: ${o.no}`, before: { ...(current as unknown as Record<string, unknown>), rev }, data: JSON.parse(JSON.stringify(next)) as Record<string, unknown> });
      rev += 1;
      current = next;
    };
    if (o.final === 'DRAFT') continue;
    const confirmedLines = o.lines.map((l) => ({ ...l, steps: buildLineSteps(l, md, processMap) }));
    step({ ...current, status: 'CONFIRMED', confirmedOn: d(o.confirmed!), bomSnapshot: snapshotBoms(o.lines, md, () => 1), stock: o.stock ?? {}, lines: confirmedLines });
    if (o.done) {
      const lines = confirmedLines.map((l) => ({ ...l, steps: [...l.steps] }));
      for (const [li, day] of o.done) lines[li]!.steps = completeCurrent(lines[li]!.steps, at(day)) ?? lines[li]!.steps;
      step({ ...current, lines });
    }
    if (o.final === 'COMPLETED') step({ ...current, status: 'COMPLETED', completedOn: d(o.completed!) });
  }
  return writes;
}
