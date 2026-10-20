import { describe, expect, it } from 'vitest';
import { backupFileName, buildBackup, BACKUP_COLLECTIONS, daysSinceBackup, toPlain } from '../../src/lib/backup';
import { READINESS_ITEMS, readinessSummary, readinessWorkspace } from '../../src/lib/readiness';
import { DEFAULT_CALENDAR } from '../../src/lib/calendar';
import { buildSampleData } from '../../src/lib/sampleData';
import { canTransition, type JobOrder, type JoStatus } from '../../src/lib/jobOrders';
import type { Bom, MasterData, Product, RawMaterial } from '../../src/lib/masters';
import { planMaterials } from '../../src/lib/materials';
import { orderTrack, overrunningSteps } from '../../src/lib/route';

describe('backup', () => {
  it('turns Firestore timestamps into text and keeps every collection', () => {
    const ts = { toDate: () => new Date('2026-10-20T03:00:00Z') };
    expect(toPlain({ a: ts, b: [ts, 1], c: null })).toEqual({ a: '2026-10-20T03:00:00.000Z', b: ['2026-10-20T03:00:00.000Z', 1], c: null });
    const f = buildBackup({ workspaceId: 'u_actual', mode: 'ACTUAL', appVersion: '1', now: new Date('2026-10-20T03:00:00Z'), collections: { products: [{ id: 'b', data: {} }, { id: 'a', data: { updatedAt: ts } }] } });
    expect(Object.keys(f.collections)).toEqual([...BACKUP_COLLECTIONS]);
    expect(f.collections.products!.map((r) => r.id)).toEqual(['a', 'b']);
    expect(f.counts.products).toBe(2);
    expect(f.counts.jobOrders).toBe(0);
    expect(backupFileName('DEMO', new Date('2026-10-20T03:05:00Z'))).toBe('exportflow-demo-backup-202610200305.json');
    expect(daysSinceBackup('2026-10-10T03:00:00Z', new Date('2026-10-20T04:00:00Z'))).toBe(10);
    expect(daysSinceBackup(null, new Date())).toBeNull();
  });
});

describe('company data checklist', () => {
  it('counts received and not-needed items', () => {
    expect(readinessSummary(null)).toEqual({ received: 0, notNeeded: 0, pending: READINESS_ITEMS.length, total: READINESS_ITEMS.length });
    const s = readinessSummary({ items: { 'jo-sample': { status: 'RECEIVED', note: '', on: null }, packing: { status: 'NOT_NEEDED', note: '', on: null } } });
    expect(s).toMatchObject({ received: 1, notNeeded: 1, pending: READINESS_ITEMS.length - 2 });
    expect(new Set(READINESS_ITEMS.map((i) => i.id)).size).toBe(READINESS_ITEMS.length);
  });
  it('always uses the ACTUAL workspace', () => {
    expect(readinessWorkspace('abc123', 'abc123_demo')).toBe('abc123_actual');
    expect(readinessWorkspace(undefined, 'x_demo')).toBe('x_demo');
  });
});

describe('DEMO sample data', () => {
  const today = '2026-10-20';
  const writes = buildSampleData(today);
  it('marks every named record as sample data', () => {
    for (const w of writes) {
      const name = (w.data.name ?? w.data.customerName) as string | undefined;
      if (name) expect(name).toMatch(/\(sample\)$/);
    }
  });
  it('moves Job Orders only through allowed status changes, one revision at a time', () => {
    const revs = new Map<string, { rev: number; status: JoStatus }>();
    for (const w of writes.filter((x) => x.collection === 'jobOrders')) {
      const prev = revs.get(w.docId);
      const status = w.data.status as JoStatus;
      if (!prev) {
        expect(w.before).toBeNull();
        expect(status).toBe('DRAFT');
      } else {
        expect(w.before?.rev).toBe(prev.rev);
        expect(canTransition(prev.status, status)).toBe(true);
        if (status !== 'DRAFT') expect(w.data.bomSnapshot).toBeTypeOf('object');
      }
      revs.set(w.docId, { rev: (prev?.rev ?? 0) + 1, status });
    }
    expect(revs.size).toBe(5);
  });
  it('produces the intended dashboard situations', () => {
    const md: MasterData = {
      products: new Map(writes.filter((w) => w.collection === 'products').map((w) => [w.docId, w.data as unknown as Product])),
      rawMaterials: new Map(writes.filter((w) => w.collection === 'rawMaterials').map((w) => [w.docId, w.data as unknown as RawMaterial])),
      boms: new Map(writes.filter((w) => w.collection === 'boms').map((w) => [w.docId, w.data as unknown as Bom])),
    };
    const ctx = { md, cal: DEFAULT_CALENDAR };
    const final = new Map<string, JobOrder>();
    for (const w of writes) if (w.collection === 'jobOrders') final.set(w.data.joNumber as string, w.data as unknown as JobOrder);
    expect(orderTrack(final.get('DEMO-101')!, today, ctx).kind).toBe('LATE');
    expect(orderTrack(final.get('DEMO-102')!, today, ctx).gap!).toBeGreaterThanOrEqual(0);
    expect(orderTrack(final.get('DEMO-103')!, today, ctx).gap!).toBeLessThan(0);
    expect(orderTrack(final.get('DEMO-104')!, today, ctx).kind).toBe('DRAFT');
    expect(final.get('DEMO-099')!.status).toBe('COMPLETED');
    expect(final.get('DEMO-102')!.lines.map((l) => l.steps!.map((s) => s.label))).toEqual([
      ['Spinning (sample)', 'Weaving (sample)', 'Bleaching (sample)', 'Dyeing (sample)', 'Latex backing (sample)', 'Packing (sample)'],
      ['Ordered', 'Received', 'Labelling (sample)', 'Packing (sample)'],
    ]);
    expect(overrunningSteps(final.get('DEMO-101')!, today, ctx).length).toBeGreaterThan(0);
    expect(planMaterials(final.get('DEMO-104')!, md).errors[0]).toMatch(/BOM missing/);
    expect(planMaterials(final.get('DEMO-102')!, md).toBuy.map((r) => r.id)).toContain('sample_p_door');
  });
});
