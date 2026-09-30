import { Link } from 'wouter';
import { ArrowRight, CheckCircle2, Clock, Layers, Plus } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { useGetMemoryStats, useListMemories } from '@workspace/api-client-react';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { EmptyState, ErrorState, MemoryCard, MemoryCardSkeleton, SampleBanner, Surface, btnPrimary } from '@/components/kit';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const { t } = useI18n();
  usePageTitle(t('navHome'));
  const { user } = useAuth();
  const stats = useGetMemoryStats();
  const list = useListMemories();
  const h = new Date().getHours();
  const greet = h < 12 ? t('greetMorning') : h < 18 ? t('greetAfternoon') : t('greetEvening');
  const recent = (list.data ?? []).slice(0, 5);

  const tiles = [
    { k: 'statTotal' as const, v: stats.data?.total, icon: Layers, tone: 'bg-lavender text-primary' },
    { k: 'statReview' as const, v: stats.data?.needs_review, icon: Clock, tone: 'bg-amber/15 text-amber' },
    { k: 'statConfirmed' as const, v: stats.data?.confirmed, icon: CheckCircle2, tone: 'bg-green/15 text-green' },
  ];

  return (
    <>
      <SampleBanner />
      <section className="rise relative mb-8 overflow-hidden rounded-3xl bg-primary p-7 text-primary-foreground sm:p-10">
        <div className="breathe pointer-events-none absolute -end-16 -top-20 h-64 w-64 rounded-full bg-white/15 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 end-24 h-48 w-48 rounded-full bg-amber/30 blur-3xl" />
        <p className="relative text-sm font-medium text-primary-foreground/75">{greet}{user?.firstName ? `, ${user.firstName}` : ''}</p>
        <h1 className="relative font-display mt-2 max-w-lg text-3xl font-bold leading-tight sm:text-4xl" data-testid="text-page-title">{t('quickCapture')}</h1>
        <p className="relative mt-3 max-w-md text-primary-foreground/80">{t('quickCaptureBody')}</p>
        <Link href="/capture" className="relative mt-6 inline-flex items-center gap-2 rounded-xl bg-card px-5 py-2.5 text-sm font-semibold text-primary transition hover:gap-3 active:scale-95" data-testid="link-hero-capture">
          <Plus className="h-4 w-4" />{t('captureSomething')}
        </Link>
      </section>

      <p className="mb-4 text-muted-foreground">{t('homeLead')}</p>
      {stats.isError ? <div className="mb-10"><ErrorState onRetry={() => stats.refetch()} /></div> : (
        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
          {tiles.map(({ k, v, icon: Icon, tone }, i) => (
            <Surface key={k} className={cn('rise flex items-center gap-4 p-5', i === 0 && 'sm:p-6')} style={{ animationDelay: `${80 + i * 60}ms` }}>
              <span className={cn('grid h-11 w-11 place-items-center rounded-xl', tone)}><Icon className="h-5 w-5" /></span>
              <div>
                {stats.isLoading ? <div className="h-7 w-10 animate-pulse rounded bg-muted" /> :
                  <div className={cn('font-display font-bold tabular-nums', i === 0 ? 'text-3xl' : 'text-2xl')} data-testid={`text-${k}`}>{v ?? 0}</div>}
                <div className="text-sm text-muted-foreground">{t(k)}</div>
              </div>
            </Surface>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">{t('recent')}</h2>
        {recent.length > 0 && (
          <Link href="/memories" className="group inline-flex items-center gap-1 text-sm font-medium text-primary" data-testid="link-see-all">
            {t('seeAll')}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5 rtl:-scale-x-100" />
          </Link>
        )}
      </div>
      {list.isLoading ? <div className="space-y-3">{[0, 1, 2].map((i) => <MemoryCardSkeleton key={i} />)}</div>
        : list.isError ? <ErrorState onRetry={() => list.refetch()} />
        : recent.length === 0 ? <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={<Link href="/capture" className={btnPrimary} data-testid="link-empty-capture"><Plus className="h-4 w-4" />{t('captureSomething')}</Link>} />
        : <div className="space-y-3">{recent.map((m, i) => <MemoryCard key={m.id} memory={m} index={i} />)}</div>}
    </>
  );
}
