import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@workspace/replit-auth-web';
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

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

// Wipe all cached per-user data whenever the signed-in identity changes (login, logout, switch, deletion).
function AuthCacheSync() {
  const { user, isLoading } = useAuth();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  const id = user?.id ?? null;
  useEffect(() => {
    if (isLoading) return;
    if (prev.current !== undefined && prev.current !== id) qc.clear();
    askSession.setOwner(id);
    prev.current = id;
  }, [id, isLoading, qc]);
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
                  <Route path="/capture" component={CapturePage} />
                  <Route path="/memories" component={MemoriesPage} />
                  <Route path="/memories/:id" component={MemoryDetailPage} />
                  <Route path="/ask" component={AskPage} />
                  <Route path="/settings" component={SettingsPage} />
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
