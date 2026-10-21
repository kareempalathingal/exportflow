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
    expect(c.steps.length).toBe(6);
    expect(c.actualDays).toBeGreaterThan(0);
    expect(r.open.map((o) => o.joNumber)).toEqual(expect.arrayContaining(['DEMO-101', 'DEMO-102', 'DEMO-103']));
    expect(r.open[0]!.joNumber).toBe('DEMO-101'); // late first
  });
  it('a period with no completions is empty but still lists open orders', () => {
    const r = buildPerformance({ jobOrders: jos, ctx, from: '2026-10-01', to: TODAY, today: TODAY, history: [] });
    expect(r.summary.completed).toBe(0);
    expect(r.summary.avgLateDays).toBeNull();
    expect(r.open.length).toBe(3);
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
