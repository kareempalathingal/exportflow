import { beforeEach, describe, expect, it } from 'vitest';
import { countSnapshot, readsToday } from '../../src/lib/readsToday';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};
const snap = (fromCache: boolean, size: number, changes: number) => ({ size, metadata: { fromCache }, docChanges: () => Array.from({ length: changes }) });

describe('reads today (approx., 15 Nov 2026)', () => {
  beforeEach(() => mem.clear());
  it('a list read for the first time costs every document; then only changes', () => {
    const owner = {};
    const t = new Date('2026-11-15T05:00:00Z');
    expect(countSnapshot(snap(true, 600, 600), 'ws/products', owner, t)).toBe(0); // the phone's saved copy is free
    expect(countSnapshot(snap(false, 600, 0), 'ws/products', owner, t)).toBe(600);
    expect(countSnapshot(snap(false, 600, 2), 'ws/products', owner, t)).toBe(2);
    expect(readsToday(t)).toBe(602);
  });
  it('reconnecting within 30 minutes costs only the changes; after that, everything again', () => {
    const t0 = new Date('2026-11-15T05:00:00Z');
    countSnapshot(snap(false, 100, 100), 'ws/boms', {}, t0);
    expect(countSnapshot(snap(false, 100, 3), 'ws/boms', {}, new Date('2026-11-15T05:20:00Z'))).toBe(3);
    expect(countSnapshot(snap(false, 100, 0), 'ws/boms', {}, new Date('2026-11-15T06:00:00Z'))).toBe(100);
  });
  it('the count starts again each day (IST)', () => {
    countSnapshot(snap(false, 50, 50), 'ws/x', {}, new Date('2026-11-15T10:00:00Z'));
    expect(readsToday(new Date('2026-11-15T19:00:00Z'))).toBe(0); // 00:30 IST on the 16th
  });
});
