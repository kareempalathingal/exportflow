import { describe, expect, it } from 'vitest';
import type { JoStep } from '../../src/lib/jobOrders';
import type { StepView } from '../../src/lib/route';
import { canEnterOutput, doneUpdate, outputUpdate, withLineSteps } from '../../src/lib/stepUpdates';

const st = (key: string, extra: Partial<JoStep> = {}): JoStep => ({ key, label: key, processId: 'p', perDay: 100, perDayUnit: 'pcs', fixedDays: null, status: 'USER_PROVIDED', doneAt: null, ...extra }) as JoStep;
const view = (s: JoStep, extra: Partial<StepView> = {}): StepView =>
  ({ step: { ...s, forProduct: 'Mat', qty: 300, qtyUnit: 'pcs', outputQty: 0, plannedDays: 3 }, state: 'NOW', startOn: '2026-11-16', doneOn: null, actualDays: 1, overrunDays: 0, startedOn: null, waitDays: null, workDays: null, ...extra }) as StepView;

describe('step updates shared by the WO page and Today (17 Nov 2026)', () => {
  const raw = [st('Tufting'), st('Shearing')];
  it('"done" on a date gives the history text of the WO page', () => {
    const u = doneUpdate(raw, 'Tufting', 'Mat', '2026-11-17', '2026-11-17')!;
    expect(u.steps[0]!.doneAt).toBeTruthy();
    expect(u.what).toBe('Tufting done today (Mat)');
    expect(doneUpdate(raw, 'Tufting', 'Mat', '2026-11-16', '2026-11-17')!.what).toBe('Tufting done 16 Nov 2026 (Mat)');
  });
  it('the whole quantity asks before marking done; otherwise only the output is saved', () => {
    const v = view(raw[0]!);
    let asked = '';
    const whole = outputUpdate(raw, 0, v, { on: '2026-11-17', qty: 300, unit: 'pcs', at: 'a' }, true, 'Mat', '2026-11-17', (q) => ((asked = q), true))!;
    expect(asked).toBe('Whole quantity made: mark Tufting done?');
    expect(whole.steps[0]!.doneAt).toBeTruthy();
    expect(whole.what).toMatch(/; done \(Mat\)$/);
    const part = outputUpdate(raw, 0, v, { on: '2026-11-17', qty: 100, unit: 'pcs', at: 'a' }, true, 'Mat', '2026-11-17', () => true)!;
    expect(part.steps[0]!.doneAt).toBeFalsy();
    expect(part.steps[0]!.outputLog).toHaveLength(1);
    const no = outputUpdate(raw, 0, v, { on: '2026-11-17', qty: 300, unit: 'pcs', at: 'a' }, true, 'Mat', '2026-11-17', () => false)!;
    expect(no.steps[0]!.doneAt).toBeFalsy(); // the app never marks done by itself
  });
  it('output only on a running or started step with a quantity', () => {
    expect(canEnterOutput(view(raw[0]!))).toBe(true);
    expect(canEnterOutput(view(raw[1]!, { state: 'TODO' }))).toBe(false);
    expect(withLineSteps({ lines: [{ id: 'a', steps: [] } as never, { id: 'b' } as never] }, 'b', raw)[1]!.steps).toBe(raw);
  });
});
