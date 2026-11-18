import { useState } from 'react';
import { DUE_KIND_LABEL, DUE_KINDS, type DueKind, type DueRule } from '../../lib/milestones';

/** One line on how a stage gets its date ("30 calendar days after Documents to customer is done"). */
export function ruleText(s: { rule?: DueRule | null }, nameOf?: (stageId: string) => string | undefined): string {
  const r = s.rule;
  if (!r) return 'date set on each WO';
  const unit = r.calendar ? 'calendar' : 'working';
  const what = r.kind === 'AFTER_MILESTONE' ? `after ${(r.after && nameOf?.(r.after)) || 'another milestone'} is done` : DUE_KIND_LABEL[r.kind];
  if (r.days === 0) return r.kind === 'BEFORE_CARGO' ? 'on the cargo ready date' : r.kind === 'AFTER_WO' ? 'on the WO date' : `when ${what.replace(/^after /, '')}`;
  return `${r.days} ${unit} day${r.days === 1 ? '' : 's'} ${what}`;
}

export type RuleChoice = DueKind | 'FIXED' | '';

/** State and fields of a due rule, shared by Settings → Order flow and the WO Milestones tab. */
export function useRuleFields(rule: DueRule | null | undefined, fixed: boolean) {
  const [kind, setKind] = useState<RuleChoice>(fixed ? 'FIXED' : (rule?.kind ?? ''));
  const [days, setDays] = useState(rule ? String(rule.days) : '');
  const [calendar, setCalendar] = useState(!!rule?.calendar);
  const [after, setAfter] = useState(rule?.after ?? '');
  const n = Number(days.trim());
  const withDays = kind !== '' && kind !== 'FIXED';
  const badDays = withDays && (!days.trim() || !Number.isInteger(n) || n < 0 || n > 365);
  const badAfter = kind === 'AFTER_MILESTONE' && !after;
  const value: DueRule | null = !withDays ? null : { kind: kind as DueKind, days: n, ...(calendar ? { calendar: true } : {}), ...(kind === 'AFTER_MILESTONE' ? { after } : {}) };
  return { kind, setKind, days, setDays, calendar, setCalendar, after, setAfter, bad: badDays || badAfter, badDays, badAfter, value };
}

export function RuleFields({ f, allowFixed, others }: { f: ReturnType<typeof useRuleFields>; allowFixed: boolean; others: { id: string; name: string }[] }) {
  return (
    <>
      <label>
        Due
        <select value={f.kind} onChange={(e) => f.setKind(e.target.value as RuleChoice)}>
          <option value="">{allowFixed ? 'To be set' : `${DUE_KIND_LABEL.FIXED} (or to be set)`}</option>
          {allowFixed && <option value="FIXED">On a date</option>}
          {DUE_KINDS.map((k) => (
            <option key={k} value={k}>
              N days {DUE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {f.kind === 'AFTER_MILESTONE' && (
        <label>
          After which milestone
          <select value={f.after} onChange={(e) => f.setAfter(e.target.value)}>
            <option value="">— choose —</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {f.kind !== '' && f.kind !== 'FIXED' && (
        <div className="grid2">
          <label>
            N
            <input inputMode="numeric" value={f.days} onChange={(e) => f.setDays(e.target.value)} />
          </label>
          <label>
            Counted in
            <select value={f.calendar ? 'cal' : 'work'} onChange={(e) => f.setCalendar(e.target.value === 'cal')}>
              <option value="work">working days</option>
              <option value="cal">calendar days</option>
            </select>
          </label>
        </div>
      )}
      {f.badDays && <p className="error small">Enter whole days from 0 to 365.</p>}
      {f.badAfter && <p className="error small">Choose the milestone it follows.</p>}
      {f.kind === 'AFTER_MILESTONE' && <p className="muted small">The date shows once that milestone is done.</p>}
      {f.kind === 'AFTER_LANDING' && <p className="muted small">The date shows once all outside work has landed.</p>}
    </>
  );
}
