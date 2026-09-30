import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Languages, Loader2, LogIn, Monitor, Moon, Palette, ShieldCheck, Sun, Trash2 } from 'lucide-react';
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
  const { t, lang, setLang } = useI18n();
  usePageTitle(t('settingsTitle'));
  const { theme, setTheme } = useTheme();
  const { isAuthenticated, isLoading, login } = useAuth();
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
              <button onClick={login} className={btnPrimary} data-testid="button-settings-login"><LogIn className="h-4 w-4" />{t('login')}</button>
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
    </div>
  );
}
