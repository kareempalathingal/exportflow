/**
 * Follow-up of everything awaited from outside, and "ready to start?" checks
 * (confirmed 5 Nov 2026, mockup canvas "Follow-up & readiness"). Built only from
 * data recorded in the app; nothing is guessed and nothing is sent.
 */
import { addWorkingDays, workingDaysBetween } from './calendar';
import { effectiveSupply, firstPromise, formatDay, type JobOrder, type JoStep } from './jobOrders';
import type { Process, Supplier } from './masters';
import { planMaterials } from './materials';
import { isBuiltIn, lineProgresses, lineSchedule, MATERIALS_KEY, PURCHASE_STEPS, type PlanContext, type PlannedStep, type StepView } from './route';
import { formatQty, unitLabel } from './units';

/** Working days before a step starts that the "ready to start?" check is shown (confirmed: one value for all). */
export const DEFAULT_ALERT_DAYS = 2;

export type AwaitedKind = 'JOB_WORK' | 'BOUGHT' | 'MATERIAL';
export type AwaitedBucket = 'LATE' | 'SOON' | 'LATER' | 'UNKNOWN';

export interface AwaitedItem {
  kind: AwaitedKind;
  bucket: AwaitedBucket;
  joId: string;
  joNumber: string;
  /** e.g. "Embossing", "Woven mat", "Dolomite". */
  what: string;
  /** Ordered product (for job work / bought items). */
  product: string | null;
  supplierId: string | null;
  poNo: string;
  expectedOn: string | null;
  /** The first date promised, when it was changed later. */
  promisedFirst: string | null;
  lateDays: number | null;
  /** e.g. "340 of 864 pcs still out", "1270 kg". */
  outstanding: string;
  /** Production waits for it (materials). */
  note: string;
  link: string;
}

const sum = (s: JoStep | PlannedStep | undefined) => (s?.outputLog ?? []).reduce((a, e) => a + e.qty, 0);

export function awaitedItems(jos: (JobOrder & { id: string })[], ctx: PlanContext, today: string, alertDays = DEFAULT_ALERT_DAYS): AwaitedItem[] {
  const soon = addWorkingDays(today, alertDays, ctx.cal) ?? today;
  const bucket = (d: string | null): AwaitedBucket => (!d ? 'UNKNOWN' : d < today ? 'LATE' : d <= soon ? 'SOON' : 'LATER');
  const late = (d: string | null) => (d && d < today ? Math.max(1, workingDaysBetween(d, today, ctx.cal) ?? 1) : null);
  const out: AwaitedItem[] = [];
  for (const jo of jos) {
    if (jo.status !== 'CONFIRMED') continue;
    const base = { joId: jo.id, joNumber: jo.joNumber };
    // Materials to buy (orders that track arrivals).
    if (jo.materialDates) {
      for (const r of planMaterials(jo, ctx.md).toBuy) {
        if (r.ordered || !(r.net > 1e-9)) continue;
        const d = jo.materialDates[r.key] ?? {};
        if (d.receivedOn) continue;
        const exp = d.expectedOn ?? null;
        out.push({
          ...base,
          kind: 'MATERIAL',
          bucket: bucket(exp),
          what: r.name,
          product: null,
          supplierId: d.supplierId ?? null,
          poNo: d.poNo ?? '',
          expectedOn: exp,
          promisedFirst: firstPromise(d) !== exp ? firstPromise(d) : null,
          lateDays: late(exp),
          outstanding: `${formatQty(r.net)} ${unitLabel(r.unit)}${d.orderedOn ? '' : ' · not ordered yet'}`,
          note: 'production waits for it',
          link: `/orders/${jo.id}?tab=materials`,
        });
      }
    }
    for (const line of jo.lines) {
      const ss = line.steps ?? [];
      // Bought items: Ordered (supplier, PO, date) → Received (part deliveries).
      if (effectiveSupply(line, ctx.md.products.get(line.productId)) === 'BUY') {
        const o = ss.find((s) => s.processId === null && !s.outsideOf && s.label === PURCHASE_STEPS[0]);
        const r = ss.find((s) => s.processId === null && !s.outsideOf && s.label === PURCHASE_STEPS[1]);
        if (o && r && !r.doneAt) {
          const exp = o.expectedOn ?? null;
          const got = sum(r);
          out.push({
            ...base,
            kind: 'BOUGHT',
            bucket: bucket(exp),
            what: line.productName,
            product: line.productName,
            supplierId: o.supplierId ?? null,
            poNo: o.poNo ?? '',
            expectedOn: exp,
            promisedFirst: firstPromise(o) !== exp ? firstPromise(o) : null,
            lateDays: late(exp),
            outstanding: `${got > 0 ? `${formatQty(Math.max(0, line.qty - got))} of ` : ''}${formatQty(line.qty)} ${unitLabel(line.unit)}${o.doneAt ? '' : ' · not ordered yet'}`,
            note: '',
            link: `/orders/${jo.id}?tab=products&line=${line.id}`,
          });
        }
      }
      // Outside work: sent out (dispatch) and not all back (landing).
      ss.forEach((s, i) => {
        if (!s.outside) return;
        const disp = ss[i - 1]?.outsideOf === s.processId ? ss[i - 1] : undefined;
        const land = ss[i + 1]?.outsideOf === s.processId ? ss[i + 1] : undefined;
        if (land?.doneAt || (!land && s.doneAt)) return;
        const started = !!(disp?.doneAt || disp?.startedAt || sum(disp) > 0 || s.expectedOn || s.supplierId);
        if (!started) return;
        const sent = sum(disp);
        const back = sum(land);
        const unit = disp?.outputLog?.[0]?.unit ?? land?.outputLog?.[0]?.unit ?? '';
        const exp = s.expectedOn ?? null;
        out.push({
          ...base,
          kind: 'JOB_WORK',
          bucket: bucket(exp),
          what: s.label.replace(/ \(outside\)$/, ''),
          product: s.forProduct || line.productName,
          supplierId: s.supplierId ?? null,
          poNo: s.poNo ?? '',
          expectedOn: exp,
          promisedFirst: firstPromise(s) !== exp ? firstPromise(s) : null,
          lateDays: late(exp),
          outstanding: sent > 0 ? `${formatQty(Math.max(0, sent - back))} of ${formatQty(sent)} ${unitLabel(unit)} still out` : 'not dispatched yet',
          note: '',
          link: `/orders/${jo.id}?tab=products&line=${line.id}`,
        });
      });
    }
  }
  const rank: Record<AwaitedBucket, number> = { LATE: 0, SOON: 1, LATER: 2, UNKNOWN: 3 };
  return out.sort((a, b) => rank[a.bucket] - rank[b.bucket] || (b.lateDays ?? 0) - (a.lateDays ?? 0) || (a.expectedOn ?? '').localeCompare(b.expectedOn ?? '') || a.joNumber.localeCompare(b.joNumber));
}

export const AWAITED_BUCKET_LABEL: Record<AwaitedBucket, string> = { LATE: 'Late', SOON: 'Next working days · ask now', LATER: 'Later', UNKNOWN: 'Date to be confirmed' };
export const AWAITED_KIND_LABEL: Record<AwaitedKind, string> = { JOB_WORK: 'Job work', BOUGHT: 'Bought items', MATERIAL: 'Materials' };

/** Plain text of the awaited list, for the share sheet. */
export function awaitedText(items: AwaitedItem[], supplierName: (id: string | null) => string, dateText: (d: string) => string, today: string): string {
  const out = [`Awaited from outside · ${dateText(today)}`];
  if (!items.length) out.push('', 'Nothing awaited.');
  for (const b of ['LATE', 'SOON', 'LATER', 'UNKNOWN'] as AwaitedBucket[]) {
    const list = items.filter((i) => i.bucket === b);
    if (!list.length) continue;
    out.push('', `${AWAITED_BUCKET_LABEL[b]}:`);
    for (const i of list) {
      const when = i.expectedOn ? (i.lateDays ? `${i.lateDays} working day${i.lateDays === 1 ? '' : 's'} late (expected ${dateText(i.expectedOn)})` : `expected ${dateText(i.expectedOn)}`) : 'date to be confirmed';
      out.push(`• ${i.joNumber} · ${i.what}${i.product && i.product !== i.what ? ` (${i.product})` : ''} · ${supplierName(i.supplierId)}${i.poNo ? ` · PO ${i.poNo}` : ''} · ${i.outstanding} · ${when}`);
    }
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Ready to start?
// ---------------------------------------------------------------------------

export interface StartCheck {
  joId: string;
  joNumber: string;
  lineId: string;
  lineIndex: number;
  product: string;
  stepKey: string;
  stepIndex: number; // index in the line's stored steps
  label: string;
  processId: string | null;
  start: string;
  /** Checks the app makes by itself. */
  auto: { ok: boolean; text: string }[];
  /** The process's own checklist, with what is ticked. */
  items: { item: string; on: string | null }[];
  ready: boolean;
  readyCount: number;
  total: number;
}

/**
 * Steps planned to start within `alertDays` working days (or already due and not
 * started): what the app can check itself, and the process's checklist.
 */
export function startChecks(
  jos: (JobOrder & { id: string })[],
  ctx: PlanContext,
  today: string,
  processes: Map<string, Process>,
  suppliers: Map<string, Supplier>,
  alertDays = DEFAULT_ALERT_DAYS,
): StartCheck[] {
  const until = addWorkingDays(today, alertDays, ctx.cal) ?? today;
  const out: StartCheck[] = [];
  for (const jo of jos) {
    if (jo.status !== 'CONFIRMED') continue;
    for (const { line, lp } of lineProgresses(jo, today, ctx)) {
      const raw = jo.lines.find((l) => l.id === line.id)?.steps ?? [];
      const lineIndex = jo.lines.findIndex((l) => l.id === line.id);
      const sched = lineSchedule(lp, today, ctx.cal);
      const mat = lp.steps.find((v) => v.step.key === MATERIALS_KEY);
      sched.forEach((st, k) => {
        const v = st.view;
        const s = v.step;
        if (isBuiltIn(s) || v.state === 'DONE' || s.startedAt || !st.start || st.start > until) return;
        if (s.passThrough && !s.outsideOf) return;
        const i = raw.findIndex((x) => x.key === s.key);
        if (i < 0) return;
        const auto: StartCheck['auto'] = [];
        if (mat && k > 0 && lp.steps.indexOf(mat) === k - 1) {
          auto.push(mat.state === 'DONE' ? { ok: true, text: 'Materials: all there' } : mat.step.readyBy && mat.step.readyBy <= st.start ? { ok: true, text: `Materials: expected by ${formatDay(mat.step.readyBy)}` } : { ok: false, text: `Materials: ${mat.step.note ?? 'not in time'}` });
        }
        const prev = prevReal(lp.steps, k);
        if (prev && !isBuiltIn(prev.step)) {
          auto.push(
            prev.state === 'DONE' ? { ok: true, text: `${prev.step.label}: done` } : prev.step.startedAt ? { ok: true, text: `${prev.step.label}: running` } : st.start <= today ? { ok: false, text: `${prev.step.label} has not started yet` } : { ok: true, text: `${prev.step.label}: planned to have work ready by the start` },
          );
        }
        // Outside work and bought items need a supplier and a date to follow up.
        const holder = s.outsideOf ? raw.find((x) => x.outside && x.processId === s.outsideOf) : s.outside ? raw[i] : s.processId === null && s.label === PURCHASE_STEPS[0] ? raw[i] : undefined;
        if (holder) {
          const sup = holder.supplierId ? suppliers.get(holder.supplierId) : undefined;
          auto.push(sup ? { ok: true, text: `${holder.outside ? 'Vendor' : 'Supplier'}: ${sup.name}${holder.poNo ? ` · PO ${holder.poNo}` : ''}` } : { ok: false, text: `No ${holder.outside ? 'vendor' : 'supplier'} recorded` });
          auto.push(holder.expectedOn ? { ok: true, text: `${holder.outside ? 'Expected back' : 'Expected'} ${formatDay(holder.expectedOn)}` } : { ok: false, text: 'No expected date' });
        }
        const pid = s.processId ?? s.outsideOf ?? null;
        const list = pid ? (processes.get(pid)?.readiness ?? []) : [];
        const ticks = new Map((raw[i]!.readiness ?? []).map((r) => [r.item, r.on]));
        const items = list.map((item) => ({ item, on: ticks.get(item) ?? null }));
        const readyCount = auto.filter((a) => a.ok).length + items.filter((x) => x.on).length;
        const total = auto.length + items.length;
        out.push({
          joId: jo.id,
          joNumber: jo.joNumber,
          lineId: line.id,
          lineIndex,
          product: s.forProduct || line.productName,
          stepKey: s.key,
          stepIndex: i,
          label: s.label,
          processId: pid,
          start: st.start,
          auto,
          items,
          ready: readyCount === total,
          readyCount,
          total,
        });
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || Number(a.ready) - Number(b.ready) || a.joNumber.localeCompare(b.joNumber));
}

function prevReal(views: StepView[], k: number): StepView | undefined {
  let j = k - 1;
  while (j >= 0 && views[j]!.step.passThrough) j--;
  return j >= 0 ? views[j] : undefined;
}
