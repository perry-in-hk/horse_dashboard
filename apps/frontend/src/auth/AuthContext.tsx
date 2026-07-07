import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const apiBase = () => import.meta.env.VITE_API_URL ?? "";

export type AuthUser = {
  id: number;
  username: string;
  role: "admin" | "user";
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch(`${apiBase()}/api/auth/me`, { credentials: "include" });
    if (res.status === 401) {
      setUser(null);
      return;
    }
    if (!res.ok) {
      setUser(null);
      return;
    }
    const data = (await res.json()) as { user: AuthUser };
    setUser(data.user);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const login = useCallback(async () => {
    window.location.assign(`${apiBase()}/api/auth/login`);
  }, []);

  const logout = useCallback(async () => {
    const res = await fetch(`${apiBase()}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    if (!res.ok) return;
    const payload = (await res.json()) as { redirectUrl?: string };
    if (payload.redirectUrl) {
      window.location.assign(payload.redirectUrl);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
