import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { performanceDoc, todayDoc } from '../../src/lib/docs/model';
import type { JobOrder, JoStep } from '../../src/lib/jobOrders';
import type { Bom, MasterData, Product, RawMaterial } from '../../src/lib/masters';
import { buildPerformance, changesAfterConfirm } from '../../src/lib/performance';
import { buildSampleData } from '../../src/lib/sampleData';
import { buildToday, todayText } from '../../src/lib/today';

const TODAY = '2026-10-20';
const writes = buildSampleData(TODAY);
const md: MasterData = {
  products: new Map(writes.filter((w) => w.collection === 'products').map((w) => [w.docId, w.data as unknown as Product])),
  rawMaterials: new Map(writes.filter((w) => w.collection === 'rawMaterials').map((w) => [w.docId, w.data as unknown as RawMaterial])),
  boms: new Map(writes.filter((w) => w.collection === 'boms').map((w) => [w.docId, w.data as unknown as Bom])),
};
const finalJo = new Map<string, JobOrder & { id: string }>();
for (const w of writes) if (w.collection === 'jobOrders') finalJo.set(w.docId, { id: w.docId, ...(w.data as unknown as JobOrder) });
const jos = [...finalJo.values()];
const ctx = { md, cal: DEFAULT_CALENDAR };

describe('JO performance report', () => {
  it('reports completed orders against the internal deadline and delivery, in working days', () => {
    const r = buildPerformance({ jobOrders: jos, ctx, from: '2026-07-22', to: TODAY, today: TODAY, history: [] });
    expect(r.summary.completed).toBe(1);
    const c = r.completed[0]!;
    expect(c.joNumber).toBe('DEMO-099');
    expect(c.vsInternal).toBe(1); // one working day into the buffer…
    expect(c.bufferUsed).toBe(1);
    expect(c.vsDelivery).toBeLessThan(0); // …but before the customer delivery date
    expect(r.summary).toMatchObject({ onTimeInternal: 0, onTimeDelivery: 1, avgLateDays: 1 });
    expect(c.steps.length).toBe(7); // planning + 6 process steps
    expect(c.planningDays).toBe(2);
    expect(c.steps[0]!.label).toBe('Planning');
    expect(c.actualDays).toBeGreaterThan(0);
    expect(r.open.map((o) => o.joNumber)).toEqual(expect.arrayContaining(['DEMO-101', 'DEMO-102', 'DEMO-103']));
    expect(r.open[0]!.joNumber).toBe('DEMO-101'); // late first
  });
  it('a period with no completions is empty but still lists open orders', () => {
    const r = buildPerformance({ jobOrders: jos, ctx, from: '2026-10-01', to: TODAY, today: TODAY, history: [] });
    expect(r.summary.completed).toBe(0);
    expect(r.summary.avgLateDays).toBeNull();
    expect(r.open.length).toBe(4);
  });
  it('counts plan changes after confirmation, not step progress or the confirmation itself', () => {
    const line = { id: 'a', productId: 'p', productName: 'Mat', qty: 10, unit: 'pcs', supply: 'MAKE' };
    const step = { key: 'k', processId: 'x', label: 'Weave', forProduct: 'Mat', productId: 'p', perDay: 1, perDayUnit: 'pcs', fixedDays: null, doneAt: null } as JoStep;
    const ev = (at: string, changes: { field: string; before: unknown; after: unknown }[]) => ({ entityPath: 'workspaces/w/jobOrders/j', at, action: 'UPDATE', changes });
    const r = changesAfterConfirm(
      [
        ev('2026-10-01T05:00:00Z', [{ field: 'status', before: 'DRAFT', after: 'CONFIRMED' }, { field: 'lines', before: [line], after: [{ ...line, steps: [step] }] }]),
        ev('2026-10-02T05:00:00Z', [{ field: 'lines', before: [{ ...line, steps: [step] }], after: [{ ...line, steps: [{ ...step, doneAt: 'x' }] }] }]), // progress only
        ev('2026-10-03T05:00:00Z', [{ field: 'lines', before: [line], after: [{ ...line, qty: 12 }] }, { field: 'deliveryDate', before: 'a', after: 'b' }]),
        ev('2026-09-20T05:00:00Z', [{ field: 'deliveryDate', before: 'a', after: 'b' }]), // before confirmation
      ],
      '2026-10-01',
    );
    expect(r).toEqual({ count: 1, fields: { 'Products / quantities': 1, 'Delivery date': 1 } });
  });
  it('suggests a benchmark only with 5+ steps that differ by 15% or more', () => {
    // Five orders, weaving planned 200/day, each took longer: 400 mats in 3 working days ≈ 133/day.
    const many = Array.from({ length: 5 }, (_, i) => {
      const base = finalJo.get('sample_jo_099')!;
      return { ...base, id: `x${i}`, joNumber: `X-${i}`, lines: [{ ...base.lines[0]!, qty: 400 }] };
    });
    const r = buildPerformance({ jobOrders: many, ctx, from: '2026-07-01', to: TODAY, today: TODAY, history: [] });
    const weave = r.processes.find((p) => p.label === 'Weaving (sample)')!;
    expect(weave.steps).toBe(5);
    expect(weave.suggestion).toMatch(/^Planned 200\/day, actual median \d+\/day over 5 steps — consider \d+\/day$/);
    const few = buildPerformance({ jobOrders: many.slice(0, 4), ctx, from: '2026-07-01', to: TODAY, today: TODAY, history: [] });
    expect(few.processes.find((p) => p.label === 'Weaving (sample)')!.suggestion).toBeNull();
  });
  it('makes a PDF model with a chart and tables', () => {
    const r = buildPerformance({ jobOrders: jos, ctx, from: '2026-07-22', to: TODAY, today: TODAY, history: [] });
    const m = performanceDoc(r, { company: 'Co', generatedAt: 'now' });
    expect(m.charts![0]!.rows[0]!.label).toBe('DEMO-099');
    expect(m.tables.map((t) => t.title)).toEqual(['Completed orders', 'Steps that took longer than planned', 'Processes (steps finished in this period)', 'Open orders']);
  });
});

describe('daily summary', () => {
  it('lists what is overdue, due today and in the next 2 working days', () => {
    const s = buildToday({ jobOrders: jos, ctx, today: TODAY });
    expect(s.soonUntil).toBe('2026-10-22');
    expect(s.items.find((i) => i.text.startsWith('DEMO-101: internal deadline passed'))?.when).toBe('OVERDUE');
    expect(s.items.find((i) => i.text.startsWith('DEMO-101: customer delivery'))).toBeUndefined(); // delivery is 3 days away (beyond 2 working days)
    expect(s.items.some((i) => i.when === 'OVERDUE' && i.text.includes('over plan'))).toBe(true);
    expect(s.items.every((i, n) => n === 0 || ['OVERDUE', 'TODAY', 'SOON'].indexOf(s.items[n - 1]!.when) <= ['OVERDUE', 'TODAY', 'SOON'].indexOf(i.when))).toBe(true);
  });
  it('mentions an upcoming company holiday and makes shareable text and a PDF', () => {
    const cal = { weeklyOff: [0], holidays: { '2026-10-21': 'Puja' } };
    const s = buildToday({ jobOrders: [], ctx: { md, cal }, today: TODAY });
    expect(s.items).toEqual([{ when: 'SOON', date: '2026-10-21', text: '21 Oct 2026: Puja (no work)', link: '/' }]);
    expect(todayText(s, 'Co')).toContain('Next 2 working days:\n• 21 Oct 2026: Puja (no work)');
    expect(todayText(buildToday({ jobOrders: [], ctx, today: TODAY }), '')).toContain('Nothing due today');
    expect(todayDoc(s, { company: 'Co', generatedAt: 'now' }).tables[2]!.rows).toEqual([['21 Oct 2026: Puja (no work)']]);
  });
});

describe('plan document', () => {
  const processes = new Map(writes.filter((w) => w.collection === 'processes').map((w) => [w.docId, w.data as unknown as import('../../src/lib/masters').Process]));
  const input = (jo: JobOrder & { id: string }) => ({
    jo: { ...jo, rev: 4 }, md, processes, ctx, today: TODAY, company: 'Co', generatedAt: '21 Oct 2026, 09:00 IST',
    preparedBy: { name: 'Kareem', designation: 'Production Manager' },
    variant: 'working' as const,
  });
  it('a draft gives a PROPOSED plan built from the product routes, with open points', async () => {
    const { productionPlanDoc } = await import('../../src/lib/docs/model');
    const m = productionPlanDoc(input(finalJo.get('sample_jo_104')!));
    expect(m.title).toBe('Working Plan (proposed)');
    expect(m.banner).toMatch(/^WORKING PLAN/);
    expect(m.meta.find(([k]) => k === 'Plan version')![1]).toBe('Revision 4 · generated 21 Oct 2026, 09:00 IST');
    expect(m.meta.find(([k]) => k === 'Planning')![1]).toMatch(/^In planning for 2 working days \(benchmark 1\)/);
    expect(m.tables[0]!.rows.map((r) => r[0])).toEqual(['Planning (whole order)', 'Weaving (sample)', 'Packing (sample)']);
    expect(m.tables.at(-1)!.rows.flat().join(' ')).toMatch(/BOM missing/);
    expect(m.tables.at(-1)!.rows[0]![0]).toBe('Planning is 1 working day over its benchmark - confirm the plan to start production');
    expect(m.provisional).toBe(true);
    expect(m.signature).toEqual({ preparedBy: 'Kareem', designation: 'Production Manager', date: '20 Oct 2026' });
    expect(m.timeline!.rows[0]).toMatchObject({ group: 'Rubber-backed mat 50×80 (sample)', label: 'Planning (order)', kind: 'now' });
  });
  it('a confirmed order gives the PRODUCTION plan with actual and planned dates', async () => {
    const { productionPlanDoc } = await import('../../src/lib/docs/model');
    const m = productionPlanDoc(input(finalJo.get('sample_jo_103')!));
    expect(m.title).toBe('Working Plan');
    const mat = m.tables[0]!;
    expect(mat.rows[0]![0]).toBe('Planning (whole order)');
    expect(mat.rows[0]![5]).toBe('Done');
    expect(m.meta.find(([k]) => k === 'Planning')![1]).toBe('Confirmed 14 Oct 2026 · 3 working days (benchmark 1)');
    expect(mat.rows.some((r) => r[5] === 'Planned' && r[3] !== '—' && r[4] !== '—')).toBe(true);
    expect(m.meta.find(([k]) => k === 'Expected finish')![1]).not.toBe('');
    expect(m.tables.map((t) => t.title)).toEqual(expect.arrayContaining(['Products to make', 'Raw materials to buy for production', 'Material calculation (BOM)', 'Open points and risks']));
  });
  it('drafts past the planning benchmark show in the daily summary', () => {
    const s = buildToday({ jobOrders: jos, ctx, today: TODAY });
    expect(s.items.find((i) => i.text.startsWith('DEMO-104'))).toMatchObject({ when: 'OVERDUE', text: expect.stringMatching(/still in planning after 2 working days \(benchmark 1\)/) });
    expect(buildToday({ jobOrders: jos, ctx: { ...ctx, planningDays: null }, today: TODAY }).items.some((i) => i.text.startsWith('DEMO-104'))).toBe(false);
  });
});

describe('clean plan to submit', () => {
  const processes = new Map(writes.filter((w) => w.collection === 'processes').map((w) => [w.docId, w.data as unknown as import('../../src/lib/masters').Process]));
  const build = async (id: string) => {
    const { productionPlanDoc } = await import('../../src/lib/docs/model');
    return productionPlanDoc({ jo: { ...finalJo.get(id)!, rev: 4 }, md, processes, ctx, today: TODAY, company: 'Co', generatedAt: 'x', preparedBy: { name: 'Kareem', designation: 'PM' } });
  };
  it('has no benchmarks, calculations or provisional band — open points in plain language', async () => {
    const m = await build('sample_jo_104');
    expect(m.title).toBe('Proposed Plan');
    expect(m.banner).toBe('PROPOSED PLAN - for review and approval');
    expect(m.provisional).toBe(false);
    const all = JSON.stringify([m.banner, m.meta, m.tables, m.notes, m.timeline, m.roadMap, m.stepRoads]); // the printed text
    expect(all).not.toMatch(/benchmark|÷|\/day|user-provided|PROVISIONAL|time pending/i);
    expect(m.meta.find(([k]) => k === 'Planning')![1]).toBe('Started 18 Oct 2026 - this plan');
    // Overview (confirmed 26 Oct 2026): road map, product table, steps as landmarks; no Gantt chart.
    expect(m.timeline).toBeUndefined();
    expect(m.roadMap!.stops.map((x) => x.label)).toEqual(['Order received', 'Plan approval', 'Production', 'Internal deadline', 'Customer delivery']);
    expect(m.roadMap!.stops[1]).toMatchObject({ here: true, date: 'today, 20 Oct' });
    expect(m.tables[0]!.columns.map((c) => c.label)).toEqual(['#', 'Product', 'Quantity', 'Start', 'Ready', 'Before deadline']);
    expect(m.tables[0]!.rows[0]!.slice(0, 3)).toEqual(['1', 'Rubber-backed mat 50×80 (sample)', '500 pcs']);
    expect(m.stepRoads!.afterTables).toBe(1);
    expect(m.stepRoads!.items[0]!.nodes.map((n) => [n.label, n.state])).toEqual([
      ['Weaving (sample)', 'planned'],
      ['Packing (sample)', 'planned'],
    ]);
    expect(m.stepRoads!.items[0]!.ready.text).toMatch(/^Ready \d{2} [A-Z][a-z]+$/);
    expect(m.tables.at(-1)!.title).toBe('Open points');
    expect(m.tables.at(-1)!.rows.map((r) => r[0])).toEqual([
      'Plan confirmation pending - production can start once this plan is approved',
      'Rubber-backed mat 50×80 (sample): sequence of process steps to be confirmed with production',
      'Rubber-backed mat 50×80 (sample): material list (BOM) to be confirmed',
      'Delivery date basis (ex-factory / port / arrival) to be confirmed with the customer',
    ]);
    expect(m.notes).toEqual(['Dates are in working days; Sundays and company holidays are not worked.', 'Prepared from the information available on 20 Oct 2026.']);
    expect(m.fileName).toBe('DEMO-104_proposed-plan_2026-10-20.pdf');
  });
  it('a confirmed order shows planning dates and progress without the benchmark', async () => {
    const m = await build('sample_jo_103');
    expect(m.title).toBe('Production Plan');
    expect(m.meta.find(([k]) => k === 'Planning')![1]).toBe('10 Oct 2026 to 14 Oct 2026');
    expect(m.meta.find(([k]) => k === 'Internal deadline')![1]).toBe('19 Nov 2026');
    expect(m.meta.find(([k]) => k === 'Progress')![1]).toMatch(/^\d+% complete \(planned \d+% by today\)$/);
    expect(m.roadMap!.stops[1]).toEqual({ label: 'Plan confirmed', date: '14 Oct', note: '', kind: 'done' });
    expect(m.roadMap!.stops[2]).toMatchObject({ kind: 'now', here: true, note: expect.stringMatching(/% complete$/) });
    expect(m.stepRoads!.items[0]!.nodes[0]).toMatchObject({ state: 'now', sub: 'for Coir yarn (sample)' });
  });
});

describe('plan overview: road map and steps as landmarks (confirmed 26 Oct 2026)', () => {
  const processes = new Map(writes.filter((w) => w.collection === 'processes').map((w) => [w.docId, w.data as unknown as import('../../src/lib/masters').Process]));
  it('marks tight, late and unknown products and says what is still to be confirmed', async () => {
    const { productionPlanDoc, TIGHT_DAYS } = await import('../../src/lib/docs/model');
    const m = productionPlanDoc({ jo: { ...finalJo.get('sample_jo_105')!, rev: 1 }, md, processes, ctx, today: TODAY, company: 'Co', generatedAt: 'x', preparedBy: { name: '', designation: '' } });
    const door = m.stepRoads!.items.find((i) => i.name.startsWith('Printed door mat'))!;
    expect(door).toMatchObject({ dashed: true, badge: { tone: 'unknown', text: 'supplier dates to be confirmed' }, ready: { text: 'Ready ?' } });
    expect(m.roadMap!.summary).toMatch(/Still to be confirmed: Printed door mat 45×75 \(sample\)\.$/);
    expect(m.stepRoads!.counts.map((c) => c.text)).toContain('1 waiting for dates');
    const rows = m.tables[0]!.rows;
    m.tables[0]!.rowTones!.forEach((tone, i) => {
      const cell = rows[i]![5]!;
      if (tone === 'unknown') expect(cell).toBe('to be confirmed');
      if (tone === 'tight') expect(Number(cell.split(' ')[0])).toBeLessThanOrEqual(TIGHT_DAYS);
      if (tone === 'late') expect(cell).toMatch(/late$/);
      if (tone === null) expect(cell).toMatch(/^\d+ days?$|^done$/);
    });
  });
});

describe('materials: made from, needed for, calculation (confirmed 27 Oct 2026)', () => {
  const processes = new Map(writes.filter((w) => w.collection === 'processes').map((w) => [w.docId, w.data as unknown as import('../../src/lib/masters').Process]));
  it('links raw materials to the ordered products and splits ready-made purchases', async () => {
    const { planMaterials } = await import('../../src/lib/materials');
    const { productionPlanDoc } = await import('../../src/lib/docs/model');
    const jo = finalJo.get('sample_jo_105')!;
    const plan = planMaterials(jo, md);
    const fibre = plan.toBuy.find((r) => r.name.startsWith('Coir fibre'))!;
    expect(fibre.via).toEqual(['Coir yarn (sample)']);
    expect(fibre.usedFor).toEqual(expect.arrayContaining(['Coir mat 40×60 (sample)', 'Coir rug 120×180 (sample)']));
    const yarn = plan.toProduce.find((r) => r.name.startsWith('Coir yarn'))!;
    expect(yarn.madeFrom).toEqual(['Coir fibre (sample)']);
    // every component quantity is the sum of its calculation lines
    for (const r of [...plan.toBuy, ...plan.toProduce]) {
      const ls = plan.links.filter((l) => l.childKey === r.key);
      if (ls.length && !r.ordered) expect(ls.reduce((a, l) => a + l.qty, 0)).toBeCloseTo(r.gross, 6);
    }
    const m = productionPlanDoc({ jo: { ...jo, rev: 1 }, md, processes, ctx, today: TODAY, company: 'Co', generatedAt: 'x', preparedBy: { name: '', designation: '' }, supplierNames: () => [] });
    const titles = m.tables.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Products to make', 'Raw materials to buy for production', 'Ready-made products to buy']));
    expect(titles).not.toContain('Material calculation (BOM)'); // no BOM figures in the plan to submit
    const ready = m.tables.find((t) => t.title === 'Ready-made products to buy')!;
    expect(ready.rows.map((r) => r[0])).toEqual(['Printed door mat 45×75 (sample)']);
    const raw = m.tables.find((t) => t.title === 'Raw materials to buy for production')!;
    expect(raw.rows.find((r) => r[0]!.startsWith('Coir fibre'))![4]).toMatch(/\(via Coir yarn \(sample\)\)$/);
  });
});

describe('estimated step times (confirmed 21 Oct 2026)', () => {
  const processes = new Map(writes.filter((w) => w.collection === 'processes').map((w) => [w.docId, w.data as unknown as import('../../src/lib/masters').Process]));
  // DEMO-104 (draft) builds its steps from the product route: mark Weaving's time as an estimate.
  const estMd: MasterData = {
    ...md,
    products: new Map(
      [...md.products].map(([id, p]) => [id, { ...p, route: (p.route ?? []).map((s) => (s.processId === 'sample_pr_weave' ? { ...s, status: 'ESTIMATED' as const } : s)) }]),
    ),
  };
  it('are used in the plan and marked, in the working and the clean plan', async () => {
    const { firmTime } = await import('../../src/lib/route');
    expect(firmTime({ perDay: 100, perDayUnit: 'pcs', fixedDays: null, status: 'ESTIMATED' })).toMatchObject({ perDay: 100, estimated: true });
    expect(firmTime({ perDay: 100, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED' }).estimated).toBeUndefined();
    expect(firmTime({ perDay: 100, perDayUnit: 'pcs', fixedDays: null, status: 'PENDING_VERIFICATION' }).perDay).toBeNull();
    const { productionPlanDoc } = await import('../../src/lib/docs/model');
    const base = { jo: finalJo.get('sample_jo_104')!, md: estMd, processes, ctx: { md: estMd, cal: DEFAULT_CALENDAR }, today: TODAY, company: 'Co', generatedAt: 'now', preparedBy: { name: '', designation: '' } };
    const working = productionPlanDoc({ ...base, variant: 'working' });
    const weave = working.tables[0]!.rows.find((r) => r[0]!.startsWith('Weaving'))!;
    expect(weave.join(' ')).toMatch(/my estimate/);
    expect(working.provisionalReasons.join(' ')).toMatch(/Estimated time for Weaving/);
    const clean = productionPlanDoc({ ...base, variant: 'submit' });
    expect(clean.tables.at(-1)!.rows.flat().join(' ')).toMatch(/time for Weaving \(sample\) is approximate/);
  });
  it('labels describe how sure a figure is, not who entered it', async () => {
    const { DATA_STATUS_LABEL } = await import('../../src/lib/dataStatus');
    expect(Object.values(DATA_STATUS_LABEL)).toEqual(['Confirmed', 'Known', 'My estimate', 'To be confirmed', 'Not available']);
  });
});
