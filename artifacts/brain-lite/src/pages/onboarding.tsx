import { useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import { ArrowRight, Brain, CalendarClock, Loader2, MessageCircleQuestion, Plus } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { nextParam } from '@/lib/auth-helpers';
import { useToast } from '@/hooks/use-toast';
import { btnPrimary } from '@/components/kit';
import { cn } from '@/lib/utils';

const steps: { icon: typeof Plus; title: TKey; body: TKey; tone: string }[] = [
  { icon: Plus, title: 'ob1Title', body: 'ob1Body', tone: 'bg-primary text-primary-foreground' },
  { icon: MessageCircleQuestion, title: 'ob2Title', body: 'ob2Body', tone: 'bg-amber text-[#1C1B29]' },
  { icon: CalendarClock, title: 'ob3Title', body: 'ob3Body', tone: 'bg-green text-[#0f1f1a]' },
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
  const s = steps[i];
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
    <div className="flex min-h-[100dvh] flex-col px-5 py-5 sm:px-10">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Brain className="h-5 w-5" /></span><span className="font-display font-bold">{t('appName')}</span></span>
        <button onClick={finish} disabled={busy} className="rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid="button-onboarding-skip">{t('obSkip')}</button>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
        <div key={i} className="rise">
          <div className="relative mb-10 h-40">
            <div className="breathe absolute start-6 top-4 h-32 w-32 rounded-full bg-primary/20 blur-2xl" />
            <span className={cn('relative grid h-24 w-24 place-items-center rounded-[1.75rem] soft-shadow', s.tone)}><Icon className="h-10 w-10" /></span>
            <span className="absolute start-28 top-20 h-3 w-3 rounded-full bg-amber" />
            <span className="absolute start-36 top-8 h-2 w-2 rounded-full bg-primary/60" />
          </div>
          <p className="text-sm font-medium text-primary" aria-live="polite">{t('obStep').replace('{n}', String(i + 1))}</p>
          <h1 className="mt-2 font-display text-4xl font-bold leading-tight" data-testid="text-onboarding-title">{t(s.title)}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{t(s.body)}</p>
        </div>
        <div className="mt-12 flex items-center justify-between gap-4">
          <div className="flex gap-2" role="tablist" aria-label={t('obStep').replace('{n}', String(i + 1))}>
            {steps.map((_, j) => (
              <button key={j} role="tab" aria-selected={i === j} aria-label={t('obStep').replace('{n}', String(j + 1))} onClick={() => setI(j)} data-testid={`button-onboarding-dot-${j}`}
                className={cn('h-2 rounded-full transition-all', i === j ? 'w-8 bg-primary' : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50')} />
            ))}
          </div>
          {i < steps.length - 1
            ? <button onClick={() => setI(i + 1)} className={btnPrimary} data-testid="button-onboarding-next">{t('obNext')}<ArrowRight className="h-4 w-4 rtl:-scale-x-100" /></button>
            : <button onClick={finish} disabled={busy} className={btnPrimary} data-testid="button-onboarding-finish">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('obStart')}</button>}
        </div>
      </div>
    </div>
  );
}
