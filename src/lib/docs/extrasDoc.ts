import type { WorkCalendar } from '../calendar';
import { formatDay, type JobOrder } from '../jobOrders';
import { checkDue, itemState } from '../orderExtras';
import { formatQty, unitLabel } from '../units';
import { milestoneSummary, PHASE_LABEL, type MilestoneView } from '../milestones';
import type { PlanContext } from '../route';
import type { DocTable, DocTone } from './model';

/**
 * The WO Checklist tab in documents (18 Nov 2026): items to arrange outside the BOM and the customer's
 * requirements. Only tables for lists that have entries. No prices (none are kept).
 */
export function orderExtrasTables(jo: Pick<JobOrder, 'orderItems' | 'checklist' | 'deliveryDate'>, opts: { today: string; cal: WorkCalendar; processName?: (id: string) => string; supplierName?: (id: string) => string }): DocTable[] {
  const out: DocTable[] = [];
  const items = jo.orderItems ?? [];
  if (items.length) {
    const tones: (DocTone | null)[] = [];
    const rows = items.map((it) => {
      const st = itemState(it, opts.today);
      tones.push(st === 'LANDED' ? 'done' : st === 'LATE' ? 'late' : st === 'EXPECTED' ? null : 'unknown');
      const status =
        st === 'LANDED' ? `Landed ${formatDay(it.landedOn)}`
        : st === 'LATE' ? `Late - expected ${formatDay(it.expectedOn)}`
        : st === 'EXPECTED' ? `Expected ${formatDay(it.expectedOn)}`
        : st === 'ORDERED' ? `Ordered${it.orderedOn ? ` ${formatDay(it.orderedOn)}` : ''} - date to be confirmed`
        : 'To order';
      const sup = [it.supplierId ? (opts.supplierName?.(it.supplierId) ?? '') : '', it.poNo ? `PO ${it.poNo}` : ''].filter(Boolean).join(' · ');
      return [it.item, it.qty ? `${formatQty(it.qty)} ${unitLabel(it.unit ?? 'pcs')}` : '-', sup || '-', status, it.neededAt ? (opts.processName?.(it.neededAt) ?? '-') : '-'];
    });
    out.push({ title: 'Items to arrange for this order', columns: [{ label: 'Item' }, { label: 'Qty', align: 'right' }, { label: 'Supplier / PO' }, { label: 'Status' }, { label: 'Needed before' }], rows, rowTones: tones, empty: '' });
  }
  const checks = jo.checklist ?? [];
  if (checks.length) {
    const tones: (DocTone | null)[] = [];
    const rows = checks.map((c) => {
      const due = checkDue(c, jo, opts.cal);
      const late = !c.doneOn && !!due && due < opts.today;
      tones.push(c.doneOn ? 'done' : late ? 'late' : null);
      return [c.text, due ? formatDay(due) : 'No date', c.doneOn ? `Done ${formatDay(c.doneOn)}` : late ? 'Overdue' : 'Open', c.note ?? ''];
    });
    out.push({ title: 'Customer requirements', columns: [{ label: 'Requirement' }, { label: 'Due' }, { label: 'Status' }, { label: 'Note' }], rows, rowTones: tones, empty: '' });
  }
  return out;
}

/** Order flow milestones (18 Nov 2026): one table, phase 1 then phase 3; only when the WO has them. */
export function milestonesTable(jo: JobOrder, opts: { today: string; ctx: PlanContext; departmentName?: (id: string) => string }): DocTable[] {
  if (!jo.milestones?.length) return [];
  const sum = milestoneSummary(jo, opts.today, opts.ctx);
  const tones: (DocTone | null)[] = [];
  const row = (v: MilestoneView) => {
    tones.push(v.state === 'DONE' ? 'done' : v.state === 'LATE' ? 'late' : v.state === 'NO_DATE' ? 'unknown' : null);
    const status = v.state === 'DONE' ? `Done${v.doneOn ? ` ${formatDay(v.doneOn)}` : ''}` : v.state === 'NOT_NEEDED' ? 'Not needed' : v.state === 'LATE' ? 'Overdue' : v.state === 'NO_DATE' ? 'Date to be set' : 'Open';
    return [PHASE_LABEL[v.m.phase], v.m.name, v.due ? formatDay(v.due) : 'to be set', status, v.m.departmentId ? (opts.departmentName?.(v.m.departmentId) ?? '') : '', v.m.note ?? ''];
  };
  const rows = [...sum.before.map(row), ...sum.after.map(row)];
  return [{ title: `Milestones (${sum.done} of ${sum.total} done)`, columns: [{ label: 'Phase' }, { label: 'Milestone' }, { label: 'Due' }, { label: 'Status' }, { label: 'Department' }, { label: 'Note' }], rows, rowTones: tones, empty: '' }];
}
