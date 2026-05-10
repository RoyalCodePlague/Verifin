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
  onAuthExpired,
  registerRequest,
  setTokens,
  staffLoginRequest,
  type ApiUser,
  type StaffSession,
} from "@/lib/api";
import { loadServerData } from "@/lib/sync";
import { useStore } from "@/lib/store";
import {
  clearAuthenticatedOfflineSession,
  clearOfflineQueue,
  clearOfflineSession,
  getOfflineQueue,
  hasAuthenticatedOfflineSession,
  markAuthenticatedOfflineSession,
} from "@/lib/offlineQueue";

const CACHED_USER_KEY = "sp_cached_user";
const STAFF_SESSION_KEY = "sp_staff_session";

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

function clearCachedUser() {
  localStorage.removeItem(CACHED_USER_KEY);
}

function loadStaffSession(): StaffSession | null {
  try {
    const stored = localStorage.getItem(STAFF_SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveStaffSession(staff: StaffSession) {
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(staff));
}

export const ROLE_DEFAULT_PERMISSIONS: Record<string, string[]> = {
  Owner: ["*"],
  Manager: ["dashboard", "inventory", "sales", "expenses", "customers", "reports", "audits", "suppliers"],
  "Stock Manager": ["dashboard", "inventory", "audits", "suppliers"],
  Cashier: ["dashboard", "sales", "customers", "inventory"],
};

type AuthContextValue = {
  user: ApiUser | null;
  staffSession: StaffSession | null;
  isStaffSession: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  staffLogin: (businessCode: string, username: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string, referralCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  canAccess: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [staffSession, setStaffSession] = useState<StaffSession | null>(() => loadStaffSession());
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
    if (getOfflineQueue().length > 0) return;
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
        setStaffSession(loadStaffSession());
        markAuthenticatedOfflineSession();
        setUser(u);
        if (getOfflineQueue().length > 0) return;
        await applyServerData(u);
      } catch {
        const cachedUser = loadCachedUser();
        if (!navigator.onLine && cachedUser && hasAuthenticatedOfflineSession()) {
          setUser(cachedUser);
          return;
        }
        clearTokens();
        localStorage.removeItem(STAFF_SESSION_KEY);
        setStaffSession(null);
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyServerData, resetForLogout]);

  useEffect(() => {
    return onAuthExpired(() => {
      localStorage.removeItem(STAFF_SESSION_KEY);
      clearCachedUser();
      clearAuthenticatedOfflineSession();
      setStaffSession(null);
      setUser(null);
      resetForLogout();
    });
  }, [resetForLogout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await loginRequest(email, password);
      localStorage.removeItem(STAFF_SESSION_KEY);
      setStaffSession(null);
      setTokens(tokens.access, tokens.refresh);
      await refreshUser();
    },
    [refreshUser]
  );

  const staffLogin = useCallback(
    async (businessCode: string, username: string, password: string) => {
      const res = await staffLoginRequest({ business_code: businessCode, username, password });
      setTokens(res.access, res.refresh);
      saveCachedUser(res.user);
      saveStaffSession(res.staff);
      setStaffSession(res.staff);
      setUser(res.user);
      markAuthenticatedOfflineSession();
      await applyServerData(res.user);
    },
    [applyServerData]
  );

  const register = useCallback(
    async (email: string, password: string, name?: string, referralCode?: string) => {
      const res = await registerRequest({
        email,
        password,
        business_name: name || "",
        referral_code: referralCode || "",
      });
      setTokens(res.access, res.refresh);
      localStorage.removeItem(STAFF_SESSION_KEY);
      setStaffSession(null);
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
      clearCachedUser();
      localStorage.removeItem(STAFF_SESSION_KEY);
      clearOfflineQueue();
      clearOfflineSession();
      clearAuthenticatedOfflineSession();
      setUser(null);
      setStaffSession(null);
      resetForLogout();
    }
  }, [resetForLogout]);

  const canAccess = useCallback(
    (permission: string) => {
      if (!staffSession) return true;
      const permissions = staffSession.permissions?.length ? staffSession.permissions : ROLE_DEFAULT_PERMISSIONS[staffSession.role] || [];
      return permissions.includes("*") || permissions.includes(permission);
    },
    [staffSession]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      staffSession,
      isStaffSession: !!staffSession,
      isAuthenticated: !!user,
      isLoading,
      login,
      staffLogin,
      register,
      logout,
      refreshUser,
      canAccess,
    }),
    [user, staffSession, isLoading, login, staffLogin, register, logout, refreshUser, canAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
