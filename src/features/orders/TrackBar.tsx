import type { Track } from '../../lib/progress';

/**
 * Planned vs actual bar: the fill is where the order is, the dark tick is
 * where it should be today, and the hatched part is the gap to catch up.
 */
export function TrackBar({ track, color }: { track: Track; color: string }) {
  const actual = track.actual ?? 0;
  const planned = track.kind === 'DRAFT' ? 0 : track.kind === 'LATE' ? 100 : track.planned;
  const behind = track.actual !== null && actual < planned;
  return (
    <div className="trackbar" role="img" aria-label={track.actual === null ? `Should be ${planned}% today; progress not entered` : `Is ${actual}%, should be ${planned}% today`}>
      {track.actual !== null && <div className="trackbar-fill" style={{ width: `${actual}%`, background: color }} />}
      {behind && <div className="trackbar-gap" style={{ left: `${actual}%`, width: `${planned - actual}%`, ['--gap' as string]: color }} />}
      {track.kind !== 'DRAFT' && track.kind !== 'DONE' && <div className="trackbar-mark" style={{ left: `calc(${planned}% - 1px)` }} />}
    </div>
  );
}
