import { overPrevQuestion, prevLimit } from '../../lib/stepUpdates';
import { useState } from 'react';
import { useApp } from '../../AppContext';
import { formatDay, withExpected, type JobOrder, type StepOutput } from '../../lib/jobOrders';
import type { Department } from '../../lib/masters';
import { isBuiltIn, lineProgresses, setPromise, type PlanContext } from '../../lib/route';
import type { Task } from '../../lib/tasks';
import type { TodayAct } from '../../lib/today';
import type { WithMeta } from '../masters/useCollection';
import { OutputForm, StepDate } from '../orders/StepParts';
import { canEnterOutput, doneUpdate, outputUpdate, saveJoFields, saveJoLines, saveMaterialDates, withLineSteps } from '../orders/stepSave';
import { CloseTask, markDone } from '../work/WorkPage';

/** The records the Today actions write to (from the page that shows the card). */
export interface TodayActContext {
  jos: WithMeta<JobOrder>[];
  tasks: WithMeta<Task>[];
  ctx: PlanContext;
  departments: WithMeta<Department>[];
}

type Open = null | 'DONE' | 'OUTPUT' | 'LANDED' | 'DATE' | 'TASK';

/**
 * Round 2 (17 Nov 2026): the usual updates right on the Today card, with the same checks and
 * history entries as the WO page (shared code in `orders/stepSave.ts`). Anything else: "Open".
 */
export function TodayActions({ act, c, today }: { act: TodayAct; c: TodayActContext; today: string }) {
  const { workspaceId } = useApp();
  const [open, setOpen] = useState<Open>(null);
  const [when, setWhen] = useState(today);
  const [date, setDate] = useState(today);
  const [msg, setMsg] = useState<string | null>(null);
  const toggle = (o: Open) => {
    setOpen(open === o ? null : o);
    setWhen(today);
    setDate(today);
  };
  const saved = (text: string) => {
    setOpen(null);
    setMsg(text);
    setTimeout(() => setMsg(null), 3000);
  };
  const btn = (o: Open, label: string, primary = false) => (
    <button key={o} type="button" className={`${primary ? 'primary' : 'secondary'} small`} aria-expanded={open === o} onClick={() => toggle(o)}>
      {open === o ? 'Close' : label}
    </button>
  );

  if (act.kind === 'TASK') {
    const t = c.tasks.find((x) => x.id === act.taskId);
    if (!t || !workspaceId) return null;
    return (
      <div className="today-quick">
        <div className="row gap wrap">{btn('TASK', 'Done', true)}</div>
        {open === 'TASK' && (
          <CloseTask
            t={t}
            today={today}
            departments={c.departments}
            onCancel={() => setOpen(null)}
            onSave={(end) => {
              const r = markDone(workspaceId, t, today, end);
              saved(r.nextDue ? `Done. Next one due ${formatDay(r.nextDue)}.` : 'Done.');
            }}
          />
        )}
        {msg && <p className="ok small">{msg}</p>}
      </div>
    );
  }

  const jo = c.jos.find((x) => x.id === act.joId);
  if (!jo || jo.status !== 'CONFIRMED') return null;

  if (act.kind === 'AWAIT' && act.target.kind === 'MATERIAL') {
    const key = act.target.key;
    const d = jo.materialDates?.[key] ?? {};
    const label = act.target.name;
    const save = (next: typeof d, what: string) => {
      saveMaterialDates(workspaceId, jo, { ...jo.materialDates, [key]: next }, `${label}: ${what}`);
      saved('Saved.');
    };
    return (
      <div className="today-quick">
        <div className="row gap wrap">
          {btn('LANDED', 'Landed', true)}
          {btn('DATE', 'New date')}
        </div>
        {open === 'LANDED' && (
          <DateSave label="Landed on" value={date} max={today} onChange={setDate} button="Save landed" onSave={() => date <= today && save({ ...d, receivedOn: date }, `landed ${formatDay(date)}`)} />
        )}
        {open === 'DATE' && (
          <DateSave label="New expected date" value={date} min={today} onChange={setDate} button="Save new date" onSave={() => date >= today && save(withExpected(d, date, new Date().toISOString()), `expected ${formatDay(date)}`)} />
        )}
        {msg && <p className="ok small">{msg}</p>}
      </div>
    );
  }

  if (act.kind === 'AWAIT' && act.target.kind === 'ITEM') {
    const it = jo.orderItems?.find((x) => x.id === (act.target as { itemId: string }).itemId);
    if (!it) return null;
    const save = (next: typeof it, what: string) => {
      saveJoFields(workspaceId, jo, { orderItems: (jo.orderItems ?? []).map((x) => (x.id === it.id ? next : x)) }, `${it.item}: ${what}`);
      saved('Saved.');
    };
    return (
      <div className="today-quick">
        <div className="row gap wrap">
          {btn('LANDED', 'Landed', true)}
          {btn('DATE', 'New date')}
        </div>
        {open === 'LANDED' && <DateSave label="Landed on" value={date} max={today} onChange={setDate} button="Save landed" onSave={() => date <= today && save({ ...it, landedOn: date }, `landed ${formatDay(date)}`)} />}
        {open === 'DATE' && <DateSave label="New expected date" value={date} min={today} onChange={setDate} button="Save new date" onSave={() => date >= today && save(withExpected(it, date, new Date().toISOString()), `expected ${formatDay(date)}`)} />}
        {msg && <p className="ok small">{msg}</p>}
      </div>
    );
  }

  // Steps of one line: a running step (done / output) or an awaited item (landed / new date).
  const lineId = act.kind === 'STEP' ? act.lineId : act.target.kind === 'STEPS' ? act.target.lineId : '';
  const line = jo.lines.find((l) => l.id === lineId);
  const raw = line?.steps ?? [];
  const lp = lineProgresses(jo, today, c.ctx).find((x) => x.line.id === lineId)?.lp;
  if (!line || !lp) return null;
  const viewOf = (key: string) => lp.steps.find((v) => v.step.key === key);
  const rawIndex = (key: string) => raw.findIndex((s) => s.key === key);
  const firstOpen = raw.findIndex((s) => !s.doneAt);
  const product = c.ctx.md.products.get(line.productId);
  const write = (u: { steps: typeof raw; what: string } | null) => {
    if (!u) return;
    saveJoLines(workspaceId, jo, withLineSteps(jo, line.id, u.steps), u.what, today, c.ctx);
    saved('Saved.');
  };
  const outputForm = (key: string) => {
    const v = viewOf(key);
    const i = rawIndex(key);
    if (!v || i < 0) return null;
    return (
      <OutputForm
        step={v.step}
        product={product}
        today={today}
        onAdd={(entry: StepOutput) => {
          const over = overPrevQuestion(prevLimit(lp.steps, key), (v.step.outputQty ?? 0) + entry.qty, entry.unit, v.step.label);
          if (over && !window.confirm(over)) return;
          write(outputUpdate(raw, i, v, entry, i === firstOpen, line.productName, today, (q) => window.confirm(q)));
        }}
        onRemove={() => undefined}
      />
    );
  };

  if (act.kind === 'STEP') {
    const v = viewOf(act.stepKey);
    const i = rawIndex(act.stepKey);
    if (!v || i < 0 || isBuiltIn(v.step)) return null;
    const canDone = i === firstOpen;
    const canOut = canEnterOutput(v);
    if (!canDone && !canOut) return null;
    const min = v.startedOn ?? v.startOn;
    const bad = when > today || (min !== null && when < min);
    return (
      <div className="today-quick">
        <div className="row gap wrap">
          {canDone && btn('DONE', `${v.step.label} done`, true)}
          {canOut && btn('OUTPUT', "+ Day's output")}
        </div>
        {open === 'DONE' && (
          <div className="row gap wrap">
            <StepDate current={v} today={today} value={when} onChange={setWhen} />
            <button type="button" className="primary small" disabled={bad} onClick={() => write(doneUpdate(raw, v.step.label, line.productName, when, today))}>
              Save: {v.step.label} done
            </button>
          </div>
        )}
        {open === 'OUTPUT' && outputForm(act.stepKey)}
        {msg && <p className="ok small">{msg}</p>}
      </div>
    );
  }

  if (act.target.kind !== 'STEPS') return null;
  const { promiseKey, landingKey } = act.target;
  const pi = rawIndex(promiseKey);
  const landing = viewOf(landingKey);
  return (
    <div className="today-quick">
      <div className="row gap wrap">
        {landing && canEnterOutput(landing) && btn('LANDED', '+ Landed', true)}
        {pi >= 0 && btn('DATE', 'New date')}
      </div>
      {open === 'LANDED' && outputForm(landingKey)}
      {open === 'DATE' && pi >= 0 && (
        <DateSave
          label="New expected date"
          value={date}
          min={today}
          onChange={setDate}
          button="Save new date"
          onSave={() => date >= today && write({ steps: setPromise(raw, pi, { expectedOn: date }, new Date().toISOString())!, what: `${raw[pi]!.label}: expected ${formatDay(date)} (${line.productName})` })}
        />
      )}
      {msg && <p className="ok small">{msg}</p>}
    </div>
  );
}

function DateSave({ label, value, min, max, onChange, button, onSave }: { label: string; value: string; min?: string; max?: string; onChange: (d: string) => void; button: string; onSave: () => void }) {
  const bad = (max && value > max) || (min && value < min);
  return (
    <div className="row gap wrap">
      <label className="small">
        {label}
        <input type="date" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value)} />
      </label>
      <button type="button" className="primary small" disabled={!value || !!bad} onClick={onSave}>
        {button}
      </button>
      {bad && <span className="error small">{max && value > max ? 'The date cannot be in the future.' : 'The date cannot be in the past.'}</span>}
    </div>
  );
}
