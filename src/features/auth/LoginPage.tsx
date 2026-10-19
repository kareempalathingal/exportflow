import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { auth } from '../../firebase';
import { useApp } from '../../AppContext';
import { usernameToEmail, validateUsername } from '../../lib/username';

export function LoginPage() {
  const { t, online } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const invalid = validateUsername(username);
    if (invalid) return setError(invalid);
    if (!password) return setError(t('loginFailed'));
    if (!online) return setError(t('loginOffline'));
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    } catch (err) {
      const code = err instanceof FirebaseError ? err.code : '';
      if (code === 'auth/too-many-requests') setError(t('loginTooMany'));
      else if (code === 'auth/network-request-failed') setError(t('loginOffline'));
      else setError(t('loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-card">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={48} height={48} />
          <div>
            <h1>{t('appName')}</h1>
            <p className="muted">{t('tagline')}</p>
          </div>
        </div>
        <form onSubmit={submit} noValidate>
          <label>
            {t('username')}
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            {t('password')}
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? t('signingIn') : t('signIn')}
          </button>
        </form>
      </div>
    </main>
  );
}
