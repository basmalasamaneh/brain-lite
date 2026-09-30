import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { motion, useReducedMotion } from 'framer-motion';
import { Home, Languages, Library, Loader2, LogOut, MessageCircleQuestion, Monitor, Moon, Plus, Settings, Sun, Layers } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { usePreferences } from '@/lib/auth-helpers';
import { useToast } from '@/hooks/use-toast';
import { Wordmark } from '@/components/brand';
import { PageTransition } from '@/components/motion';
import { cn } from '@/lib/utils';
import { InstallPrompt } from '@/components/install-prompt';
import { useMobileKeyboard } from '@/hooks/use-mobile-keyboard';
import { spaceText } from '@/lib/i18n-spaces';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const nav: { href: string; key: TKey; icon: typeof Home }[] = [
  { href: '/', key: 'navHome', icon: Home },
  { href: '/memories', key: 'navMemories', icon: Library },
  { href: '/capture', key: 'navCapture', icon: Plus },
  { href: '/ask', key: 'navAsk', icon: MessageCircleQuestion },
  { href: '/spaces', key: 'navSpaces', icon: Layers },
];

function isActive(loc: string, href: string) {
  return href === '/' ? loc === '/' : loc.startsWith(href);
}

const themeOpts: { v: ThemeChoice; icon: typeof Sun; k: TKey }[] = [
  { v: 'light', icon: Sun, k: 'themeLight' }, { v: 'dark', icon: Moon, k: 'themeDark' }, { v: 'system', icon: Monitor, k: 'themeSystem' },
];

function ThemeSwitch() {
  const reduce = useReducedMotion();
  const { theme } = useTheme();
  const { setTheme } = usePreferences();
  const { t } = useI18n();
  return (
    <div className="flex rounded-xl border border-border bg-surface-alt p-1" role="radiogroup" aria-label={t('theme')}>
      {themeOpts.map(({ v, icon: Icon, k }) => (
        <button key={v} role="radio" aria-checked={theme === v} aria-label={t(k)} title={t(k)} onClick={() => setTheme(v)} data-testid={`button-theme-${v}`}
          className={cn('relative flex h-10 flex-1 items-center justify-center rounded-lg transition', theme === v ? 'text-gold' : 'text-muted-foreground hover:text-foreground')}>
          {theme === v && <motion.span layoutId="theme-pill" className="absolute inset-0 rounded-lg bg-card soft-shadow ring-1 ring-gold-400/40" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }} />}
          <Icon className="relative h-4 w-4" strokeWidth={1.75} />
        </button>
      ))}
    </div>
  );
}

/** Compact theme button for the mobile header: cycles light → dark → system. */
export function ThemeCycle() {
  const reduce = useReducedMotion();
  const { theme } = useTheme();
  const { setTheme } = usePreferences();
  const { t } = useI18n();
  const i = themeOpts.findIndex((o) => o.v === theme);
  const cur = themeOpts[i < 0 ? 2 : i];
  const next = themeOpts[((i < 0 ? 2 : i) + 1) % 3];
  const Icon = cur.icon;
  return (
    <button onClick={() => setTheme(next.v)} aria-label={`${t('switchTheme')}: ${t(cur.k)}`} title={t(cur.k)} data-testid="button-theme-cycle"
      className="grid h-11 w-11 place-items-center rounded-xl text-foreground/80 transition hover:bg-gold-soft hover:text-gold active:scale-95">
      <motion.span key={cur.v} initial={reduce ? false : { rotate: -60, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} transition={{ duration: reduce ? 0 : 0.25 }}><Icon className="h-[18px] w-[18px]" strokeWidth={1.75} /></motion.span>
    </button>
  );
}

export function LangSwitch({ compact }: { compact?: boolean }) {
  const { lang, t } = useI18n();
  const { setLanguage: setLang } = usePreferences();
  return (
    <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} aria-label={t('language')} data-testid="button-language"
      className={cn('flex min-h-11 items-center gap-2 rounded-xl text-sm font-medium transition hover:bg-gold-soft hover:text-gold active:scale-95',
        compact ? 'shrink-0 px-2 sm:px-3' : 'w-full border border-border px-3')}>
      <Languages className={cn('h-4 w-4 shrink-0', compact && 'max-[400px]:hidden')} strokeWidth={1.75} />
      <span dir="ltr"><span className={lang === 'en' ? 'font-bold text-gold underline underline-offset-4' : 'text-muted-foreground'}>EN</span><span aria-hidden="true"> / </span><span className={lang === 'ar' ? 'font-bold text-gold underline underline-offset-4' : 'text-muted-foreground'}>AR</span></span>
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
    <div className="flex min-w-0 items-center gap-3 rounded-xl p-1">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full gold-gradient font-display text-lg font-semibold text-gold-ink" aria-hidden>{name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" data-testid="text-username">{name}</span>
        <span className="block truncate text-xs text-muted-foreground" dir="ltr" data-testid="text-user-email">{user.email}</span>
      </span>
      <button onClick={doLogout} disabled={busy} title={t('logout')} aria-label={t('logout')} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-gold-soft hover:text-foreground disabled:opacity-50" data-testid="button-logout">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.75} />}
      </button>
    </div>
  );
}

function Logo() {
  const { t } = useI18n();
  return <Link href="/" className="rounded-xl" data-testid="link-logo" aria-label={t('appName')}><Wordmark name={t('appName')} /></Link>;
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { t, lang } = useI18n();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  return <DropdownMenu dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <DropdownMenuTrigger asChild><button aria-label={spaceText(lang, 'account')} data-testid="button-account-menu" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-400/40 bg-gold-soft text-gold"><span className="font-display text-lg">{(user.name || user.email).charAt(0).toUpperCase()}</span></button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56 rounded-2xl border-gold-400/40 p-2">
      <DropdownMenuLabel className="truncate">{user.name || user.email}</DropdownMenuLabel><DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => navigate('/settings')} className="min-h-11 gap-2 rounded-xl" data-testid="menu-settings"><Settings className="h-4 w-4" />{t('navSettings')}</DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={async () => {
        setBusy(true);
        try { await logout(); navigate('/login', { replace: true }); }
        catch { toast({ variant: 'destructive', title: t('logoutFail') }); setBusy(false); }
      }} className="min-h-11 gap-2 rounded-xl"><LogOut className="h-4 w-4" />{t('logout')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function AppShell({ children }: { children: ReactNode }) {
  useMobileKeyboard();
  const [loc] = useLocation();
  const { t } = useI18n();
  const reduce = useReducedMotion();

  return (
    <div className="min-h-[100dvh]">
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-72 flex-col border-e border-sidebar-border bg-sidebar/90 p-6 backdrop-blur md:flex">
        <div className="pattern-star pointer-events-none absolute inset-x-0 top-0 h-48 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden />
        <div className="relative flex items-center justify-between gap-2"><Logo /><AccountMenu /></div>
        <p className="relative mt-3 text-xs text-muted-foreground">{t('tagline')}</p>
        <nav className="relative mt-10 flex flex-col gap-1" aria-label={t('mainNav')}>
          {nav.map(({ href, key, icon: Icon }) => {
            const active = isActive(loc, href);
            return (
              <Link key={href} href={href} data-testid={`link-nav-${key}`} aria-current={active ? 'page' : undefined}
                className={cn('group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
                  active ? 'text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-gold-soft/60 hover:text-foreground')}>
                {active && <motion.span layoutId="side-active" className="absolute inset-0 rounded-xl bg-sidebar-accent ring-1 ring-inset ring-gold-400/30" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />}
                {active && <motion.span layoutId="side-bar" className="absolute inset-y-2.5 start-0 w-[3px] rounded-full gold-gradient" />}
                <Icon className="relative h-[18px] w-[18px] transition group-hover:scale-110" strokeWidth={1.5} />
                <span className="relative">{t(key)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="relative mt-auto space-y-3">
          <ThemeSwitch />
          <LangSwitch />
          <div className="border-t border-sidebar-border pt-3"><AuthBlock /></div>
        </div>
      </aside>

      <header className="mobile-safe-header sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur md:hidden">
        <Logo />
        <div className="flex items-center">
          <LangSwitch compact />
          <ThemeCycle />
          <AccountMenu />
        </div>
      </header>

      <main id="main" tabIndex={-1} className="md:ps-72">
        <InstallPrompt />
        <div className="mobile-page-content mx-auto w-full min-w-0 max-w-5xl px-4 pb-36 pt-6 sm:px-8 md:pb-16 md:pt-12">
          <PageTransition routeKey={loc}>{children}</PageTransition>
        </div>
        <div className="px-4 pb-32 md:hidden"><div className="rounded-2xl border border-border bg-card p-2"><AuthBlock /></div></div>
      </main>

      <nav aria-label={t('mainNav')} className="mobile-bottom-tabs fixed inset-x-3 z-40 grid grid-cols-5 items-end rounded-2xl border border-gold-400/30 bg-card/95 px-1 pt-1.5 lux-shadow backdrop-blur md:hidden">
        {nav.map(({ href, key, icon: Icon }) => {
          const active = isActive(loc, href);
          if (href === '/capture') return (
            <Link key={href} href={href} aria-label={t(key)} aria-current={active ? 'page' : undefined} data-testid="link-tab-capture" className="-mt-8 flex flex-col items-center gap-1 rounded-full">
              <motion.span whileTap={reduce ? undefined : { scale: 0.9 }}
                className={cn('btn-gold grid h-16 w-16 place-items-center rounded-full ring-4 ring-background', active && 'ring-gold-300/60')}>
                <Plus className="h-7 w-7" strokeWidth={2} />
              </motion.span>
              <span className={cn('text-[11px] font-medium', active ? 'text-gold' : 'text-muted-foreground')}>{t(key)}</span>
            </Link>
          );
          return (
            <Link key={href} href={href} data-testid={`link-tab-${key}`} aria-current={active ? 'page' : undefined}
              className={cn('relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition active:scale-95', active ? 'text-gold' : 'text-muted-foreground')}>
              {active && <motion.span layoutId="tab-indicator" className="absolute top-0 h-[3px] w-8 rounded-full gold-gradient" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
              <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
              <span className="max-w-full truncate px-0.5">{t(key)}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
