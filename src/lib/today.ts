/**
 * "Today" summary (confirmed 21 Oct 2026): what needs attention today and in
 * the next 2 working days. Shown on Home and shareable as text or PDF; the
 * app never sends it by itself. Pure and deterministic.
 */
import { addWorkingDays, dayOff, workingDaysBetween, type WorkCalendar } from './calendar';
import { addDays, daysBetween, formatDay, type JobOrder } from './jobOrders';
import { DEFAULT_PLANNING_DAYS, lineProgresses, type PlanContext } from './route';
import { formatQty } from './units';

export const SOON_WORKING_DAYS = 2;

export type TodayWhen = 'OVERDUE' | 'TODAY' | 'SOON';

export interface TodayItem {
  when: TodayWhen;
  date: string | null;
  text: string;
  link: string;
}

export interface TodaySummary {
  today: string;
  soonUntil: string;
  items: TodayItem[];
}

const ORDER: Record<TodayWhen, number> = { OVERDUE: 0, TODAY: 1, SOON: 2 };

export function buildToday(args: {
  jobOrders: (JobOrder & { id: string })[];
  ctx: PlanContext;
  today: string;
  backupDue?: { days: number | null } | null;
}): TodaySummary {
  const { today, ctx } = args;
  const cal: WorkCalendar = ctx.cal;
  const soonUntil = addWorkingDays(today, SOON_WORKING_DAYS, cal) ?? today;
  const items: TodayItem[] = [];
  const when = (date: string): TodayWhen | null => (date < today ? 'OVERDUE' : date === today ? 'TODAY' : date <= soonUntil ? 'SOON' : null);
  const day = (d: string) => (d === today ? 'today' : formatDay(d));

  const planningDays = ctx.planningDays === undefined ? DEFAULT_PLANNING_DAYS : ctx.planningDays;
  for (const jo of args.jobOrders) {
    const link = `/orders/${jo.id}`;
    // Drafts: planning is the first stage of the order clock.
    if (jo.status === 'DRAFT' && planningDays !== null) {
      const used = workingDaysBetween(jo.receivedDate, today, cal) ?? 0;
      const due = addWorkingDays(jo.receivedDate, planningDays, cal) ?? today;
      if (used > planningDays) items.push({ when: 'OVERDUE', date: null, text: `${jo.joNumber}: still in planning after ${formatQty(used)} working days (benchmark ${formatQty(planningDays)}) — confirm the plan`, link });
      else if (when(due) === 'TODAY' || when(due) === 'SOON') items.push({ when: when(due)!, date: due, text: `${jo.joNumber}: plan to be confirmed by ${day(due)}`, link });
      continue;
    }
    if (jo.status !== 'CONFIRMED') continue;
    const d = jo.deadline.internalDeadline;
    const w = when(d);
    if (w === 'OVERDUE') {
      const n = daysBetween(d, today) ?? 0;
      items.push({ when: w, date: d, text: `${jo.joNumber}: internal deadline passed ${n} day${n === 1 ? '' : 's'} ago (${formatDay(d)})`, link });
    } else if (w) items.push({ when: w, date: d, text: `${jo.joNumber}: internal deadline ${day(d)}`, link });
    const dw = when(jo.deliveryDate);
    if (dw && dw !== 'OVERDUE') items.push({ when: dw, date: jo.deliveryDate, text: `${jo.joNumber}: customer delivery ${day(jo.deliveryDate)}`, link });

    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      const cur = lp.current;
      if (!cur) continue;
      const name = `${jo.joNumber} · ${line.productName}: ${cur.step.label}`;
      if (cur.overrunDays !== null && cur.overrunDays > 0) {
        items.push({ when: 'OVERDUE', date: null, text: `${name} running ${formatQty(cur.overrunDays)} working day${cur.overrunDays === 1 ? '' : 's'} over plan`, link: `${link}?tab=products` });
      } else if (cur.step.plannedDays !== null && cur.startOn) {
        const end = addWorkingDays(cur.startOn, cur.step.plannedDays, cal);
        const ew = end ? when(end) : null;
        if (end && (ew === 'TODAY' || ew === 'SOON')) items.push({ when: ew, date: end, text: `${name} should finish ${day(end)}`, link: `${link}?tab=products` });
      }
    }
  }

  // Company holidays coming up (Sundays are known; only holidays are listed).
  for (let d = addDays(today, 1)!; d <= soonUntil; d = addDays(d, 1)!) {
    const off = dayOff(d, cal);
    if (off.off && d in cal.holidays) items.push({ when: 'SOON', date: d, text: `${formatDay(d)}: ${off.reason} (no work)`, link: '/' });
  }

  if (args.backupDue) {
    items.push({ when: 'TODAY', date: null, text: args.backupDue.days === null ? 'Backup: none taken on this phone yet' : `Backup: last one ${args.backupDue.days} days ago`, link: '/settings' });
  }

  items.sort((a, b) => ORDER[a.when] - ORDER[b.when] || (a.date ?? '').localeCompare(b.date ?? '') || a.text.localeCompare(b.text));
  return { today, soonUntil, items };
}

const HEAD: Record<TodayWhen, string> = { OVERDUE: 'Overdue / running late', TODAY: 'Today', SOON: 'Next 2 working days' };

/** Plain text to paste into WhatsApp or email. */
export function todayText(s: TodaySummary, company: string): string {
  const out = [`ExportFlow · ${company ? `${company} · ` : ''}${formatDay(s.today)}`];
  if (s.items.length === 0) out.push('', 'Nothing due today or in the next 2 working days.');
  for (const w of ['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]) {
    const list = s.items.filter((i) => i.when === w);
    if (!list.length) continue;
    out.push('', `${HEAD[w]}:`, ...list.map((i) => `• ${i.text}`));
  }
  return out.join('\n');
}

export const TODAY_HEADINGS = HEAD;
