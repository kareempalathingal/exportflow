import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR, workingDaysBetween } from '../../src/lib/calendar';
import { completeCurrent, lineProgress, lineSchedule, stepDates, stepTime, type PlannedStep } from '../../src/lib/route';

const cal = DEFAULT_CALENDAR;
const START = '2026-10-19'; // Monday
const step = (key: string, plannedDays: number | null, estimated = false): PlannedStep => ({
  key, processId: 'p', label: key, forProduct: 'X', productId: null, perDay: null, perDayUnit: null, fixedDays: plannedDays, doneAt: null,
  plannedDays, qty: null, qtyUnit: null, basis: null, note: null, ...(estimated ? { estimated: true } : {}),
});
const lp = (steps: PlannedStep[], today: string) => lineProgress(steps, START, today, cal)!;

describe('expected dates per step on the Products tab (confirmed 28 Oct 2026)', () => {
  it('uses the plan PDF dates; estimates are approx.; Ready is compared with the internal deadline', () => {
    const p = lp([step('a', 2), step('b', 3, true), step('c', 1)], '2026-10-20');
    const sched = lineSchedule(p, '2026-10-20', cal);
    const { steps, ready } = stepDates(p, '2026-10-20', cal, '2026-11-10');
    expect(steps[0]).toEqual({ kind: 'DUE', finish: sched[0]!.finish, approx: false, earliest: false });
    expect(steps[1]).toEqual({ kind: 'PLANNED', start: sched[1]!.start, finish: sched[1]!.finish, approx: true, earliest: false });
    expect(steps[2]).toMatchObject({ kind: 'PLANNED', approx: false });
    expect(ready).toMatchObject({ date: sched[2]!.finish, approx: true, earliest: false, tone: 'ok' });
    expect(ready!.spareDays).toBe(workingDaysBetween(sched[2]!.finish!, '2026-11-10', cal));
    // tight (2 working days or less) and late
    const tight = addSpare(sched[2]!.finish!, 2);
    expect(stepDates(p, '2026-10-20', cal, tight).ready!.tone).toBe('tight');
    const late = stepDates(p, '2026-10-20', cal, '2026-10-21').ready!;
    expect(late.tone).toBe('late');
    expect(late.spareDays).toBeLessThan(0);
  });
  it('a step past its plan has no expected finish; later dates are "at the earliest"', () => {
    const p = lp([step('a', 2), step('b', 3)], '2026-10-28');
    const { steps, ready } = stepDates(p, '2026-10-28', cal, '2026-11-20');
    expect(steps[0]).toMatchObject({ kind: 'OVER' });
    expect((steps[0] as { overDays: number }).overDays).toBeGreaterThan(0);
    expect(steps[1]).toMatchObject({ kind: 'PLANNED', start: '2026-10-28', earliest: true });
    expect(ready).toMatchObject({ earliest: true });
  });
  it('from the first step without a time onwards: date to be confirmed, never guessed', () => {
    const p = lp([step('a', 2), step('b', null), step('c', 1)], '2026-10-20');
    const { steps, ready } = stepDates(p, '2026-10-20', cal, '2026-11-10');
    expect(steps.map((s) => s.kind)).toEqual(['DUE', 'UNKNOWN', 'UNKNOWN']);
    expect(steps[1]).toEqual({ kind: 'UNKNOWN', noTime: true });
    expect(steps[2]).toEqual({ kind: 'UNKNOWN', noTime: false });
    expect(ready).toMatchObject({ date: null, missing: 'b', tone: 'unknown', spareDays: null });
  });
  it('done steps keep their own dates; no Ready row when all are done', () => {
    const done = completeCurrent([step('a', 1)], stepTime('2026-10-20', '2026-10-21'))! as PlannedStep[];
    const { steps, ready } = stepDates(lp(done, '2026-10-21'), '2026-10-21', cal, '2026-11-10');
    expect(steps).toEqual([{ kind: 'DONE' }]);
    expect(ready).toBeNull();
  });
});

/** A deadline `n` working days after `date`. */
function addSpare(date: string, n: number): string {
  let d = date;
  for (let i = 0; i < 20 && (workingDaysBetween(date, d, cal) ?? 0) < n; i++) d = new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return d;
}
