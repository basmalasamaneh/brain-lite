import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// Cookie-session email/password auth. Contract: /api/auth/*
export type AuthLanguage = 'en' | 'ar';
export type AuthTheme = 'system' | 'light' | 'dark';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  language: AuthLanguage;
  theme: AuthTheme;
  onboardingCompleted: boolean;
}

export interface SignupInput { email: string; password: string; name: string; language: AuthLanguage; theme: AuthTheme }
export interface ProfileUpdate { name?: string; language?: AuthLanguage; theme?: AuthTheme; onboardingCompleted?: boolean }

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; this.name = 'AuthError'; }
}

async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthError(0, 'network');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && typeof j.error === 'string') msg = j.error; } catch { /* ignore */ }
    throw new AuthError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

type Status = 'loading' | 'ready' | 'error';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  status: Status;
  /** Navigate to the login page (compat). */
  login: () => void;
  /** Ends the session and clears the user. */
  logout: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signUp: (input: SignupInput) => Promise<AuthUser>;
  refresh: () => Promise<void>;
  updateProfile: (patch: ProfileUpdate) => Promise<AuthUser | null>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function basePath() { return import.meta.env.BASE_URL.replace(/\/+$/, ''); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    setStatus('loading');
    try {
      const r = await call<{ user: AuthUser | null }>('me', 'GET');
      setUser(r.user ?? null);
      setStatus('ready');
    } catch (e) {
      setUser(null);
      setStatus(e instanceof AuthError && e.status === 401 ? 'ready' : 'error');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await call<{ user: AuthUser }>('login', 'POST', { email, password });
    seq.current++; setUser(r.user); setStatus('ready');
    return r.user;
  }, []);

  const signUp = useCallback(async (input: SignupInput) => {
    const r = await call<{ user: AuthUser }>('signup', 'POST', input);
    seq.current++; setUser(r.user); setStatus('ready');
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    let endpoint: string | undefined;
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        endpoint = subscription?.endpoint;
        // Server session binding remains authoritative even if this fails.
        if (endpoint) await fetch('/api/notifications/subscriptions', {
          method: 'DELETE', credentials: 'include', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({endpoint}),
        });
        await subscription?.unsubscribe();
      } catch { /* best effort device unsubscribe; logout below is required */ }
    }
    // Do not falsely mark the session logged out when server-side cleanup fails.
    await call<void>('logout', 'POST', endpoint ? {endpoint} : undefined);
    seq.current++; setUser(null); setStatus('ready');
  }, []);

  // Last-write-wins: stale responses from earlier PATCHes are ignored.
  const updateProfile = useCallback(async (patch: ProfileUpdate) => {
    const mine = ++seq.current;
    const r = await call<{ user: AuthUser }>('profile', 'PATCH', patch);
    if (mine === seq.current) { setUser(r.user); return r.user; }
    return null;
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await call<void>('password', 'POST', { currentPassword, newPassword });
  }, []);

  const deleteAccount = useCallback(async (password: string) => {
    await call<void>('account', 'DELETE', { confirmation: 'DELETE', password });
    seq.current++; setUser(null); setStatus('ready');
  }, []);

  const login = useCallback(() => { window.location.href = `${basePath()}/login`; }, []);

  const value = useMemo<AuthState>(() => ({
    user, status, isLoading: status === 'loading', isAuthenticated: !!user,
    login, logout, signIn, signUp, refresh, updateProfile, changePassword, deleteAccount,
  }), [user, status, login, logout, signIn, signUp, refresh, updateProfile, changePassword, deleteAccount]);

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthState {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}
