/**
 * DEMO-only sample data so every screen can be tried at once. Every name ends
 * in "(sample)" and every figure is marked as DEMO data — none of it describes
 * a real company, recipe or benchmark. Never written to ACTUAL.
 */
import type { Tracked } from './dataStatus';
import { addDays, computeDeadline, snapshotBoms, type JobOrder, type JoLine, type JoStatus, type StockEntry } from './jobOrders';
import type { Bom, BomLine, Customer, Department, MasterData, Process, Product, RawMaterial, RouteStep, Supplier } from './masters';
import { emptyTask, monthDay, nextDue, type Task } from './tasks';
import { buildLineSteps, completeCurrent, startCurrent } from './route';
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
  // Sample benchmarks only (output per working day / fixed days); real ones come from the company.
  const st = (processId: string, perDay: number | null, perDayUnit: string, fixedDays: number | null = null): RouteStep => ({
    processId,
    perDay,
    perDayUnit,
    fixedDays,
    status: perDay === null && fixedDays === null ? 'PENDING_VERIFICATION' : 'USER_PROVIDED',
    source: perDay === null && fixedDays === null ? '' : SRC,
  });
  // Sample departments: example.com emails only (reserved domain); no phone numbers, so no real person is ever called.
  const person = (name: string, designation: string, email: string, primary: boolean) => ({ name, designation, phone: '', whatsapp: '', email, primary });
  const departments: Record<string, Department> = {
    sample_d_spin: { name: 'Spinning (sample)', active: true, notes: SRC, people: [person('Spinning lead (sample)', 'Supervisor', 'spinning.lead@example.com', true)], processIds: ['sample_pr_spin'] },
    sample_d_weave: {
      name: 'Weaving (sample)', active: true, notes: SRC,
      people: [person('Weaving lead (sample)', 'Supervisor', 'weaving.lead@example.com', true), person('Weaving shift B (sample)', 'Shift in-charge', 'weaving.b@example.com', false)],
      processIds: ['sample_pr_weave'],
    },
    sample_d_finish: { name: 'Finishing (sample)', active: true, notes: SRC, people: [person('Finishing lead (sample)', 'Supervisor', 'finishing.lead@example.com', true)], processIds: ['sample_pr_bleach', 'sample_pr_dye', 'sample_pr_latex'] },
    sample_d_pack: { name: 'Packing (sample)', active: true, notes: SRC, people: [person('Packing lead (sample)', 'Supervisor', 'packing.lead@example.com', true)], processIds: ['sample_pr_label', 'sample_pr_pack'] },
    sample_d_design: { name: 'Design (sample)', active: true, notes: SRC, people: [person('Design lead (sample)', 'Designer', 'design.lead@example.com', true)], processIds: [] },
    sample_d_finance: { name: 'Finance (sample)', active: true, notes: SRC, people: [person('Accounts (sample)', 'Accountant', 'accounts@example.com', true)], processIds: [] },
  };
  for (const [id, d] of Object.entries(departments)) create('departments', id, `Department: ${d.name}`, d);
  const rawMaterials: Record<string, RawMaterial> = {
    sample_rm_fibre: rm('Coir fibre'),
    sample_rm_latex: rm('Latex compound'),
    sample_rm_dye: rm('Natural dye'),
  };
  const products: Record<string, Product> = {
    sample_p_yarn: product('Coir yarn', 'MANUFACTURED', 'kg', { route: [st('sample_pr_spin', 250, 'kg')] }),
    sample_p_mat: product('Coir mat 40×60', 'MANUFACTURED', 'pcs', {
      size: { length: 40, width: 60, unit: 'cm', status: 'USER_PROVIDED' },
      gsm: up(1500),
      route: [st('sample_pr_weave', 200, 'pcs'), st('sample_pr_bleach', 600, 'pcs', 1), st('sample_pr_dye', 500, 'pcs'), st('sample_pr_latex', null, 'pcs', 2), { ...st('sample_pr_pack', 800, 'pcs'), alsoForStock: true }],
    }),
    sample_p_door: product('Printed door mat 45×75', 'TRADED', 'pcs', { size: { length: 45, width: 75, unit: 'cm', status: 'USER_PROVIDED' }, route: [st('sample_pr_label', null, 'pcs'), { ...st('sample_pr_pack', 800, 'pcs'), alsoForStock: true }] }),
    sample_p_rubber: product('Rubber-backed mat 50×80', 'BOTH', 'pcs', { usualSupply: 'MAKE', size: { length: 50, width: 80, unit: 'cm', status: 'USER_PROVIDED' }, route: [st('sample_pr_weave', 150, 'pcs'), { ...st('sample_pr_pack', 800, 'pcs'), alsoForStock: true }] }),
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
    lines: JoLine[]; final: JoStatus; confirmed?: number; completed?: number; done?: [number, number, number?][] /* [line index, day done, day started (optional)] */; started?: [number, number][] /* current step started: [line index, day] */; stock?: Record<string, StockEntry>;
  }[] = [
    { id: 'sample_jo_099', no: 'DEMO-099', cust: 'sample_c_nordic', rec: -70, del: -20, type: 'PORT', lines: [jl('a', 'sample_p_mat', 800, 'MAKE')], final: 'COMPLETED', confirmed: -68, completed: -25, done: [[0, -60], [0, -50], [0, -45], [0, -40], [0, -33], [0, -26]] },
    { id: 'sample_jo_101', no: 'DEMO-101', cust: 'sample_c_hansa', rec: -40, del: 3, type: 'PORT', lines: [jl('a', 'sample_p_mat', 1500, 'MAKE')], final: 'CONFIRMED', confirmed: -38, done: [[0, -34], [0, -27], [0, -22], [0, -17], [0, -5]], stock: { 'PRODUCT:sample_p_mat': stock(300, 'pcs', 30) } },
    {
      id: 'sample_jo_102', no: 'DEMO-102', cust: 'sample_c_nordic', rec: -25, del: 12, type: 'FACTORY_DISPATCH',
      lines: [jl('a', 'sample_p_mat', 1200, 'MAKE'), jl('b', 'sample_p_door', 300, 'BUY')], final: 'CONFIRMED', confirmed: -24, done: [[0, -21], [1, -20], [0, -17, -18], [1, -12], [0, -15, -16], [0, -13], [1, -1], [0, -1]],
      stock: { 'PRODUCT:sample_p_yarn': stock(300, 'kg', 20), 'RAW_MATERIAL:sample_rm_fibre': stock(400, 'kg', 20) },
    },
    { id: 'sample_jo_103', no: 'DEMO-103', cust: 'sample_c_hansa', rec: -10, del: 35, type: 'PORT', lines: [jl('a', 'sample_p_mat', 2000, 'MAKE')], final: 'CONFIRMED', confirmed: -6 /* planning took longer than the benchmark */, started: [[0, -3]] /* spinning waited, then started */, stock: { 'RAW_MATERIAL:sample_rm_fibre': stock(500, 'kg', 8) } },
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
      for (const [li, day, startDay] of o.done) {
        if (startDay !== undefined) lines[li]!.steps = startCurrent(lines[li]!.steps, at(startDay)) ?? lines[li]!.steps;
        lines[li]!.steps = completeCurrent(lines[li]!.steps, at(day)) ?? lines[li]!.steps;
      }
      step({ ...current, lines });
    }
    if (o.started) {
      const lines = current.lines.map((l) => ({ ...l, steps: [...(l.steps ?? [])] }));
      for (const [li, day] of o.started) lines[li]!.steps = startCurrent(lines[li]!.steps, at(day)) ?? lines[li]!.steps;
      step({ ...current, lines });
    }
    if (o.final === 'COMPLETED') step({ ...current, status: 'COMPLETED', completedOn: d(o.completed!) });
  }
  // Work: follow-ups in other departments (Design, Finance) and a repeating one.
  const task = (t: Partial<Task>): Task => ({ ...emptyTask(), notes: SRC, ...t });
  create('tasks', 'sample_t_artwork', 'Task: Artwork approval (sample)', task({ title: 'Artwork approval for printed door mat (sample)', departmentId: 'sample_d_design', person: 'Design lead (sample)', dueDate: d(2), status: 'WAITING', waitingOn: "buyer's reply", joId: 'sample_jo_102', joNumber: 'DEMO-102' }));
  create('tasks', 'sample_t_payment', 'Task: Payment follow-up (sample)', task({ title: 'Advance payment status from Hansa (sample)', departmentId: 'sample_d_finance', person: 'Accounts (sample)', dueDate: d(-1), priority: 'HIGH' }));
  create('tasks', 'sample_t_gst', 'Task: Monthly GST status (sample)', task({ title: 'Ask accounts for GST filing status (sample)', departmentId: 'sample_d_finance', dueDate: monthDay(d(0).slice(0, 7), 10) >= d(0) ? monthDay(d(0).slice(0, 7), 10) : nextDue({ kind: 'MONTHLY', day: 10 }, d(0)), repeat: { kind: 'MONTHLY', day: 10 } }));
  create('tasks', 'sample_t_review', 'Task: Weekly review (sample)', task({ title: 'Weekly production review notes (sample)', dueDate: d(4) }));
  return writes;
}
