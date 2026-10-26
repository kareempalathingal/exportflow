import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { useApp } from '../AppContext';
import { useSyncOps } from '../features/sync/syncStore';
import { summarize } from '../lib/syncState';
import { UpdatePrompt } from './UpdatePrompt';
import { RULES_URL, useAutoRulesCheck, useRulesState } from '../features/settings/rulesCheck';

export function Layout() {
  const { t, mode, online, workspaceId } = useApp();
  const ops = useSyncOps();
  const counts = summarize(ops);
  const permissionFailures = ops.filter((o) => o.status === 'FAILED' && o.error === 'permission-denied').length;
  useAutoRulesCheck(workspaceId, online, permissionFailures);
  const rules = useRulesState();
  const attention = counts.CONFLICT + counts.FAILED;
  const { pathname } = useLocation();

  return (
    <div className={`shell ${mode === 'DEMO' ? 'is-demo' : ''}`}>
      {mode === 'DEMO' && (
        <div className="demo-banner" role="status">
          {t('demoBanner')}
        </div>
      )}
      <header className="topbar">
        <span className="title">{t('appName')}</span>
        <span className={`mode-chip ${mode === 'DEMO' ? 'demo' : 'actual'}`}>{mode}</span>
        <span className={`net ${online ? 'on' : 'off'}`} title={online ? t('online') : t('offline')}>
          <span className="dot" aria-hidden="true" />
          {online ? t('online') : t('offline')}
        </span>
        {counts.PENDING > 0 && <span className="badge pending">{counts.PENDING} {t('PENDING')}</span>}
        {attention > 0 && <span className="badge alert">{attention} !</span>}
      </header>
      {!online && <div className="offline-note">{t('offlineNote')}</div>}
      {rules.state === 'old' && (
        <div className="rules-banner" role="alert">
          <strong>Firestore rules need publishing.</strong> New parts of the app cannot save yet ({rules.missing?.join(', ')}). Copy{' '}
          <a href={RULES_URL} target="_blank" rel="noreferrer">
            firestore.rules
          </a>{' '}
          → Firebase console → Firestore → Rules → Publish, then <NavLink to="/settings">Settings → System health → Check rules</NavLink>.
        </div>
      )}
      <UpdatePrompt />
      <main className="content">
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <nav className="bottomnav" aria-label="Main">
        <NavLink to="/" end>
          {t('navHome')}
        </NavLink>
        <NavLink to="/orders">{t('navOrders')}</NavLink>
        <NavLink to="/work">{t('navWork')}</NavLink>
        <NavLink to="/reports" className={({ isActive }) => (isActive || pathname.startsWith('/history') ? 'active' : '')}>
          {t('navReports')}
        </NavLink>
        <NavLink to="/settings" className={({ isActive }) => (isActive || pathname.startsWith('/masters') || pathname.startsWith('/readiness') ? 'active' : '')}>
          {t('navSettings')}
          {attention > 0 && <span className="nav-dot" aria-label="needs attention" />}
        </NavLink>
      </nav>
    </div>
  );
}
