import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CheckCircle2, Inbox, Lock } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import { getListMemoriesQueryKey, useGetMemoryStats, useListMemories, useUpdateMemory } from '@workspace/api-client-react';
import { useInvalidateMemories } from '@/lib/memory';
import { ConfidenceMeter, ConfirmChange } from '@/components/extraction';
import { TypeChip, btnGhost } from '@/components/kit';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { ErrorState, MemoryCardSkeleton, SampleBanner, Surface } from '@/components/kit';
import { DailyBriefSection } from '@/components/daily-brief';

import { IconCircle } from '@/components/brand';
export default function HomePage() {
  const { t, lang } = useI18n();
  usePageTitle(t('navHome'));
  const { isAuthenticated, login } = useAuth();
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

  return (
    <>
      <SampleBanner />
      <DailyBriefSection />

      <section className="rise mb-10" data-testid="section-inbox">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-3 font-display text-2xl"><IconCircle icon={Inbox} size="sm" />{t('inboxTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('inboxLead')}</p>
          </div>
          {stats.data && <p className="text-sm font-medium tabular-nums" data-testid="text-counter">{nf(stats.data.confirmed)} {t('organized')} · {nf(stats.data.needs_review)} {t('needConfirmation')}</p>}
        </div>
        {inbox.isLoading ? <div className="space-y-3">{[0, 1].map((i) => <MemoryCardSkeleton key={i} />)}</div>
          : inbox.isError ? <ErrorState onRetry={() => inbox.refetch()} />
          : (inbox.data ?? []).length === 0 ? <Surface className="flex items-center gap-3 p-5 text-sm text-muted-foreground" data-testid="text-inbox-empty"><CheckCircle2 className="h-5 w-5 text-success-ink" />{t('inboxEmpty')}</Surface>
          : <div className="space-y-3">
              {(inbox.data ?? []).slice(0, 6).map((m) => (
                <Surface key={m.id} className="lift grid gap-4 p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-center sm:p-5" data-testid={`card-inbox-${m.id}`}>
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
              {inboxError && <p role="alert" className="text-sm text-danger-ink">{t('errSave')}</p>}
            </div>}
      </section>

    </>
  );
}
