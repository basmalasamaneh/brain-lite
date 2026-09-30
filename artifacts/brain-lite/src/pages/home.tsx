import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, CheckCircle2, Clock, Inbox, Layers, Lock, Plus } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { getListMemoriesQueryKey, useGetMemoryStats, useListMemories, useUpdateMemory } from '@workspace/api-client-react';
import { useInvalidateMemories } from '@/lib/memory';
import { ConfidenceMeter, ConfirmChange } from '@/components/extraction';
import { TypeChip, btnGhost } from '@/components/kit';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { EmptyState, ErrorState, MemoryCard, MemoryCardSkeleton, SampleBanner, Surface, btnPrimary } from '@/components/kit';
import { cn } from '@/lib/utils';

export default function HomePage() {
  const { t, lang } = useI18n();
  usePageTitle(t('navHome'));
  const { user, isAuthenticated, login } = useAuth();
  const [, navigate] = useLocation();
  const invalidate = useInvalidateMemories();
  const update = useUpdateMemory();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [inboxError, setInboxError] = useState(false);
  const inboxParams = { status: 'needs_review' as const };
  const inbox = useListMemories(inboxParams, { query: { queryKey: getListMemoriesQueryKey(inboxParams) } });
  const confirmOne = (id: number) => {
    if (pendingId != null) return;
    setPendingId(id); setInboxError(false);
    update.mutate({ id, data: { status: 'confirmed' } }, {
      onSuccess: () => { invalidate(id); setPendingId(null); },
      onError: () => { setInboxError(true); setPendingId(null); },
    });
  };
  const nf = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en');
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

      <section className="rise mb-10" data-testid="section-inbox">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-semibold"><Inbox className="h-5 w-5 text-primary" />{t('inboxTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('inboxLead')}</p>
          </div>
          {stats.data && <p className="text-sm font-medium tabular-nums" data-testid="text-counter">{nf(stats.data.confirmed)} {t('organized')} · {nf(stats.data.needs_review)} {t('needConfirmation')}</p>}
        </div>
        {inbox.isLoading ? <div className="space-y-3">{[0, 1].map((i) => <MemoryCardSkeleton key={i} />)}</div>
          : inbox.isError ? <ErrorState onRetry={() => inbox.refetch()} />
          : (inbox.data ?? []).length === 0 ? <Surface className="flex items-center gap-3 p-5 text-sm text-muted-foreground" data-testid="text-inbox-empty"><CheckCircle2 className="h-5 w-5 text-green" />{t('inboxEmpty')}</Surface>
          : <div className="space-y-3">
              {(inbox.data ?? []).slice(0, 6).map((m) => (
                <Surface key={m.id} className="grid gap-4 p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-center sm:p-5" data-testid={`card-inbox-${m.id}`}>
                  <Link href={`/memories/${m.id}`} className="min-w-0" data-testid={`link-inbox-${m.id}`}>
                    <TypeChip type={m.type} />
                    <p className="mt-1.5 truncate font-medium">{m.title}</p>
                    {m.summary && <p className="truncate text-sm text-muted-foreground">{m.summary}</p>}
                  </Link>
                  {m.extraction_status === 'extracted' ? <ConfidenceMeter value={m.confidence} /> : <span />}
                  <div className="flex gap-2">
                    {isAuthenticated
                      ? <ConfirmChange id={m.id} confirming={pendingId === m.id} onConfirm={() => confirmOne(m.id)} onChange={() => navigate(`/memories/${m.id}?edit=1`)} />
                      : <button onClick={login} className={btnGhost} data-testid={`button-login-inbox-${m.id}`}><Lock className="h-4 w-4" />{t('login')}</button>}
                  </div>
                </Surface>
              ))}
              {inboxError && <p role="alert" className="text-sm text-destructive">{t('errSave')}</p>}
            </div>}
      </section>

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
