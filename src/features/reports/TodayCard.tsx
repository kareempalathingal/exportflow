import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDay } from '../../lib/jobOrders';
import { TODAY_HEADINGS, todayText, type TodaySummary, type TodayWhen } from '../../lib/today';

/** Share plain text through the phone's share sheet, or copy it. The app never sends anything itself. */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    window.prompt('Copy this summary:', text);
    return 'copied';
  }
}

const CLS: Record<TodayWhen, string> = { OVERDUE: 'bad', TODAY: 'warn', SOON: 'neutral' };

/** Home: today and the next 2 working days, with a share button. */
export function TodayCard({ summary, company, compact = false }: { summary: TodaySummary; company: string; compact?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  async function share() {
    const r = await shareText(`Daily summary ${formatDay(summary.today)}`, todayText(summary, company));
    if (r !== 'cancelled') {
      setMsg(r === 'shared' ? 'Passed to the share menu.' : 'Copied — paste it where you need it.');
      setTimeout(() => setMsg(null), 3000);
    }
  }
  return (
    <section className="card today-card" aria-label="Today">
      <div className="row between">
        <h3>Today</h3>
        <button type="button" className="secondary small" onClick={() => void share()}>
          Share summary
        </button>
      </div>
      {summary.items.length === 0 ? (
        <p className="ok small">Nothing due today or in the next 2 working days.</p>
      ) : (
        (['OVERDUE', 'TODAY', 'SOON'] as TodayWhen[]).map((w) => {
          const list = summary.items.filter((i) => i.when === w);
          if (!list.length) return null;
          const shown = compact ? list.slice(0, 5) : list;
          return (
            <div key={w} className="today-group">
              <span className={`pill ${CLS[w]}`}>{TODAY_HEADINGS[w]}</span>
              <ul className="today-list">
                {shown.map((i, n) => (
                  <li key={n}>
                    <Link to={i.link}>{i.text}</Link>
                  </li>
                ))}
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
