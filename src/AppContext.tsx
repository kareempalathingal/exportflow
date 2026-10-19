import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';
import { translate, type Lang, type StringKey } from './i18n/strings';
import { readPref, writePref } from './lib/storage';
import { workspaceIdFor, type AppMode } from './lib/mode';
import { ensureWorkspaces } from './features/workspace/workspace';
import { reconcileStaleOps } from './features/sync/records';

interface AppState {
  user: User | null;
  authReady: boolean;
  workspaceError: string | null;
  mode: AppMode;
  setMode: (m: AppMode) => void;
  workspaceId: string | null;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: StringKey) => string;
  online: boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [mode, setModeState] = useState<AppMode>(readPref('mode') === 'DEMO' ? 'DEMO' : 'ACTUAL');
  const [lang, setLangState] = useState<Lang>(readPref('lang') === 'ml' ? 'ml' : 'en');
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setWorkspaceError(null);
      if (u) {
        try {
          await ensureWorkspaces(u.uid);
        } catch (e) {
          // Offline after a previous sign-in: workspaces already exist; continue.
          if (navigator.onLine) setWorkspaceError(e instanceof Error ? e.message : String(e));
        }
      }
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (user && online) void reconcileStaleOps();
  }, [user, online]);

  const setMode = useCallback((m: AppMode) => {
    writePref('mode', m);
    setModeState(m);
  }, []);
  const setLang = useCallback((l: Lang) => {
    writePref('lang', l);
    setLangState(l);
    document.documentElement.lang = l;
  }, []);
  const t = useCallback((k: StringKey) => translate(lang, k), [lang]);
  const logout = useCallback(() => signOut(auth), []);

  const value = useMemo<AppState>(
    () => ({
      user,
      authReady,
      workspaceError,
      mode,
      setMode,
      workspaceId: user ? workspaceIdFor(user.uid, mode) : null,
      lang,
      setLang,
      t,
      online,
      logout,
    }),
    [user, authReady, workspaceError, mode, setMode, lang, setLang, t, online, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
