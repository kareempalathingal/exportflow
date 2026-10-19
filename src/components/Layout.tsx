import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../AppContext';
import { useSyncOps } from '../features/sync/syncStore';
import { summarize } from '../lib/syncState';
import { UpdatePrompt } from './UpdatePrompt';

export function Layout() {
  const { t, mode, online } = useApp();
  const counts = summarize(useSyncOps());
  const attention = counts.CONFLICT + counts.FAILED;

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
      <UpdatePrompt />
      <main className="content">
        <Outlet />
      </main>
      <nav className="bottomnav" aria-label="Main">
        <NavLink to="/" end>
          {t('navHome')}
        </NavLink>
        <NavLink to="/masters">{t('navMasters')}</NavLink>
        <NavLink to="/history">{t('navHistory')}</NavLink>
        <NavLink to="/settings">
          {t('navSettings')}
          {attention > 0 && <span className="nav-dot" aria-label="needs attention" />}
        </NavLink>
      </nav>
    </div>
  );
}
