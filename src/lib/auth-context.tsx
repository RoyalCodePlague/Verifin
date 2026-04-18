import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  apiFetch,
  clearTokens,
  fetchMe,
  getAccessToken,
  loginRequest,
  logoutRequest,
  registerRequest,
  setTokens,
  type ApiUser,
} from "@/lib/api";
import { loadServerData } from "@/lib/sync";
import { useStore } from "@/lib/store";
import {
  clearAuthenticatedOfflineSession,
  clearOfflineQueue,
  clearOfflineSession,
  hasAuthenticatedOfflineSession,
  markAuthenticatedOfflineSession,
} from "@/lib/offlineQueue";

const CACHED_USER_KEY = "sp_cached_user";

function loadCachedUser(): ApiUser | null {
  try {
    const stored = localStorage.getItem(CACHED_USER_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveCachedUser(user: ApiUser) {
  localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
}

type AuthContextValue = {
  user: ApiUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { hydrateFromServer, resetForLogout } = useStore();

  const applyServerData = useCallback(
    async (u: ApiUser) => {
      const data = await loadServerData(u);
      hydrateFromServer(data);
    },
    [hydrateFromServer]
  );

  const refreshUser = useCallback(async () => {
    const u = await fetchMe();
    saveCachedUser(u);
    markAuthenticatedOfflineSession();
    setUser(u);
    await applyServerData(u);
  }, [applyServerData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const u = await fetchMe();
        if (cancelled) return;
        saveCachedUser(u);
        markAuthenticatedOfflineSession();
        setUser(u);
        await applyServerData(u);
      } catch {
        const cachedUser = loadCachedUser();
        if (!navigator.onLine && cachedUser && hasAuthenticatedOfflineSession()) {
          setUser(cachedUser);
          return;
        }
        clearTokens();
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyServerData, resetForLogout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await loginRequest(email, password);
      setTokens(tokens.access, tokens.refresh);
      await refreshUser();
    },
    [refreshUser]
  );

  const register = useCallback(
    async (email: string, password: string, name?: string) => {
      const res = await registerRequest({
        email,
        password,
        business_name: name || "",
      });
      setTokens(res.access, res.refresh);
      await refreshUser();
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // ignore server logout failures and clear local auth state anyway
    } finally {
      clearTokens();
      localStorage.removeItem(CACHED_USER_KEY);
      clearOfflineQueue();
      clearOfflineSession();
      clearAuthenticatedOfflineSession();
      setUser(null);
      resetForLogout();
    }
  }, [resetForLogout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      register,
      logout,
      refreshUser,
    }),
    [user, isLoading, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
