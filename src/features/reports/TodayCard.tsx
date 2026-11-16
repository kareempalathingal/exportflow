import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDay } from '../../lib/jobOrders';
import { departmentsFor, stepMessage } from '../../lib/contacts';
import type { Department } from '../../lib/masters';
import { StepContacts } from '../masters/ContactButtons';
import { shareMessage, shareText } from '../../lib/share';
import { TODAY_HEADINGS, countsText, todayByDepartment, todayGroupText, todayText, type TodayGroup, type TodaySummary, type TodayWhen } from '../../lib/today';
import { readPref, writePref } from '../../lib/storage';

const CLS: Record<TodayWhen, string> = { OVERDUE: 'bad', TODAY: 'warn', SOON: 'neutral' };

/** Home: today and the next 2 working days, with a share button. */
type View = 'DEPT' | 'TIME';

/** Home: today and the next 2 working days, by department (default, 16 Nov 2026) or by time, with share buttons. */
export function TodayCard({ summary, company, compact = false, departments = [] }: { summary: TodaySummary; company: string; compact?: boolean; departments?: Department[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [view, setViewState] = useState<View>(() => (readPref('todayView') === 'TIME' ? 'TIME' : 'DEPT'));
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
  const groups = view === 'DEPT' ? todayByDepartment(summary, departments) : [];
  return (
    <section className="card today-card" aria-label="Today">
      <div className="row between">
        <h3>Today</h3>
        <button type="button" className="secondary small" onClick={() => void share(`Daily summary ${formatDay(summary.today)}`, todayText(summary, company, view === 'DEPT' ? departments : undefined))}>
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
        groups.map((g) => <DeptGroup key={g.key} g={g} compact={compact} today={summary.today} company={company} onShare={(t) => void share(`${g.name} ${formatDay(summary.today)}`, t)} />)
      ) : (
        (['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]).map((w) => {
          const list = summary.items.filter((i) => i.when === w);
          if (!list.length) return null;
          const shown = compact ? list.slice(0, 5) : list;
          return (
            <div key={w} className="today-group">
              <span className={`pill ${CLS[w]}`}>{TODAY_HEADINGS[w]}</span>
              <ul className="today-list">
                {shown.map((i, n) => {
                  const st = i.step;
                  const depts = st ? departmentsFor(st.processId, departments) : [];
                  return (
                    <li key={n}>
                      <Link to={i.link}>{i.text}</Link>
                      {st && depts.length > 0 && (
                        <StepContacts
                          departments={depts}
                          message={(p) => stepMessage({ person: p.name, joNumber: st.joNumber, product: st.product, step: st.label, quantity: st.quantity, plannedFinish: st.finish, late: st.late })}
                        />
                      )}
                    </li>
                  );
                })}
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
function DeptGroup({ g, compact, today, company, onShare }: { g: TodayGroup; compact: boolean; today: string; company: string; onShare: (text: string) => void }) {
  const shown = compact ? g.items.slice(0, 5) : g.items;
  const text = todayGroupText(g, today, company);
  return (
    <div className="today-group dept-group">
      <div className="row between">
        <strong>{g.name}</strong>
        <span className="small">
          {g.counts.OVERDUE > 0 && <span className="pill bad inline-pill">{g.counts.OVERDUE} overdue</span>}
          <span className="muted"> {countsText({ ...g.counts, OVERDUE: 0 })}</span>
        </span>
      </div>
      <div className="row between small">
        {g.department ? (
          <StepContacts departments={[g.department]} message={(p) => ({ subject: `${g.name} - ${formatDay(today)}`, body: `Hi ${p.name.split(' ')[0]},\n\n${g.items.map((i) => `- ${i.text}`).join('\n')}` })} />
        ) : (
          <span />
        )}
        <button type="button" className="linkish small" onClick={() => onShare(text)}>
          Share list
        </button>
      </div>
      <ul className="today-list">
        {shown.map((i, n) => (
          <li key={n} className={i.when === 'OVERDUE' ? 'bad' : undefined}>
            <span className={`pill ${CLS[i.when]} inline-pill`}>{i.when === 'OVERDUE' ? 'Overdue' : i.when === 'TODAY' ? 'Today' : 'Soon'}</span> <Link to={i.link}>{i.text}</Link>
          </li>
        ))}
        {shown.length < g.items.length && (
          <li className="muted small">
            <Link to="/reports">+{g.items.length - shown.length} more</Link>
          </li>
        )}
      </ul>
    </div>
  );
}
