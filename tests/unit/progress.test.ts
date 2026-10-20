import { describe, expect, it } from 'vitest';
import { colorAt, gapColor, plannedPct, trackGroup, trackLabel, trackOf } from '../../src/lib/progress';
import type { Deadline, JoStatus } from '../../src/lib/jobOrders';

const deadline: Deadline = { orderPeriodDays: 59, bufferDays: 6, internalDeadline: '2026-12-24', ruleVersion: 'v' };
const jo = (status: JoStatus, pct?: number, on = '2026-11-20') => ({
  status, confirmedOn: '2026-11-04', receivedDate: '2026-11-01', deadline, progress: pct === undefined ? null : { pct, on },
});

describe('planned vs actual', () => {
  it('plans linearly from confirmation to the internal deadline', () => {
    expect(plannedPct(jo('CONFIRMED'), '2026-11-04')).toBe(0);
    expect(plannedPct(jo('CONFIRMED'), '2026-11-29')).toBe(50);
    expect(plannedPct(jo('CONFIRMED'), '2026-12-30')).toBe(100);
    expect(plannedPct(jo('CONFIRMED'), '2026-10-01')).toBe(0);
  });
  it('classifies orders by schedule gap, not by days left', () => {
    const ahead = trackOf(jo('CONFIRMED', 90), '2026-12-19'); // 5 days left, planned 90
    expect(ahead).toMatchObject({ kind: 'TRACKED', gap: 0 });
    expect(trackGroup(ahead)).toBe('ON_TRACK');
    const behind = trackOf(jo('CONFIRMED', 25), '2026-11-29'); // plenty of time, planned 50
    expect(behind).toMatchObject({ kind: 'TRACKED', gap: -25 });
    expect(trackGroup(behind)).toBe('BEHIND');
    expect(trackLabel(behind)).toBe('25% behind');
    expect(trackOf(jo('CONFIRMED'), '2026-11-29').kind).toBe('NOT_TRACKED');
    expect(trackOf(jo('CONFIRMED', 85), '2026-12-26')).toMatchObject({ kind: 'LATE', daysLeft: -2 });
    expect(trackOf(jo('CONFIRMED', 100), '2026-12-26').kind).toBe('DONE');
    expect(trackOf(jo('DRAFT'), '2026-11-29').kind).toBe('DRAFT');
    expect(trackOf(jo('CONFIRMED', 40, '2026-11-20'), '2026-11-29').updatedDaysAgo).toBe(9);
  });
  it('colour moves smoothly from green to red and is full red at the limit', () => {
    expect(colorAt(0)).toBe('oklch(0.580 0.130 150.0)');
    expect(colorAt(0.5)).toBe('oklch(0.720 0.150 75.0)');
    expect(colorAt(1)).toBe('oklch(0.560 0.190 28.0)');
    expect(colorAt(0.25)).toBe('oklch(0.650 0.140 112.5)');
    expect(gapColor({ kind: 'TRACKED', gap: 5 }, 20)).toBe(colorAt(0));
    expect(gapColor({ kind: 'TRACKED', gap: -40 }, 20)).toBe(colorAt(1));
    expect(gapColor({ kind: 'TRACKED', gap: -5 }, 20)).toBe(colorAt(0.25));
    expect(gapColor({ kind: 'TRACKED', gap: -5 }, 10)).toBe(colorAt(0.5));
    expect(gapColor({ kind: 'LATE', gap: 0 }, 20)).toBe(colorAt(1));
    expect(gapColor({ kind: 'NOT_TRACKED', gap: null }, 20)).toBe('var(--muted)');
  });
});

import { appendProgress, lastPerDay } from '../../src/lib/progress';
describe('progress history', () => {
  it('keeps every update with its time, oldest first', () => {
    let log = appendProgress(undefined, { pct: 10, on: '2026-11-05', at: '2026-11-05T04:00:00Z' });
    log = appendProgress(log, { pct: 30, on: '2026-11-12', at: '2026-11-12T05:00:00Z' });
    log = appendProgress(log, { pct: 35, on: '2026-11-12', at: '2026-11-12T11:30:00Z' });
    log = appendProgress(log, { pct: 20, on: '2026-11-08', at: '2026-11-08T06:00:00Z' });
    expect(log.map((e) => e.pct)).toEqual([10, 20, 30, 35]);
    expect(lastPerDay(log).map((e) => [e.on, e.pct])).toEqual([
      ['2026-11-05', 10],
      ['2026-11-08', 20],
      ['2026-11-12', 35],
    ]);
  });
});
