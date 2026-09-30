import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Plus, Search, X } from 'lucide-react';
import { useListMemories } from '@workspace/api-client-react';
import { useI18n, usePageTitle, type TKey } from '@/lib/i18n';
import { MEMORY_TYPES, typeMeta } from '@/lib/memory';
import { EmptyState, ErrorState, MemoryCard, MemoryCardSkeleton, PageHeader, SampleBanner, btnGhost, btnPrimary, fieldCls } from '@/components/kit';
import { cn } from '@/lib/utils';

export default function MemoriesPage() {
  const { t } = useI18n();
  usePageTitle(t('memoriesTitle'));
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>('');
  useEffect(() => { const id = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(id); }, [q]);

  const params = { ...(type ? { type } : {}), ...(search ? { search } : {}) };
  const list = useListMemories(Object.keys(params).length ? params : undefined);
  const filtered = !!(type || search);
  const clear = () => { setQ(''); setSearch(''); setType(''); };

  return (
    <>
      <SampleBanner />
      <PageHeader title={t('memoriesTitle')} lead={t('memoriesLead')}
        action={<Link href="/capture" className={cn(btnPrimary, 'hidden md:inline-flex')} data-testid="link-new-memory"><Plus className="h-4 w-4" />{t('captureSomething')}</Link>} />

      <div className="rise sticky top-[61px] z-20 -mx-4 mb-6 space-y-3 bg-background/85 px-4 py-3 backdrop-blur md:top-0 md:mx-0 md:px-0" style={{ animationDelay: '60ms' }}>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('searchPlaceholder')} className={cn(fieldCls, 'bg-card ps-10 pe-10 py-3')} data-testid="input-search" />
          {q && <button onClick={() => setQ('')} className="absolute end-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label={t('clearFilters')} data-testid="button-clear-search"><X className="h-4 w-4" /></button>}
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <button onClick={() => setType('')} className={cn('shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition active:scale-95', !type ? 'bg-foreground text-background' : 'bg-card border border-border hover:border-primary/30')} data-testid="filter-all">{t('all')}</button>
          {MEMORY_TYPES.map((ty) => {
            const Icon = typeMeta[ty].icon;
            return (
              <button key={ty} onClick={() => setType(type === ty ? '' : ty)} data-testid={`filter-${ty}`}
                className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition active:scale-95', type === ty ? 'bg-primary text-primary-foreground' : 'bg-card border border-border hover:border-primary/30')}>
                <Icon className="h-3.5 w-3.5" />{t(`type_${ty}` as TKey)}
              </button>
            );
          })}
        </div>
      </div>

      {list.isLoading ? <div className="space-y-3">{[0, 1, 2, 3].map((i) => <MemoryCardSkeleton key={i} />)}</div>
        : list.isError ? <ErrorState onRetry={() => list.refetch()} />
        : (list.data ?? []).length === 0 ? (
          filtered
            ? <EmptyState title={t('noResults')} body={t('noResultsBody')} action={<button onClick={clear} className={btnGhost} data-testid="button-clear-filters">{t('clearFilters')}</button>} />
            : <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={<Link href="/capture" className={btnPrimary} data-testid="link-empty-capture"><Plus className="h-4 w-4" />{t('captureSomething')}</Link>} />
        ) : <div className="space-y-3" data-testid="list-memories">{list.data!.map((m, i) => <MemoryCard key={m.id} memory={m} index={i} />)}</div>}
    </>
  );
}
