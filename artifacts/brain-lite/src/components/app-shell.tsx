import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Brain, Home, Languages, Library, Loader2, LogOut, MessageCircleQuestion, Monitor, Moon, Plus, Settings, Sun } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { usePreferences } from '@/lib/auth-helpers';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const nav: { href: string; key: TKey; icon: typeof Home }[] = [
  { href: '/', key: 'navHome', icon: Home },
  { href: '/capture', key: 'navCapture', icon: Plus },
  { href: '/memories', key: 'navMemories', icon: Library },
  { href: '/ask', key: 'navAsk', icon: MessageCircleQuestion },
  { href: '/settings', key: 'navSettings', icon: Settings },
];

function isActive(loc: string, href: string) {
  return href === '/' ? loc === '/' : loc.startsWith(href);
}

function ThemeSwitch() {
  const { theme } = useTheme();
  const { setTheme } = usePreferences();
  const { t } = useI18n();
  const opts: { v: ThemeChoice; icon: typeof Sun; k: TKey }[] = [
    { v: 'light', icon: Sun, k: 'themeLight' }, { v: 'dark', icon: Moon, k: 'themeDark' }, { v: 'system', icon: Monitor, k: 'themeSystem' },
  ];
  return (
    <div className="flex rounded-xl bg-muted p-1" role="radiogroup" aria-label={t('theme')}>
      {opts.map(({ v, icon: Icon, k }) => (
        <button key={v} role="radio" aria-checked={theme === v} title={t(k)} onClick={() => setTheme(v)} data-testid={`button-theme-${v}`}
          className={cn('flex flex-1 items-center justify-center rounded-lg py-1.5 transition', theme === v ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          <Icon className="h-4 w-4" /><span className="sr-only">{t(k)}</span>
        </button>
      ))}
    </div>
  );
}

function LangSwitch({ compact }: { compact?: boolean }) {
  const { lang, t } = useI18n();
  const { setLanguage: setLang } = usePreferences();
  return (
    <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} aria-label={t('language')} data-testid="button-language"
      className={cn('flex items-center gap-2 rounded-xl text-sm font-medium transition hover:bg-lavender hover:text-primary', compact ? 'h-9 px-2.5' : 'w-full px-3 py-2')}>
      <Languages className="h-4 w-4" />
      <span>{lang === 'en' ? 'العربية' : 'English'}</span>
    </button>
  );
}

function AuthBlock() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const name = user.name || user.email;
  const doLogout = async () => {
    setBusy(true);
    try { await logout(); navigate('/login', { replace: true }); }
    catch { toast({ variant: 'destructive', title: t('logoutFail') }); setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3 rounded-xl p-2">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-lavender text-sm font-semibold text-primary" aria-hidden>{name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" data-testid="text-username">{name}</span>
        <span className="block truncate text-xs text-muted-foreground" dir="ltr" data-testid="text-user-email">{user.email}</span>
      </span>
      <button onClick={doLogout} disabled={busy} title={t('logout')} className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50" data-testid="button-logout">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4 rtl:-scale-x-100" />}<span className="sr-only">{t('logout')}</span>
      </button>
    </div>
  );
}

function Logo() {
  const { t } = useI18n();
  return (
    <Link href="/" className="flex items-center gap-2.5" data-testid="link-logo">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Brain className="h-5 w-5" /></span>
      <span className="font-display text-lg font-bold">{t('appName')}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { t } = useI18n();
  const mobileTabs = [nav[0], nav[1], nav[3], nav[2]];

  return (
    <div className="min-h-[100dvh]">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-sidebar-border bg-sidebar/80 p-5 backdrop-blur md:flex">
        <Logo />
        <p className="mt-2 text-xs text-muted-foreground">{t('tagline')}</p>
        <nav className="mt-8 flex flex-col gap-1">
          {nav.map(({ href, key, icon: Icon }) => {
            const active = isActive(loc, href);
            return (
              <Link key={href} href={href} data-testid={`link-nav-${key}`}
                className={cn('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                {active && <span className="absolute inset-y-2 start-0 w-1 rounded-full bg-primary" />}
                <Icon className="h-[18px] w-[18px] transition group-hover:scale-110" />
                {t(key)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-3">
          <ThemeSwitch />
          <LangSwitch />
          <div className="border-t border-sidebar-border pt-3"><AuthBlock /></div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <LangSwitch compact />
          <Link href="/settings" aria-label={t('navSettings')} data-testid="link-mobile-settings"
            className={cn('grid h-9 w-9 place-items-center rounded-xl transition hover:bg-lavender hover:text-primary', isActive(loc, '/settings') && 'bg-lavender text-primary')}>
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="md:ps-64">
        <div className="mx-auto w-full max-w-5xl px-4 pb-32 pt-6 sm:px-8 md:pb-16 md:pt-12">{children}</div>
        <div className="px-4 pb-28 md:hidden"><AuthBlock /></div>
      </main>

      <nav className="fixed inset-x-3 bottom-3 z-40 flex items-end justify-around rounded-2xl border border-border bg-card/90 px-2 pb-2 pt-2 soft-shadow backdrop-blur md:hidden">
        {mobileTabs.map(({ href, key, icon: Icon }) => {
          const active = isActive(loc, href);
          if (href === '/capture') return (
            <Link key={href} href={href} aria-label={t(key)} data-testid="link-tab-capture" className="-mt-7 flex flex-col items-center gap-1">
              <span className={cn('grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_24px_-8px_hsl(var(--primary)/0.8)] transition active:scale-90', active && 'ring-4 ring-lavender')}>
                <Plus className="h-7 w-7" />
              </span>
              <span className={cn('text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}>{t(key)}</span>
            </Link>
          );
          return (
            <Link key={href} href={href} data-testid={`link-tab-${key}`} className={cn('flex w-16 flex-col items-center gap-1 rounded-xl py-1 text-[11px] font-medium transition active:scale-90', active ? 'text-primary' : 'text-muted-foreground')}>
              <Icon className="h-5 w-5" />{t(key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
