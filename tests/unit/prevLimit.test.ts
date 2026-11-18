import { describe, expect, it } from 'vitest';
import { allocate, overPrevRows, type BoardRow } from '../../src/lib/processBoard';
import type { StepView } from '../../src/lib/route';
import { overPrevQuestion, prevLimit } from '../../src/lib/stepUpdates';

// 18 Nov 2026: a step may not silently go beyond what the step before has recorded. Sample values only.

const view = (key: string, label: string, qty: number | null, unit: string, made: number | null, extra: Record<string, unknown> = {}, state: StepView['state'] = 'NOW'): StepView =>
  ({ step: { key, label, qty, qtyUnit: unit, outputQty: made, processId: 'p', doneAt: null, ...extra }, state, startOn: null, doneOn: null, actualDays: null, overrunDays: null, startedOn: null, waitDays: null, workDays: null }) as unknown as StepView;

describe('previous step limit', () => {
  it('in proportion, also across units (base mat sq m → mat pcs)', () => {
    const vs = [view('a', 'Tufting', 240, 'sqm', 120), view('b', 'Shearing', 1000, 'pcs', 0)];
    expect(prevLimit(vs, 'b')).toMatchObject({ allowed: 500, unit: 'pcs', prevLabel: 'Tufting' });
    expect(overPrevQuestion(prevLimit(vs, 'b'), 400, 'pcs', 'Shearing')).toBeNull();
    expect(overPrevQuestion(prevLimit(vs, 'b'), 600, 'pcs', 'Shearing')).toContain('Save 600 pcs of Shearing anyway?');
  });
  it('no limit for the first step, a done previous step, nothing to make before, or a landing', () => {
    expect(prevLimit([view('a', 'A', 10, 'pcs', 0)], 'a')).toBeNull();
    expect(prevLimit([view('a', 'A', 10, 'pcs', 2, { doneAt: 'x' }, 'DONE'), view('b', 'B', 10, 'pcs', 0)], 'b')).toBeNull();
    expect(prevLimit([view('a', 'A', 0, 'pcs', 0), view('b', 'B', 10, 'pcs', 0)], 'b')).toBeNull();
    const land = [view('d', 'Dispatch for X', 10, 'pcs', 4, { processId: null, outsideOf: 'x', passThrough: true }), view('o', 'X (outside)', 10, 'pcs', null, { outside: true }), view('l', 'Landing from X', 10, 'pcs', 0, { processId: null, outsideOf: 'x' })];
    expect(prevLimit(land, 'l')).toBeNull();
    // dispatch is limited by the in-house step before it
    expect(prevLimit([view('t', 'Trimming', 10, 'pcs', 3), land[0]!], 'd')).toMatchObject({ allowed: 3 });
  });
  it('the dashboard fills what is covered first, then asks for the rest', () => {
    const row = (k: string, left: number, prevLeft: number | null) => ({ joId: 'j', lineId: k, stepKey: 's', open: true, unit: 'pcs', left, prevLeft, prevLabel: 'Trimming', made: 0, qty: left, joNumber: 'S-1', no: 1, product: k }) as unknown as BoardRow;
    const rows = [row('A', 100, 0), row('B', 100, 60)];
    const a = allocate(rows, 50, 'pcs');
    expect([...a.given.entries()].map(([, q]) => q)).toEqual([50]);
    expect(overPrevRows(rows, a)).toEqual([]);
    const b = allocate(rows, 80, 'pcs');
    expect(overPrevRows(rows, b).map((r) => r.product)).toEqual(['A']);
  });
});
