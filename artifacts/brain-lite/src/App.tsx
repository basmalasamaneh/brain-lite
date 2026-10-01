import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@workspace/replit-auth-web';
import { useInitializeNotificationTimezone } from '@workspace/api-client-react';
import { RequireAuth, PublicOnly } from '@/components/auth-gate';
import { askSession } from '@/lib/ask-session';
import AuthPage from '@/pages/auth';
import OnboardingPage from '@/pages/onboarding';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { I18nProvider, useI18n } from '@/lib/i18n';
import { ThemeProvider, useTheme } from '@/lib/theme';
import NotFound from '@/pages/not-found';
import HomePage from '@/pages/home';
import CapturePage from '@/pages/capture';
import MemoriesPage from '@/pages/memories';
import MemoryDetailPage from '@/pages/memory-detail';
import AskPage from '@/pages/ask';
import SettingsPage from '@/pages/settings';
import SpacesPage from '@/pages/spaces';
import SpaceDetailPage from '@/pages/space-detail';
import GraphPage from '@/pages/graph';
import { NotificationCenter } from '@/components/notifications';
import { useToast } from '@/hooks/use-toast';
import { clearDeferredConnections } from '@/lib/deferred-connections';
import { connectionText } from '@/lib/i18n-connections';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// Wipe all cached per-user data whenever the signed-in identity changes (login, logout, switch, deletion).
function AuthCacheSync() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { lang } = useI18n();
  const prev = useRef<string | null | undefined>(undefined);
  const id = user?.id ?? null;
  useEffect(() => {
    if (isLoading) return;
    if (prev.current !== undefined && prev.current !== id) {
      if (prev.current) {
        try { clearDeferredConnections(prev.current); }
        catch { toast({ variant: 'destructive', title: connectionText(lang, 'laterError'), description: connectionText(lang, 'laterClearError') }); }
      }
      qc.clear();
      if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).then(registration => registration?.active?.postMessage({ type: 'BRAIN_LITE_CLEAR_NOTIFICATIONS' })).catch(() => undefined);
    }
    askSession.setOwner(id);
    prev.current = id;
  }, [id, isLoading, qc, lang, toast]);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const refresh = (event: MessageEvent) => {
      if (event.data?.type === 'BRAIN_LITE_REMINDERS_CHANGED') {
        qc.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('/api/reminders') || String(q.queryKey[0]).startsWith('/api/notifications') });
      }
    };
    navigator.serviceWorker.addEventListener('message', refresh);
    return () => navigator.serviceWorker.removeEventListener('message', refresh);
  }, [qc]);
  return null;
}

// Runs once for each authenticated identity on this app load, including users
// who completed onboarding before notification settings existed. The server's
// initialized guard makes this safe for already-edited timezones.
function NotificationTimezoneSync() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const { lang } = useI18n();
  const { toast } = useToast();
  const attempted = useRef(new Set<string>());
  const { mutate } = useInitializeNotificationTimezone({ request: { credentials: 'include' } });
  const owner = user?.id;
  useEffect(() => {
    if (isLoading || !owner || attempted.current.has(owner)) return;
    attempted.current.add(owner);
    mutate({ data: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }, {
      onSuccess: settings => {
        qc.setQueryData(['/api/notifications/settings', owner], settings);
        qc.invalidateQueries({ predicate: q => q.queryKey[1] === owner && String(q.queryKey[0]).startsWith('/api/reminders') });
      },
      onError: error => toast({
        variant: 'destructive',
        title: lang === 'ar' ? 'تعذّر إعداد المنطقة الزمنية للتذكيرات' : 'Could not initialize your reminder timezone',
        description: lang === 'ar' ? 'اختر منطقتك الزمنية في إعدادات الإشعارات قبل جدولة التذكيرات.' : `Choose your timezone in notification Settings before scheduling reminders. ${error.message}`,
      }),
    });
  }, [isLoading, owner, mutate, qc, lang, toast]);
  return null;
}

// Apply persisted language/theme once per identity. Later edits go through usePreferences.
function ProfilePrefsSync() {
  const { user } = useAuth();
  const { setLang } = useI18n();
  const { setTheme } = useTheme();
  const fns = useRef({ setLang, setTheme });
  fns.current = { setLang, setTheme };
  const applied = useRef<string | null>(null);
  const id = user?.id ?? null;
  useEffect(() => {
    if (!user) { applied.current = null; return; }
    if (applied.current === user.id) return;
    applied.current = user.id;
    fns.current.setLang(user.language);
    fns.current.setTheme(user.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return null;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location]);
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login">{() => <PublicOnly><AuthPage mode="login" /></PublicOnly>}</Route>
      <Route path="/signup">{() => <PublicOnly><AuthPage mode="signup" /></PublicOnly>}</Route>
      <Route path="/onboarding">{() => <RequireAuth onboarding><OnboardingPage /></RequireAuth>}</Route>
      <Route>
        {() => (
          <RequireAuth>
            <AppShell>
              <RoutedErrorBoundary>
                <Switch>
                  <Route path="/" component={HomePage} />
                  <Route path="/notifications" component={NotificationCenter} />
                  <Route path="/capture" component={CapturePage} />
                  <Route path="/memories" component={MemoriesPage} />
                  <Route path="/memories/:id" component={MemoryDetailPage} />
                  <Route path="/graph" component={GraphPage} />
                  <Route path="/ask" component={AskPage} />
                  <Route path="/settings" component={SettingsPage} />
                  <Route path="/spaces" component={SpacesPage} />
                  <Route path="/spaces/:id">{(params) => <SpaceDetailPage key={params.id} />}</Route>
                  <Route component={NotFound} />
                </Switch>
              </RoutedErrorBoundary>
            </AppShell>
          </RequireAuth>
        )}
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
          <TooltipProvider>
            <AuthCacheSync />
            <NotificationTimezoneSync />
            <ProfilePrefsSync />
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
