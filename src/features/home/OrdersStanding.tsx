import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { isEditable, type JobOrder } from '../../lib/jobOrders';
import { gapColor, trackGroup, trackLabel, type Track } from '../../lib/progress';
import { orderTrack, type PlanContext } from '../../lib/route';
import { readRedAt } from '../../lib/theme';
import { TrackBar } from '../orders/TrackBar';

const GROUPS = [
  { id: 'ON_TRACK', label: 'On track', edge: 'oklch(0.58 0.13 150)' },
  { id: 'BEHIND', label: 'Behind', edge: 'oklch(0.72 0.15 75)' },
  { id: 'LATE', label: 'Late', edge: 'oklch(0.56 0.19 28)' },
  { id: 'NOT_TRACKED', label: 'Not tracked', edge: 'var(--line)' },
] as const;

/** Urgency order: late, then furthest behind, then untracked, drafts last. */
export function urgency(t: Track): number {
  if (t.kind === 'LATE') return -1000 + t.daysLeft;
  if (t.kind === 'TRACKED') return t.gap ?? 0;
  if (t.kind === 'NOT_TRACKED') return 500;
  if (t.kind === 'DONE') return 800;
  return 900;
}

/**
 * Where the work orders stand (moved from Home to the top of the Dashboard, 17 Nov 2026):
 * status counts and one planned-vs-actual card per open WO (bar, is / should be, days left).
 * What each product is doing is shown by the process cards below, not repeated here.
 */
export function OrdersStanding({ jos, ctx, today, loading, emptyText }: { jos: (JobOrder & { id: string })[]; ctx: PlanContext; today: string; loading: boolean; emptyText: string }) {
  const redAt = readRedAt();
  const open = useMemo(
    () =>
      jos
        .filter((j) => isEditable(j.status))
        .map((j) => {
          const track = orderTrack(j, today, ctx);
          return { jo: j, track, color: gapColor(track, redAt) };
        })
        .sort((a, b) => urgency(a.track) - urgency(b.track)),
    [jos, today, redAt, ctx],
  );
  const groupCount = useMemo(() => {
    const c: Record<string, number> = { ON_TRACK: 0, BEHIND: 0, LATE: 0, NOT_TRACKED: 0 };
    for (const o of open) c[trackGroup(o.track)]! += 1;
    return c;
  }, [open]);

  return (
    <>
      <section aria-label="Order status counts" className="counts">
        {GROUPS.map((g) => (
          <div key={g.id} style={{ boxShadow: `inset 0 4px 0 ${g.edge}` }}>
            <span className="mono count">{loading ? '–' : groupCount[g.id]}</span>
            <span className="muted small">{g.label}</span>
          </div>
        ))}
      </section>
      <section aria-labelledby="h-pva">
        <h3 id="h-pva">Planned vs actual</h3>
        {!loading && open.length === 0 && <p className="muted">{emptyText}</p>}
        <ul className="master-list">
          {open.map(({ jo, track, color }) => (
            <li key={jo.id}>
              <Link to={`/orders/${jo.id}`} className={`card link edge${jo.status === 'DRAFT' ? ' dashed' : ''}`} style={{ ['--edge' as string]: jo.status === 'DRAFT' ? 'transparent' : color }}>
                <div className="row between">
                  <span>
                    <strong>{jo.joNumber}</strong> <span className="muted small">{jo.customerName}</span>
                  </span>
                  <span className="track-label">
                    <span className="dot" style={{ background: color }} aria-hidden="true" />
                    {track.kind === 'DRAFT' ? 'Draft' : trackLabel(track)}
                  </span>
                </div>
                {jo.status === 'DRAFT' ? (
                  <span className="muted small block">Tracking starts when the order is confirmed</span>
                ) : (
                  <>
                    <TrackBar track={track} color={color} />
                    <div className="row between small">
                      <span>Is {track.actual === null ? '—' : `${track.actual}%`}</span>
                      <span>Should be {track.planned}%</span>
                      <span>{track.daysLeft >= 0 ? `${track.daysLeft} day${track.daysLeft === 1 ? '' : 's'} left` : 'past deadline'}</span>
                    </div>
                    {track.updatedDaysAgo !== null && track.updatedDaysAgo > 3 && <span className="muted small block">Progress updated {track.updatedDaysAgo} days ago</span>}
                  </>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {open.some((o) => o.jo.status === 'CONFIRMED') && (
          <p className="muted small legend">
            <span>
              <span className="legend-mark" aria-hidden="true" /> Should be here today
            </span>
            <span>
              <span className="legend-gap" aria-hidden="true" /> Gap to catch up
            </span>
          </p>
        )}
      </section>
    </>
  );
}
