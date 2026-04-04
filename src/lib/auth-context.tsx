"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useGoogleLogin, googleLogout } from "@react-oauth/google";

export interface UserInfo {
  sub: string;
  name: string;
  given_name: string;
  family_name: string;
  picture: string;
  email: string;
  email_verified: boolean;
  locale: string;
}

interface AuthContextValue {
  user: UserInfo | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "google_auth";

function loadStoredAuth(): {
  user: UserInfo | null;
  accessToken: string | null;
} {
  if (typeof window === "undefined") return { user: null, accessToken: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, accessToken: null };
    const data = JSON.parse(raw);
    return { user: data.user ?? null, accessToken: data.accessToken ?? null };
  } catch {
    return { user: null, accessToken: null };
  }
}

function storeAuth(user: UserInfo | null, accessToken: string | null) {
  if (typeof window === "undefined") return;
  if (user && accessToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, accessToken }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = loadStoredAuth();
    if (stored.user && stored.accessToken) {
      setUser(stored.user);
      setAccessToken(stored.accessToken);
    }
    setIsLoading(false);
  }, []);

  const fetchUserInfo = useCallback(async (token: string) => {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!res.ok) throw new Error("Failed to fetch user info");
    return res.json() as Promise<UserInfo>;
  }, []);

  const login = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      const token = tokenResponse.access_token;
      const userInfo = await fetchUserInfo(token);
      setUser(userInfo);
      setAccessToken(token);
      storeAuth(userInfo, token);
    },
    onError: () => {
      logout();
    },
    scope:
      "openid email profile https://www.googleapis.com/auth/drive.appdata",
  });

  const logout = useCallback(() => {
    googleLogout();
    setUser(null);
    setAccessToken(null);
    storeAuth(null, null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated: !!user && !!accessToken,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
