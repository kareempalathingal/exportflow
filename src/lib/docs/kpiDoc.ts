/** KPI report PDF (confirmed 26 Oct 2026). */
import { formatDay } from '../jobOrders';
import { delta, fmtDays, fmtPct, fmtThroughput, toneFor, type FactoryKpi, type KpiReport, type KpiTargets, type KpiTone } from '../kpi';
import { formatQty } from '../units';
import type { DocModel } from './model';

const TONE: Record<Exclude<KpiTone, null>, string> = { ok: 'Met', warn: 'Close', bad: 'Below' };

interface Row {
  label: string;
  get: (f: FactoryKpi) => number | null;
  fmt: (n: number | null) => string;
  target?: number | null;
  higher: boolean;
  unit: string;
}

export function kpiRows(t: KpiTargets): Row[] {
  return [
    { label: 'Orders completed', get: (f) => f.completed, fmt: (n) => (n === null ? '—' : String(n)), higher: true, unit: '' },
    { label: 'On-time delivery', get: (f) => f.onTimeDeliveryPct, fmt: fmtPct, target: t.onTimeDeliveryPct, higher: true, unit: ' pts' },
    { label: 'Done by internal deadline', get: (f) => f.onTimeInternalPct, fmt: fmtPct, target: t.onTimeInternalPct, higher: true, unit: ' pts' },
    { label: 'Steps on time', get: (f) => f.onTimeStepPct, fmt: fmtPct, target: t.onTimeStepPct, higher: true, unit: ' pts' },
    { label: 'Efficiency (planned ÷ actual time)', get: (f) => f.efficiencyPct, fmt: fmtPct, target: t.efficiencyPct, higher: true, unit: ' pts' },
    { label: 'Average delay per step', get: (f) => f.avgDelay, fmt: fmtDays, target: t.maxAvgDelayDays, higher: false, unit: ' d' },
    { label: 'Average wait before a step', get: (f) => f.avgWait, fmt: fmtDays, target: t.maxAvgWaitDays, higher: false, unit: ' d' },
    { label: 'Average buffer used', get: (f) => f.avgBufferUsed, fmt: fmtDays, higher: false, unit: ' d' },
    { label: 'Planning within benchmark', get: (f) => f.planningOnTimePct, fmt: fmtPct, target: t.planningOnTimePct, higher: true, unit: ' pts' },
    { label: 'Average planning time', get: (f) => f.avgPlanningDays, fmt: fmtDays, higher: false, unit: ' d' },
    { label: 'Plan changes per order after confirmation', get: (f) => f.avgChanges, fmt: (n) => (n === null ? '—' : formatQty(n)), higher: false, unit: '' },
  ];
}

const signed = (n: number | null, unit: string) => (n === null || n === 0 ? '—' : `${n > 0 ? '+' : ''}${formatQty(n)}${unit}`);

export function kpiDoc(r: KpiReport, targets: KpiTargets, opts: { company: string; generatedAt: string }): DocModel {
  const real = r.groups.filter((g) => g.steps > 0 && g.onTimePct !== null);
  const coverage = r.groups.reduce((a, g) => a + g.startCoverage * g.steps, 0) / Math.max(1, r.groups.reduce((a, g) => a + g.steps, 0));
  return {
    title: 'KPI Report',
    reference: `${formatDay(r.from)} - ${formatDay(r.to)}`,
    company: opts.company,
    meta: [
      ['Compared with', `${formatDay(r.prevFrom)} - ${formatDay(r.prevTo)}`],
      ['Steps finished', String(r.steps)],
      ['Open orders late now', String(r.factory.openLate)],
      ...(r.worstGroup ? ([['Needs most attention', r.worstGroup]] as [string, string][]) : []),
    ],
    charts: real.length
      ? [
          {
            title: 'Departments: steps on time and efficiency',
            unit: '%',
            series: [
              { label: 'Steps on time %', color: [31, 58, 95] },
              { label: 'Efficiency %', color: [196, 140, 40] },
            ],
            rows: real.map((g) => ({ label: g.name, values: [g.onTimePct ?? 0, g.efficiencyPct ?? 0] })),
          },
        ]
      : [],
    tables: [
      {
        title: 'Factory',
        columns: [{ label: 'KPI' }, { label: 'This period', align: 'right' }, { label: 'Previous', align: 'right' }, { label: 'Change', align: 'right' }, { label: 'Target', align: 'right' }, { label: 'Status' }],
        rows: kpiRows(targets).map((k) => {
          const cur = k.get(r.factory);
          const prev = k.get(r.prev);
          const tone = toneFor(cur, k.target, k.higher);
          return [k.label, k.fmt(cur), k.fmt(prev), signed(delta(cur, prev), k.unit), k.target === null || k.target === undefined ? '—' : `${k.higher ? ">=" : "<="} ${k.fmt(k.target)}`, tone ? TONE[tone] : '—'];
        }),
        empty: '',
      },
      {
        title: `Planning - orders confirmed in the period (benchmark ${r.planningBenchmark === null ? 'not set' : `${formatQty(r.planningBenchmark)} working day${r.planningBenchmark === 1 ? '' : 's'}`})`,
        columns: [{ label: 'Job Order' }, { label: 'Received' }, { label: 'Confirmed' }, { label: 'Planning days', align: 'right' }, { label: 'Within benchmark' }],
        rows: r.planning.map((p) => [p.joNumber, formatDay(p.received), formatDay(p.confirmed), formatQty(p.days), r.planningBenchmark === null ? '-' : p.over ? 'No' : 'Yes']),
        empty: 'No orders confirmed in this period.',
      },
      {
        title: 'Departments',
        columns: [
          { label: 'Department' },
          { label: 'Steps', align: 'right' },
          { label: 'On time', align: 'right' },
          { label: 'Efficiency', align: 'right' },
          { label: 'Avg delay', align: 'right' },
          { label: 'Avg wait', align: 'right' },
          { label: 'Main delay in late orders', align: 'right' },
          { label: 'Running now', align: 'right' },
        ],
        rows: r.groups.map((g) => {
          const p = r.prevGroups.get(g.id);
          const trend = p && g.onTimePct !== null && p.onTimePct !== null ? ` (${signed(g.onTimePct - p.onTimePct, '')})` : '';
          return [
            g.name,
            String(g.steps),
            `${fmtPct(g.onTimePct)}${trend}`,
            fmtPct(g.efficiencyPct),
            fmtDays(g.avgDelay),
            fmtDays(g.avgWait),
            g.lateOrderShare ? String(g.lateOrderShare) : '—',
            g.runningNow ? `${g.runningNow}${g.overNow ? ` (${g.overNow} over plan)` : ''}` : '—',
          ];
        }),
        empty: 'No process steps finished in this period.',
      },
      {
        title: 'By process',
        columns: [{ label: 'Department' }, { label: 'Process' }, { label: 'Steps', align: 'right' }, { label: 'On time', align: 'right' }, { label: 'Efficiency', align: 'right' }, { label: 'Avg delay', align: 'right' }, { label: 'Quantity handled', align: 'right' }],
        rows: r.groups.flatMap((g) => g.processes.map((p) => [g.name, p.label, String(p.steps), fmtPct(p.onTimePct), fmtPct(p.efficiencyPct), fmtDays(p.avgDelay), fmtThroughput(p.throughput)])),
        empty: 'No process steps finished in this period.',
      },

    ],
    notes: [
      'Steps on time = finished within their planned working days. Efficiency = planned days ÷ actual days (a step finished the same day counts as half a day). Avg delay = working days over plan per step (early = 0).',
      `Wait = days between the previous step finishing and this step starting; recorded for ${Math.round(coverage * 100)}% of steps. Where the start was not recorded, the step time includes waiting.`,
      '"Main delay in late orders" = late orders whose biggest overrun was in this department. Plans and targets are your own benchmarks; nothing is invented.',
      'Planning = received to confirmed, in working days, for every order confirmed in the period (completed or not).',
      'Working days exclude the weekly off and company holidays.',
    ],
    provisional: false,
    provisionalReasons: [],
    generatedAt: opts.generatedAt,
    fileName: `kpi-report_${r.from}_${r.to}.pdf`,
  };
}
