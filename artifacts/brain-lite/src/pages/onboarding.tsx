import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ArrowRight, CalendarClock, Loader2, MessageCircleQuestion, Plus } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { nextParam } from '@/lib/auth-helpers';
import { useToast } from '@/hooks/use-toast';
import { btnPrimary } from '@/components/kit';
import { cn } from '@/lib/utils';
import { Medallion, OrnamentDivider, Wordmark } from '@/components/brand';
import { LangSwitch, ThemeCycle } from '@/components/app-shell';
import { PushPermission } from '@/components/notifications';

const steps: { icon: typeof Plus; title: TKey; body: TKey; tone: string }[] = [
  { icon: Plus, title: 'ob1Title', body: 'ob1Body', tone: 'text-gold' },
  { icon: MessageCircleQuestion, title: 'ob2Title', body: 'ob2Body', tone: 'text-gold' },
  { icon: CalendarClock, title: 'ob3Title', body: 'ob3Body', tone: 'text-gold' },
];

export default function OnboardingPage() {
  const { t } = useI18n();
  usePageTitle(t('ob1Title'));
  const { updateProfile } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const next = nextParam(useSearch());
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const s = steps[Math.min(i, steps.length - 1)];
  const Icon = s.icon;

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await updateProfile({ onboardingCompleted: true });
      navigate(next, { replace: true });
    } catch {
      toast({ variant: 'destructive', title: t('authGeneric') });
      setBusy(false);
    }
  };

  return (
    <div className="pattern-star flex min-h-[100dvh] flex-col px-5 py-5 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Wordmark name={t('appName')} size="sm" />
        <div className="flex items-center gap-1"><LangSwitch compact /><ThemeCycle /></div>
        <button onClick={finish} disabled={busy} className="min-h-11 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-gold-soft hover:text-foreground" data-testid="button-onboarding-skip">{t('obSkip')}</button>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        {i === steps.length ? <PushPermission onLater={finish} onEnabled={finish} /> : <div key={i} className="rise">
          <Medallion className={cn('mb-8 h-36 w-36', s.tone)}><Icon className="h-10 w-10" strokeWidth={1.5} /></Medallion>
          <p className="eyebrow text-center text-gold" aria-live="polite">{t('obStep').replace('{n}', String(i + 1))}</p>
          <h1 className="mt-2 text-center font-display text-4xl leading-tight sm:text-5xl" data-testid="text-onboarding-title">{t(s.title)}</h1>
          <OrnamentDivider className="mx-auto my-5 max-w-[12rem]" />
          <p className="text-center text-lg text-muted-foreground">{t(s.body)}</p>
        </div>}
        <div className="mt-12 flex items-center justify-between gap-4">
          <div className="flex gap-2" role="tablist" aria-label={t('obStep').replace('{n}', String(i + 1))}>
            {[...steps, steps[steps.length - 1]].map((_, j) => (
              <button key={j} role="tab" aria-selected={i === j} aria-label={t('obStep').replace('{n}', String(j + 1))} onClick={() => setI(j)} data-testid={`button-onboarding-dot-${j}`}
                className="group grid h-11 min-w-11 place-items-center"><span className={cn('block h-2 rounded-full transition-all', i === j ? 'w-8 gold-gradient' : 'w-2 bg-muted-foreground/30 group-hover:bg-gold-400/60')} /></button>
            ))}
          </div>
          {i < steps.length
            ? <button onClick={() => setI(i + 1)} className={btnPrimary} data-testid="button-onboarding-next">{t('obNext')}<ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></button>
            : <button onClick={finish} disabled={busy} className={btnPrimary} data-testid="button-onboarding-finish">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('obStart')}</button>}
        </div>
      </div>
    </div>
  );
}
