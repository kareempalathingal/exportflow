/**
 * Long lists that stay out of the way (confirmed 4 Nov 2026): up to `inline`
 * entries are shown as they are; more collapse into one row ("54 products"),
 * opened on tap and grouped (e.g. by family) with a count per group.
 */
import type { ReactNode } from 'react';

export interface LongListEntry {
  key: string;
  group?: string;
  node: ReactNode;
}

export const LONG_LIST_INLINE = 5;

/** Groups entries, biggest group first; entries without a group go to `other`, last. */
export function groupEntries<T extends { group?: string }>(entries: T[], other = 'Other'): { name: string; entries: T[] }[] {
  const m = new Map<string, T[]>();
  for (const e of entries) {
    const g = e.group?.trim() || other;
    m.set(g, [...(m.get(g) ?? []), e]);
  }
  return [...m]
    .map(([name, es]) => ({ name, entries: es }))
    .sort((a, b) => (a.name === other ? 1 : b.name === other ? -1 : b.entries.length - a.entries.length || a.name.localeCompare(b.name)));
}

export function LongList(props: {
  entries: LongListEntry[];
  /** e.g. "54 products" */
  summary: string;
  /** How the entries look when shown inline / inside a group. */
  as?: 'comma' | 'chips' | 'list';
  inline?: number;
  other?: string;
  empty?: ReactNode;
}) {
  const { entries, as = 'list', inline = LONG_LIST_INLINE } = props;
  if (!entries.length) return <>{props.empty ?? null}</>;
  // Inline: as asked; once collapsed, one entry per line (long names stay readable).
  const body = (es: LongListEntry[], style: 'comma' | 'chips' | 'list' = as) =>
    style === 'comma' ? (
      <span>
        {es.map((e, i) => (
          <span key={e.key}>
            {i > 0 && ', '}
            {e.node}
          </span>
        ))}
      </span>
    ) : (
      <ul className={style === 'chips' ? 'chips' : 'plain-list long-list-items'}>{es.map((e) => (style === 'chips' ? e.node : <li key={e.key}>{e.node}</li>))}</ul>
    );
  if (entries.length <= inline) return body(entries);
  const groups = groupEntries(entries, props.other);
  const open = as === 'comma' ? 'list' : as;
  return (
    <details className="long-list">
      <summary>
        {props.summary} <span className="muted small">(tap to show)</span>
      </summary>
      {groups.length <= 1
        ? body(entries, open)
        : groups.map((g) => (
            <details key={g.name} className="long-list-group">
              <summary>
                {g.name} <span className="muted small">{g.entries.length}</span>
              </summary>
              {body(g.entries, open)}
            </details>
          ))}
    </details>
  );
}
