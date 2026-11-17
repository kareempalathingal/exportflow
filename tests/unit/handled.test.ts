import { beforeEach, describe, expect, it } from 'vitest';
import { readHandled, writeHandled } from '../../src/lib/handled';
import { handledLast, todayByDepartment, todayGroupText, todayItemKey, todayText, type TodayItem } from '../../src/lib/today';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
};

const item = (text: string, when: TodayItem['when'] = 'TODAY'): TodayItem => ({ when, date: null, text, link: '/orders/a', area: { kind: 'PROCESS', id: 'p' }, open: { label: 'Open step', link: '/orders/a' } });

describe('Handled marks on Today items (17 Nov 2026)', () => {
  beforeEach(() => mem.clear());
  it('are kept for the day only and can be undone', () => {
    const a = item('A late');
    writeHandled('ws', '2026-11-17', todayItemKey(a), { at: '11:40', note: '  called supervisor  ' });
    expect(readHandled('ws', '2026-11-17')[todayItemKey(a)]).toEqual({ at: '11:40', note: 'called supervisor' });
    expect(readHandled('ws', '2026-11-18')).toEqual({}); // next day: open again
    expect(readHandled('other', '2026-11-17')).toEqual({}); // per workspace
    expect(writeHandled('ws', '2026-11-17', todayItemKey(a), null)).toEqual({});
  });
  it('move handled items last, out of the counts, and into the shared text with the note', () => {
    const a = item('A over plan', 'OVERDUE');
    const b = item('B should finish');
    const marks = { [todayItemKey(a)]: { at: '11:40', note: 'new date Friday' } };
    const h = (i: TodayItem) => marks[todayItemKey(i)];
    expect(handledLast([a, b], h).map((i) => i.text)).toEqual(['B should finish', 'A over plan']);
    const depts = [{ id: 'd', name: 'Production', active: true, notes: '', people: [], processIds: ['p'] }];
    const g = todayByDepartment({ today: '2026-11-17', soonUntil: '2026-11-19', items: [a, b] }, depts, h)[0]!;
    expect(g.counts).toEqual({ OVERDUE: 0, TODAY: 1, SOON: 0 });
    expect(g.handled).toBe(1);
    expect(todayGroupText(g, '2026-11-17', '', h).split('\n').slice(2)).toEqual(['• [Today] B should finish', '• [Handled 11:40] A over plan - new date Friday']);
    expect(todayText({ today: '2026-11-17', soonUntil: '2026-11-19', items: [a, b] }, '', depts, h)).toContain('Production (1 today, 1 handled):');
  });
});
