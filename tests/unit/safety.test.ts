import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackup } from '../../src/lib/backup';
import { clearErrors, ERROR_LOG_MAX, errorReport, logError, quotaErrors, readErrors } from '../../src/lib/errorLog';
import { checkIntegrity } from '../../src/lib/integrity';
import type { JobOrder } from '../../src/lib/jobOrders';
import type { MasterData, Product } from '../../src/lib/masters';
import { parseBackup, planRestore, statusPath, type CurrentRecord } from '../../src/lib/restore';

// In-memory localStorage for the on-phone error log.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const na = { value: null, status: 'UNAVAILABLE' as const, source: '' };
const product = (name: string, baseUnit = 'pcs'): Product => ({
  name, code: '', active: true, notes: '', baseUnit, supplyType: 'MANUFACTURED', specifications: '',
  size: { length: null, width: null, unit: 'cm', status: 'UNAVAILABLE' }, thicknessMm: na, gsm: na, weightPerPieceKg: na, customUnits: [],
});
const jo = (status: JobOrder['status'], extra: Partial<JobOrder> = {}): JobOrder => ({
  joNumber: 'JO-1', customerId: 'c1', customerName: 'Buyer', poNumber: '', receivedDate: '2026-11-02', deliveryDate: '2026-12-30',
  deliveryDateType: 'PORT', deadline: { orderPeriodDays: 51, bufferDays: 6, internalDeadline: '2026-12-23', ruleVersion: 'v2' },
  status, lines: [{ id: 'l1', productId: 'p1', productName: 'Mat', qty: 10, unit: 'pcs', supply: 'MAKE' }], notes: '',
  bomSnapshot: status === 'DRAFT' ? null : {}, confirmedOn: status === 'DRAFT' ? null : '2026-11-02', ...extra,
});
const backup = (mode: 'ACTUAL' | 'DEMO', collections: Record<string, { id: string; data: unknown }[]>) =>
  buildBackup({ workspaceId: `u1_${mode.toLowerCase()}`, mode, appVersion: 't', now: new Date('2026-10-20T05:00:00Z'), collections });
const cur = (id: string, data: object, rev: number): CurrentRecord => ({ id, data: { ...data, rev, updatedAt: 'x', updatedBy: 'u1', lastAuditId: 'a' } });

describe('reading a backup file', () => {
  it('accepts an ExportFlow backup and rejects anything else', () => {
    const b = backup('ACTUAL', { products: [{ id: 'p1', data: product('Mat') }] });
    expect(parseBackup(JSON.stringify(b)).ok).toBe(true);
    expect(parseBackup('not json')).toMatchObject({ ok: false, error: expect.stringMatching(/not a valid backup/) });
    expect(parseBackup(JSON.stringify({ hello: 1 }))).toMatchObject({ ok: false, error: expect.stringMatching(/not an ExportFlow backup/) });
    const bad = { ...b, collections: { products: [{ id: '../x', data: {} }] } };
    expect(parseBackup(JSON.stringify(bad))).toMatchObject({ ok: false, error: expect.stringMatching(/damaged/) });
  });
});

describe('restore plan', () => {
  it('never puts DEMO data into ACTUAL', () => {
    const p = planRestore(backup('DEMO', {}), {}, { workspaceId: 'u1_actual', mode: 'ACTUAL' });
    expect(p.blocked).toMatch(/never written to ACTUAL/);
    expect(p.writes).toHaveLength(0);
  });
  it('allows an ACTUAL backup into DEMO for a practice run, with a note', () => {
    const p = planRestore(backup('ACTUAL', {}), {}, { workspaceId: 'u1_demo', mode: 'DEMO' });
    expect(p.blocked).toBeNull();
    expect(p.warnings[0]).toMatch(/practice run/);
  });
  it('creates missing records, updates changed ones as a new revision, skips equal ones and keeps extra ones', () => {
    const b = backup('ACTUAL', {
      products: [
        { id: 'p1', data: product('Mat') },
        { id: 'p2', data: { ...product('Rug'), rev: 9, updatedAt: '2026-01-01T00:00:00Z' } },
        { id: 'p3', data: product('New one') },
      ],
    });
    const current = { products: [cur('p1', product('Mat'), 2), cur('p2', product('Rug (renamed)'), 5), cur('p4', product('Added later'), 1)] };
    const p = planRestore(b, current, { workspaceId: 'u1_actual', mode: 'ACTUAL' });
    expect(p.byCollection.products).toEqual({ create: 1, update: 1, same: 1, skipped: 0, keptNotInBackup: 1 });
    const p2 = p.writes.find((w) => w.docId === 'p2')!;
    expect(p2.before!.rev).toBe(5); // written as revision 6 on top of the current one
    expect(p2.data).not.toHaveProperty('rev');
    expect(p2.data).not.toHaveProperty('updatedAt');
    expect(p2.reason).toBe('Restored from backup of 2026-10-20 05:00 UTC');
    expect(p.writes.find((w) => w.docId === 'p3')!.before).toBeNull();
  });
  it('skips a product whose base unit changed (the rules forbid that)', () => {
    const p = planRestore(backup('ACTUAL', { products: [{ id: 'p1', data: product('Mat', 'kg') }] }), { products: [cur('p1', product('Mat', 'pcs'), 1)] }, { workspaceId: 'u1_actual', mode: 'ACTUAL' });
    expect(p.writes).toHaveLength(0);
    expect(p.skips[0]!.reason).toMatch(/base unit/);
  });
  it('job orders go through allowed status changes only', () => {
    expect(statusPath('CONFIRMED', 'CONFIRMED')).toEqual(['CONFIRMED']);
    expect(statusPath('COMPLETED', 'COMPLETED')).toEqual(['CONFIRMED', 'COMPLETED']);
    expect(statusPath('CANCELLED', 'CONFIRMED')).toEqual(['DRAFT', 'CONFIRMED']);
    expect(statusPath('COMPLETED', 'DRAFT')).toEqual(['CONFIRMED', 'CANCELLED', 'DRAFT']);
    const b = backup('ACTUAL', { jobOrders: [{ id: 'j1', data: jo('COMPLETED', { notes: 'from backup' }) }, { id: 'j2', data: jo('CONFIRMED') }] });
    const p = planRestore(b, { jobOrders: [cur('j1', jo('CANCELLED'), 4)] }, { workspaceId: 'u1_actual', mode: 'ACTUAL' });
    const j1 = p.writes.filter((w) => w.docId === 'j1');
    expect(j1.map((w) => [w.before!.rev, w.data.status])).toEqual([[4, 'DRAFT'], [5, 'CONFIRMED'], [6, 'COMPLETED']]);
    const j2 = p.writes.filter((w) => w.docId === 'j2');
    expect(j2.map((w) => [w.before?.rev ?? 0, w.data.status])).toEqual([[0, 'DRAFT'], [1, 'CONFIRMED']]); // new orders start as drafts
    expect(j1.every((w) => w.reason)).toBe(true);
  });
  it('never restores history (audit events stay as they are)', () => {
    const b = backup('ACTUAL', { auditEvents: [{ id: 'a1', data: { entity: 'x' } }] });
    expect(planRestore(b, {}, { workspaceId: 'u1_actual', mode: 'ACTUAL' }).writes).toHaveLength(0);
  });
});

describe('error log on this phone', () => {
  beforeEach(() => clearErrors());
  it('keeps the newest errors, drops repeats within a minute, and caps the list', () => {
    const t = new Date('2026-10-20T05:00:00Z');
    logError(new Error('boom'), 'Screen', { now: t, route: '#/orders', appVersion: '1' });
    logError(new Error('boom'), 'Screen', { now: new Date(t.getTime() + 5000), route: '#/orders', appVersion: '1' });
    expect(readErrors()).toHaveLength(1);
    for (let i = 0; i < 60; i++) logError(new Error(`e${i}`), 'Screen', { now: new Date(t.getTime() + i * 120_000) });
    expect(readErrors()).toHaveLength(ERROR_LOG_MAX);
    expect(readErrors()[0]!.message).toBe('Error: e59');
  });
  it('makes a report to paste, and spots the free plan limit', () => {
    logError({ code: 'resource-exhausted', message: 'Quota exceeded.' }, 'Sync: Product', { now: new Date('2026-10-20T05:00:00Z'), route: '#/', appVersion: '1' });
    expect(errorReport(readErrors())).toContain('resource-exhausted: Quota exceeded.');
    expect(quotaErrors(readErrors())).toHaveLength(1);
  });
});

describe('data checks', () => {
  it('finds missing links, BOM loops and broken orders', () => {
    const md: MasterData = {
      products: new Map([['a', { ...product('A'), route: [{ processId: 'gone', perDay: null, perDayUnit: 'pcs', fixedDays: null, status: 'PENDING_VERIFICATION', source: '' }] }], ['b', product('B')]]),
      rawMaterials: new Map(),
      boms: new Map([
        ['a', { productId: 'a', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'b', qty: 1, unit: 'pcs', wastagePct: 0, status: 'VERIFIED', source: '' }] }],
        ['b', { productId: 'b', notes: '', lines: [{ componentType: 'PRODUCT', componentId: 'a', qty: 1, unit: 'pcs', wastagePct: 0, status: 'VERIFIED', source: '' }, { componentType: 'RAW_MATERIAL', componentId: 'r9', qty: 1, unit: 'kg', wastagePct: 0, status: 'VERIFIED', source: '' }] }],
      ]),
    };
    const issues = checkIntegrity({
      md,
      jobOrders: [{ id: 'j1', ...jo('CONFIRMED', { bomSnapshot: null, lines: [{ id: 'l', productId: 'zz', productName: 'Old', qty: 1, unit: 'pcs', supply: 'MAKE' }] }) }],
      customers: [],
      processes: [],
      suppliers: [{ id: 's1', name: 'S', active: true, notes: '', place: '', contactPerson: '', phone: '', email: '', gstin: '', items: ['PRODUCT:nope'] }],
    }).map((i) => i.text);
    expect(issues).toEqual(expect.arrayContaining([
      'Loop in BOMs: A → B → A',
      'BOM of B: a line points to a missing raw material',
      'A: a process step points to a missing process',
      'S: 1 linked item is missing',
      'JO-1: customer record is missing (Buyer)',
      'JO-1 line 1: product is missing (Old)',
      'JO-1: confirmed without a saved BOM copy',
    ]));
  });
  it('reports nothing for consistent data', () => {
    const md: MasterData = { products: new Map([['p1', product('Mat')]]), rawMaterials: new Map(), boms: new Map() };
    expect(checkIntegrity({ md, jobOrders: [{ id: 'j1', ...jo('DRAFT') }], customers: [{ id: 'c1', name: 'Buyer', active: true, notes: '', country: '', customerType: 'DIRECT', contactPerson: '', phone: '', email: '' }], processes: [], suppliers: [] })).toEqual([]);
  });
});

describe('sharing a file after a slow preparation', () => {
  it('reports "needs-tap" instead of failing when the phone refuses the late share', async () => {
    const { saveFile } = await import('../../src/lib/docs/pdf');
    const nav = globalThis.navigator as unknown as Record<string, unknown>;
    const saved = { canShare: nav.canShare, share: nav.share };
    Object.defineProperty(globalThis.navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(globalThis.navigator, 'share', { value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')), configurable: true });
    try {
      expect(await saveFile(new Blob(['{}']), 'b.json', 'application/json', 'Backup', 'share')).toBe('needs-tap');
      Object.defineProperty(globalThis.navigator, 'share', { value: () => Promise.reject(new DOMException('x', 'AbortError')), configurable: true });
      expect(await saveFile(new Blob(['{}']), 'b.json', 'application/json', 'Backup', 'share')).toBe('cancelled');
    } finally {
      Object.defineProperty(globalThis.navigator, 'canShare', { value: saved.canShare, configurable: true });
      Object.defineProperty(globalThis.navigator, 'share', { value: saved.share, configurable: true });
    }
  });
});
