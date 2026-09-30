import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, KeyRound, Languages, Loader2, LogOut, Monitor, Moon, Palette, ShieldCheck, Sun, Trash2, UserRound } from 'lucide-react';
import { useLocation } from 'wouter';
import { AuthError } from '@workspace/replit-auth-web';
import { authErrorKey, usePreferences } from '@/lib/auth-helpers';
import { useAuth } from '@workspace/replit-auth-web';
import { useDeleteBrainData } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { askSession } from '@/lib/ask-session';
import { useToast } from '@/hooks/use-toast';
import { PageHeader, Surface, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

// API is mounted at /api on the same origin (not under the web base path).
const EXPORT_URL = '/api/brain/export';

function filenameFrom(header: string | null) {
  const m = header && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return m ? decodeURIComponent(m[1]) : `brain-lite-export-${new Date().toISOString().slice(0, 10)}.json`;
}

function Section({ icon: Icon, title, children }: { icon: typeof Sun; title: string; children: React.ReactNode }) {
  return (
    <Surface className="rise p-5 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><Icon className="h-5 w-5 text-primary" />{title}</h2>
      {children}
    </Surface>
  );
}

export default function SettingsPage() {
  const { t, lang } = useI18n();
  usePageTitle(t('settingsTitle'));
  const { theme } = useTheme();
  const { setTheme, setLanguage: setLang } = usePreferences();
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const del = useDeleteBrainData();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const themes: { v: ThemeChoice; icon: typeof Sun; k: TKey }[] = [
    { v: 'light', icon: Sun, k: 'themeLight' }, { v: 'dark', icon: Moon, k: 'themeDark' }, { v: 'system', icon: Monitor, k: 'themeSystem' },
  ];

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(EXPORT_URL, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filenameFrom(res.headers.get('content-disposition'));
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: t('exportDone') });
    } catch {
      toast({ variant: 'destructive', title: t('exportFail') });
    } finally { setExporting(false); }
  };

  const doDelete = () => {
    if (typed !== 'DELETE') return;
    del.mutate({ data: { confirmation: 'DELETE' } }, {
      onSuccess: () => {
        askSession.clear();
        qc.removeQueries({ predicate: (q) => String(q.queryKey[0] ?? '').startsWith('/api/memories') || String(q.queryKey[0] ?? '').startsWith('/api/brain') });
        qc.invalidateQueries();
        setOpen(false); setTyped('');
        toast({ title: t('deleteAllDone') });
      },
      onError: () => toast({ variant: 'destructive', title: t('deleteAllFail'), description: t('retry') }),
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('settingsTitle')} lead={t('settingsLead')} />
      <div className="space-y-4">
        <AccountSection />
        <Section icon={Palette} title={t('appearance')}>
          <p className="mb-2 text-sm font-medium">{t('theme')}</p>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('theme')}>
            {themes.map(({ v, icon: Icon, k }) => (
              <button key={v} role="radio" aria-checked={theme === v} onClick={() => setTheme(v)} data-testid={`button-settings-theme-${v}`}
                className={cn('flex flex-col items-center gap-1.5 rounded-xl border p-3 text-sm font-medium transition', theme === v ? 'border-primary bg-lavender text-primary' : 'border-border hover:border-primary/30')}>
                <Icon className="h-5 w-5" />{t(k)}
              </button>
            ))}
          </div>
          <p className="mb-2 mt-5 flex items-center gap-2 text-sm font-medium"><Languages className="h-4 w-4" />{t('language')}</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('language')}>
            {([['en', 'English'], ['ar', 'العربية']] as const).map(([v, label]) => (
              <button key={v} role="radio" aria-checked={lang === v} onClick={() => setLang(v)} data-testid={`button-settings-lang-${v}`}
                className={cn('rounded-xl border p-3 text-sm font-medium transition', lang === v ? 'border-primary bg-lavender text-primary' : 'border-border hover:border-primary/30')}>
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section icon={ShieldCheck} title={t('privacyTitle')}>
          <p className="font-medium" data-testid="text-privacy-note">{t('privacyNote')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('aiNotice')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('askPrivacy')}</p>
        </Section>

        <Section icon={Download} title={t('dataTitle')}>
          {isLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted" /> : !isAuthenticated ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{t('loginForData')}</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
                <div><p className="font-medium">{t('exportTitle')}</p><p className="text-sm text-muted-foreground">{t('exportBody')}</p></div>
                <button onClick={doExport} disabled={exporting} className={btnGhost} data-testid="button-export">
                  {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{exporting ? t('exporting') : t('exportBtn')}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-5">
                <div className="max-w-sm"><p className="font-medium text-destructive">{t('deleteAllTitle')}</p><p className="text-sm text-muted-foreground">{t('deleteAllBody')}</p></div>
                <button onClick={() => { setTyped(''); setOpen(true); }} className={cn(btnGhost, 'border-destructive/40 text-destructive hover:bg-destructive/10')} data-testid="button-delete-all">
                  <Trash2 className="h-4 w-4" />{t('deleteAllBtn')}
                </button>
              </div>
            </div>
          )}
        </Section>
      </div>

      <AlertDialog open={open} onOpenChange={(o) => { if (!del.isPending) setOpen(o); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />{t('deleteAllConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteAllConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-sm font-medium" htmlFor="confirm-delete">{t('typeDelete')}</label>
          <input id="confirm-delete" dir="ltr" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" className={fieldCls} data-testid="input-confirm-delete" />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending} data-testid="button-cancel-delete-all">{t('cancel')}</AlertDialogCancel>
            <button onClick={doDelete} disabled={typed !== 'DELETE' || del.isPending} data-testid="button-confirm-delete-all"
              className={cn(btnPrimary, 'bg-destructive text-destructive-foreground shadow-none')}>
              {del.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{del.isPending ? t('deleting') : t('deleteAllBtn')}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <DangerAccount />
    </div>
  );
}

function AccountSection() {
  const { t } = useI18n();
  const { user, updateProfile, changePassword, logout } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [name, setName] = useState(user?.name ?? '');
  const [nameErr, setNameErr] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const init = useRef<string | null>(null);
  useEffect(() => { if (user && init.current !== user.id) { init.current = user.id; setName(user.name); } }, [user]);
  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [outBusy, setOutBusy] = useState(false);
  if (!user) return null;
  const dirty = name.trim() !== user.name;

  const saveName = async () => {
    const v = name.trim();
    if (!v) { setNameErr(t('vName')); return; }
    if (v.length > 100) { setNameErr(t('vNameLong')); return; }
    setNameErr(null); setSavingName(true);
    try { await updateProfile({ name: v }); toast({ title: t('nameSaved') }); }
    catch (e) { setNameErr(t(authErrorKey(e, 'other'))); }
    finally { setSavingName(false); }
  };
  const closePw = () => { setPwOpen(false); setCur(''); setNw(''); setPwErr(null); };
  const savePw = async () => {
    if (cur.length < 1) { setPwErr(t('wrongPassword')); return; }
    if (nw.length < 8) { setPwErr(t('vPassword')); return; }
    if (nw === cur) { setPwErr(t('vPasswordMatch')); return; }
    setPwErr(null); setPwBusy(true);
    try { await changePassword(cur, nw); closePw(); toast({ title: t('passwordChanged') }); }
    catch (e) { setPwErr(e instanceof AuthError && (e.status === 401 || e.status === 400) ? t('wrongPassword') : t(authErrorKey(e, 'other'))); }
    finally { setPwBusy(false); }
  };
  const doLogout = async () => {
    setOutBusy(true);
    try { await logout(); navigate('/login', { replace: true }); }
    catch { toast({ variant: 'destructive', title: t('logoutFail') }); setOutBusy(false); }
  };

  return (
    <Section icon={UserRound} title={t('accountTitle')}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('fEmail')}</p>
          <p className="rounded-xl bg-muted px-3.5 py-2.5 text-sm" dir="ltr" data-testid="text-account-email">{user.email}</p>
        </div>
        <div>
          <label htmlFor="account-name" className="mb-1.5 block text-sm font-medium">{t('fName')}</label>
          <div className="flex gap-2">
            <input id="account-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameErr} className={fieldCls} data-testid="input-account-name" />
            <button onClick={saveName} disabled={!dirty || savingName} className={cn(btnPrimary, 'shrink-0')} data-testid="button-save-name">
              {savingName && <Loader2 className="h-4 w-4 animate-spin" />}{t('saveName')}
            </button>
          </div>
          {nameErr && <p role="alert" className="mt-1.5 text-xs font-medium text-destructive">{nameErr}</p>}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <button onClick={() => setPwOpen(true)} className={btnGhost} data-testid="button-change-password"><KeyRound className="h-4 w-4" />{t('changePassword')}</button>
          <button onClick={doLogout} disabled={outBusy} className={btnGhost} data-testid="button-settings-logout">
            {outBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4 rtl:-scale-x-100" />}{outBusy ? t('loggingOut') : t('logout')}
          </button>
        </div>
      </div>
      <AlertDialog open={pwOpen} onOpenChange={(o) => { if (!pwBusy && !o) closePw(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />{t('changePassword')}</AlertDialogTitle>
            <AlertDialogDescription>{t('changePasswordBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void savePw(); }}>
            <label className="block text-sm font-medium" htmlFor="pw-current">{t('fCurrentPassword')}</label>
            <input id="pw-current" type="password" dir="ltr" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} className={fieldCls} data-testid="input-current-password" />
            <label className="block text-sm font-medium" htmlFor="pw-new">{t('fNewPassword')}</label>
            <input id="pw-new" type="password" dir="ltr" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} className={fieldCls} data-testid="input-new-password" />
            <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
            {pwErr && <p role="alert" className="text-sm font-medium text-destructive" data-testid="error-password">{pwErr}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={pwBusy} data-testid="button-cancel-password">{t('cancel')}</AlertDialogCancel>
              <button type="submit" disabled={pwBusy} className={btnPrimary} data-testid="button-confirm-password">
                {pwBusy && <Loader2 className="h-4 w-4 animate-spin" />}{pwBusy ? t('updating') : t('changePassword')}
              </button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

function DangerAccount() {
  const { t } = useI18n();
  const { user, deleteAccount } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const close = () => { setOpen(false); setTyped(''); setPw(''); setErr(null); };
  const doDelete = async () => {
    if (typed !== 'DELETE' || !pw) return;
    setBusy(true); setErr(null);
    try {
      await deleteAccount(pw);
      setTyped(''); setPw(''); setOpen(false);
      askSession.clear();
      toast({ title: t('deleteAccountDone') });
      navigate('/login', { replace: true });
    } catch (e) {
      setPw('');
      setErr(e instanceof AuthError && (e.status === 401 || e.status === 400) ? t('wrongPassword') : e instanceof AuthError && e.status === 429 ? t('authRate') : t('deleteAccountFail'));
      setBusy(false);
    }
  };
  return (
    <Surface className="rise mt-4 border-destructive/30 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-sm"><p className="font-display text-lg font-semibold text-destructive">{t('deleteAccountTitle')}</p><p className="text-sm text-muted-foreground">{t('deleteAccountBody')}</p></div>
        <button onClick={() => setOpen(true)} className={cn(btnPrimary, 'bg-destructive text-destructive-foreground shadow-none')} data-testid="button-delete-account"><Trash2 className="h-4 w-4" />{t('deleteAccountBtn')}</button>
      </div>
      <AlertDialog open={open} onOpenChange={(o) => { if (!busy && !o) close(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />{t('deleteAccountConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteAccountConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-sm font-medium" htmlFor="acct-confirm">{t('typeDelete')}</label>
          <input id="acct-confirm" dir="ltr" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" className={fieldCls} data-testid="input-confirm-delete-account" />
          <label className="block text-sm font-medium" htmlFor="acct-pw">{t('enterPassword')}</label>
          <input id="acct-pw" type="password" dir="ltr" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className={fieldCls} data-testid="input-delete-account-password" />
          {err && <p role="alert" className="text-sm font-medium text-destructive" data-testid="error-delete-account">{err}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="button-cancel-delete-account">{t('cancel')}</AlertDialogCancel>
            <button onClick={doDelete} disabled={typed !== 'DELETE' || !pw || busy} className={cn(btnPrimary, 'bg-destructive text-destructive-foreground shadow-none')} data-testid="button-confirm-delete-account">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{busy ? t('deleting') : t('deleteAccountBtn')}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Surface>
  );
}
