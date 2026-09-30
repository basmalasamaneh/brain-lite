import type { ReactNode } from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import { Brain } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useI18n } from '@/lib/i18n';
import { nextParam, withNext } from '@/lib/auth-helpers';
import { ErrorState } from '@/components/kit';

export function FullPageSkeleton() {
  return (
    <div className="min-h-[100dvh] md:ps-64" aria-busy="true" aria-live="polite">
      <div className="fixed inset-y-0 start-0 hidden w-64 border-e border-sidebar-border bg-sidebar/80 p-5 md:block">
        <div className="flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/80 text-primary-foreground"><Brain className="h-5 w-5" /></span><div className="h-4 w-24 animate-pulse rounded bg-muted" /></div>
        <div className="mt-10 space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-9 animate-pulse rounded-xl bg-muted" style={{ animationDelay: `${i * 80}ms` }} />)}</div>
      </div>
      <div className="mx-auto max-w-5xl space-y-4 px-4 pt-10 sm:px-8 md:pt-14">
        <div className="h-9 w-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded bg-muted" />
        <div className="grid gap-3 pt-6 sm:grid-cols-[2fr_1fr]"><div className="h-44 animate-pulse rounded-2xl bg-muted" /><div className="h-44 animate-pulse rounded-2xl bg-muted" /></div>
        <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

function currentPath(loc: string, search: string) {
  return search ? `${loc}?${search}` : loc;
}

export function RequireAuth({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  const { user, status, refresh } = useAuth();
  const { t } = useI18n();
  const [loc] = useLocation();
  const search = useSearch();
  if (status === 'loading') return <FullPageSkeleton />;
  if (status === 'error') return <div className="mx-auto max-w-md px-4 pt-24"><ErrorState message={t('authCheckFailed')} onRetry={() => void refresh()} /></div>;
  if (!user) return <Redirect to={withNext('/login', currentPath(loc, search))} replace />;
  if (!onboarding && !user.onboardingCompleted) return <Redirect to={withNext('/onboarding', currentPath(loc, search))} replace />;
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { user, status } = useAuth();
  const search = useSearch();
  if (status === 'loading') return <div className="min-h-[100dvh] animate-pulse bg-muted/40" aria-busy="true" />;
  if (user) {
    const next = nextParam(search);
    return <Redirect to={user.onboardingCompleted ? next : withNext('/onboarding', next)} replace />;
  }
  return <>{children}</>;
}
