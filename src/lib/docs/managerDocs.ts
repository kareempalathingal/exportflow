/**
 * PDF models for the manager reports (confirmed 21 Oct 2026). Plain data;
 * drawn by pdf.ts. Clean wording, suitable to submit.
 */
import { formatDay } from '../jobOrders';
import {
  FITS_LABEL,
  NEXT_DELIVERY_DAYS,
  RISK_LABEL,
  workRowWhen,
  type DeliveryRow,
  type ManagementSummary,
  type RiskItem,
  type StockRow,
  type SupplierGroup,
  type WorkGroup,
} from '../managerReports';
import { formatQty, unitLabel } from '../units';
import { safeFileName, type DocModel, type DocTable } from './model';

const q = (n: number, unit: string) => `${formatQty(n)} ${unitLabel(unit)}`;
const pctOf = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '-');
const WORKING_DAYS_NOTE = 'Working days exclude the weekly off and company holidays.';

function deliveryWhen(r: DeliveryRow): string {
  const d = formatDay(r.deliveryDate);
  if (r.daysLeft < 0) return `${d} (passed ${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} ago)`;
  if (r.daysLeft === 0) return `${d} (today)`;
  return `${d} (in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'})`;
}

function deliveryTable(title: string, rows: DeliveryRow[], empty: string): DocTable {
  return {
    title,
    columns: [{ label: 'Delivery' }, { label: 'Job Order' }, { label: 'Basis' }, { label: 'Internal deadline' }, { label: 'Progress' }, { label: 'Expected finish' }, { label: 'In time?' }],
    rows: rows.map((r) => [
      deliveryWhen(r),
      `${r.joNumber}${r.status === 'DRAFT' ? ' (draft)' : ''}\n${r.customer || '-'}`,
      r.deliveryType,
      formatDay(r.internalDeadline),
      r.progress,
      r.outlook.fits === 'DRAFT' ? 'After plan approval' : r.outlook.expectedFinish ? formatDay(r.outlook.expectedFinish) : 'To be confirmed',
      FITS_LABEL[r.outlook.fits],
    ]),
    empty,
  };
}

export function deliveryDoc(s: { from: string; to: string; rows: DeliveryRow[] }, opts: { company: string; today: string; generatedAt: string }): DocModel {
  const passed = s.rows.filter((r) => r.daysLeft < 0);
  const coming = s.rows.filter((r) => r.daysLeft >= 0);
  return {
    title: 'Delivery Schedule',
    reference: `${formatDay(s.from)} - ${formatDay(s.to)}`,
    company: opts.company,
    meta: [
      ['Status as of', formatDay(opts.today)],
      ['Orders', `${coming.length} due in the period${passed.length ? ` · ${passed.length} past the delivery date and still open` : ''}`],
      ['Not in time', String(s.rows.filter((r) => r.outlook.fits === 'NO').length)],
    ],
    tables: [
      ...(passed.length ? [deliveryTable('Delivery date passed - still open', passed, '')] : []),
      deliveryTable('Deliveries in the period', coming, 'No deliveries in this period.'),
    ],
    notes: [
      '"In time?" compares the expected finish with the internal deadline. Unknown = some step time is not confirmed yet.',
      'Draft orders are not yet confirmed; their schedule starts after plan approval.',
      WORKING_DAYS_NOTE,
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `delivery-schedule_${s.from}_${s.to}.pdf`,
  };
}

function riskTable(items: RiskItem[], title: string, empty: string): DocTable {
  return {
    title,
    columns: [{ label: 'Level' }, { label: 'Job Order' }, { label: 'Internal deadline' }, { label: 'Delivery' }, { label: 'Why' }],
    rows: items.map((i) => [RISK_LABEL[i.level], `${i.joNumber}\n${i.customer || '-'}`, formatDay(i.internalDeadline), formatDay(i.deliveryDate), i.reasons.map((r) => `- ${r}`).join('\n')]),
    empty,
  };
}

export function riskDoc(items: RiskItem[], opts: { company: string; today: string; generatedAt: string }): DocModel {
  const n = (l: RiskItem['level']) => items.filter((i) => i.level === l).length;
  return {
    title: 'Orders at Risk',
    reference: formatDay(opts.today),
    company: opts.company,
    meta: [['Open orders listed', `${items.length} · ${n('LATE')} late · ${n('HIGH')} at risk · ${n('WATCH')} to watch`]],
    tables: [riskTable(items, 'Late first, then at risk, then to watch', 'No open order is late or at risk.')],
    notes: ['Late = a deadline has passed. At risk = expected to miss the internal deadline, far behind plan, or still in planning. Watch = slightly behind, a step over plan, or progress not tracked.', WORKING_DAYS_NOTE],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `orders-at-risk_${opts.today}.pdf`,
  };
}

export function summaryDoc(s: ManagementSummary, opts: { company: string; generatedAt: string }): DocModel {
  const c = s.completed;
  const o = s.openNow;
  return {
    title: 'Management Summary',
    reference: `${formatDay(s.from)} - ${formatDay(s.to)}`,
    company: opts.company,
    meta: [
      ['Orders received', `${s.received.count}${s.received.cancelledSince ? ` (${s.received.cancelledSince} since cancelled)` : ''}`],
      ['Orders confirmed', String(s.confirmed)],
      ['Orders completed', String(c.count)],
      ['By internal deadline', c.count ? `${c.onTimeInternal} of ${c.count} (${pctOf(c.onTimeInternal, c.count)})` : '-'],
      ['Before delivery date', c.count ? `${c.onTimeDelivery} of ${c.count} (${pctOf(c.onTimeDelivery, c.count)})` : '-'],
      ['Open orders today', `${o.onTrack} on track · ${o.behind} behind · ${o.late} late · ${o.notTracked} not tracked · ${o.drafts} in planning`],
    ],
    tables: [
      {
        title: 'Completed in the period',
        columns: [{ label: 'Job Order' }, { label: 'Customer' }, { label: 'Completed' }, { label: 'Internal deadline' }, { label: 'Delivery' }, { label: 'On time' }],
        rows: c.list.map((x) => [x.joNumber, x.customer || '-', formatDay(x.completedOn), formatDay(x.internal), formatDay(x.delivery), x.completedOn <= x.internal ? 'Yes' : x.completedOn <= x.delivery ? 'Within buffer' : 'No']),
        empty: 'No orders completed in this period.',
      },
      deliveryTable(`Deliveries in the next ${NEXT_DELIVERY_DAYS} days (from ${formatDay(s.today)})`, s.nextDeliveries, 'No deliveries in the next 7 days.'),
      riskTable(s.risks, s.riskTotal > s.risks.length ? `Main risks (${s.risks.length} of ${s.riskTotal} - see "Orders at risk")` : 'Main risks', 'No open order is late or at risk.'),
    ],
    notes: ['Open orders, deliveries and risks are as of the date the summary was made.', WORKING_DAYS_NOTE],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `management-summary_${s.from}_${s.to}.pdf`,
  };
}

export function workDoc(groups: WorkGroup[], opts: { company: string; today: string; until: string; generatedAt: string; department?: string }): DocModel {
  return {
    title: opts.department ? `Work List - ${opts.department}` : 'Department Work List',
    reference: `${formatDay(opts.today)} - ${formatDay(opts.until)}`,
    company: opts.company,
    meta: [['Steps', `${groups.reduce((a, g) => a + g.rows.length, 0)} running now or starting in the period`]],
    tables: groups.map((g) => ({
      title: g.name,
      columns: [{ label: 'Job Order' }, { label: 'Product' }, { label: 'Step' }, { label: 'Quantity', align: 'right' as const }, { label: 'When' }],
      rows: g.rows.map((r) => [r.joNumber, r.product, r.step, r.quantity ?? '-', workRowWhen(r)]),
      empty: 'Nothing.',
    })),
    notes: [
      'Each order is planned on its own: the shared capacity of a department is not checked yet.',
      'Dates follow the planned time of each step; "to be confirmed" where a step time is not known.',
      WORKING_DAYS_NOTE,
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `work-list_${opts.department ? `${safeFileName(opts.department)}_` : ''}${opts.today}.pdf`,
  };
}

const STOCK_STATE: Record<StockRow['state'], string> = { OK: 'OK', OVER: 'Over-allocated', MANUAL_ONLY: 'No count' };

export function stockDoc(rows: StockRow[], opts: { company: string; today: string; generatedAt: string; oldDays: number }): DocModel {
  const over = rows.filter((r) => r.state === 'OVER').length;
  const old = rows.filter((r) => r.oldCount).length;
  return {
    title: 'Stock Allocation',
    reference: formatDay(opts.today),
    company: opts.company,
    meta: [['Items', `${rows.length}${over ? ` · ${over} over-allocated` : ''}${old ? ` · ${old} with a count older than ${opts.oldDays} days` : ''}`]],
    tables: [
      {
        title: 'Counted stock and stock set aside for open orders',
        columns: [
          { label: 'Item' },
          { label: 'Counted', align: 'right' },
          { label: 'Set aside (confirmed)', align: 'right' },
          { label: 'Free', align: 'right' },
          { label: 'Orders' },
          { label: 'Status' },
        ],
        rows: rows.map((r) => [
          `${r.name}\n${r.type === 'PRODUCT' ? 'Product' : 'Raw material'}`,
          r.counted === null ? 'Not counted' : `${q(r.counted, r.unit)}\n${formatDay(r.countedOn)}${r.oldCount ? ' (old)' : ''}`,
          q(r.confirmed, r.unit),
          r.free === null ? '-' : q(r.free, r.unit),
          r.orders.map((o) => `${o.joNumber}${o.status === 'DRAFT' ? ' (draft)' : ''}: ${formatQty(o.qty)}`).join('\n') || '-',
          `${STOCK_STATE[r.state]}${r.oldCount ? '\nCount is old' : ''}${r.draft > 0 ? `\nDrafts: ${q(r.draft, r.unit)}` : ''}`,
        ]),
        empty: 'No stock counted or set aside.',
      },
    ],
    notes: [
      'Free = last count minus stock set aside on confirmed orders. Draft orders are shown for information only.',
      `A count older than ${opts.oldDays} days should be checked again. Stock is counted by hand; nothing is calculated automatically.`,
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `stock-allocation_${opts.today}.pdf`,
  };
}

export function toBuyBySupplierDoc(
  groups: SupplierGroup[],
  ordersWithErrors: string[],
  opts: { company: string; today: string; generatedAt: string; includeDrafts: boolean },
): DocModel {
  const provisional = groups.some((g) => g.rows.some((r) => r.row.provisional));
  return {
    title: 'To Buy - by Supplier',
    reference: opts.includeDrafts ? 'Confirmed and draft orders' : 'Confirmed orders',
    company: opts.company,
    meta: [['Suppliers', String(groups.filter((g) => g.id !== null).length)]],
    tables: groups.map((g) => ({
      title: g.name,
      columns: [{ label: 'Item' }, { label: 'Type' }, { label: 'To buy', align: 'right' as const }, { label: 'Orders' }, { label: 'Also from' }],
      rows: g.rows.map(({ row: r, others }) => [
        `${r.name}${r.provisional ? ' *' : ''}`,
        r.type === 'PRODUCT' ? 'Product' : 'Raw material',
        q(r.net, r.unit),
        r.orders.map((o) => `${o.joNumber}: ${formatQty(o.net)}`).join(', '),
        others.join(', ') || '-',
      ]),
      empty: 'Nothing.',
    })),
    notes: [
      'An item that more than one supplier can supply is listed under each of them; buy it once.',
      'No prices or lead times are included.',
      ...(provisional ? ['* Based on estimated or unconfirmed data.'] : []),
    ],
    provisional: ordersWithErrors.length > 0 || provisional || opts.includeDrafts,
    provisionalReasons: [
      ...(ordersWithErrors.length ? [`Incomplete data on ${ordersWithErrors.join(', ')} - those orders are not fully included`] : []),
      ...(opts.includeDrafts ? ['Includes draft orders'] : []),
      ...(provisional ? ['Some figures use estimated or unconfirmed data'] : []),
    ],
    generatedAt: opts.generatedAt,
    fileName: `to-buy_by-supplier_${opts.today}.pdf`,
  };
}
