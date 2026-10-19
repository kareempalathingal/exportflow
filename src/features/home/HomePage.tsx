import { useApp } from '../../AppContext';
import { useProfile } from '../settings/useProfile';
import { formatDateTime } from '../../lib/time';

export function HomePage() {
  const { t, workspaceId, mode } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value;

  return (
    <section>
      <h2>{t('homeTitle')}</h2>
      <p className="muted small">{formatDateTime(new Date())} IST</p>
      <div className="card">
        <p className="kicker">{mode}</p>
        <p className="lead">{company ?? t('appName')}</p>
        <p className="muted">{t('homeEmpty')}</p>
      </div>
      <div className="card subtle">
        <p>{t('homeFoundation')}</p>
      </div>
    </section>
  );
}
