import { describe, expect, it } from 'vitest';
import { itemMatchesSearch } from '../../src/lib/itemGroups';

describe('itemMatchesSearch (Calculator → By product)', () => {
  const item = { name: 'Tufted mat 40 × 60 (sample)', family: 'Coir tufted PRINTED', category: 'Doormats', code: 'TM-01', erpCode: 'ERP123' };
  it('matches name, family, code and ERP code, every word', () => {
    expect(itemMatchesSearch(item, '')).toBe(true);
    expect(itemMatchesSearch(item, 'tufted printed')).toBe(true);
    expect(itemMatchesSearch(item, 'erp123')).toBe(true);
    expect(itemMatchesSearch(item, 'tm-01')).toBe(true);
    expect(itemMatchesSearch(item, 'tufted woven')).toBe(false);
  });
  it('treats 40x60, 40 x 60 and 40 × 60 alike', () => {
    expect(itemMatchesSearch(item, '40x60')).toBe(true);
    expect(itemMatchesSearch(item, '40 x 60')).toBe(true);
    expect(itemMatchesSearch(item, '45x75')).toBe(false);
  });
});
