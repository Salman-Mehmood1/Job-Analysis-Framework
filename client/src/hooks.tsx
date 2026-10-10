import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, type Organization, type User } from './api';

export function useData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let live = true;
    setLoading(true);
    api
      .get<T>(url)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

interface AuthState {
  user: User | null;
  organization: Organization | null;
  ready: boolean;
  setSession: (s: { user: User; organization: Organization } | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .get<{ user: User; organization: Organization }>('/auth/me')
      .then((s) => {
        setUser(s.user);
        setOrganization(s.organization);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const setSession: AuthState['setSession'] = (s) => {
    setUser(s?.user ?? null);
    setOrganization(s?.organization ?? null);
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, organization, ready, setSession, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** Signed-in user; only used inside role-protected routes. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('No user');
  return user;
}
