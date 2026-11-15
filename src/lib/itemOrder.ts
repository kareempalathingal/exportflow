/**
 * Item priority (confirmed 15 Nov 2026): texts and the all-orders effect list.
 * The rule itself lives in `scheduleOrder()` (src/lib/route.ts, ItemOrderRule).
 */
import type { DocModel } from './docs/model';
import { formatDay, isEditable, type JobOrder } from './jobOrders';
import type { MasterData, Process } from './masters';
import { buildLineSteps, orderPlan, type ItemOrder, type PlanContext } from './route';

export const ITEM_ORDER_RULE = 'Rush first, then the item with more work left';

/** The rule in one line, for screens and plans. */
export function itemOrderRule(io: ItemOrder): string {
  return io.items.some((i) => i.rush) ? 'Rush, then more work first' : 'More work first';
}

export type GainTone = 'ok' | 'warn' | 'neutral';

/** "3 working days earlier" (than the listed order), "2 working days later", "same", or null when not known. */
export function gainText(gainDays: number | null): { text: string; tone: GainTone } | null {
  if (gainDays === null) return null;
  if (gainDays === 0) return { text: 'same as listed order', tone: 'neutral' };
  const n = Math.abs(gainDays);
  const days = `${n} working day${n === 1 ? '' : 's'}`;
  return gainDays > 0 ? { text: `${days} earlier`, tone: 'ok' } : { text: `${days} later`, tone: 'warn' };
}

/** "9 days left", "4 days left (part unknown)", "work left not known yet". */
export function daysLeftText(i: ItemOrder['items'][number]): string {
  const d = i.daysLeft;
  if (i.partUnknown && d === 0) return 'work left not known yet';
  return `${d} day${d === 1 ? '' : 's'} left${i.partUnknown ? ' (part unknown)' : ''}`;
}

/** Drafts are planned from the product routes as they are now (like the proposed plan). */
export function withDraftSteps(jo: JobOrder, md: MasterData, processes: Map<string, Process>): JobOrder {
  if (jo.status !== 'DRAFT') return jo;
  return { ...jo, lines: jo.lines.map((l) => (l.steps?.length ? l : { ...l, steps: buildLineSteps(l, md, processes) })) };
}

export interface ItemPriorityRow {
  id: string;
  joNumber: string;
  customer: string;
  draft: boolean;
  items: number;
  readyListed: string | null;
  ready: string | null;
  gainDays: number | null;
}

/** Open WOs (drafts and confirmed) with two or more items that have steps: listed order vs priority. */
export function itemPriorityRows(jos: (JobOrder & { id: string })[], today: string, ctx: PlanContext, processes: Map<string, Process>): ItemPriorityRow[] {
  const rows: ItemPriorityRow[] = [];
  for (const jo of jos) {
    if (!isEditable(jo.status)) continue;
    const io = orderPlan(withDraftSteps(jo, ctx.md, processes), today, ctx).itemOrder;
    if (io.items.length < 2) continue;
    rows.push({ id: jo.id, joNumber: jo.joNumber, customer: jo.customerName, draft: jo.status === 'DRAFT', items: io.items.length, readyListed: io.readyListed, ready: io.ready, gainDays: io.gainDays });
  }
  // Biggest change first (either way), unknown last.
  return rows.sort((a, b) => (b.gainDays === null ? -1 : Math.abs(b.gainDays)) - (a.gainDays === null ? -1 : Math.abs(a.gainDays)) || a.joNumber.localeCompare(b.joNumber));
}

/** "2 earlier · 1 same · 1 later". */
export function itemPrioritySummary(rows: ItemPriorityRow[]): string {
  if (!rows.length) return 'No open WO with two or more items';
  const n = (f: (g: number) => boolean) => rows.filter((r) => r.gainDays !== null && f(r.gainDays)).length;
  const unknown = rows.filter((r) => r.gainDays === null).length;
  return [
    [n((g) => g > 0), 'earlier'],
    [n((g) => g === 0), 'same'],
    [n((g) => g < 0), 'later'],
    [unknown, 'not known yet'],
  ]
    .filter(([c]) => (c as number) > 0)
    .map(([c, w]) => `${c} ${w}`)
    .join(' · ');
}

const diffText = (r: ItemPriorityRow) => (r.gainDays === null ? 'not known yet' : r.gainDays === 0 ? 'same' : r.gainDays > 0 ? `${r.gainDays} earlier` : `${-r.gainDays} later`);
const dayOrDash = (d: string | null) => (d ? formatDay(d) : 'to be confirmed');

/** Plain text for the share sheet. */
export function itemPriorityText(rows: ItemPriorityRow[], today: string): string {
  const out = [`Item priority: effect · ${formatDay(today)}`, `Rule: ${ITEM_ORDER_RULE}. Working days; ready = last item ready.`, itemPrioritySummary(rows)];
  for (const r of rows) out.push(`• ${r.joNumber}${r.draft ? ' (draft)' : ''}: listed order ${dayOrDash(r.readyListed)} → with priority ${dayOrDash(r.ready)} (${diffText(r)})`);
  return out.join('\n');
}

export function itemPriorityDoc(rows: ItemPriorityRow[], opts: { company: string; today: string; generatedAt: string }): DocModel {
  return {
    title: 'Item Priority - Effect',
    reference: `As of ${formatDay(opts.today)}`,
    company: opts.company,
    meta: [
      ['Rule', ITEM_ORDER_RULE],
      ['Open WOs', `${rows.length} · ${itemPrioritySummary(rows)}`],
    ],
    tables: [
      {
        title: 'Listed order vs priority',
        columns: [{ label: 'WO' }, { label: 'Customer' }, { label: 'Items', align: 'right' }, { label: 'Listed order' }, { label: 'With priority' }, { label: 'Difference' }],
        rows: rows.map((r) => [`${r.joNumber}${r.draft ? '\nDraft' : ''}`, r.customer || '-', String(r.items), dayOrDash(r.readyListed), dayOrDash(r.ready), diffText(r)]),
        empty: 'No open WO with two or more items.',
      },
    ],
    notes: [
      'Ready = the day the last item of the WO is ready, in working days (Sundays and company holidays left out).',
      'Each WO is planned on its own; waiting behind other WOs is not included yet. Drafts are planned from the product routes as they are now.',
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `item-priority_${opts.today}.pdf`,
  };
}
