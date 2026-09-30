import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Plus, Search, X } from 'lucide-react';
import { useListMemories, getListMemoriesQueryKey } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { MEMORY_TYPES, typeMeta } from '@/lib/memory';
import { EmptyState, ErrorState, MemoryCard, MemoryCardSkeleton, PageHeader, SampleBanner, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';
import { VoiceQuestion } from '@/components/voice-question';
import { RelatedResults } from '@/components/semantic-memories';
import { useRelatedMemories, type SearchFilters } from '@/hooks/use-semantic-search';
import { searchText } from '@/lib/i18n-search';

export default function MemoriesPage() {
  const { t, lang } = useI18n();
  usePageTitle(t('memoriesTitle'));
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [submitted, setSubmitted] = useState('');
  const invalidDates = !!(dateFrom && dateTo && dateFrom > dateTo);
  useEffect(() => { const id = setTimeout(() => setSearch(q.trim()), 400); return () => clearTimeout(id); }, [q]);

  // Native date input values are YYYY-MM-DD strings. Never convert them to Date:
  // the generated URL serializer uses String(value), not a date-only formatter.
  const filters: SearchFilters = { ...(type ? { type } : {}), ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) };
  const params = { ...filters, ...(search ? { search } : {}) };
  const list = useListMemories(Object.keys(params).length ? params : undefined, { query: { queryKey: getListMemoriesQueryKey(params), enabled: !invalidDates } });
  const related = useRelatedMemories(submitted, filters, !invalidDates);
  const filtered = !!(type || q.trim() || search || dateFrom || dateTo);
  const changeQuestion = (text: string) => { setQ(text); setSubmitted(''); };
  const clear = () => { changeQuestion(''); setSearch(''); setType(''); setDateFrom(''); setDateTo(''); };

  return (
    <>
      <SampleBanner />
      <PageHeader eyebrow={t('memoriesEyebrow')} title={t('memoriesTitle')} lead={t('memoriesLead')}
        action={<Link href="/capture" className={cn(btnPrimary, 'hidden md:inline-flex')} data-testid="link-new-memory"><Plus className="h-4 w-4" />{t('captureSomething')}</Link>} />

      <div className="rise smart-search sticky z-20 -mx-4 mb-6 space-y-3 bg-background/95 px-4 py-3 backdrop-blur md:mx-0 md:px-0" style={{ animationDelay: '60ms' }}>
        <form onSubmit={(e) => { e.preventDefault(); if (!invalidDates) { setSearch(q.trim()); setSubmitted(q.trim()); if (submitted === q.trim() && submitted) void related.refetch(); } }} className="relative flex h-12 w-full min-w-0 items-center rounded-xl border border-input bg-card focus-within:border-gold-500">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={q} onChange={(e) => changeQuestion(e.target.value)} placeholder={t('searchPlaceholder')} className="h-full min-w-0 flex-1 rounded-xl bg-transparent ps-10 pe-1 text-sm outline-none" data-testid="input-search" enterKeyHint="search" />
          {q && <button type="button" onClick={() => { changeQuestion(''); setSearch(''); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-gold-soft hover:text-foreground" aria-label={t('clearFilters')} data-testid="button-clear-search"><X className="h-4 w-4" /></button>}
          <VoiceQuestion onTranscript={changeQuestion} testId="button-search-mic" />
          <button type="submit" disabled={!q.trim() || invalidDates} aria-label={searchText(lang, 'submit')} data-testid="button-search-submit" className="me-1 grid h-11 w-11 shrink-0 place-items-center rounded-xl text-gold hover:bg-gold-soft disabled:opacity-40"><Search className="h-4 w-4" /></button>
        </form>
        <div className="flex flex-wrap gap-2 pb-1">
          <button onClick={() => setType('')} className={cn('min-h-11 shrink-0 rounded-full px-4 text-sm font-medium transition active:scale-95', !type ? 'gold-gradient text-gold-ink soft-shadow' : 'bg-card border border-border hover:border-gold-400/60')} data-testid="filter-all">{t('all')}</button>
          {MEMORY_TYPES.map((ty) => {
            const Icon = typeMeta[ty].icon;
            return (
              <button key={ty} onClick={() => setType(type === ty ? '' : ty)} data-testid={`filter-${ty}`}
                className={cn('inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition active:scale-95', type === ty ? 'gold-gradient text-gold-ink soft-shadow' : 'bg-card border border-border hover:border-gold-400/60')}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />{t(`type_${ty}` as TKey)}
              </button>
            );
          })}
          {filtered && <button type="button" onClick={clear} className={btnGhost} data-testid="button-clear-filters"><X className="h-4 w-4" />{t('clearFilters')}</button>}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3">
          <label className="min-w-0 text-xs text-muted-foreground">{searchText(lang, 'from')}<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={cn(fieldCls, 'mt-1 min-w-0 max-w-full text-sm')} data-testid="input-search-date-from" /></label>
          <label className="min-w-0 text-xs text-muted-foreground">{searchText(lang, 'to')}<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={cn(fieldCls, 'mt-1 min-w-0 max-w-full text-sm')} data-testid="input-search-date-to" /></label>
        </div>
        {invalidDates && <p role="alert" className="text-sm text-danger-ink" data-testid="error-search-dates">{searchText(lang, 'dateError')}</p>}
      </div>

      {submitted && <h2 className="mb-3 font-display text-2xl">{searchText(lang, 'keyword')}</h2>}
      {!invalidDates && (list.isError ? <ErrorState onRetry={() => list.refetch()} />
        : !list.isSuccess || list.isFetching ? <div className="space-y-3" data-testid="status-keyword-loading">{[0, 1, 2, 3].map((i) => <MemoryCardSkeleton key={i} />)}</div>
        : (list.data ?? []).length === 0 ? (
          filtered
            ? <EmptyState title={t('noResults')} body={t('noResultsBody')} />
            : <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={<Link href="/capture" className={btnPrimary} data-testid="link-empty-capture"><Plus className="h-4 w-4" />{t('captureSomething')}</Link>} />
        ) : <div className="space-y-3" data-testid="list-memories">{list.data!.map((m, i) => <MemoryCard key={m.id} memory={m} index={i} />)}</div>)}
      {submitted && !invalidDates && <section className="mt-8" data-testid="section-related">
        <h2 className="mb-3 font-display text-2xl">{searchText(lang, 'related')}</h2>
        {related.isError ? <ErrorState onRetry={() => related.refetch()} />
          : !related.isSuccess || related.isFetching ? <div className="space-y-3">{[0, 1, 2].map((i) => <MemoryCardSkeleton key={i} />)}</div>
          : !related.data?.memories.length ? <EmptyState title={searchText(lang, 'relatedEmpty')} body={searchText(lang, 'relatedEmptyBody')} action={<Link href="/capture" className={btnPrimary} data-testid="link-related-capture">{t('captureSomething')}</Link>} />
          : <RelatedResults memories={related.data.memories} />}
      </section>}
    </>
  );
}
