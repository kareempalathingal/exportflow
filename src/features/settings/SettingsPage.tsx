import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../../AppContext';
import { emailToUsername } from '../../lib/username';
import { DATA_STATUSES, tracked, type DataStatus } from '../../lib/dataStatus';
import { useProfile, PROFILE_COLLECTION, PROFILE_DOC } from './useProfile';
import { saveRecord } from '../sync/records';
import { SyncPanel } from '../sync/SyncPanel';
import { offlineCacheEnabled } from '../../firebase';
import { DEFAULT_RED_AT, readRedAt, readTheme, saveRedAt, saveTheme, type ThemePref } from '../../lib/theme';

function AppearanceCard() {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  const [redAt, setRedAt] = useState(readRedAt);
  return (
    <div className="card">
      <h3>Appearance</h3>
      <div className="segmented" role="radiogroup" aria-label="Theme">
        {(['auto', 'light', 'dark'] as const).map((x) => (
          <button
            key={x}
            role="radio"
            aria-checked={theme === x}
            className={theme === x ? 'on' : ''}
            onClick={() => {
              setTheme(x);
              saveTheme(x);
            }}
          >
            {x === 'auto' ? 'Auto' : x === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
      <p className="muted small">Auto follows the phone’s dark mode. Saved on this phone only.</p>
      <label>
        Dashboard colour is full red when an order is behind plan by
        <select
          value={redAt}
          onChange={(e) => {
            const n = Number(e.target.value);
            setRedAt(n);
            saveRedAt(n);
          }}
        >
          {[10, 15, 20, 25, 30].map((n) => (
            <option key={n} value={n}>
              {n}%{n === DEFAULT_RED_AT ? ' (default)' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const STATUS_LABEL: Record<DataStatus, string> = {
  VERIFIED: 'Verified',
  USER_PROVIDED: 'User-Provided',
  ESTIMATED: 'Estimated',
  PENDING_VERIFICATION: 'Pending Verification',
  UNAVAILABLE: 'Unavailable',
};

function ProfileForm() {
  const { t, workspaceId } = useApp();
  const { profile, loading, pendingWrite, error } = useProfile(workspaceId);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<DataStatus>('USER_PROVIDED');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Load saved values only when a new revision arrives (or the workspace
  // changes), not on every sync-metadata update, so typing is never lost.
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!profile) return;
    const key = `${workspaceId}:${profile.rev}`;
    if (loadedKey.current === key) return;
    loadedKey.current = key;
    setName(profile.companyName?.value ?? '');
    setStatus(profile.companyName?.status ?? 'USER_PROVIDED');
    setSource(profile.companyName?.source ?? '');
  }, [profile, workspaceId]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) return;
    const value = name.trim() === '' ? null : name.trim();
    let companyName;
    try {
      companyName = tracked(value, value === null && status !== 'PENDING_VERIFICATION' ? 'UNAVAILABLE' : status, source);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
      return;
    }
    setFormError(null);
    saveRecord({
      workspaceId,
      collectionName: PROFILE_COLLECTION,
      docId: PROFILE_DOC,
      entity: 'Profile',
      before: profile,
      data: { companyName },
      reason,
    });
    setReason('');
    setMsg(t('saved'));
    setTimeout(() => setMsg(null), 2500);
  }

  if (loading) return <p className="muted">{t('loading')}</p>;
  return (
    <form className="card" onSubmit={submit}>
      <h3>{t('profile')}</h3>
      {error && <p className="error">{error === 'permission-denied' ? t('permissionDenied') : error}</p>}
      <label>
        {t('companyName')}
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </label>
      <div className="grid2">
        <label>
          {t('dataStatus')}
          <select value={status} onChange={(e) => setStatus(e.target.value as DataStatus)}>
            {DATA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('source')}
          <input value={source} onChange={(e) => setSource(e.target.value)} maxLength={120} />
        </label>
      </div>
      <label>
        {t('reasonOptional')}
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      {formError && <p className="error">{formError}</p>}
      <div className="row between">
        <span className="muted small">
          {t('rev')} {profile?.rev ?? 0}
          {pendingWrite && <span className="badge pending inline">{t('PENDING')}</span>}
        </span>
        <button className="primary" type="submit">
          {t('save')}
        </button>
      </div>
      {msg && <p className="ok small">{msg}</p>}
    </form>
  );
}

export function SettingsPage() {
  const { t, user, mode, setMode, lang, setLang, logout } = useApp();

  return (
    <section>
      <h2>{t('settingsTitle')}</h2>

      <div className="card">
        <h3>{t('mode')}</h3>
        <div className="segmented" role="radiogroup" aria-label={t('mode')}>
          {(['ACTUAL', 'DEMO'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? 'on' : ''}
              onClick={() => setMode(m)}
            >
              {m === 'ACTUAL' ? t('modeActual') : t('modeDemo')}
            </button>
          ))}
        </div>
        <p className="muted small">{mode === 'ACTUAL' ? t('modeActualHelp') : t('modeDemoHelp')}</p>
      </div>

      <ProfileForm />

      <SyncPanel />

      <div className="card">
        <h3>{t('language')}</h3>
        <div className="segmented" role="radiogroup" aria-label={t('language')}>
          <button role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
            English
          </button>
          <button role="radio" aria-checked={lang === 'ml'} className={lang === 'ml' ? 'on' : ''} onClick={() => setLang('ml')}>
            മലയാളം
          </button>
        </div>
      </div>

      <AppearanceCard />

      <div className="card">
        <h3>{t('account')}</h3>
        <p>{emailToUsername(user?.email)}</p>
        <p className="muted small">
          {t('version')} {__APP_VERSION__}
          {!offlineCacheEnabled && ' · offline cache unavailable in this browser'}
        </p>
        <button className="secondary" onClick={() => void logout()}>
          {t('signOut')}
        </button>
      </div>
    </section>
  );
}
