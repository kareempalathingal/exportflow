import { describe, expect, it } from 'vitest';
import { convertItemAll, convertStandard, evaluate, formatResult, showQty, unitsOf } from '../../src/lib/calc';
import { productContext, type Product } from '../../src/lib/masters';
import { buildSampleData } from '../../src/lib/sampleData';
import { availableUnits, completeFacts } from '../../src/lib/units';

const val = (e: string) => {
  const r = evaluate(e);
  return r.ok ? r.value : r.error;
};

describe('calculator', () => {
  it('does arithmetic with the usual order and brackets', () => {
    expect(val('2+3×4')).toBe(14);
    expect(val('(2+3)×4')).toBe(20);
    expect(val('10÷4')).toBe(2.5);
    expect(val('−5+2')).toBe(-3);
    expect(val('0.1+0.2')).toBe(0.3); // no float noise
    expect(val('1,200 × 0.24')).toBe(288);
  });
  it('percent works like a phone calculator', () => {
    expect(val('200+10%')).toBe(220);
    expect(val('200−10%')).toBe(180);
    expect(val('200×10%')).toBe(20);
    expect(val('50%')).toBe(0.5);
    expect(val('(1200×0.24)+5%')).toBe(302.4);
  });
  it('reports mistakes instead of guessing', () => {
    expect(val('5÷0')).toBe('Cannot divide by 0');
    expect(val('2+')).toBe('Incomplete');
    expect(val('(2+3')).toBe('Missing )');
    expect(val('2)')).toBe('Extra )');
    expect(val('1.2.3')).toMatch(/Bad number/);
    expect(val('2^3')).toMatch(/Unknown sign/);
    expect(evaluate('').ok).toBe(false);
  });
  it('formats results for the display', () => {
    expect(formatResult(1234567.5)).toBe('12,34,567.5');
    expect(showQty(10.7639104)).toBe('10.7639');
    expect(showQty(2083.3333)).toBe('2,083.33');
  });
});

describe('unit converter', () => {
  it('converts within one kind', () => {
    const r = convertStandard(1, 'sqm', 'sqft');
    expect(r.ok && r.value).toBeCloseTo(10.7639, 4);
    expect(convertStandard(1, 'kg', 'sqm').ok).toBe(false);
    const sqin = convertStandard(1, 'sqm', 'sqin');
    expect(sqin.ok && sqin.value).toBeCloseTo(1550.0031, 3);
    expect(unitsOf('area')).toEqual(['sqcm', 'sqm', 'sqin', 'sqft']); // sq yd not offered
    expect(convertStandard(1, 'sqyd', 'sqft').ok).toBe(true); // …but older records still convert
  });
  it('converts a product between pieces, area and weight using its size and GSM', () => {
    const writes = buildSampleData('2026-10-21');
    const mat = writes.find((w) => w.docId === 'sample_p_mat')!.data as unknown as Product;
    const ctx = productContext(mat);
    const units = availableUnits(completeFacts(ctx));
    const rows = convertItemAll(500, 'sqm', ctx, units);
    const pcs = rows.find((r) => r.unit === 'pcs')!;
    expect(pcs.value).toBeCloseTo(500 / 0.24, 3);
    expect(pcs.via).toEqual(['size']);
    expect(rows.some((r) => r.unit === 'sqm')).toBe(false); // the "from" unit is not repeated
  });
});
