import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AuthError, useAuth } from '@workspace/replit-auth-web';
import type { Memory } from '@workspace/api-client-react';
import { useI18n, type Lang, type TKey } from '@/lib/i18n';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { useToast } from '@/hooks/use-toast';

/** Only allow same-app relative paths; blocks //host, /\host, schemes. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/';
  let v = raw;
  try { v = decodeURIComponent(raw); } catch { return '/'; }
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || /[\u0000-\u001f]/.test(v)) return '/';
  if (/^\/(login|signup|onboarding)(\/|\?|$)/.test(v)) return '/';
  return v;
}

export function nextParam(search: string) {
  return safeNext(new URLSearchParams(search).get('next'));
}

export function withNext(path: string, next: string) {
  const n = safeNext(next);
  return n === '/' ? path : `${path}?next=${encodeURIComponent(n)}`;
}

export function authErrorKey(e: unknown, kind: 'login' | 'signup' | 'other'): TKey {
  if (e instanceof AuthError) {
    if (e.status === 0) return 'authNetwork';
    if (e.status === 429) return 'authRate';
    if (kind === 'login' && (e.status === 401 || e.status === 400)) return 'authInvalid';
    if (kind === 'signup' && e.status === 409) return 'authTaken';
  }
  return 'authGeneric';
}

export function isSample(m: Memory) {
  const extra = (m.extra ?? {}) as Record<string, unknown>;
  return m.tags.includes('sample') || extra.is_sample === true || (m as unknown as { is_sample?: boolean }).is_sample === true;
}

/** Set language/theme locally and persist to profile. */
export function usePreferences() {
  const { setLang } = useI18n();
  const { setTheme } = useTheme();
  const { user, updateProfile } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();
  const r = useRef({ setLang, setTheme, user, updateProfile, toast, t });
  r.current = { setLang, setTheme, user, updateProfile, toast, t };
  const persist = useCallback((patch: { language?: Lang; theme?: ThemeChoice }) => {
    const c = r.current;
    if (!c.user) return;
    c.updateProfile(patch).catch(() => c.toast({ variant: 'destructive', title: c.t('prefsSaveFail') }));
  }, []);
  const setLanguage = useCallback((l: Lang) => { r.current.setLang(l); persist({ language: l }); }, [persist]);
  const setThemePref = useCallback((th: ThemeChoice) => { r.current.setTheme(th); persist({ theme: th }); }, [persist]);
  return { setLanguage, setTheme: setThemePref };
}

export function useRemoveSamples() {
  const qc = useQueryClient();
  return useCallback(async () => {
    const res = await fetch('/api/memories/samples', { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error(String(res.status));
    await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? '').startsWith('/api/memories') });
  }, [qc]);
}
