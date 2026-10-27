import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { lookAheadDoc, myReportDoc } from '../../src/lib/docs/reportsDocs';
import type { JobOrder } from '../../src/lib/jobOrders';
import { buildLookAhead } from '../../src/lib/lookAhead';
import type { Bom, Department, MasterData, Process, Product, RawMaterial } from '../../src/lib/masters';
import { buildMyReport } from '../../src/lib/myReport';
import { buildSampleData } from '../../src/lib/sampleData';
import type { Task } from '../../src/lib/tasks';

const TODAY = '2026-10-27';
const writes = buildSampleData('2026-10-26');
const of = <T,>(c: string) => {
  const m = new Map<string, T & { id: string }>();
  for (const w of writes.filter((x) => x.collection === c)) m.set(w.docId, { id: w.docId, ...(w.data as unknown as T) });
  return [...m.values()];
};
const md: MasterData = {
  products: new Map(of<Product>('products').map((p) => [p.id, p])),
  rawMaterials: new Map(of<RawMaterial>('rawMaterials').map((p) => [p.id, p])),
  boms: new Map(of<Bom>('boms').map((p) => [p.id, p])),
};
const departments = of<Department>('departments');
const names = new Map(departments.map((d) => [d.id, d.name]));
const jos = of<JobOrder>('jobOrders');
const base = {
  jobOrders: jos,
  ctx: { md, cal: DEFAULT_CALENDAR },
  today: TODAY,
  departments,
  processNames: new Map(of<Process>('processes').map((p) => [p.id, p.name])),
  tasks: of<Task>('tasks'),
  deptName: (id: string) => names.get(id) ?? '',
};

describe('look ahead (confirmed 27 Oct 2026)', () => {
  const la = buildLookAhead({ ...base, from: TODAY, to: '2026-11-23' });
  it('uses confirmed orders only, in Monday weeks', () => {
    expect(la.orders).toBe(jos.filter((j) => j.status === 'CONFIRMED').length);
    expect(la.byMonth).toBe(false);
    expect(la.weeks[0]!.start).toBe('2026-10-26');
    expect(la.weeks.every((w) => new Date(`${w.start}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
  });
  it('load per department: orders, average and peak jobs at a time, levels compared across departments', () => {
    const cells = la.departments.flatMap((d) => d.cells);
    for (const c of cells) {
      expect(c.orders > 0).toBe(c.avg > 0);
      expect(c.avg).toBeLessThanOrEqual(c.peak);
      expect(c.level === 0).toBe(c.orders === 0);
    }
    expect(cells.some((c) => c.level === 3)).toBe(true);
    // quantity per process, one unit each, never summed across processes
    for (const d of la.departments) for (const p of d.processes) expect(p.qty).toHaveLength(la.weeks.length);
    expect(la.departments.find((d) => d.name.startsWith('Spinning'))!.processes[0]!.unit).toBe('kg');
  });
  it('quieter weeks are the department’s empty or light weeks', () => {
    for (const d of la.departments) for (const w of d.quietWeeks) {
      const i = la.weeks.findIndex((x) => x.start === w);
      const max = Math.max(...d.cells.map((c) => c.avg));
      expect(d.cells[i]!.avg === 0 || d.cells[i]!.avg < max / 3).toBe(true);
    }
  });
  it('materials only for products not started yet, with the date their work starts', () => {
    expect(la.materials.length).toBeGreaterThan(0);
    for (const m of la.materials) expect(m.neededBy <= la.to).toBe(true);
    expect(la.materials.some((m) => m.joNumber === 'DEMO-101')).toBe(false); // already in production
    const fibre = la.materials.find((m) => m.name.startsWith('Coir fibre') && m.joNumber === 'DEMO-105')!;
    expect(fibre).toMatchObject({ overdue: true });
  });
  it('long ranges use months; repeating tasks show each coming occurrence', () => {
    const long = buildLookAhead({ ...base, from: TODAY, to: '2027-01-26' });
    expect(long.byMonth).toBe(true);
    expect(long.weeks.map((w) => w.start)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01']);
    expect(long.tasks.filter((t) => t.title.startsWith('Ask accounts for GST')).map((t) => t.date)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10']);
    const doc = lookAheadDoc(long, { company: 'Co', generatedAt: 'x', today: TODAY });
    expect(doc.tables[0]!.columns.map((c) => c.label)).toEqual(['Department', 'Oct 2026', 'Nov 2026', 'Dec 2026', 'Jan 2027', 'Quieter (leave)']);
    expect(doc.tables[0]!.cellLevels![0]!).toHaveLength(6);
  });
});

describe('my report (confirmed 27 Oct 2026)', () => {
  const r = buildMyReport({ ...base, from: '2026-10-19', to: '2026-10-25', monthly: false, history: [], targets: { onTimeStepPct: 85 } });
  it('counts what was recorded in the period, nothing more', () => {
    expect(r.prevFrom).toBe('2026-10-12');
    expect(r.tiles.stepsOnTime).toBeLessThanOrEqual(r.tiles.stepsTimed);
    expect(r.tiles.stepsTimed).toBeLessThanOrEqual(r.tiles.stepsDone);
    expect(r.delays.every((d) => /\d+(\.\d+)? days over$/.test(d.over))).toBe(true);
    expect(r.delays.some((d) => d.step.startsWith('Latex backing'))).toBe(true);
    for (const o of r.orders) {
      const m = /^(\d+)% → (\d+)%$/.exec(o.progress);
      if (m) expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
    }
    expect(r.kpis.map((k) => k.label)).toEqual(['Steps on time', 'Efficiency (planned ÷ actual time)', 'Planning within benchmark', 'On-time delivery (orders completed)']);
  });
  it('suggests highlights from the records; the PDF uses the edited ones', () => {
    expect(r.highlights.some((h) => /DEMO-103 .*planned and confirmed/.test(h))).toBe(true);
    const doc = myReportDoc(r, { company: 'Co', generatedAt: 'x', highlights: ['My own line', ''], preparedBy: { name: 'Kareem', designation: 'PM' }, today: TODAY });
    expect(doc.title).toBe('Weekly Report');
    expect(doc.tables[0]).toMatchObject({ title: 'Highlights', rows: [['- My own line']], noHead: true });
    expect(doc.signature?.preparedBy).toBe('Kareem');
  });
});
