import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../../AppContext';
import { emailToUsername } from '../../lib/username';
import { DATA_STATUSES, tracked, type DataStatus, DATA_STATUS_LABEL } from '../../lib/dataStatus';
import { useProfile, PROFILE_COLLECTION, PROFILE_DOC } from './useProfile';
import { saveRecord } from '../sync/records';
import { SyncPanel } from '../sync/SyncPanel';
import { offlineCacheEnabled } from '../../firebase';
import { BackupCard } from './BackupCard';
import { RestoreCard } from './RestoreCard';
import { HealthCard, useErrors } from './HealthCard';
import { KpiTargetsCard } from './KpiTargetsCard';
import { SettingSection } from './SettingSection';
import { useSyncOps } from '../sync/syncStore';
import { summarize } from '../../lib/syncState';
import { quotaErrors } from '../../lib/errorLog';
import { BACKUP_REMIND_DAYS, daysSinceBackup, readLastBackup } from '../../lib/backup';
import { SampleDataCard } from './SampleDataCard';
import { Link } from 'react-router-dom';
import { READINESS_DOC, readinessSummary, readinessWorkspace, type ReadinessDoc } from '../../lib/readiness';
import { useDocument } from '../masters/useCollection';

function ReadinessLinkCard() {
  const app = useApp();
  const { item } = useDocument<ReadinessDoc>(readinessWorkspace(app.user?.uid, app.workspaceId), 'settings', READINESS_DOC);
  const s = readinessSummary(item);
  return (
    <Link to="/readiness" className="card setting-link">
      <span className="setting-title">Waiting for company data</span>
      <span className="setting-sum">
        {s.received}/{s.total - s.notNeeded} received
      </span>
      <span className="setting-chev" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
import { DEFAULT_RED_AT, readRedAt, readTheme, saveRedAt, saveTheme, type ThemePref } from '../../lib/theme';
import { DEFAULT_PLANNING_DAYS } from '../../lib/route';

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

const STATUS_LABEL = DATA_STATUS_LABEL;

function ProfileForm() {
  const { t, workspaceId } = useApp();
  const { profile, loading, pendingWrite, error } = useProfile(workspaceId);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<DataStatus>('USER_PROVIDED');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [person, setPerson] = useState('');
  const [designation, setDesignation] = useState('');
  const [planningText, setPlanningText] = useState(String(DEFAULT_PLANNING_DAYS));

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
    setPerson(profile.preparedByName ?? '');
    setDesignation(profile.preparedByDesignation ?? '');
    setPlanningText(profile.planningDays === null ? '' : String(profile.planningDays ?? DEFAULT_PLANNING_DAYS));
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
    const planning = planningText.trim() === '' ? null : Number(planningText.replace(',', '.'));
    if (planning !== null && (!Number.isFinite(planning) || planning <= 0 || planning > 30)) {
      setFormError('Planning time must be between 0.5 and 30 working days, or empty');
      return;
    }
    setFormError(null);
    saveRecord({
      workspaceId,
      collectionName: PROFILE_COLLECTION,
      docId: PROFILE_DOC,
      entity: 'Profile',
      before: profile,
      data: { companyName, preparedByName: person.trim(), preparedByDesignation: designation.trim(), planningDays: planning },
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
      <div className="grid2">
        <label>
          Your name (on plan documents)
          <input value={person} onChange={(e) => setPerson(e.target.value)} maxLength={80} />
        </label>
        <label>
          Designation
          <input value={designation} onChange={(e) => setDesignation(e.target.value)} maxLength={80} placeholder="e.g. Production Manager" />
        </label>
      </div>
      <label>
        Planning time benchmark (working days from JO received to confirmed)
        <input inputMode="decimal" value={planningText} onChange={(e) => setPlanningText(e.target.value)} placeholder="not set" />
      </label>
      <p className="muted small">Your own benchmark; drafts older than this show as late in planning. Empty = not set.</p>
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
  const { t, user, mode, setMode, lang, setLang, logout, workspaceId } = useApp();
  const { profile } = useProfile(workspaceId);
  const company = profile?.companyName?.value ?? '';
  const sync = summarize(useSyncOps().filter((o) => o.workspaceId === workspaceId));
  const errors = useErrors();
  const backupDays = workspaceId ? daysSinceBackup(readLastBackup(workspaceId), new Date()) : null;

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

      <Link to="/masters" className="card setting-link">
        <span className="setting-title">{t('navMasters')}</span>
        <span className="setting-sum">Products, BOMs, processes, departments, suppliers</span>
        <span className="setting-chev" aria-hidden="true">
          ›
        </span>
      </Link>

      <SettingSection title={t('profile')} summary={[company, profile?.preparedByName].filter(Boolean).join(' · ') || 'Company name, your name'}>
        <ProfileForm />
      </SettingSection>

      <SettingSection
        title={t('sync')}
        summary={sync.FAILED + sync.CONFLICT + sync.PENDING === 0 ? 'All saved' : [sync.PENDING && `${sync.PENDING} waiting`, sync.FAILED && `${sync.FAILED} failed`, sync.CONFLICT && `${sync.CONFLICT} conflict${sync.CONFLICT === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        flag={sync.FAILED + sync.CONFLICT > 0 ? 'bad' : null}
        flagLabel="Failed or conflicting changes"
      >
        <SyncPanel />
      </SettingSection>

      <SettingSection title="KPI targets" summary="Your own targets">
        <KpiTargetsCard />
      </SettingSection>
      <SettingSection title={t('language')} summary={lang === 'en' ? 'English' : 'മലയാളം'}>
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
      </SettingSection>

      {mode === 'DEMO' && (
        <SettingSection title="Sample data (DEMO)">
          <SampleDataCard />
        </SettingSection>
      )}

      <ReadinessLinkCard />

      <SettingSection
        title="Backup"
        summary={backupDays === null ? 'Never on this phone' : backupDays === 0 ? 'Last: today' : `Last: ${backupDays} day${backupDays === 1 ? '' : 's'} ago`}
        flag={mode === 'ACTUAL' && (backupDays === null || backupDays > BACKUP_REMIND_DAYS) ? 'warn' : null}
        flagLabel="Backup due"
      >
        <BackupCard />
      </SettingSection>

      <SettingSection title="Restore from a backup">
        <RestoreCard />
      </SettingSection>

      <SettingSection
        title="System health"
        summary={errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : 'No errors'}
        flag={quotaErrors(errors).length || sync.FAILED + sync.CONFLICT ? 'bad' : errors.length ? 'warn' : null}
        flagLabel="Errors to look at"
      >
        <HealthCard />
      </SettingSection>

      <SettingSection title="Appearance" summary={{ auto: 'Auto', light: 'Light', dark: 'Dark' }[readTheme()]}>
        <AppearanceCard />
      </SettingSection>

      <SettingSection title={t('account')} summary={emailToUsername(user?.email)}>
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
      </SettingSection>
    </section>
  );
}
