"use client";

import {
  createContext,
  useContext,
  useReducer,
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
  /** 初回マウント時に sessionStorage から認証状態を復元中か */
  isRestoring: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY_TOKEN = "auth_access_token";
const STORAGE_KEY_EXPIRES_AT = "auth_expires_at";
const STORAGE_KEY_USER = "auth_user_info";

function persistAuth(token: string, expiresIn: number, userInfo: UserInfo) {
  const expiresAt = Date.now() + expiresIn * 1000;
  sessionStorage.setItem(STORAGE_KEY_TOKEN, token);
  sessionStorage.setItem(STORAGE_KEY_EXPIRES_AT, String(expiresAt));
  sessionStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userInfo));
}

function clearPersistedAuth() {
  sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  sessionStorage.removeItem(STORAGE_KEY_EXPIRES_AT);
  sessionStorage.removeItem(STORAGE_KEY_USER);
}

interface PersistedAuth {
  token: string;
  expiresAt: number;
  userInfo: UserInfo;
}

function loadPersistedAuth(): PersistedAuth | null {
  const token = sessionStorage.getItem(STORAGE_KEY_TOKEN);
  const expiresAt = sessionStorage.getItem(STORAGE_KEY_EXPIRES_AT);
  const userInfo = sessionStorage.getItem(STORAGE_KEY_USER);
  if (!token || !expiresAt || !userInfo) return null;
  const parsedExpiresAt = Number(expiresAt);
  if (!Number.isFinite(parsedExpiresAt)) {
    clearPersistedAuth();
    return null;
  }
  if (Date.now() >= parsedExpiresAt) {
    clearPersistedAuth();
    return null;
  }
  try {
    return { token, expiresAt: parsedExpiresAt, userInfo: JSON.parse(userInfo) };
  } catch {
    clearPersistedAuth();
    return null;
  }
}

interface AuthState {
  user: UserInfo | null;
  accessToken: string | null;
  isRestoring: boolean;
}

type AuthAction =
  | { type: "RESTORE"; payload: PersistedAuth }
  | { type: "LOGIN"; payload: { token: string; expiresIn: number; userInfo: UserInfo } }
  | { type: "CLEAR" };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "RESTORE":
      return {
        user: action.payload.userInfo,
        accessToken: action.payload.token,
        isRestoring: false,
      };
    case "LOGIN":
      return {
        user: action.payload.userInfo,
        accessToken: action.payload.token,
        isRestoring: false,
      };
    case "CLEAR":
      return { user: null, accessToken: null, isRestoring: false };
  }
}

const INITIAL_STATE: AuthState = {
  user: null,
  accessToken: null,
  isRestoring: true,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, INITIAL_STATE);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAuth = useCallback(() => {
    googleLogout();
    clearPersistedAuth();
    dispatch({ type: "CLEAR" });
    if (expireTimer.current) {
      clearTimeout(expireTimer.current);
      expireTimer.current = null;
    }
  }, []);

  // 初回マウント時に sessionStorage から認証状態を復元
  useEffect(() => {
    const persisted = loadPersistedAuth();
    if (persisted) {
      const remainingMs = Math.max(0, persisted.expiresAt - Date.now() - 60_000);
      expireTimer.current = setTimeout(clearAuth, remainingMs);
      dispatch({ type: "RESTORE", payload: persisted });
    } else {
      dispatch({ type: "CLEAR" });
    }
  }, [clearAuth]);

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
        const expiresIn = tokenResponse.expires_in ?? 3600;
        const userInfo = await fetchUserInfo(token);
        persistAuth(token, expiresIn, userInfo);
        dispatch({
          type: "LOGIN",
          payload: { token, expiresIn, userInfo },
        });
        if (expireTimer.current) clearTimeout(expireTimer.current);
        const expiresInMs = expiresIn * 1000;
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
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: !!state.user && !!state.accessToken,
        isRestoring: state.isRestoring,
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
