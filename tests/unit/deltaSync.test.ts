import { beforeEach, describe, expect, it } from 'vitest';
import { chooseMode, clearListMeta, countMismatch, countReads, deltaFrom, listSyncSummary, newestSave, OVERLAP_MS, readListMeta, removeListMeta, savedMs, writeListMeta } from '../../src/lib/deltaSync';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};
const ts = (ms: number) => ({ toMillis: () => ms });
const NOW = new Date('2026-11-15T10:00:00+05:30');
const TODAY = '2026-11-15';

describe('delta sync rules (15 Nov 2026)', () => {
  beforeEach(() => clearListMeta());

  it('reads whole on the first open of the day, without a saved copy, or with no record of a whole read', () => {
    expect(chooseMode(null, true, NOW)).toBe('FULL');
    expect(chooseMode({ fullDay: '2026-11-14', fullAt: 0, maxMs: 5 }, true, NOW)).toBe('FULL');
    expect(chooseMode({ fullDay: TODAY, fullAt: 0, maxMs: 5 }, false, NOW)).toBe('FULL');
    expect(chooseMode({ fullDay: TODAY, fullAt: 0, maxMs: 5 }, true, NOW)).toBe('DELTA');
  });

  it('asks for changes from the newest save seen minus the overlap', () => {
    expect(deltaFrom({ fullDay: TODAY, fullAt: 0, maxMs: 1_000_000_000 })).toBe(1_000_000_000 - OVERLAP_MS);
    expect(deltaFrom({ fullDay: TODAY, fullAt: 0, maxMs: 0 })).toBe(0);
  });

  it('takes the newest server save time and ignores saves still waiting for the server', () => {
    expect(savedMs(ts(42))).toBe(42);
    expect(savedMs(null)).toBeNull();
    expect(newestSave([{ updatedAt: ts(5) }, { updatedAt: null }, { updatedAt: ts(9) }, {}])).toBe(9);
    expect(newestSave([{ updatedAt: ts(5) }], 7)).toBe(7);
  });

  it('a count that differs from the phone copy means a whole read (records made here and not on the server yet allowed for)', () => {
    expect(countMismatch(100, 100)).toBe(false);
    expect(countMismatch(101, 100)).toBe(true); // phone misses one
    expect(countMismatch(99, 100)).toBe(true); // phone holds one the server no longer has
    expect(countMismatch(100, 101, 1)).toBe(false); // one new record still on its way
    expect(countReads(0)).toBe(1);
    expect(countReads(5000)).toBe(5);
    expect(countReads(5001)).toBe(6);
  });

  it('keeps the state per list and per workspace', () => {
    writeListMeta('ws_demo/products', { fullDay: TODAY, fullAt: NOW.getTime(), maxMs: 3 });
    writeListMeta('ws_demo/boms', { fullDay: TODAY, fullAt: NOW.getTime() - 60_000, maxMs: 4 });
    writeListMeta('ws_actual/products', { fullDay: '2026-11-14', fullAt: 1, maxMs: 1 });
    expect(readListMeta('ws_demo/products')?.maxMs).toBe(3);
    const all = { 'ws_demo/products': readListMeta('ws_demo/products')!, 'ws_demo/boms': readListMeta('ws_demo/boms')!, 'ws_actual/products': readListMeta('ws_actual/products')! };
    expect(listSyncSummary('ws_demo', all, NOW)).toEqual({ today: 2, firstAt: NOW.getTime() - 60_000 });
    expect(listSyncSummary('ws_actual', all, NOW)).toEqual({ today: 0, firstAt: null });
    removeListMeta('ws_demo/boms');
    expect(readListMeta('ws_demo/boms')).toBeNull();
    clearListMeta('ws_demo');
    expect(readListMeta('ws_demo/products')).toBeNull();
    expect(readListMeta('ws_actual/products')).not.toBeNull();
  });
});
