import { Link } from 'wouter';
import { useI18n } from '@/lib/i18n';
import { searchText } from '@/lib/i18n-search';
import { useSimilarMemories, type RankedMemory } from '@/hooks/use-semantic-search';
import { EmptyState, ErrorState, MemoryCard, MemoryCardSkeleton, TypeChip } from '@/components/kit';

export function Relevance({ value, id }: { value?: number; id: number }) {
  const { lang } = useI18n();
  if (value == null || !Number.isFinite(value)) return null;
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" data-testid={`relevance-${id}`} aria-label={`${searchText(lang, 'relevance')}: ${percent}%`}>
      <span>{searchText(lang, 'relevance')}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="gold-gradient block h-full rounded-full" style={{ width: `${percent}%` }} /></span>
    </div>
  );
}

export function RelatedResults({ memories }: { memories: RankedMemory[] }) {
  return <div className="space-y-3">{memories.map((m, i) => <div key={m.id}><MemoryCard memory={m} index={i} /><div className="px-4"><Relevance value={m.relevance} id={m.id} /></div></div>)}</div>;
}

export function SimilarMemories({ id }: { id: number }) {
  const { lang, t } = useI18n();
  const query = useSimilarMemories(id);
  return (
    <section className="mt-8 min-w-0" data-testid="section-similar">
      <h2 className="mb-3 font-display text-2xl">{searchText(lang, 'similar')}</h2>
      {query.isLoading ? <MemoryCardSkeleton /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : !query.data?.memories.length
        ? <EmptyState title={searchText(lang, 'similarEmpty')} />
        : <div className="flex gap-3 overflow-x-auto pb-3 snap-x">
          {query.data.memories.map((m) => <Link key={m.id} href={`/memories/${m.id}`} data-testid={`link-similar-${m.id}`} className="w-64 shrink-0 snap-start rounded-2xl border border-card-border bg-card p-4 hover:border-gold-400/50">
            <TypeChip type={m.type} /><h3 className="mt-3 truncate font-display text-lg">{m.title}</h3>
            <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{m.summary || m.raw_text}</p>
            <Relevance value={m.relevance} id={m.id} />
          </Link>)}
        </div>}
      {query.isError && <p className="sr-only">{t('retry')}</p>}
    </section>
  );
}