import { describe, expect, it } from 'vitest';
import { addWorkingDays, calendarFrom, DEFAULT_CALENDAR, dayOff, monthGrid, shiftMonth, weekday, workingDaysBetween, workingDaysInclusive } from '../../src/lib/calendar';

const cal = { weeklyOff: [0], holidays: { '2026-11-04': 'Diwali (sample)' } };

describe('working-day calendar', () => {
  it('knows weekdays, Sundays and holidays', () => {
    expect(weekday('2026-11-01')).toBe(0); // Sunday
    expect(weekday('2026-10-20')).toBe(2); // Tuesday
    expect(dayOff('2026-11-01', cal)).toEqual({ off: true, reason: 'Sunday' });
    expect(dayOff('2026-11-04', cal)).toEqual({ off: true, reason: 'Diwali (sample)' });
    expect(dayOff('2026-11-05', cal)).toEqual({ off: false });
  });
  it('counts working days after the start up to the end, both directions', () => {
    expect(workingDaysBetween('2026-11-02', '2026-11-09', DEFAULT_CALENDAR)).toBe(6); // Sun 8 Nov left out
    expect(workingDaysBetween('2026-11-02', '2026-11-09', cal)).toBe(5); // and the holiday
    expect(workingDaysBetween('2026-11-09', '2026-11-02', cal)).toBe(-5);
    expect(workingDaysBetween('2026-11-02', '2026-11-02', cal)).toBe(0);
    expect(workingDaysInclusive('2026-11-02', '2026-11-03', cal)).toBe(2);
    expect(workingDaysBetween('bad', '2026-11-02', cal)).toBeNull();
  });
  it('adds and subtracts working days, skipping days off', () => {
    expect(addWorkingDays('2026-11-03', 1, cal)).toBe('2026-11-05');
    expect(addWorkingDays('2026-11-07', 1, cal)).toBe('2026-11-09');
    expect(addWorkingDays('2026-11-09', -1, cal)).toBe('2026-11-07');
    expect(addWorkingDays('2026-11-03', 0.5, cal)).toBe('2026-11-05'); // half a day still uses that day
    expect(addWorkingDays('2026-11-03', 0, cal)).toBe('2026-11-03');
  });
  it('reads stored data safely and never allows a week with no working day', () => {
    expect(calendarFrom(null)).toEqual(DEFAULT_CALENDAR);
    expect(calendarFrom({ weeklyOff: [0, 6], holidays: { '2026-12-25': 'Christmas', bad: 'x' } })).toEqual({ weeklyOff: [0, 6], holidays: { '2026-12-25': 'Christmas' } });
    expect(calendarFrom({ weeklyOff: [0, 1, 2, 3, 4, 5, 6], holidays: {} }).weeklyOff).toEqual([0]);
  });
  it('builds a Sunday-first month grid', () => {
    const g = monthGrid('2026-11');
    expect(g[0]![0]).toBe('2026-11-01');
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(monthGrid('2026-10')[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});
