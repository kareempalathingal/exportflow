/** Long lists collapse into one row, grouped (confirmed 4 Nov 2026). */
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { groupEntries, LongList } from '../../src/components/LongList';
import { usedForText } from '../../src/lib/docs/model';

const entries = (n: number, group?: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, group: group?.(i), node: `Item ${i}` }));

describe('long lists', () => {
  it('short lists stay inline; long ones become one row that opens on tap', () => {
    expect(renderToString(<LongList as="comma" summary="3 products" entries={entries(3)} />)).not.toContain('details');
    const html = renderToString(<LongList as="comma" summary="54 products" entries={entries(54, (i) => (i < 35 ? 'Printed' : i < 50 ? 'Plain' : ''))} />);
    expect(html).toContain('<details class="long-list">');
    expect(html).toContain('54 products');
    expect(html).not.toContain(' open');
  });
  it('groups biggest first, items without a group last', () => {
    expect(groupEntries(entries(54, (i) => (i < 35 ? 'Printed' : i < 50 ? 'Plain' : ''))).map((g) => [g.name, g.entries.length])).toEqual([
      ['Printed', 35],
      ['Plain', 15],
      ['Other', 4],
    ]);
  });
  it('the empty text shows when there is nothing', () => {
    expect(renderToString(<LongList summary="0" entries={[]} empty="no product yet" />)).toBe('no product yet');
  });
  it('"For" says "all N ordered products" when an item is needed for every product of a larger order', () => {
    const r = { usedFor: ['A', 'B', 'C', 'D'], via: [], ordered: false };
    expect(usedForText(r, 4)).toBe('all 4 ordered products');
    expect(usedForText(r, 5)).toBe('A, B, C, D');
    expect(usedForText({ usedFor: ['A', 'B'], via: ['Yarn'], ordered: false }, 2)).toBe('A, B (via Yarn)');
  });
});
