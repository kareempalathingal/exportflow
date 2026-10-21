import type { ReactNode } from 'react';

/**
 * One collapsible Settings section: a single row (title, short status, an
 * optional red flag) that opens on tap. Nothing opens by itself.
 */
export function SettingSection({ title, summary, flag, flagLabel, children }: { title: string; summary?: ReactNode; flag?: 'bad' | 'warn' | null; flagLabel?: string; children: ReactNode }) {
  return (
    <details className="card setting">
      <summary>
        <span className="setting-title">{title}</span>
        {summary && <span className="setting-sum">{summary}</span>}
        {flag && <span className={`setting-flag ${flag}`} role="img" aria-label={flagLabel ?? 'Needs attention'} title={flagLabel} />}
        <span className="setting-chev" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="setting-body">{children}</div>
    </details>
  );
}
