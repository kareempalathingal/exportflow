import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../AppContext';
import { formatDay } from '../../lib/jobOrders';
import { departmentsFor, stepMessage } from '../../lib/contacts';
import type { Department } from '../../lib/masters';
import { StepContacts } from '../masters/ContactButtons';
import { shareMessage, shareText } from '../../lib/share';
import { readHandled, writeHandled } from '../../lib/handled';
import { formatClock, istTimeKey } from '../../lib/time';
import {
  TODAY_HEADINGS,
  countsText,
  handledLast,
  todayByDepartment,
  todayGroupText,
  todayItemKey,
  todayText,
  type HandledMark,
  type HandledOf,
  type TodayGroup,
  type TodayItem,
  type TodaySummary,
  type TodayWhen,
} from '../../lib/today';
import { readPref, writePref } from '../../lib/storage';

const CLS: Record<TodayWhen, string> = { OVERDUE: 'bad', TODAY: 'warn', SOON: 'neutral' };
const WHEN: Record<TodayWhen, string> = { OVERDUE: 'Overdue', TODAY: 'Today', SOON: 'Soon' };

type View = 'DEPT' | 'TIME';

/**
 * Home and Reports: today and the next 2 working days, by department (default, 16 Nov 2026) or
 * by time. Every item leads to where it is solved and can be marked "Handled" for today
 * (on the phone, 17 Nov 2026).
 */
export function TodayCard({ summary, company, compact = false, departments = [] }: { summary: TodaySummary; company: string; compact?: boolean; departments?: Department[] }) {
  const ws = useApp().workspaceId ?? '';
  const [msg, setMsg] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(() => (readPref('todayView') === 'TIME' ? 'TIME' : 'DEPT'));
  const [marks, setMarks] = useState<Record<string, HandledMark>>(() => readHandled(ws, summary.today));
  const handled: HandledOf = (i) => marks[todayItemKey(i)];
  const mark = (i: TodayItem, m: HandledMark | null) => setMarks(writeHandled(ws, summary.today, todayItemKey(i), m));
  const setView = (v: View) => {
    setViewState(v);
    writePref('todayView', v);
  };
  async function share(title: string, text: string) {
    const r = await shareText(title, text);
    if (r !== 'cancelled') {
      setMsg(shareMessage(r));
      setTimeout(() => setMsg(null), 3000);
    }
  }
  const row = (i: TodayItem, n: number, deptId: string | null, showContacts: boolean) => (
    <TodayRow key={`${todayItemKey(i)}-${n}`} i={i} m={handled(i)} departments={departments} deptId={deptId} showContacts={showContacts} today={summary.today} onMark={(m) => mark(i, m)} />
  );
  const groups = view === 'DEPT' ? todayByDepartment(summary, departments, handled) : [];
  return (
    <section className="card today-card" aria-label="Today">
      <div className="row between">
        <h3>Today</h3>
        <button type="button" className="secondary small" onClick={() => void share(`Daily summary ${formatDay(summary.today)}`, todayText(summary, company, view === 'DEPT' ? departments : undefined, handled))}>
          Share summary
        </button>
      </div>
      {summary.items.length > 0 && (
        <div className="segmented today-view" role="group" aria-label="Show the list">
          {(['DEPT', 'TIME'] as View[]).map((v) => (
            <button key={v} type="button" className={view === v ? 'small on' : 'small'} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'DEPT' ? 'By department' : 'By time'}
            </button>
          ))}
        </div>
      )}
      {summary.items.length === 0 ? (
        <p className="ok small">Nothing due today or in the next 2 working days.</p>
      ) : view === 'DEPT' ? (
        groups.map((g) => (
          <DeptGroup
            key={g.key}
            g={g}
            compact={compact}
            text={todayGroupText(g, summary.today, company, handled)}
            items={handledLast(g.items, handled)}
            row={(i, n) => row(i, n, g.department ? ((g.department as Department & { id?: string }).id ?? null) : null, false)}
            onShare={(t) => void share(`${g.name} ${formatDay(summary.today)}`, t)}
            today={summary.today}
          />
        ))
      ) : (
        (['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]).map((w) => {
          const list = handledLast(
            summary.items.filter((i) => i.when === w),
            handled,
          );
          if (!list.length) return null;
          const shown = compact ? list.slice(0, 5) : list;
          return (
            <div key={w} className="today-group">
              <span className={`pill ${CLS[w]}`}>{TODAY_HEADINGS[w]}</span>
              <ul className="today-list">
                {shown.map((i, n) => row(i, n, null, true))}
                {shown.length < list.length && (
                  <li className="muted small">
                    <Link to="/reports">+{list.length - shown.length} more</Link>
                  </li>
                )}
              </ul>
            </div>
          );
        })
      )}
      {msg && <p className="ok small">{msg}</p>}
    </section>
  );
}

/** One department's items, its main contact (the draft holds the list) and its own share. */
function DeptGroup({ g, compact, text, items, row, onShare, today }: { g: TodayGroup; compact: boolean; text: string; items: TodayItem[]; row: (i: TodayItem, n: number) => ReactNode; onShare: (text: string) => void; today: string }) {
  const shown = compact ? items.slice(0, 5) : items;
  return (
    <div className="today-group dept-group">
      <div className="row between">
        <strong>{g.name}</strong>
        <span className="small">
          {g.counts.OVERDUE > 0 && <span className="pill bad inline-pill">{g.counts.OVERDUE} overdue</span>}
          <span className="muted"> {countsText({ ...g.counts, OVERDUE: 0 }, g.handled)}</span>
        </span>
      </div>
      <div className="row between small">
        {g.department ? (
          <StepContacts departments={[g.department]} message={(p) => ({ subject: `${g.name} - ${formatDay(today)}`, body: `Hi ${p.name.split(' ')[0]},\n\n${text.split('\n').slice(2).join('\n')}` })} />
        ) : (
          <span />
        )}
        <button type="button" className="linkish small" onClick={() => onShare(text)}>
          Share list
        </button>
      </div>
      <ul className="today-list">
        {shown.map((i, n) => row(i, n))}
        {shown.length < items.length && (
          <li className="muted small">
            <Link to="/reports">+{items.length - shown.length} more</Link>
          </li>
        )}
      </ul>
    </div>
  );
}

/** One item: what it is, the way to solve it, "+ Follow-up task" and "Handled" (with an optional note). */
function TodayRow({ i, m, departments, deptId, showContacts, today, onMark }: { i: TodayItem; m: HandledMark | undefined; departments: Department[]; deptId: string | null; showContacts: boolean; today: string; onMark: (m: HandledMark | null) => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const st = i.step;
  const depts = showContacts && st ? departmentsFor(st.processId, departments) : [];
  if (m) {
    return (
      <li className="today-item handled">
        <span className="handled-text">✓ {i.text}</span>
        <span className="small muted">
          {' '}
          · Handled {formatClock(m.at)}
          {m.note && <> · “{m.note}”</>} ·{' '}
          <button type="button" className="linkish small" onClick={() => onMark(null)}>
            Undo
          </button>
        </span>
      </li>
    );
  }
  const task = new URLSearchParams({ title: i.text, due: today, ...(i.followUp ? { jo: i.followUp.joId, joNo: i.followUp.joNumber } : {}), ...(deptId ? { dept: deptId } : {}) });
  return (
    <li className={`today-item${i.when === 'OVERDUE' ? ' bad' : ''}`}>
      <span className={`pill ${CLS[i.when]} inline-pill`}>{WHEN[i.when]}</span> {i.open ? <Link to={i.open.link}>{i.text}</Link> : i.text}
      {i.open && (
        <div className="row gap wrap today-actions">
          <Link className="button secondary small" to={i.open.link}>
            {i.open.label}
          </Link>
          {i.followUp && (
            <Link className="button secondary small" to={`/work/new?${task.toString()}`}>
              + Follow-up task
            </Link>
          )}
          <button type="button" className="secondary small" aria-expanded={asking} onClick={() => setAsking(!asking)}>
            ✓ Handled
          </button>
        </div>
      )}
      {asking && (
        <form
          className="row gap wrap today-actions"
          onSubmit={(e) => {
            e.preventDefault();
            onMark({ at: istTimeKey(new Date()), note });
            setAsking(false);
            setNote('');
          }}
        >
          <input aria-label="What was done (optional)" placeholder="What was done (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className="small">
            Mark handled for today
          </button>
        </form>
      )}
      {depts.length > 0 && st && (
        <StepContacts
          departments={depts}
          message={(p) => stepMessage({ person: p.name, joNumber: st.joNumber, product: st.product, step: st.label, quantity: st.quantity, plannedFinish: st.finish, late: st.late })}
        />
      )}
    </li>
  );
}
