"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
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
  isInitializing: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Google Library API は非同期で読み込まれるため、初期化完了を遅延検知する
  useEffect(() => {
    const timer = setTimeout(() => setIsInitializing(false), 500);
    return () => clearTimeout(timer);
  }, []);

  const clearAuth = useCallback(() => {
    googleLogout();
    setUser(null);
    setAccessToken(null);
    if (expireTimer.current) {
      clearTimeout(expireTimer.current);
      expireTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (expireTimer.current) clearTimeout(expireTimer.current);
    };
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
      try {
        const token = tokenResponse.access_token;
        const userInfo = await fetchUserInfo(token);
        setUser(userInfo);
        setAccessToken(token);
        if (expireTimer.current) clearTimeout(expireTimer.current);
        const expiresInMs = (tokenResponse.expires_in ?? 3600) * 1000;
        const buffer = 60_000;
        const logoutDelayMs = Math.max(0, expiresInMs - buffer);
        expireTimer.current = setTimeout(clearAuth, logoutDelayMs);
      } catch {
        clearAuth();
      }
    },
    onError: clearAuth,
    scope:
      "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.appdata",
  });

  const logout = useCallback(() => {
    clearAuth();
  }, [clearAuth]);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated: !!user && !!accessToken,
        isInitializing,
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
